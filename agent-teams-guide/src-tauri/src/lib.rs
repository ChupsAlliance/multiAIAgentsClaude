use std::process::Command;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use serde::{Deserialize, Serialize};

// ── Prompt templates (loaded at compile time from .md files) ──
const PROMPT_DEPLOY_AGENT_TEAMS: &str = include_str!("../prompts/deploy_agent_teams.md");
const PROMPT_DEPLOY_STANDARD: &str = include_str!("../prompts/deploy_standard.md");
const PROMPT_CONTINUE_MISSION: &str = include_str!("../prompts/continue_mission.md");
use std::fs;
use std::path::Path;
use tokio::sync::RwLock;
use tokio::io::{AsyncBufReadExt, BufReader};
use regex::Regex;

// ─── Existing structs ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionOutput {
    pub session_id: String,
    pub content: String,
    pub output_type: String,
}

// ─── Mission data structs ───────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentStatus {
    Spawning,
    Working,
    Idle,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Blocked,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MissionStatus {
    Idle,
    Launching,
    Running,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub name: String,
    pub role: String,
    pub status: AgentStatus,
    pub current_task: Option<String>,
    pub spawned_at: i64,
    pub model: Option<String>,
    pub model_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub status: TaskStatus,
    pub assigned_agent: Option<String>,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub priority: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LogEntry {
    #[serde(default)]
    pub timestamp: i64,
    #[serde(default)]
    pub agent: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub log_type: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub phase_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub file_path: Option<String>,  // for Write/Edit log entries — enables Files tab linking
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub lines: Option<i64>,         // line count for Write/Edit operations
}

impl LogEntry {
    fn new(timestamp: i64, agent: impl Into<String>, message: impl Into<String>, log_type: impl Into<String>) -> Self {
        Self {
            timestamp,
            agent: agent.into(),
            message: message.into(),
            log_type: log_type.into(),
            tool_name: None,
            phase_hint: None,
            file_path: None,
            lines: None,
        }
    }

    fn with_tool(mut self, tool: impl Into<String>) -> Self {
        let t: String = tool.into();
        self.phase_hint = Some(Self::infer_phase(&t));
        self.tool_name = Some(t);
        self
    }

    fn infer_phase(tool: &str) -> String {
        match tool {
            "Read" | "Glob" | "Grep" | "WebSearch" | "WebFetch" => "investigating".into(),
            "Write" | "Edit" | "NotebookEdit" => "coding".into(),
            "Bash" => "building".into(),
            "Agent" => "spawning".into(),
            _ => "coding".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub action: String,
    pub agent: String,
    pub timestamp: i64,
    pub lines: Option<i64>,          // line count for Write / lines changed for Edit
    pub content_preview: Option<String>, // first ~200 chars of written/new content
    pub diff_old: Option<String>,    // Edit: old_string (truncated)
    pub diff_new: Option<String>,    // Edit: new_string (truncated)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub timestamp: i64,
    pub from: String,
    pub to: String,
    pub content: String,
    pub msg_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MissionPhase {
    Planning,      // Lead analyzing, user waiting
    ReviewPlan,    // Plan ready, user picks models
    Deploying,     // User confirmed, subagents spawning
    Executing,     // Subagents working
    Done,          // Mission completed
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissionState {
    pub id: String,
    pub description: String,
    pub project_path: String,
    pub status: MissionStatus,
    pub phase: MissionPhase,
    pub agents: Vec<Agent>,
    pub tasks: Vec<Task>,
    pub log: Vec<LogEntry>,
    pub file_changes: Vec<FileChange>,
    pub started_at: i64,
    pub raw_output: Vec<String>,
    pub team_name: Option<String>,
    pub messages: Vec<AgentMessage>,
    pub execution_mode: String,  // "standard" | "agent_teams"
}

// ─── Output parser ──────────────────────────────────────────────

fn strip_ansi(s: &str) -> String {
    let re = Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    re.replace_all(s, "").to_string()
}

/// Parse progress lines like "[AgentName] message" into (agent, message)
fn parse_progress_line(text: &str) -> (String, String) {
    let trimmed = text.trim();
    if trimmed.starts_with('[') {
        if let Some(end) = trimmed.find(']') {
            let agent = trimmed[1..end].to_string();
            let msg = trimmed[end + 1..].trim().to_string();
            if !agent.is_empty() && !msg.is_empty() {
                return (agent, msg);
            }
        }
    }
    ("Lead".to_string(), trimmed.to_string())
}

fn infer_role(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("backend") || lower == "be" { return "Backend Developer".into(); }
    if lower.contains("frontend") || lower == "fe" { return "Frontend Developer".into(); }
    if lower.contains("test") || lower.contains("qc") || lower.contains("qa") { return "Quality/Testing".into(); }
    if lower.contains("security") || lower.contains("sec") { return "Security Auditor".into(); }
    if lower.contains("perf") { return "Performance".into(); }
    if lower.contains("doc") { return "Documentation".into(); }
    if lower.contains("deploy") || lower.contains("devops") { return "DevOps".into(); }
    if lower == "lead" || lower == "orchestrator" { return "Lead Coordinator".into(); }
    name.to_string()
}

enum ParsedEvent {
    AgentMessage { agent: String, message: String },
    AgentSpawned { agent_name: String, role: String },
    TaskStarted { agent: String, description: String },
    TaskCompleted { agent: String, description: String },
    FileChanged { path: String, action: String, agent: String },
    RawLine(String),
}

struct OutputParser {
    known_agents: Vec<String>,
    current_agent: String,
    agent_msg_re: Regex,
    spawn_re: Regex,
    file_write_re: Regex,
    starting_re: Regex,
    completed_re: Regex,
}

impl OutputParser {
    fn new() -> Self {
        Self {
            known_agents: vec!["Lead".to_string()],
            current_agent: "Lead".to_string(),
            agent_msg_re: Regex::new(r"^\[([^\]]+)\]\s*(.+)$").unwrap(),
            spawn_re: Regex::new(r"(?i)spawn(?:ing|ed)?\s+(?:teammate\s+)?'([^']+)'").unwrap(),
            file_write_re: Regex::new(r"(?i)(?:writ|creat|modif|updat)(?:e|ed|ing)\s+(?:file[:\s]+)?[`']?([^\s`']+\.\w+)").unwrap(),
            starting_re: Regex::new(r"(?i)^Starting:\s*(.+)$").unwrap(),
            completed_re: Regex::new(r"(?i)^Completed:\s*(.+)$").unwrap(),
        }
    }

    fn parse_line(&mut self, line: &str) -> Vec<ParsedEvent> {
        let mut events = vec![];
        let clean = strip_ansi(line);
        let clean = clean.trim();
        if clean.is_empty() { return events; }

        events.push(ParsedEvent::RawLine(clean.to_string()));

        // Check [AgentName] prefix
        if let Some(caps) = self.agent_msg_re.captures(clean) {
            let agent = caps[1].to_string();
            let msg = caps[2].to_string();
            self.current_agent = agent.clone();

            if !self.known_agents.contains(&agent) {
                self.known_agents.push(agent.clone());
                events.push(ParsedEvent::AgentSpawned {
                    agent_name: agent.clone(),
                    role: infer_role(&agent),
                });
            }

            events.push(ParsedEvent::AgentMessage {
                agent: agent.clone(),
                message: msg.clone(),
            });

            // Check for spawn announcement in message
            if let Some(spawn_caps) = self.spawn_re.captures(&msg) {
                let spawned = spawn_caps[1].to_string();
                if !self.known_agents.contains(&spawned) {
                    self.known_agents.push(spawned.clone());
                    events.push(ParsedEvent::AgentSpawned {
                        agent_name: spawned.clone(),
                        role: infer_role(&spawned),
                    });
                }
            }

            // Check for task markers
            if let Some(task_caps) = self.starting_re.captures(&msg) {
                events.push(ParsedEvent::TaskStarted {
                    agent: agent.clone(),
                    description: task_caps[1].to_string(),
                });
            }
            if let Some(task_caps) = self.completed_re.captures(&msg) {
                events.push(ParsedEvent::TaskCompleted {
                    agent: agent.clone(),
                    description: task_caps[1].to_string(),
                });
            }

            // Check for file operations
            if let Some(file_caps) = self.file_write_re.captures(&msg) {
                events.push(ParsedEvent::FileChanged {
                    path: file_caps[1].to_string(),
                    action: "modified".into(),
                    agent: agent.clone(),
                });
            }
        } else {
            // No agent prefix — check for file operations in bare lines
            if let Some(file_caps) = self.file_write_re.captures(clean) {
                events.push(ParsedEvent::FileChanged {
                    path: file_caps[1].to_string(),
                    action: "modified".into(),
                    agent: self.current_agent.clone(),
                });
            }
        }

        events
    }
}

// ─── Mission Manager ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchivedMission {
    pub id: String,
    pub description: String,
    pub project_path: String,
    pub status: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub task_summary: Vec<String>,
    pub file_changes: Vec<FileChange>,
    pub agent_count: usize,
}

type SharedMissionState = Arc<RwLock<Option<MissionState>>>;
type SharedChild = Arc<RwLock<Option<tokio::process::Child>>>;
type SharedHistory = Arc<RwLock<Vec<ArchivedMission>>>;

struct MissionManager {
    state: SharedMissionState,
    child: SharedChild,
    #[allow(dead_code)]
    history: SharedHistory,
    watcher_stop: Arc<RwLock<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl MissionManager {
    fn new() -> Self {
        Self {
            state: Arc::new(RwLock::new(None)),
            child: Arc::new(RwLock::new(None)),
            history: Arc::new(RwLock::new(Vec::new())),
            watcher_stop: Arc::new(RwLock::new(None)),
        }
    }
}

struct MissionManagerState(Arc<RwLock<MissionManager>>);

async fn handle_parsed_event(
    state: &SharedMissionState,
    app: &AppHandle,
    event: ParsedEvent,
) {
    let now = chrono::Utc::now().timestamp_millis();

    match event {
        ParsedEvent::AgentSpawned { agent_name, role } => {
            {
                let mut st = state.write().await;
                if let Some(ref mut s) = *st {
                    if !s.agents.iter().any(|a| a.name == agent_name) {
                        s.agents.push(Agent {
                            name: agent_name.clone(),
                            role: role.clone(),
                            status: AgentStatus::Spawning,
                            current_task: None,
                            spawned_at: now,
                            model: None,
                            model_reason: None,
                        });
                    }
                    s.log.push(LogEntry {
                        timestamp: now,
                        agent: "System".into(),
                        message: format!("Agent '{}' spawned ({})", agent_name, role),
                        log_type: "spawn".into(),
                    tool_name: None,
                    phase_hint: None, file_path: None, lines: None,
                    });
                }
            }
            let _ = app.emit("mission:agent-spawned", serde_json::json!({
                "agent_name": agent_name,
                "role": role,
                "timestamp": now,
            }));
        }
        ParsedEvent::AgentMessage { agent, message } => {
            {
                let mut st = state.write().await;
                if let Some(ref mut s) = *st {
                    if let Some(a) = s.agents.iter_mut().find(|a| a.name == agent) {
                        if a.status == AgentStatus::Spawning || a.status == AgentStatus::Idle {
                            a.status = AgentStatus::Working;
                        }
                        let truncated = if message.len() > 80 { format!("{}...", &message[..77]) } else { message.clone() };
                        a.current_task = Some(truncated);
                    }
                    s.log.push(LogEntry {
                        timestamp: now,
                        agent: agent.clone(),
                        message: message.clone(),
                        log_type: "info".into(),
                    tool_name: None,
                    phase_hint: None, file_path: None, lines: None,
                    });
                    if s.log.len() > 2000 { s.log.drain(0..500); }
                }
            }
            let _ = app.emit("mission:log", serde_json::json!({
                "timestamp": now,
                "agent": agent,
                "message": message,
                "log_type": "info",
            }));
        }
        ParsedEvent::TaskStarted { agent, description } => {
            let task_id = format!("task-{}", now);
            {
                let mut st = state.write().await;
                if let Some(ref mut s) = *st {
                    s.tasks.push(Task {
                        id: task_id.clone(),
                        title: description.clone(),
                        status: TaskStatus::InProgress,
                        assigned_agent: Some(agent.clone()),
                        started_at: Some(now),
                        completed_at: None,
                        priority: None,
                    });
                    if let Some(a) = s.agents.iter_mut().find(|a| a.name == agent) {
                        a.status = AgentStatus::Working;
                        a.current_task = Some(description.clone());
                    }
                }
            }
            let _ = app.emit("mission:task-update", serde_json::json!({
                "task_id": task_id,
                "agent": agent,
                "description": description,
                "status": "in_progress",
                "timestamp": now,
            }));
        }
        ParsedEvent::TaskCompleted { agent, description } => {
            {
                let mut st = state.write().await;
                if let Some(ref mut s) = *st {
                    // Try to find matching task and mark complete
                    if let Some(t) = s.tasks.iter_mut().find(|t| {
                        t.assigned_agent.as_deref() == Some(&agent) && t.status == TaskStatus::InProgress
                    }) {
                        t.status = TaskStatus::Completed;
                        t.completed_at = Some(now);
                    } else {
                        // Task wasn't tracked; add as completed
                        s.tasks.push(Task {
                            id: format!("task-{}", now),
                            title: description.clone(),
                            status: TaskStatus::Completed,
                            assigned_agent: Some(agent.clone()),
                            started_at: Some(now),
                            completed_at: Some(now),
                            priority: None,
                        });
                    }
                    if let Some(a) = s.agents.iter_mut().find(|a| a.name == agent) {
                        a.status = AgentStatus::Idle;
                        a.current_task = None;
                    }
                }
            }
            let _ = app.emit("mission:task-update", serde_json::json!({
                "agent": agent,
                "description": description,
                "status": "completed",
                "timestamp": now,
            }));
        }
        ParsedEvent::FileChanged { path, action, agent } => {
            let fc = FileChange {
                path: path.clone(),
                action: action.clone(),
                agent: agent.clone(),
                timestamp: now,
                lines: None,
                content_preview: None,
                diff_old: None,
                diff_new: None,
            };
            {
                let mut st = state.write().await;
                if let Some(ref mut s) = *st {
                    s.file_changes.push(fc.clone());
                }
            }
            let _ = app.emit("mission:file-change", serde_json::json!({
                "path": path,
                "action": action,
                "agent": agent,
                "timestamp": now,
            }));
        }
        ParsedEvent::RawLine(line) => {
            {
                let mut st = state.write().await;
                if let Some(ref mut s) = *st {
                    s.raw_output.push(line.clone());
                    if s.raw_output.len() > 5000 { s.raw_output.drain(0..1000); }
                }
            }
            let _ = app.emit("mission:raw-line", serde_json::json!({ "line": line }));
        }
    }
}

// ─── Existing commands (unchanged) ──────────────────────────────

#[tauri::command]
fn check_claude_available() -> Result<String, String> {
    let output = Command::new("cmd")
        .args(["/C", "claude --version"])
        .env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_SESSION")
        .output();
    match output {
        Ok(o) if o.status.success() => {
            Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
        }
        Ok(o) => {
            Err(format!("Claude error: {}", String::from_utf8_lossy(&o.stderr)))
        }
        Err(_) => Err("Claude CLI not found. Please install Claude Code first.".to_string()),
    }
}

#[tauri::command]
fn get_system_info() -> serde_json::Value {
    let claude_ok = check_claude_available().is_ok();
    let userprofile = std::env::var("USERPROFILE").unwrap_or_else(|_| "~".to_string());
    let settings_path = format!("{}\\.claude\\settings.json", userprofile);
    let settings_exist = Path::new(&settings_path).exists();
    let agent_teams_enabled = if settings_exist {
        fs::read_to_string(&settings_path)
            .map(|s| s.contains("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"))
            .unwrap_or(false)
    } else {
        false
    };
    serde_json::json!({
        "claude_available": claude_ok,
        "settings_path": settings_path,
        "settings_exist": settings_exist,
        "agent_teams_enabled": agent_teams_enabled,
        "platform": std::env::consts::OS,
        "username": std::env::var("USERNAME").unwrap_or_default(),
    })
}

#[tauri::command]
fn enable_agent_teams() -> Result<String, String> {
    let userprofile = std::env::var("USERPROFILE")
        .map_err(|_| "Cannot find USERPROFILE".to_string())?;
    let claude_dir = format!("{}/.claude", userprofile);
    let settings_path = format!("{}/settings.json", claude_dir);

    fs::create_dir_all(&claude_dir)
        .map_err(|e| format!("Cannot create .claude dir: {}", e))?;

    let existing = if Path::new(&settings_path).exists() {
        fs::read_to_string(&settings_path)
            .map_err(|e| format!("Cannot read settings.json: {}", e))?
    } else {
        "{}".to_string()
    };

    let mut json: serde_json::Value = serde_json::from_str(&existing)
        .unwrap_or_else(|_| serde_json::json!({}));

    if json.get("env").is_none() {
        json["env"] = serde_json::json!({});
    }
    json["env"]["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = serde_json::json!("1");

    let new_content = serde_json::to_string_pretty(&json)
        .map_err(|e| format!("JSON serialize error: {}", e))?;
    fs::write(&settings_path, &new_content)
        .map_err(|e| format!("Cannot write settings.json: {}", e))?;

    Ok(settings_path)
}

#[tauri::command]
fn read_settings() -> Result<String, String> {
    let userprofile = std::env::var("USERPROFILE")
        .map_err(|_| "USERPROFILE not set".to_string())?;
    let path = format!("{}/.claude/settings.json", userprofile);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn scaffold_project(project_path: String, template_id: String, config: serde_json::Value) -> Result<serde_json::Value, String> {
    let base = Path::new(&project_path);
    if !base.exists() {
        return Err(format!("Directory not found: {}", project_path));
    }
    let agent_dir = base.join(".claude-agent-team");
    fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Cannot create dir: {}", e))?;
    let mut created_files: Vec<String> = vec![];

    match template_id.as_str() {
        "code-review" => {
            let files: &[(&str, &str)] = &[
                ("review-security.md", "# Security Review\n\n_Filled by security reviewer teammate_\n\n## Issues Found\n\n| Severity | File | Line | Description |\n|----------|------|------|-------------|\n\n## Summary\n\n"),
                ("review-performance.md", "# Performance Review\n\n_Filled by performance reviewer teammate_\n\n## Issues Found\n\n| Severity | File | Line | Description |\n|----------|------|------|-------------|\n\n## Summary\n\n"),
                ("review-quality.md", "# Code Quality Review\n\n_Filled by quality reviewer teammate_\n\n## Issues Found\n\n| Severity | File | Line | Description |\n|----------|------|------|-------------|\n\n## Summary\n\n"),
                ("review-report.md", "# Combined Review Report\n\n_Auto-generated by Lead agent after all reviews complete_\n\n## Critical\n\n## Major\n\n## Minor\n\n## Conclusion\n\n"),
            ];
            for (name, content) in files {
                let path = agent_dir.join(name);
                fs::write(&path, content).map_err(|e| e.to_string())?;
                created_files.push(path.to_string_lossy().to_string());
            }
        }
        "feature" => {
            let feature_name = config["feature_name"].as_str().unwrap_or("new-feature");
            let names_contents: Vec<(String, String)> = vec![
                (format!("api-design-{}.md", feature_name),
                 "# API Design\n\n_Backend agent fills this first_\n\n## Endpoints\n\n| Method | Path | Description |\n|--------|------|-------------|\n\n## TypeScript Interfaces\n\n```typescript\n// Backend agent fills this\n```\n\n".to_string()),
                (format!("progress-{}.md", feature_name),
                 "# Progress Tracker\n\n## Backend Agent\n- [ ] Service class\n- [ ] API endpoints\n- [ ] Unit tests\n\n## Frontend Agent\n- [ ] Components\n- [ ] State management\n- [ ] API integration\n\n## Tests Agent\n- [ ] Integration tests\n- [ ] E2E scenarios\n\n".to_string()),
            ];
            for (name, content) in &names_contents {
                let path = agent_dir.join(name);
                fs::write(&path, content).map_err(|e| e.to_string())?;
                created_files.push(path.to_string_lossy().to_string());
            }
        }
        "debug" => {
            let num = config["num_hypotheses"].as_u64().unwrap_or(3);
            for i in 1..=num {
                let name = format!("hypothesis-{}.md", i);
                let content = format!("# Hypothesis {i}\n\n_Teammate {i} investigates this theory_\n\n## Theory\n\n## Evidence For\n\n## Evidence Against\n\n## Files Investigated\n\n## Conclusion\n\n");
                let path = agent_dir.join(&name);
                fs::write(&path, &content).map_err(|e| e.to_string())?;
                created_files.push(path.to_string_lossy().to_string());
            }
            let rca = agent_dir.join("root-cause-analysis.md");
            fs::write(&rca, "# Root Cause Analysis\n\n_Synthesized by Lead after teammates share findings_\n\n## Most Likely Cause\n\n## Evidence\n\n## Fix Applied\n\n## Prevention\n\n").map_err(|e| e.to_string())?;
            created_files.push(rca.to_string_lossy().to_string());
        }
        "research" => {
            let files: &[(&str, &str)] = &[
                ("pros.md", "# Advantages & Use Cases\n\n_Filled by 'pros' teammate_\n\n## Key Benefits\n\n## Best Use Cases\n\n## Evidence / References\n\n"),
                ("cons.md", "# Disadvantages & Risks\n\n_Filled by 'cons' teammate_\n\n## Key Risks\n\n## Limitations\n\n## When to Avoid\n\n"),
                ("alternatives.md", "# Alternative Approaches\n\n_Filled by 'alternatives' teammate_\n\n## Option A\n\n## Option B\n\n## Comparison Table\n\n| Criteria | Current | Option A | Option B |\n|----------|---------|----------|----------|\n\n"),
                ("summary.md", "# Research Summary\n\n_Synthesized by Lead_\n\n## Recommendation\n\n## Rationale\n\n## Trade-offs\n\n"),
            ];
            for (name, content) in files {
                let path = agent_dir.join(name);
                fs::write(&path, content).map_err(|e| e.to_string())?;
                created_files.push(path.to_string_lossy().to_string());
            }
        }
        "migration" => {
            let files: &[(&str, &str)] = &[
                ("migration-plan.md", "# Migration Plan\n\n_Filled by architect teammate_\n\n## Scope\n\n## Breaking Changes\n\n## Step-by-step Plan\n\n"),
                ("migration-progress.md", "# Migration Progress\n\n## Files Migrated\n- [ ] \n\n## Issues Encountered\n\n## Blockers\n\n"),
                ("migration-tests.md", "# Migration Test Results\n\n_Filled by test teammate_\n\n## Tests Passing\n\n## Tests Failing\n\n## Coverage Report\n\n"),
            ];
            for (name, content) in files {
                let path = agent_dir.join(name);
                fs::write(&path, content).map_err(|e| e.to_string())?;
                created_files.push(path.to_string_lossy().to_string());
            }
        }
        _ => {}
    }

    Ok(serde_json::json!({
        "agent_dir": agent_dir.to_string_lossy(),
        "created_files": created_files,
    }))
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    match folder {
        Some(path) => Ok(path.to_string()),
        None => Err("No folder selected".to_string()),
    }
}

#[tauri::command]
async fn pick_files(app: AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let files = app.dialog().file()
        .add_filter("Documents", &["md", "txt", "pdf", "json", "yaml", "yml", "toml"])
        .add_filter("All files", &["*"])
        .blocking_pick_files();
    match files {
        Some(paths) => Ok(paths.into_iter().map(|p| p.to_string()).collect()),
        None => Err("No files selected".to_string()),
    }
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
fn get_file_info(path: String) -> Result<serde_json::Value, String> {
    let p = std::path::Path::new(&path);
    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to get file info: {}", e))?;
    Ok(serde_json::json!({
        "name": p.file_name().and_then(|n| n.to_str()).unwrap_or("unknown"),
        "path": path,
        "size": metadata.len(),
        "is_dir": metadata.is_dir(),
        "extension": p.extension().and_then(|e| e.to_str()).unwrap_or(""),
    }))
}

/// Save a base64-encoded clipboard image to a temp file, return its path
#[tauri::command]
fn save_clipboard_image(base64_data: String) -> Result<serde_json::Value, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    let temp_dir = std::env::temp_dir().join("agent-teams-guide");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Cannot create temp dir: {}", e))?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("clipboard_{}.png", ts);
    let filepath = temp_dir.join(&filename);

    std::fs::write(&filepath, &bytes).map_err(|e| format!("Failed to write image: {}", e))?;

    let path_str = filepath.to_string_lossy().to_string();
    Ok(serde_json::json!({
        "name": filename,
        "path": path_str,
        "size": bytes.len(),
    }))
}

/// Search files in project directory for @mention feature.
/// Returns up to 20 files matching the query (case-insensitive filename match).
#[tauri::command]
fn search_project_files(project_path: String, query: String) -> Result<Vec<serde_json::Value>, String> {
    let root = std::path::Path::new(&project_path);
    if !root.is_dir() {
        return Err("Invalid project path".to_string());
    }

    let query_lower = query.to_lowercase();
    let mut results: Vec<serde_json::Value> = Vec::new();
    let max_results = 20;
    let max_depth = 6;

    // Skip common non-useful directories
    let skip_dirs = ["node_modules", ".git", "dist", "build", "target", ".next",
                     "__pycache__", ".venv", "venv", ".claude", ".idea", ".vscode"];

    fn walk(dir: &std::path::Path, base: &std::path::Path, query: &str,
            results: &mut Vec<serde_json::Value>, max: usize, depth: usize, max_depth: usize,
            skip: &[&str]) {
        if depth > max_depth || results.len() >= max { return; }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            if results.len() >= max { return; }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                if skip.contains(&name.as_str()) || name.starts_with('.') { continue; }
                walk(&path, base, query, results, max, depth + 1, max_depth, skip);
            } else {
                if name.to_lowercase().contains(query) {
                    let rel = path.strip_prefix(base)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| path.to_string_lossy().to_string());
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    let ext = path.extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    let is_image = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].contains(&ext.as_str());
                    results.push(serde_json::json!({
                        "name": name,
                        "path": path.to_string_lossy().to_string(),
                        "relative": rel,
                        "size": size,
                        "is_image": is_image,
                    }));
                }
            }
        }
    }

    walk(root, root, &query_lower, &mut results, max_results, 0, max_depth, &skip_dirs);
    Ok(results)
}

#[tauri::command]
fn launch_in_terminal(project_path: String, prompt: String) -> Result<(), String> {
    let safe_prompt = prompt
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
        .replace('\r', "");

    let claude_cmd = format!(
        "cd /d \"{}\" && set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 && claude \"{}\"",
        project_path, safe_prompt
    );

    let wt_result = Command::new("cmd")
        .args(["/C", "wt", "cmd", "/K", &claude_cmd])
        .spawn();

    if wt_result.is_ok() {
        return Ok(());
    }

    Command::new("cmd")
        .args(["/C", "start", "cmd", "/K", &claude_cmd])
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;

    Ok(())
}

#[tauri::command]
fn save_to_history(entry: serde_json::Value) -> Result<(), String> {
    let userprofile = std::env::var("USERPROFILE")
        .map_err(|_| "USERPROFILE not set".to_string())?;
    let history_path = format!("{}/.claude/agent-teams-history.json", userprofile);

    let mut history: Vec<serde_json::Value> = if Path::new(&history_path).exists() {
        let raw = fs::read_to_string(&history_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        vec![]
    };

    history.insert(0, entry);
    history.truncate(50);

    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(&history_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn save_mission_snapshot(state: &MissionState) -> Result<(), String> {
    let userprofile = std::env::var("USERPROFILE")
        .map_err(|_| "USERPROFILE not set".to_string())?;
    let snapshots_dir = format!("{}/.claude/agent-teams-snapshots", userprofile);
    fs::create_dir_all(&snapshots_dir).map_err(|e| e.to_string())?;
    let path = format!("{}/{}.json", snapshots_dir, state.id);
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_mission_detail(mission_id: String) -> Result<serde_json::Value, String> {
    let userprofile = std::env::var("USERPROFILE")
        .map_err(|_| "USERPROFILE not set".to_string())?;
    let path = format!("{}/.claude/agent-teams-snapshots/{}.json", userprofile, mission_id);
    if !Path::new(&path).exists() {
        return Err(format!("Snapshot not found for mission {}", mission_id));
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_history() -> Result<Vec<serde_json::Value>, String> {
    let userprofile = std::env::var("USERPROFILE")
        .map_err(|_| "USERPROFILE not set".to_string())?;
    let history_path = format!("{}/.claude/agent-teams-history.json", userprofile);

    if !Path::new(&history_path).exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&history_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_mission_history() -> Result<Vec<serde_json::Value>, String> {
    load_history()
}

#[tauri::command]
fn delete_history_entry(index: usize) -> Result<(), String> {
    let userprofile = std::env::var("USERPROFILE")
        .map_err(|_| "USERPROFILE not set".to_string())?;
    let history_path = format!("{}/.claude/agent-teams-history.json", userprofile);

    let mut history: Vec<serde_json::Value> = if Path::new(&history_path).exists() {
        let raw = fs::read_to_string(&history_path).unwrap_or_else(|_| "[]".to_string());
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        return Ok(());
    };

    if index < history.len() {
        history.remove(index);
    }
    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    fs::write(&history_path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_folder_in_explorer(path: String) -> Result<(), String> {
    Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open explorer: {}", e))?;
    Ok(())
}

// ─── Agent Teams background watcher ─────────────────────────────

async fn watch_agent_teams_mission(
    state: SharedMissionState,
    app: AppHandle,
    project_path: String,
    mut stop_rx: tokio::sync::oneshot::Receiver<()>,
) {
    let tasks_dir = {
        let userprofile = std::env::var("USERPROFILE").unwrap_or_default();
        if userprofile.is_empty() {
            std::env::var("HOME").unwrap_or_default()
        } else {
            userprofile
        }
    };
    let tasks_dir = std::path::PathBuf::from(&tasks_dir).join(".claude").join("tasks").join("mission");
    let project_dir = std::path::Path::new(&project_path).to_path_buf();

    // Track known task statuses and file list
    let mut known_task_statuses: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut known_project_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Seed known project files (don't emit for pre-existing files)
    fn collect_files(dir: &std::path::Path, base: &std::path::Path, out: &mut std::collections::HashSet<String>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if name == "node_modules" || name == ".git" || name == ".claude" || name == "dist" || name == "build" || name == "target" || name.starts_with('.') { continue; }
                if path.is_dir() { collect_files(&path, base, out); }
                else if let Ok(rel) = path.strip_prefix(base) {
                    out.insert(rel.to_string_lossy().to_string().replace('\\', "/"));
                }
            }
        }
    }
    collect_files(&project_dir, &project_dir, &mut known_project_files);

    let mut iter: u32 = 0;
    loop {
        tokio::select! {
            _ = &mut stop_rx => break,
            _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {
                iter += 1;
                let now = chrono::Utc::now().timestamp_millis();

                // ── Poll ~/.claude/tasks/mission/ for task updates ──
                if tasks_dir.exists() {
                    if let Ok(entries) = std::fs::read_dir(&tasks_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
                            let raw = match std::fs::read_to_string(&path) { Ok(s) => s, Err(_) => continue };
                            let json: serde_json::Value = match serde_json::from_str(&raw) { Ok(v) => v, Err(_) => continue };

                            let task_id = json.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let task_title = json.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let task_status = json.get("status").and_then(|v| v.as_str()).unwrap_or("pending").to_string();
                            let task_owner = json.get("owner").and_then(|v| v.as_str()).unwrap_or("").to_string();

                            if task_id.is_empty() { continue; }

                            let prev_status = known_task_statuses.get(&task_id).cloned().unwrap_or_default();
                            if prev_status != task_status {
                                known_task_statuses.insert(task_id.clone(), task_status.clone());

                                // Update state
                                {
                                    let mut st = state.write().await;
                                    if let Some(ref mut s) = *st {
                                        // Find or create task
                                        let existing = s.tasks.iter_mut().find(|t| t.id == task_id || t.title == task_title);
                                        if let Some(task) = existing {
                                            let new_ts = match task_status.as_str() {
                                                "completed" | "done" => TaskStatus::Completed,
                                                "in_progress" => TaskStatus::InProgress,
                                                _ => TaskStatus::Pending,
                                            };
                                            task.status = new_ts;
                                            if task_status == "completed" || task_status == "done" {
                                                task.completed_at = Some(now);
                                            }
                                        }
                                        // Update agent status
                                        if !task_owner.is_empty() {
                                            if let Some(agent) = s.agents.iter_mut().find(|a| a.name == task_owner) {
                                                if task_status == "in_progress" {
                                                    agent.status = AgentStatus::Working;
                                                    agent.current_task = Some(task_title.clone());
                                                }
                                            }
                                        }
                                        // Log entry
                                        s.log.push(LogEntry {
                                            timestamp: now,
                                            agent: if task_owner.is_empty() { "System".into() } else { task_owner.clone() },
                                            message: format!("[Task {}] {}: {}", task_status, task_id, task_title),
                                            log_type: "task".into(),
                                        tool_name: None,
                                        phase_hint: None, file_path: None, lines: None,
                                        });
                                    }
                                }
                                let _ = app.emit("mission:task-update", serde_json::json!({
                                    "task_id": task_id,
                                    "agent": task_owner,
                                    "description": task_title,
                                    "status": task_status,
                                    "owner": task_owner,
                                    "timestamp": now,
                                }));
                                let _ = app.emit("mission:log", serde_json::json!({
                                    "timestamp": now,
                                    "agent": task_owner,
                                    "message": format!("[Task {}] {}", task_status, task_title),
                                    "log_type": "task",
                                }));
                            }

                            // Check for messages in task file
                            if let Some(msgs) = json.get("messages").and_then(|m| m.as_array()) {
                                for msg in msgs {
                                    let from = msg.get("from").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    let to = msg.get("to").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    let content = msg.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                    let msg_ts = msg.get("timestamp").and_then(|v| v.as_i64()).unwrap_or(now);
                                    let msg_id = format!("{}-{}-{}", from, to, msg_ts);
                                    if !from.is_empty() && !content.is_empty() {
                                        let mut st = state.write().await;
                                        if let Some(ref mut s) = *st {
                                            if !s.messages.iter().any(|m| m.from == from && m.timestamp == msg_ts) {
                                                s.messages.push(AgentMessage {
                                                    timestamp: msg_ts,
                                                    from: from.clone(),
                                                    to: to.clone(),
                                                    content: content.clone(),
                                                    msg_type: "message".into(),
                                                });
                                                let _ = app.emit("mission:agent-message", serde_json::json!({
                                                    "from": from, "to": to, "content": content,
                                                    "timestamp": msg_ts, "msg_id": msg_id,
                                                }));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // ── Poll project directory for new files (every 5 iterations = 10s) ──
                if iter % 5 == 0 {
                    let mut new_files: Vec<String> = Vec::new();
                    collect_files(&project_dir, &project_dir, &mut {
                        let mut tmp = std::collections::HashSet::new();
                        collect_files(&project_dir, &project_dir, &mut tmp);
                        for f in &tmp {
                            if !known_project_files.contains(f) {
                                new_files.push(f.clone());
                            }
                        }
                        known_project_files.extend(tmp);
                        std::collections::HashSet::new() // dummy, already done above
                    });
                    // Simpler approach without closure issue:
                    let mut current_files = std::collections::HashSet::new();
                    collect_files(&project_dir, &project_dir, &mut current_files);
                    for f in &current_files {
                        if !known_project_files.contains(f) {
                            known_project_files.insert(f.clone());
                            let mut st = state.write().await;
                            if let Some(ref mut s) = *st {
                                if !s.file_changes.iter().any(|fc| &fc.path == f) {
                                    s.file_changes.push(FileChange {
                                        path: f.clone(),
                                        action: "created".into(),
                                        agent: "Agent".into(),
                                        timestamp: now,
                                        lines: None,
                                        content_preview: None,
                                        diff_old: None,
                                        diff_new: None,
                                    });
                                }
                            }
                            let _ = app.emit("mission:file-change", serde_json::json!({
                                "path": f, "action": "created", "agent": "Agent", "timestamp": now,
                            }));
                        }
                    }
                }
            }
        }
    }
}

// ─── Mission commands ───────────────────────────────────────────

#[tauri::command]
async fn launch_mission(
    app: AppHandle,
    state: tauri::State<'_, MissionManagerState>,
    project_path: String,
    prompt: String,
    description: String,
    model: String,
    execution_mode: String,  // "standard" | "agent_teams"
) -> Result<serde_json::Value, String> {
    let manager = state.0.read().await;

    // Prevent double-launch
    {
        let current = manager.state.read().await;
        if let Some(ref s) = *current {
            if matches!(s.status, MissionStatus::Running | MissionStatus::Launching) {
                return Err("A mission is already running".into());
            }
        }
    }

    let now = chrono::Utc::now().timestamp_millis();
    let mission_id = format!("mission-{}", now);

    // Initialize state
    {
        let mut st = manager.state.write().await;
        *st = Some(MissionState {
            id: mission_id.clone(),
            description: description.clone(),
            project_path: project_path.clone(),
            status: MissionStatus::Launching,
            phase: MissionPhase::Planning,
            agents: vec![Agent {
                name: "Lead".into(),
                role: "Lead Coordinator".into(),
                status: AgentStatus::Spawning,
                current_task: Some("Analyzing requirement...".into()),
                spawned_at: now,
                model: Some(model.clone()),
                model_reason: None,
            }],
            tasks: vec![],
            log: vec![LogEntry {
                timestamp: now,
                agent: "System".into(),
                message: format!("Mission launched: {}", description),
                log_type: "info".into(),
            tool_name: None,
            phase_hint: None, file_path: None, lines: None,
            }],
            file_changes: vec![],
            started_at: now,
            raw_output: vec![],
            team_name: None,
            messages: vec![],
            execution_mode: if execution_mode.is_empty() { "standard".into() } else { execution_mode.clone() },
        });
    }

    let _ = app.emit("mission:status", serde_json::json!({
        "mission_id": &mission_id,
        "status": "launching",
    }));
    // Reset frontend agent list so stale agents from previous mission are cleared
    let _ = app.emit("mission:agent-spawned", serde_json::json!({
        "agent_name": "Lead",
        "role": "Lead Coordinator",
        "timestamp": now,
        "reset": true
    }));

    // Normalize project_path
    let clean_project_path = project_path.replace('/', "\\");

    // Spawn claude -p directly, pipe prompt via stdin
    // Use stream-json for realtime output parsing
    let model_arg = if model.is_empty() { "sonnet".to_string() } else { model };

    #[cfg(target_os = "windows")]
    let child_result = {
        let mut cmd = tokio::process::Command::new("claude");
        cmd.args(["-p", "--dangerously-skip-permissions", "--model", &model_arg, "--output-format", "stream-json", "--verbose"])
            .current_dir(&clean_project_path)
            .env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
            .env_remove("CLAUDECODE")
            .env_remove("CLAUDE_CODE_SESSION")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::piped());
        cmd.spawn()
    };

    #[cfg(not(target_os = "windows"))]
    let child_result = {
        let mut cmd = tokio::process::Command::new("claude");
        cmd.args(["-p", "--dangerously-skip-permissions", "--model", &model_arg, "--output-format", "stream-json", "--verbose"])
            .current_dir(&clean_project_path)
            .env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1")
            .env_remove("CLAUDECODE")
            .env_remove("CLAUDE_CODE_SESSION")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::piped());
        cmd.spawn()
    };

    let mut child = child_result.map_err(|e| format!("Failed to spawn claude: {}", e))?;

    // Write prompt to stdin then close it
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        let prompt_bytes = prompt.into_bytes();
        let _ = stdin.write_all(&prompt_bytes).await;
        drop(stdin); // Close stdin so claude knows input is complete
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Store child
    {
        let mut child_lock = manager.child.write().await;
        *child_lock = Some(child);
    }

    // Update status
    {
        let mut st = manager.state.write().await;
        if let Some(ref mut s) = *st {
            s.status = MissionStatus::Running;
        }
    }
    let _ = app.emit("mission:status", serde_json::json!({
        "mission_id": &mission_id,
        "status": "running",
    }));

    // Spawn stdout reader — handles stream-json output from claude
    let state_clone = manager.state.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut parser = OutputParser::new();
        let mut line_count: u64 = 0;
        let mut full_text_buffer = String::new(); // Accumulates all text output for plan detection

        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() { continue; }
            line_count += 1;

            // Emit every raw line for realtime visibility
            let _ = app_clone.emit("mission:raw-line", serde_json::json!({
                "line": &clean,
                "line_number": line_count,
            }));

            // Try to parse as stream-json
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&clean) {
                let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let now = chrono::Utc::now().timestamp_millis();

                match msg_type {
                    // Assistant is thinking/generating text
                    "assistant" | "content_block_delta" | "content_block_start" => {
                        // Extract text content — handle multiple stream-json structures:
                        // "assistant": { "message": { "content": [{ "text": "..." }] } }
                        // "assistant": { "content": [{ "text": "..." }] }
                        // "content_block_delta": { "delta": { "text": "..." } }
                        // "content_block_start": { "content_block": { "text": "..." } }
                        let text = json.get("message")
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_array())
                            .and_then(|arr| arr.iter().find_map(|item| {
                                if item.get("type").and_then(|t| t.as_str()) == Some("text") || item.get("text").is_some() {
                                    item.get("text").and_then(|t| t.as_str())
                                } else { None }
                            }))
                            .or_else(|| json.get("content")
                                .and_then(|c| c.as_array())
                                .and_then(|arr| arr.iter().find_map(|item| item.get("text").and_then(|t| t.as_str()))))
                            .or_else(|| json.get("delta").and_then(|d| d.get("text")).and_then(|t| t.as_str()))
                            .or_else(|| json.get("content_block").and_then(|b| b.get("text")).and_then(|t| t.as_str()))
                            .unwrap_or("");

                        if !text.is_empty() {
                            // Accumulate text for plan detection
                            full_text_buffer.push_str(text);

                            // Check for plan markers in accumulated text
                            if full_text_buffer.contains("=== MISSION PLAN ===") && full_text_buffer.contains("=== END PLAN ===") {
                                // Extract JSON between markers
                                if let Some(start) = full_text_buffer.find("=== MISSION PLAN ===") {
                                    if let Some(end) = full_text_buffer.find("=== END PLAN ===") {
                                        let plan_text = &full_text_buffer[start + 20..end].trim();
                                        // Try to find JSON object within the plan text
                                        if let Some(json_start) = plan_text.find('{') {
                                            if let Some(json_end) = plan_text.rfind('}') {
                                                let json_str = &plan_text[json_start..=json_end];
                                                if let Ok(plan_json) = serde_json::from_str::<serde_json::Value>(json_str) {
                                                    // Parse agents and tasks from plan
                                                    let plan_now = chrono::Utc::now().timestamp_millis();
                                                    let mut new_agents: Vec<Agent> = vec![];
                                                    let mut new_tasks: Vec<Task> = vec![];

                                                    if let Some(agents_arr) = plan_json.get("agents").and_then(|a| a.as_array()) {
                                                        for a in agents_arr {
                                                            new_agents.push(Agent {
                                                                name: a.get("name").and_then(|n| n.as_str()).unwrap_or("unknown").to_string(),
                                                                role: a.get("role").and_then(|r| r.as_str()).unwrap_or("").to_string(),
                                                                status: AgentStatus::Idle,
                                                                current_task: None,
                                                                spawned_at: plan_now,
                                                                model: a.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()),
                                                                model_reason: a.get("reason").and_then(|r| r.as_str()).map(|s| s.to_string()),
                                                            });
                                                        }
                                                    }

                                                    if let Some(tasks_arr) = plan_json.get("tasks").and_then(|t| t.as_array()) {
                                                        for (i, t) in tasks_arr.iter().enumerate() {
                                                            new_tasks.push(Task {
                                                                id: format!("task-{}", i),
                                                                title: t.get("title").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                                                                status: TaskStatus::Pending,
                                                                assigned_agent: t.get("agent").and_then(|a| a.as_str()).map(|s| s.to_string()),
                                                                started_at: None,
                                                                completed_at: None,
                                                                priority: t.get("priority").and_then(|p| p.as_str()).map(|s| s.to_string()),
                                                            });
                                                        }
                                                    }

                                                    // Update state: keep Lead, add planned agents, switch to ReviewPlan
                                                    {
                                                        let mut st = state_clone.write().await;
                                                        if let Some(ref mut s) = *st {
                                                            // Keep Lead agent, add new agents
                                                            for agent in &new_agents {
                                                                if !s.agents.iter().any(|a| a.name == agent.name) {
                                                                    s.agents.push(agent.clone());
                                                                }
                                                            }
                                                            s.tasks = new_tasks.clone();
                                                            s.phase = MissionPhase::ReviewPlan;
                                                            if let Some(lead) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                                                                lead.status = AgentStatus::Idle;
                                                                lead.current_task = Some("Plan ready — waiting for review".into());
                                                            }
                                                            s.log.push(LogEntry {
                                                                timestamp: plan_now,
                                                                agent: "System".into(),
                                                                message: "Mission plan ready for review".into(),
                                                                log_type: "plan-ready".into(),
                                                            tool_name: None,
                                                            phase_hint: None, file_path: None, lines: None,
                                                            });
                                                        }
                                                    }

                                                    // Emit plan-ready event with full plan data
                                                    let _ = app_clone.emit("mission:plan-ready", serde_json::json!({
                                                        "agents": new_agents,
                                                        "tasks": new_tasks,
                                                    }));
                                                }
                                            }
                                        }
                                        // Clear buffer to avoid re-detecting
                                        full_text_buffer.clear();
                                    }
                                }
                            }

                            // Fallback: detect plan JSON without markers
                            // Look for a JSON block containing both "agents" and "tasks" arrays
                            if !full_text_buffer.is_empty() {
                                let current_phase = {
                                    let st = state_clone.read().await;
                                    st.as_ref().map(|s| s.phase.clone()).unwrap_or(MissionPhase::Planning)
                                };
                                if matches!(current_phase, MissionPhase::Planning) {
                                    // Try to find JSON with agents+tasks in the buffer
                                    if let Some(fb_start) = full_text_buffer.find("{") {
                                        // Find the matching closing brace by tracking depth
                                        let buf_bytes = full_text_buffer.as_bytes();
                                        let mut depth = 0i32;
                                        let mut fb_end = None;
                                        for (i, &b) in buf_bytes.iter().enumerate().skip(fb_start) {
                                            if b == b'{' { depth += 1; }
                                            if b == b'}' { depth -= 1; }
                                            if depth == 0 { fb_end = Some(i); break; }
                                        }
                                        if let Some(end_idx) = fb_end {
                                            let candidate = &full_text_buffer[fb_start..=end_idx];
                                            if candidate.contains("\"agents\"") && candidate.contains("\"tasks\"") {
                                                if let Ok(plan_json) = serde_json::from_str::<serde_json::Value>(candidate) {
                                                    if plan_json.get("agents").and_then(|a| a.as_array()).map(|a| !a.is_empty()).unwrap_or(false)
                                                       && plan_json.get("tasks").and_then(|t| t.as_array()).map(|t| !t.is_empty()).unwrap_or(false) {
                                                        let plan_now = chrono::Utc::now().timestamp_millis();
                                                        let mut new_agents: Vec<Agent> = vec![];
                                                        let mut new_tasks: Vec<Task> = vec![];

                                                        if let Some(agents_arr) = plan_json.get("agents").and_then(|a| a.as_array()) {
                                                            for a in agents_arr {
                                                                new_agents.push(Agent {
                                                                    name: a.get("name").and_then(|n| n.as_str()).unwrap_or("unknown").to_string(),
                                                                    role: a.get("role").and_then(|r| r.as_str()).unwrap_or("").to_string(),
                                                                    status: AgentStatus::Idle,
                                                                    current_task: None,
                                                                    spawned_at: plan_now,
                                                                    model: a.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()),
                                                                    model_reason: a.get("reason").and_then(|r| r.as_str()).map(|s| s.to_string()),
                                                                });
                                                            }
                                                        }

                                                        if let Some(tasks_arr) = plan_json.get("tasks").and_then(|t| t.as_array()) {
                                                            for (i, t) in tasks_arr.iter().enumerate() {
                                                                new_tasks.push(Task {
                                                                    id: format!("task-{}", i),
                                                                    title: t.get("title").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                                                                    status: TaskStatus::Pending,
                                                                    assigned_agent: t.get("agent").and_then(|a| a.as_str()).map(|s| s.to_string()),
                                                                    started_at: None,
                                                                    completed_at: None,
                                                                    priority: t.get("priority").and_then(|p| p.as_str()).map(|s| s.to_string()),
                                                                });
                                                            }
                                                        }

                                                        {
                                                            let mut st = state_clone.write().await;
                                                            if let Some(ref mut s) = *st {
                                                                for agent in &new_agents {
                                                                    if !s.agents.iter().any(|a| a.name == agent.name) {
                                                                        s.agents.push(agent.clone());
                                                                    }
                                                                }
                                                                s.tasks = new_tasks.clone();
                                                                s.phase = MissionPhase::ReviewPlan;
                                                                if let Some(lead) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                                                                    lead.status = AgentStatus::Idle;
                                                                    lead.current_task = Some("Plan ready — waiting for review".into());
                                                                }
                                                                s.log.push(LogEntry {
                                                                    timestamp: plan_now,
                                                                    agent: "System".into(),
                                                                    message: "Mission plan detected (fallback) — ready for review".into(),
                                                                    log_type: "plan-ready".into(),
                                                                tool_name: None,
                                                                phase_hint: None, file_path: None, lines: None,
                                                                });
                                                            }
                                                        }

                                                        let _ = app_clone.emit("mission:plan-ready", serde_json::json!({
                                                            "agents": new_agents,
                                                            "tasks": new_tasks,
                                                        }));
                                                        full_text_buffer.clear();
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            let entry = LogEntry {
                                timestamp: now,
                                agent: "Lead".into(),
                                message: text.to_string(),
                                log_type: "thinking".into(),
                            tool_name: None,
                            phase_hint: None, file_path: None, lines: None,
                            };
                            {
                                let mut st = state_clone.write().await;
                                if let Some(ref mut s) = *st {
                                    if let Some(a) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                                        a.status = AgentStatus::Working;
                                        let truncated = if text.len() > 80 {
                                            format!("{}...", &text[..77])
                                        } else {
                                            text.to_string()
                                        };
                                        a.current_task = Some(truncated);
                                    }
                                    s.log.push(entry.clone());
                                    s.raw_output.push(clean.clone());
                                    if s.log.len() > 2000 { s.log.drain(0..500); }
                                }
                            }
                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                        }

                        // Also extract tool_use blocks from assistant messages (they have full input)
                        if msg_type == "assistant" {
                            if let Some(content) = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array()) {
                                for block in content {
                                    if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                                        let tool = block.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                                        let input = block.get("input").and_then(|i| i.as_object());
                                        let detail = if let Some(inp) = input {
                                            match tool {
                                                "Write" | "Edit" => {
                                                    let fp = inp.get("file_path").and_then(|p| p.as_str()).unwrap_or("");
                                                    if !fp.is_empty() {
                                                        let lc = if tool == "Write" {
                                                            inp.get("content").and_then(|c| c.as_str()).map(|c| c.lines().count()).unwrap_or(0)
                                                        } else {
                                                            inp.get("new_string").and_then(|s| s.as_str()).map(|s| s.lines().count()).unwrap_or(0)
                                                        };
                                                        format!("{}: {} (+{} lines)", tool, fp, lc)
                                                    } else { continue; }
                                                },
                                                "Read" => {
                                                    let fp = inp.get("file_path").and_then(|p| p.as_str()).unwrap_or("");
                                                    if !fp.is_empty() { format!("Read: {}", fp) } else { continue; }
                                                },
                                                "Bash" => {
                                                    let cmd = inp.get("command").and_then(|c| c.as_str()).unwrap_or("");
                                                    if !cmd.is_empty() {
                                                        let tr = if cmd.len() > 120 { format!("{}...", &cmd[..117]) } else { cmd.to_string() };
                                                        format!("Bash: {}", tr)
                                                    } else { continue; }
                                                },
                                                "Glob" => {
                                                    let pat = inp.get("pattern").and_then(|p| p.as_str()).unwrap_or("");
                                                    if !pat.is_empty() { format!("Glob: {}", pat) } else { continue; }
                                                },
                                                "Grep" => {
                                                    let pat = inp.get("pattern").and_then(|p| p.as_str()).unwrap_or("");
                                                    if !pat.is_empty() { format!("Grep: {}", pat) } else { continue; }
                                                },
                                                "Agent" => {
                                                    let desc = inp.get("description").and_then(|d| d.as_str()).unwrap_or("");
                                                    let name_v = inp.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                                    if !name_v.is_empty() {
                                                        format!("Spawning agent: {} — {}", name_v, desc)
                                                    } else if !desc.is_empty() {
                                                        format!("Spawning agent: {}", desc)
                                                    } else { continue; }
                                                },
                                                _ => format!("{}", tool),
                                            }
                                        } else { continue; };

                                        let (efp, eln) = if let Some(inp) = input {
                                            if tool == "Write" || tool == "Edit" {
                                                let fp = inp.get("file_path").and_then(|p| p.as_str()).unwrap_or("");
                                                let lc: i64 = if tool == "Write" {
                                                    inp.get("content").and_then(|c| c.as_str()).map(|c| c.lines().count() as i64).unwrap_or(0)
                                                } else {
                                                    inp.get("new_string").and_then(|s| s.as_str()).map(|s| s.lines().count() as i64).unwrap_or(0)
                                                };
                                                (if fp.is_empty() { None } else { Some(fp.to_string()) }, if lc > 0 { Some(lc) } else { None })
                                            } else { (None, None) }
                                        } else { (None, None) };

                                        let mut tool_entry = LogEntry::new(now, "Lead", detail.clone(), "tool").with_tool(tool.to_string());
                                        tool_entry.file_path = efp.clone();
                                        tool_entry.lines = eln;
                                        {
                                            let mut st = state_clone.write().await;
                                            if let Some(ref mut s) = *st {
                                                s.log.push(tool_entry.clone());
                                                if let Some(a) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                                                    a.current_task = Some(if detail.len() > 80 { format!("{}…", &detail[..77]) } else { detail });
                                                }

                                                // Track file changes for Write/Edit (enables Files tab diff viewer)
                                                if (tool == "Write" || tool == "Edit") && efp.is_some() {
                                                    if let Some(inp) = input {
                                                        let path = efp.as_deref().unwrap_or("");
                                                        let is_write = tool == "Write";
                                                        let (fc_lines, content_preview, diff_old, diff_new) = if is_write {
                                                            let ct = inp.get("content").and_then(|c| c.as_str()).unwrap_or("");
                                                            let lcount = ct.lines().count() as i64;
                                                            let preview = if ct.len() > 2000 { format!("{}…", &ct[..1997]) } else { ct.to_string() };
                                                            (Some(lcount), Some(preview), None, None)
                                                        } else {
                                                            let old = inp.get("old_string").and_then(|s| s.as_str()).unwrap_or("");
                                                            let new_s = inp.get("new_string").and_then(|s| s.as_str()).unwrap_or("");
                                                            let changed = new_s.lines().count() as i64;
                                                            let old_p = if old.len() > 1500 { format!("{}…", &old[..1497]) } else { old.to_string() };
                                                            let new_p = if new_s.len() > 1500 { format!("{}…", &new_s[..1497]) } else { new_s.to_string() };
                                                            (Some(changed), Some(new_p.clone()), Some(old_p), Some(new_p))
                                                        };
                                                        if let Some(existing) = s.file_changes.iter_mut().find(|fc| fc.path == path) {
                                                            existing.action = if is_write { "created".into() } else { "modified".into() };
                                                            existing.agent = "Lead".into();
                                                            existing.timestamp = now;
                                                            existing.lines = fc_lines;
                                                            existing.content_preview = content_preview;
                                                            existing.diff_old = diff_old;
                                                            existing.diff_new = diff_new;
                                                        } else {
                                                            s.file_changes.push(FileChange {
                                                                path: path.to_string(),
                                                                action: if is_write { "created".into() } else { "modified".into() },
                                                                agent: "Lead".into(),
                                                                timestamp: now,
                                                                lines: fc_lines,
                                                                content_preview,
                                                                diff_old,
                                                                diff_new,
                                                            });
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        let _ = app_clone.emit("mission:log", serde_json::to_value(&tool_entry).unwrap());
                                    }
                                }
                            }
                        }
                    }
                    "tool_use" if json.get("content_block").and_then(|b| b.get("type")).and_then(|t| t.as_str()) == Some("tool_use") || json.get("name").is_some() => {
                        let tool_name = json.get("content_block")
                            .and_then(|b| b.get("name"))
                            .and_then(|n| n.as_str())
                            .or_else(|| json.get("name").and_then(|n| n.as_str()))
                            .unwrap_or("unknown tool");

                        // Try to extract input details for richer logging
                        let input = json.get("content_block")
                            .and_then(|b| b.get("input"))
                            .and_then(|i| i.as_object())
                            .or_else(|| json.get("input").and_then(|i| i.as_object()));

                        let detail = if let Some(inp) = input {
                            match tool_name {
                                "Write" | "Edit" => {
                                    let fp = inp.get("file_path").and_then(|p| p.as_str()).unwrap_or("");
                                    if !fp.is_empty() {
                                        let lc = if tool_name == "Write" {
                                            inp.get("content").and_then(|c| c.as_str()).map(|c| c.lines().count()).unwrap_or(0)
                                        } else {
                                            inp.get("new_string").and_then(|s| s.as_str()).map(|s| s.lines().count()).unwrap_or(0)
                                        };
                                        format!("{}: {} (+{} lines)", tool_name, fp, lc)
                                    } else {
                                        format!("Using tool: {}", tool_name)
                                    }
                                },
                                "Read" => {
                                    let fp = inp.get("file_path").and_then(|p| p.as_str()).unwrap_or("");
                                    if !fp.is_empty() { format!("Read: {}", fp) } else { format!("Using tool: {}", tool_name) }
                                },
                                "Bash" => {
                                    let cmd = inp.get("command").and_then(|c| c.as_str()).unwrap_or("");
                                    if !cmd.is_empty() {
                                        let truncated = if cmd.len() > 120 { format!("{}...", &cmd[..117]) } else { cmd.to_string() };
                                        format!("Bash: {}", truncated)
                                    } else { format!("Using tool: {}", tool_name) }
                                },
                                "Glob" => {
                                    let pat = inp.get("pattern").and_then(|p| p.as_str()).unwrap_or("");
                                    if !pat.is_empty() { format!("Glob: {}", pat) } else { format!("Using tool: {}", tool_name) }
                                },
                                "Grep" => {
                                    let pat = inp.get("pattern").and_then(|p| p.as_str()).unwrap_or("");
                                    if !pat.is_empty() { format!("Grep: {}", pat) } else { format!("Using tool: {}", tool_name) }
                                },
                                "Agent" => {
                                    let desc = inp.get("description").and_then(|d| d.as_str()).unwrap_or("");
                                    let name = inp.get("name").and_then(|n| n.as_str()).unwrap_or("");
                                    if !name.is_empty() {
                                        format!("Spawning agent: {} — {}", name, desc)
                                    } else if !desc.is_empty() {
                                        format!("Spawning agent: {}", desc)
                                    } else {
                                        format!("Using tool: Agent")
                                    }
                                },
                                _ => format!("Using tool: {}", tool_name),
                            }
                        } else {
                            format!("Using tool: {}", tool_name)
                        };

                        // Extract file_path and lines for Write/Edit (enables Files tab)
                        let (entry_file_path, entry_lines) = if let Some(inp) = input {
                            if tool_name == "Write" || tool_name == "Edit" {
                                let fp = inp.get("file_path").and_then(|p| p.as_str()).unwrap_or("");
                                let lc: i64 = if tool_name == "Write" {
                                    inp.get("content").and_then(|c| c.as_str()).map(|c| c.lines().count() as i64).unwrap_or(0)
                                } else {
                                    inp.get("new_string").and_then(|s| s.as_str()).map(|s| s.lines().count() as i64).unwrap_or(0)
                                };
                                (if fp.is_empty() { None } else { Some(fp.to_string()) }, if lc > 0 { Some(lc) } else { None })
                            } else {
                                (None, None)
                            }
                        } else {
                            (None, None)
                        };

                        let mut entry = LogEntry::new(now, "Lead", detail.clone(), "tool").with_tool(tool_name.to_string());
                        entry.file_path = entry_file_path.clone();
                        entry.lines = entry_lines;
                        {
                            let mut st = state_clone.write().await;
                            if let Some(ref mut s) = *st {
                                if let Some(a) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                                    a.current_task = Some(if detail.len() > 80 { format!("{}…", &detail[..77]) } else { detail });
                                }
                                s.log.push(entry.clone());

                                // Track file changes for Write/Edit tools (enables Files tab diff viewer)
                                if (tool_name == "Write" || tool_name == "Edit") && entry_file_path.is_some() {
                                    if let Some(inp) = input {
                                        let path = entry_file_path.as_deref().unwrap_or("");
                                        let is_write = tool_name == "Write";
                                        let (fc_lines, content_preview, diff_old, diff_new) = if is_write {
                                            let content = inp.get("content").and_then(|c| c.as_str()).unwrap_or("");
                                            let lcount = content.lines().count() as i64;
                                            let preview = if content.len() > 2000 { format!("{}…", &content[..1997]) } else { content.to_string() };
                                            (Some(lcount), Some(preview), None, None)
                                        } else {
                                            let old = inp.get("old_string").and_then(|s| s.as_str()).unwrap_or("");
                                            let new = inp.get("new_string").and_then(|s| s.as_str()).unwrap_or("");
                                            let changed = new.lines().count() as i64;
                                            let old_p = if old.len() > 1500 { format!("{}…", &old[..1497]) } else { old.to_string() };
                                            let new_p = if new.len() > 1500 { format!("{}…", &new[..1497]) } else { new.to_string() };
                                            (Some(changed), Some(new_p.clone()), Some(old_p), Some(new_p))
                                        };
                                        if let Some(existing) = s.file_changes.iter_mut().find(|fc| fc.path == path) {
                                            existing.action = if is_write { "created".into() } else { "modified".into() };
                                            existing.agent = "Lead".into();
                                            existing.timestamp = now;
                                            existing.lines = fc_lines;
                                            existing.content_preview = content_preview;
                                            existing.diff_old = diff_old;
                                            existing.diff_new = diff_new;
                                        } else {
                                            s.file_changes.push(FileChange {
                                                path: path.to_string(),
                                                action: if is_write { "created".into() } else { "modified".into() },
                                                agent: "Lead".into(),
                                                timestamp: now,
                                                lines: fc_lines,
                                                content_preview,
                                                diff_old,
                                                diff_new,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                        let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                    }

                    // System messages
                    "system" | "error" => {
                        let subtype = json.get("subtype").and_then(|s| s.as_str()).unwrap_or("");

                        // Skip noisy init messages (huge JSON with tools, slash_commands, etc.)
                        if subtype == "init" {
                            let mut st = state_clone.write().await;
                            if let Some(ref mut s) = *st {
                                s.raw_output.push(clean.clone());
                            }
                        } else {
                            let text = json.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str())
                                .or_else(|| json.get("message").and_then(|m| m.as_str()))
                                .unwrap_or(&clean);
                            let entry = LogEntry {
                                timestamp: now,
                                agent: "System".into(),
                                message: text.to_string(),
                                log_type: if msg_type == "error" { "error" } else { "info" }.into(),
                                tool_name: None,
                                phase_hint: None, file_path: None, lines: None,
                            };
                            {
                                let mut st = state_clone.write().await;
                                if let Some(ref mut s) = *st {
                                    s.log.push(entry.clone());
                                }
                            }
                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                        }
                    }

                    // Result message — final output from a `claude -p` run
                    "result" => {
                        // Check if we're in ReviewPlan phase — if so, this is just
                        // the planning process exiting (expected with -p mode).
                        // Don't mark mission as completed.
                        let current_phase = {
                            let st = state_clone.read().await;
                            st.as_ref().map(|s| s.phase.clone()).unwrap_or(MissionPhase::Planning)
                        };

                        if matches!(current_phase, MissionPhase::ReviewPlan) {
                            // Plan already detected — this result is just the process exiting.
                            // Keep status as-is (waiting for user review).
                            let entry = LogEntry {
                                timestamp: now,
                                agent: "System".into(),
                                message: "Planning phase complete — review the plan above".into(),
                                log_type: "info".into(),
                            tool_name: None,
                            phase_hint: None, file_path: None, lines: None,
                            };
                            {
                                let mut st = state_clone.write().await;
                                if let Some(ref mut s) = *st {
                                    s.log.push(entry.clone());
                                }
                            }
                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                        } else if matches!(current_phase, MissionPhase::Planning) {
                            // Still in Planning — plan wasn't detected during streaming.
                            // Try extracting from full result text as last resort.
                            let result_text = json.get("result").and_then(|r| r.as_str())
                                .or_else(|| json.get("content").and_then(|c| c.as_array())
                                    .and_then(|arr| arr.iter().find_map(|item| item.get("text").and_then(|t| t.as_str()))))
                                .unwrap_or("");

                            // Append to full_text_buffer for fallback detection
                            full_text_buffer.push_str(result_text);

                            // Try marker-based first
                            let mut plan_found = false;
                            if full_text_buffer.contains("=== MISSION PLAN ===") && full_text_buffer.contains("=== END PLAN ===") {
                                if let Some(start) = full_text_buffer.find("=== MISSION PLAN ===") {
                                    if let Some(end) = full_text_buffer.find("=== END PLAN ===") {
                                        let plan_text = &full_text_buffer[start + 20..end].trim();
                                        if let Some(js) = plan_text.find('{') {
                                            if let Some(je) = plan_text.rfind('}') {
                                                if let Ok(_) = serde_json::from_str::<serde_json::Value>(&plan_text[js..=je]) {
                                                    plan_found = true; // Already handled above or handle here
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Fallback: find JSON with agents+tasks in entire buffer
                            if !plan_found {
                                if let Some(fb_start) = full_text_buffer.find("{") {
                                    let buf_bytes = full_text_buffer.as_bytes();
                                    let mut depth = 0i32;
                                    let mut fb_end = None;
                                    for (i, &b) in buf_bytes.iter().enumerate().skip(fb_start) {
                                        if b == b'{' { depth += 1; }
                                        if b == b'}' { depth -= 1; }
                                        if depth == 0 { fb_end = Some(i); break; }
                                    }
                                    if let Some(end_idx) = fb_end {
                                        let candidate = &full_text_buffer[fb_start..=end_idx];
                                        if candidate.contains("\"agents\"") && candidate.contains("\"tasks\"") {
                                            if let Ok(plan_json) = serde_json::from_str::<serde_json::Value>(candidate) {
                                                if plan_json.get("agents").and_then(|a| a.as_array()).map(|a| !a.is_empty()).unwrap_or(false)
                                                   && plan_json.get("tasks").and_then(|t| t.as_array()).map(|t| !t.is_empty()).unwrap_or(false) {
                                                    let plan_now = chrono::Utc::now().timestamp_millis();
                                                    let mut new_agents: Vec<Agent> = vec![];
                                                    let mut new_tasks: Vec<Task> = vec![];

                                                    if let Some(agents_arr) = plan_json.get("agents").and_then(|a| a.as_array()) {
                                                        for a in agents_arr {
                                                            new_agents.push(Agent {
                                                                name: a.get("name").and_then(|n| n.as_str()).unwrap_or("unknown").to_string(),
                                                                role: a.get("role").and_then(|r| r.as_str()).unwrap_or("").to_string(),
                                                                status: AgentStatus::Idle,
                                                                current_task: None,
                                                                spawned_at: plan_now,
                                                                model: a.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()),
                                                                model_reason: a.get("reason").and_then(|r| r.as_str()).map(|s| s.to_string()),
                                                            });
                                                        }
                                                    }

                                                    if let Some(tasks_arr) = plan_json.get("tasks").and_then(|t| t.as_array()) {
                                                        for (i, t) in tasks_arr.iter().enumerate() {
                                                            new_tasks.push(Task {
                                                                id: format!("task-{}", i),
                                                                title: t.get("title").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                                                                status: TaskStatus::Pending,
                                                                assigned_agent: t.get("agent").and_then(|a| a.as_str()).map(|s| s.to_string()),
                                                                started_at: None,
                                                                completed_at: None,
                                                                priority: t.get("priority").and_then(|p| p.as_str()).map(|s| s.to_string()),
                                                            });
                                                        }
                                                    }

                                                    {
                                                        let mut st = state_clone.write().await;
                                                        if let Some(ref mut s) = *st {
                                                            for agent in &new_agents {
                                                                if !s.agents.iter().any(|a| a.name == agent.name) {
                                                                    s.agents.push(agent.clone());
                                                                }
                                                            }
                                                            s.tasks = new_tasks.clone();
                                                            s.phase = MissionPhase::ReviewPlan;
                                                            if let Some(lead) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                                                                lead.status = AgentStatus::Idle;
                                                                lead.current_task = Some("Plan ready — waiting for review".into());
                                                            }
                                                            s.log.push(LogEntry {
                                                                timestamp: plan_now,
                                                                agent: "System".into(),
                                                                message: "Mission plan detected from result — ready for review".into(),
                                                                log_type: "plan-ready".into(),
                                                            tool_name: None,
                                                            phase_hint: None, file_path: None, lines: None,
                                                            });
                                                        }
                                                    }

                                                    let _ = app_clone.emit("mission:plan-ready", serde_json::json!({
                                                        "agents": new_agents,
                                                        "tasks": new_tasks,
                                                    }));
                                                    full_text_buffer.clear();
                                                    plan_found = true;
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // If still no plan found, mark as completed with the result text
                            if !plan_found {
                                let result_display = if result_text.len() > 500 {
                                    format!("{}...", &result_text[..500])
                                } else {
                                    result_text.to_string()
                                };

                                // Detect API connectivity errors
                                let is_connection_error = result_text.contains("ConnectionRefused")
                                    || result_text.contains("Unable to connect to API")
                                    || result_text.contains("ECONNREFUSED")
                                    || result_text.contains("connection refused")
                                    || result_text.contains("Network error")
                                    || result_text.contains("401")
                                    || result_text.contains("authentication");

                                let (log_msg, log_type_str) = if is_connection_error {
                                    (
                                        "⚠️ Không thể kết nối tới API. Vui lòng kiểm tra lại kết nối và cấu hình API của bạn.".to_string(),
                                        "error"
                                    )
                                } else {
                                    (format!("Result (no plan detected): {}", result_display), "result")
                                };

                                let entry = LogEntry {
                                    timestamp: now,
                                    agent: "System".into(),
                                    message: log_msg,
                                    log_type: log_type_str.into(),
                                    tool_name: None,
                                    phase_hint: None, file_path: None, lines: None,
                                };
                                {
                                    let mut st = state_clone.write().await;
                                    if let Some(ref mut s) = *st {
                                        s.log.push(entry.clone());
                                        s.status = if is_connection_error { MissionStatus::Failed } else { MissionStatus::Completed };
                                        s.phase = MissionPhase::Done;
                                        if let Some(a) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                                            a.status = if is_connection_error { AgentStatus::Error } else { AgentStatus::Done };
                                            a.current_task = Some(if is_connection_error {
                                                "Failed — API connection error".into()
                                            } else {
                                                "Completed — no plan structure found".into()
                                            });
                                        }
                                    }
                                }
                                let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                                let status_str = if is_connection_error { "failed" } else { "completed" };
                                let _ = app_clone.emit("mission:status", serde_json::json!({ "status": status_str }));
                            }
                        } else {
                            // Real completion — from deploy phase or non-plan run
                            let text = json.get("result").and_then(|r| r.as_str())
                                .or_else(|| {
                                    json.get("content").and_then(|c| {
                                        if let Some(arr) = c.as_array() {
                                            arr.iter()
                                                .filter_map(|item| item.get("text").and_then(|t| t.as_str()))
                                                .next()
                                        } else {
                                            c.as_str()
                                        }
                                    })
                                })
                                .unwrap_or("Mission completed");

                            let display_text = if text.len() > 500 {
                                format!("{}...", &text[..500])
                            } else {
                                text.to_string()
                            };

                            let entry = LogEntry {
                                timestamp: now,
                                agent: "Lead".into(),
                                message: format!("Result: {}", display_text),
                                log_type: "result".into(),
                            tool_name: None,
                            phase_hint: None, file_path: None, lines: None,
                            };
                            {
                                let mut st = state_clone.write().await;
                                if let Some(ref mut s) = *st {
                                    s.log.push(entry.clone());
                                    s.status = MissionStatus::Completed;
                                    s.phase = MissionPhase::Done;
                                    if let Some(a) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                                        a.status = AgentStatus::Done;
                                        a.current_task = Some("Mission completed".into());
                                    }
                                }
                            }
                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                            let _ = app_clone.emit("mission:status", serde_json::json!({ "status": "completed" }));
                        }
                    }

                    _ => {
                        // Unknown JSON type — log with type info for debugging
                        let mut st = state_clone.write().await;
                        if let Some(ref mut s) = *st {
                            s.raw_output.push(clean.clone());
                        }
                        // Emit as raw line so RawOutput panel shows it
                    }
                }
            } else {
                // Not JSON — fallback to regex-based parsing (plain text output)
                let events = parser.parse_line(&clean);
                for event in events {
                    handle_parsed_event(&state_clone, &app_clone, event).await;
                }
            }
        }
    });

    // Spawn stderr reader
    let state_clone2 = manager.state.clone();
    let app_clone2 = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() { continue; }
            let now = chrono::Utc::now().timestamp_millis();
            let entry = LogEntry {
                timestamp: now,
                agent: "System".into(),
                message: clean.clone(),
                log_type: "error".into(),
            tool_name: None,
            phase_hint: None, file_path: None, lines: None,
            };
            {
                let mut st = state_clone2.write().await;
                if let Some(ref mut s) = *st {
                    s.log.push(entry.clone());
                    s.raw_output.push(format!("[stderr] {}", clean));
                }
            }
            let _ = app_clone2.emit("mission:log", serde_json::to_value(&entry).unwrap());
        }
    });

    // Spawn process watcher
    let state_clone3 = manager.state.clone();
    let child_clone = manager.child.clone();
    let app_clone3 = app.clone();
    let mid = mission_id.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
            let mut child_lock = child_clone.write().await;
            if let Some(ref mut child) = *child_lock {
                match child.try_wait() {
                    Ok(Some(exit_status)) => {
                        // Check if we're in ReviewPlan phase — planning process exiting is
                        // expected (claude -p is single-turn). Don't mark as completed.
                        let current_phase = {
                            let st = state_clone3.read().await;
                            st.as_ref().map(|s| s.phase.clone()).unwrap_or(MissionPhase::Planning)
                        };
                        if matches!(current_phase, MissionPhase::ReviewPlan) {
                            // Planning process exited normally — user is reviewing the plan.
                            // Don't emit completed status. Just stop watching.
                            break;
                        }

                        let final_status = if exit_status.success() {
                            MissionStatus::Completed
                        } else {
                            MissionStatus::Failed
                        };
                        {
                            let mut st = state_clone3.write().await;
                            if let Some(ref mut s) = *st {
                                s.status = final_status.clone();
                                // Mark all working agents as done
                                for a in s.agents.iter_mut() {
                                    if a.status == AgentStatus::Working || a.status == AgentStatus::Idle || a.status == AgentStatus::Spawning {
                                        a.status = if final_status == MissionStatus::Completed { AgentStatus::Done } else { AgentStatus::Error };
                                        a.current_task = None;
                                    }
                                }
                            }
                        }
                        let status_str = match final_status {
                            MissionStatus::Completed => "completed",
                            MissionStatus::Failed => "failed",
                            _ => "unknown",
                        };
                        // Auto-save completed mission to history file
                        {
                            let st = state_clone3.read().await;
                            if let Some(ref s) = *st {
                                let now_ms = std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as i64;
                                let entry = serde_json::json!({
                                    "id": s.id,
                                    "description": s.description,
                                    "project_path": s.project_path,
                                    "status": status_str,
                                    "started_at": s.started_at,
                                    "ended_at": now_ms,
                                    "agent_count": s.agents.len(),
                                    "task_summary": s.tasks.iter().map(|t| format!("[{:?}] {}", t.status, t.title)).collect::<Vec<_>>(),
                                    "file_changes": s.file_changes,
                                    "log_count": s.log.len(),
                                });
                                let _ = save_to_history(entry);
                                // Also save full MissionState snapshot for detail view
                                let _ = save_mission_snapshot(s);
                            }
                        }
                        let _ = app_clone3.emit("mission:status", serde_json::json!({
                            "mission_id": mid,
                            "status": status_str,
                        }));
                        break;
                    }
                    Ok(None) => continue,
                    Err(_) => break,
                }
            } else {
                break;
            }
        }
    });

    let result_state = manager.state.read().await;
    Ok(serde_json::to_value(&*result_state).unwrap_or(serde_json::json!(null)))
}

#[tauri::command]
async fn stop_mission(
    app: AppHandle,
    state: tauri::State<'_, MissionManagerState>,
) -> Result<(), String> {
    let manager = state.0.read().await;

    // Stop background watcher (agent_teams mode)
    {
        let mut ws = manager.watcher_stop.write().await;
        if let Some(tx) = ws.take() { let _ = tx.send(()); }
    }

    {
        let mut child_lock = manager.child.write().await;
        if let Some(ref mut child) = *child_lock {
            let _ = child.kill().await;
        }
        *child_lock = None;
    }

    {
        let mut st = manager.state.write().await;
        if let Some(ref mut s) = *st {
            s.status = MissionStatus::Stopped;
            for a in s.agents.iter_mut() {
                if a.status == AgentStatus::Working || a.status == AgentStatus::Spawning {
                    a.status = AgentStatus::Idle;
                    a.current_task = None;
                }
            }
        }
    }

    let _ = app.emit("mission:status", serde_json::json!({ "status": "stopped" }));
    Ok(())
}

#[tauri::command]
async fn reset_mission(
    app: AppHandle,
    state: tauri::State<'_, MissionManagerState>,
) -> Result<(), String> {
    let manager = state.0.read().await;

    // Stop background watcher
    {
        let mut ws = manager.watcher_stop.write().await;
        if let Some(tx) = ws.take() { let _ = tx.send(()); }
    }

    // Kill any running child process
    {
        let mut child_lock = manager.child.write().await;
        if let Some(ref mut child) = *child_lock {
            let _ = child.kill().await;
        }
        *child_lock = None;
    }

    // Clear state entirely
    {
        let mut st = manager.state.write().await;
        *st = None;
    }

    let _ = app.emit("mission:status", serde_json::json!({ "status": "reset" }));
    Ok(())
}

#[tauri::command]
async fn get_mission_state(
    state: tauri::State<'_, MissionManagerState>,
) -> Result<serde_json::Value, String> {
    let manager = state.0.read().await;
    let st = manager.state.read().await;
    Ok(serde_json::to_value(&*st).unwrap_or(serde_json::json!(null)))
}

#[tauri::command]
async fn update_agent_model(
    state: tauri::State<'_, MissionManagerState>,
    agent_name: String,
    model: String,
) -> Result<(), String> {
    let manager = state.0.read().await;
    let mut st = manager.state.write().await;
    if let Some(ref mut s) = *st {
        if let Some(agent) = s.agents.iter_mut().find(|a| a.name == agent_name) {
            agent.model = Some(model);
        }
    }
    Ok(())
}

#[tauri::command]
async fn deploy_mission(
    app: AppHandle,
    state: tauri::State<'_, MissionManagerState>,
    agents: Vec<serde_json::Value>,
    tasks: Vec<serde_json::Value>,
) -> Result<(), String> {
    let manager = state.0.read().await;

    // Get project path, model, execution_mode, and description from current mission state
    let (project_path, lead_model, execution_mode, mission_description) = {
        let st = manager.state.read().await;
        match st.as_ref() {
            Some(s) => {
                let model = s.agents.iter()
                    .find(|a| a.name == "Lead")
                    .and_then(|a| a.model.clone())
                    .unwrap_or_else(|| "sonnet".to_string());
                (s.project_path.clone(), model, s.execution_mode.clone(), s.description.clone())
            }
            None => return Err("No active mission".into()),
        }
    };

    // Detect Vietnamese language from mission description
    let vietnamese_rule = {
        let vi_chars = ['à','á','ả','ã','ạ','ă','ắ','ằ','ẳ','ẵ','ặ','â','ấ','ầ','ẩ','ẫ','ậ',
                        'è','é','ẻ','ẽ','ẹ','ê','ế','ề','ể','ễ','ệ','ì','í','ỉ','ĩ','ị',
                        'ò','ó','ỏ','õ','ọ','ô','ố','ồ','ổ','ỗ','ộ','ơ','ớ','ờ','ở','ỡ','ợ',
                        'ù','ú','ủ','ũ','ụ','ư','ứ','ừ','ử','ữ','ự','ỳ','ý','ỷ','ỹ','ỵ','đ',
                        'À','Á','Ả','Ã','Ạ','Ă','Ắ','Ằ','Ẳ','Ẵ','Ặ','Â','Ấ','Ầ','Ẩ','Ẫ','Ậ',
                        'È','É','Ẻ','Ẽ','Ẹ','Ê','Ế','Ề','Ể','Ễ','Ệ','Ì','Í','Ỉ','Ĩ','Ị',
                        'Ò','Ó','Ỏ','Õ','Ọ','Ô','Ố','Ồ','Ổ','Ỗ','Ộ','Ơ','Ớ','Ờ','Ở','Ỡ','Ợ',
                        'Ù','Ú','Ủ','Ũ','Ụ','Ư','Ứ','Ừ','Ử','Ữ','Ự','Ỳ','Ý','Ỷ','Ỹ','Ỵ','Đ'];
        if mission_description.chars().any(|c| vi_chars.contains(&c)) {
            "\n## LANGUAGE REQUIREMENT\nThe requirement is in Vietnamese. Rules:\n\
            - All UI text, labels, buttons, placeholders, and user-facing strings MUST be in Vietnamese\n\
            - For PDF generation: MUST embed a Unicode font supporting Vietnamese characters (e.g. jsPDF with custom font, or @fontsource). Do NOT use default Latin-only fonts — Vietnamese chars will display as □□□ boxes\n\
            - Test that Vietnamese text renders correctly before marking any task done\n"
        } else {
            ""
        }
    };

    // Detect project type from working directory for smarter verification steps
    let project_type_hint = {
        let p = std::path::Path::new(&project_path);
        if p.join("package.json").exists() {
            let pkg = std::fs::read_to_string(p.join("package.json")).unwrap_or_default();
            if pkg.contains("\"vite\"") || pkg.contains("\"@vitejs") {
                "Node.js/Vite project. After writing code: run `npm install` then `npm run build`. If build fails, fix errors and retry. Final check: `npm run build` must succeed with 0 errors."
            } else if pkg.contains("\"next\"") {
                "Node.js/Next.js project. After writing code: run `npm install` then `npm run build`. If build fails, fix errors and retry."
            } else {
                "Node.js project. After writing code: run `npm install` then verify with `node -e \"require('./index.js')\"` or appropriate entry point."
            }
        } else if p.join("requirements.txt").exists() || p.join("pyproject.toml").exists() || p.join("setup.py").exists() {
            "Python project. After writing code: run `pip install -r requirements.txt` (if exists) then verify with `python -c \"import <module>\"` or run the main script."
        } else if p.join("Cargo.toml").exists() {
            "Rust project. After writing code: run `cargo build`. If it fails, fix errors and retry until `cargo build` succeeds."
        } else if p.join("go.mod").exists() {
            "Go project. After writing code: run `go build ./...`. If it fails, fix errors and retry."
        } else if p.join("pom.xml").exists() || p.join("build.gradle").exists() {
            "Java/JVM project. After writing code: run `mvn compile` or `gradle build`. Fix any errors before declaring done."
        } else {
            "Unknown project type. Detect from file extensions what runtime is needed. Always verify the code actually runs before reporting done."
        }
    };

    // Build deploy prompt from frontend-confirmed agents/tasks
    let agent_blocks: Vec<String> = agents.iter().map(|a| {
        let name = a.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let role = a.get("role").and_then(|r| r.as_str()).unwrap_or("");
        let model = a.get("model").and_then(|m| m.as_str()).unwrap_or("sonnet");
        let custom = a.get("customPrompt").and_then(|c| c.as_str()).unwrap_or("");
        let has_skill = a.get("skillFile").and_then(|s| s.get("name")).is_some();

        // Log skill injection for visibility
        if has_skill {
            let skill_name = a.get("skillFile").and_then(|s| s.get("name")).and_then(|n| n.as_str()).unwrap_or("?");
            eprintln!("[Deploy] Agent \"{}\": skill \"{}\" injected ({} chars in customPrompt)", name, skill_name, custom.len());
        }

        // Get tasks for this agent
        let agent_tasks: Vec<String> = tasks.iter()
            .filter(|t| {
                let agent_name = t.get("assigned_agent").and_then(|a| a.as_str())
                    .or_else(|| t.get("agent").and_then(|a| a.as_str()))
                    .unwrap_or("");
                agent_name == name
            })
            .map(|t| t.get("title").and_then(|tt| tt.as_str()).unwrap_or("").to_string())
            .collect();

        let tasks_str = agent_tasks.iter()
            .enumerate()
            .map(|(i, t)| format!("   {}. {}", i + 1, t))
            .collect::<Vec<_>>()
            .join("\n");

        let custom_str = if custom.is_empty() { String::new() } else { format!("\n   Custom: {}", custom) };

        format!(
            "### Agent: \"{name}\"\n\
             - Role: {role}\n\
             - Model: {model}\n\
             - Tasks:\n{tasks_str}{custom_str}"
        )
    }).collect();

    // Emit skill injection info to activity log for user visibility
    {
        let now = chrono::Utc::now().timestamp_millis();
        for a in &agents {
            let name = a.get("name").and_then(|n| n.as_str()).unwrap_or("?");
            let custom = a.get("customPrompt").and_then(|c| c.as_str()).unwrap_or("");
            let skill_name = a.get("skillFile").and_then(|s| s.get("name")).and_then(|n| n.as_str());
            if let Some(sn) = skill_name {
                let entry = LogEntry::new(now, "System", format!("Skill \"{}\" loaded for agent \"{}\" ({} chars)", sn, name, custom.len()), "info");
                let mut st = manager.state.write().await;
                if let Some(ref mut s) = *st {
                    s.log.push(entry.clone());
                }
                let _ = app.emit("mission:log", serde_json::to_value(&entry).unwrap());
            }
        }
    }

    let proj = project_path.replace('\\', "/");
    let agents_str = agent_blocks.join("\n\n");
    let total = agents.len().to_string();

    let deploy_prompt = if execution_mode == "agent_teams" {
        // Replace static vars first, then inject user content last (avoids accidental template injection)
        PROMPT_DEPLOY_AGENT_TEAMS
            .replace("{{PROJECT_PATH}}", &proj)
            .replace("{{PROJECT_TYPE}}", project_type_hint)
            .replace("{{LANG_RULE}}", &vietnamese_rule)
            .replace("{{TOTAL_AGENTS}}", &total)
            .replace("{{AGENT_BLOCKS}}", &agents_str) // last — user content may contain {{ }}
    } else {
        PROMPT_DEPLOY_STANDARD
            .replace("{{PROJECT_PATH}}", &proj)
            .replace("{{PROJECT_TYPE}}", project_type_hint)
            .replace("{{LANG_RULE}}", &vietnamese_rule)
            .replace("{{TOTAL_AGENTS}}", &total)
            .replace("{{AGENT_BLOCKS}}", &agents_str) // last — user content may contain {{ }}
    };

    // Update state to Deploying phase
    {
        let mut st = manager.state.write().await;
        if let Some(ref mut s) = *st {
            s.phase = MissionPhase::Deploying;
            s.status = MissionStatus::Running;
            if let Some(lead) = s.agents.iter_mut().find(|a| a.name == "Lead") {
                lead.status = AgentStatus::Working;
                lead.current_task = Some("Deploying teammates...".into());
            }
            for a_json in &agents {
                let name = a_json.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let model = a_json.get("model").and_then(|m| m.as_str()).unwrap_or("sonnet");
                if let Some(agent) = s.agents.iter_mut().find(|a| a.name == name) {
                    agent.model = Some(model.to_string());
                }
            }
            s.log.push(LogEntry {
                timestamp: chrono::Utc::now().timestamp_millis(),
                agent: "System".into(),
                message: "User approved plan — spawning new claude process for execution".into(),
                log_type: "info".into(),
            tool_name: None,
            phase_hint: None, file_path: None, lines: None,
            });
        }
    }

    let _ = app.emit("mission:status", serde_json::json!({ "status": "deploying" }));

    // Kill old process if still lingering
    {
        let mut child_lock = manager.child.write().await;
        if let Some(ref mut child) = *child_lock {
            let _ = child.kill().await;
        }
        *child_lock = None;
    }

    // Spawn a NEW claude -p process for the execution phase
    let clean_project_path = project_path.replace('/', "\\");

    let child_result = {
        let mut cmd = tokio::process::Command::new("claude");
        cmd.args(["-p", "--dangerously-skip-permissions", "--model", &lead_model, "--output-format", "stream-json", "--verbose", "--max-turns", "200"])
            .current_dir(&clean_project_path);
        if execution_mode == "agent_teams" {
            cmd.env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1");
        } else {
            cmd.env_remove("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
        }
        cmd.env_remove("CLAUDECODE")
            .env_remove("CLAUDE_CODE_SESSION")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::piped());
        cmd.spawn()
    };

    let mut child = child_result.map_err(|e| format!("Failed to spawn claude for deploy: {}", e))?;

    // Write deploy prompt to stdin then close
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        let _ = stdin.write_all(deploy_prompt.as_bytes()).await;
        drop(stdin);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Store new child process
    {
        let mut child_lock = manager.child.write().await;
        *child_lock = Some(child);
    }

    // Update phase to Executing
    {
        let mut st = manager.state.write().await;
        if let Some(ref mut s) = *st {
            s.phase = MissionPhase::Executing;
        }
    }

    // If agent_teams mode: start background watcher (polls task files + project dir)
    if execution_mode == "agent_teams" {
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        {
            let mut ws = manager.watcher_stop.write().await;
            // Cancel any previous watcher
            if let Some(prev) = ws.take() { let _ = prev.send(()); }
            *ws = Some(stop_tx);
        }
        let watcher_state = manager.state.clone();
        let watcher_app = app.clone();
        let watcher_proj = project_path.clone();
        tokio::spawn(async move {
            watch_agent_teams_mission(watcher_state, watcher_app, watcher_proj, stop_rx).await;
        });
    }

    // Spawn stdout reader for the deploy process (reuse same parsing logic)
    let state_clone = manager.state.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut parser = OutputParser::new();
        let mut running_tasks: std::collections::HashSet<String> = std::collections::HashSet::new();
        // Map tool_use_id → agent_name for tracking which subagent generates which output
        let mut tool_use_to_agent: std::collections::HashMap<String, String> = std::collections::HashMap::new();

        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() { continue; }

            let now = chrono::Utc::now().timestamp_millis();

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&clean) {
                let msg_type = json.get("type").and_then(|t| t.as_str()).unwrap_or("");
                // Track parent_tool_use_id to attribute output to subagents
                let parent_id = json.get("parent_tool_use_id").and_then(|p| p.as_str()).unwrap_or("").to_string();

                // Determine which agent this message belongs to
                let source_agent = if !parent_id.is_empty() {
                    tool_use_to_agent.get(&parent_id).cloned().unwrap_or_else(|| "Subagent".to_string())
                } else {
                    "Lead".to_string()
                };

                match msg_type {
                    "system" => {
                        let subtype = json.get("subtype").and_then(|s| s.as_str()).unwrap_or("");

                        // task_notification and task_progress carry tool_use_id (not parent_tool_use_id)
                        // Use tool_use_id to look up the agent name
                        let tool_use_id_direct = json.get("tool_use_id").and_then(|t| t.as_str()).unwrap_or("");
                        let task_agent = if !tool_use_id_direct.is_empty() {
                            tool_use_to_agent.get(tool_use_id_direct).cloned()
                                .unwrap_or_else(|| source_agent.clone())
                        } else {
                            source_agent.clone()
                        };

                        match subtype {
                            "init" => { /* skip */ }
                            "task_notification" => {
                                // Subagent completed — extract output text from the notification
                                let output = json.get("output").and_then(|o| o.as_str()).unwrap_or("");
                                let msg = if output.is_empty() {
                                    format!("[{}] Task notification received", task_agent)
                                } else {
                                    // Truncate very long output to first 500 chars
                                    if output.len() > 500 {
                                        format!("{}...", &output[..497])
                                    } else {
                                        output.to_string()
                                    }
                                };
                                let entry = LogEntry { timestamp: now, agent: task_agent.clone(), message: msg, log_type: "result".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                                {
                                    let mut st = state_clone.write().await;
                                    if let Some(ref mut s) = *st {
                                        s.log.push(entry.clone());
                                        s.raw_output.push(clean.clone());
                                        // Mark agent as Done after notification
                                        if let Some(agent) = s.agents.iter_mut().find(|a| a.name == task_agent) {
                                            agent.status = AgentStatus::Done;
                                            agent.current_task = Some("Completed".into());
                                        }
                                    }
                                }
                                let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                            }
                            "task_progress" => {
                                // Subagent is actively working — show progress description
                                let desc = json.get("description").and_then(|d| d.as_str()).unwrap_or("Working...");
                                let entry = LogEntry { timestamp: now, agent: task_agent.clone(), message: desc.to_string(), log_type: "tool".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                                {
                                    let mut st = state_clone.write().await;
                                    if let Some(ref mut s) = *st {
                                        s.log.push(entry.clone());
                                        s.raw_output.push(clean.clone());
                                        // Mark agent as Working and update current task
                                        if let Some(agent) = s.agents.iter_mut().find(|a| a.name == task_agent) {
                                            if agent.status != AgentStatus::Done {
                                                agent.status = AgentStatus::Working;
                                                agent.current_task = Some(desc.chars().take(80).collect());
                                            }
                                        }
                                    }
                                }
                                let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                            }
                            "task_started" => {
                                let task_id = json.get("task_id").and_then(|t| t.as_str()).unwrap_or("");
                                let desc = json.get("description").and_then(|d| d.as_str()).unwrap_or("");
                                if !task_id.is_empty() {
                                    running_tasks.insert(task_id.to_string());
                                }
                                let entry = LogEntry { timestamp: now, agent: task_agent.clone(), message: format!("Started: {}", desc), log_type: "spawn".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                                {
                                    let mut st = state_clone.write().await;
                                    if let Some(ref mut s) = *st {
                                        s.log.push(entry.clone());
                                        s.raw_output.push(clean.clone());
                                        if let Some(agent) = s.agents.iter_mut().find(|a| a.name == task_agent) {
                                            if agent.status != AgentStatus::Done {
                                                agent.status = AgentStatus::Working;
                                                agent.current_task = Some(desc.chars().take(80).collect());
                                            }
                                        }
                                    }
                                }
                                let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                            }
                            "task_completed" => {
                                let task_id = json.get("task_id").and_then(|t| t.as_str()).unwrap_or("");
                                if !task_id.is_empty() {
                                    running_tasks.remove(task_id);
                                }
                                {
                                    let mut st = state_clone.write().await;
                                    if let Some(ref mut s) = *st {
                                        if let Some(agent) = s.agents.iter_mut().find(|a| a.name == task_agent) {
                                            agent.status = AgentStatus::Done;
                                            agent.current_task = Some("Completed".into());
                                        }
                                    }
                                }
                                let entry = LogEntry { timestamp: now, agent: task_agent.clone(), message: format!("Task completed (remaining: {})", running_tasks.len()), log_type: "result".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                                { let mut st = state_clone.write().await; if let Some(ref mut s) = *st { s.log.push(entry.clone()); s.raw_output.push(clean.clone()); } }
                                let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                            }
                            _ => {
                                let text = json.get("message").and_then(|m| m.as_str()).unwrap_or(&clean);
                                let entry = LogEntry { timestamp: now, agent: source_agent.clone(), message: text.to_string(), log_type: "info".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                                { let mut st = state_clone.write().await; if let Some(ref mut s) = *st { s.log.push(entry.clone()); s.raw_output.push(clean.clone()); } }
                                let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                            }
                        }
                    }

                    "assistant" => {
                        // Extract text and tool_use from assistant messages
                        if let Some(content) = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array()) {
                            for block in content {
                                let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                match block_type {
                                    "text" => {
                                        let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("");
                                        if !text.trim().is_empty() {
                                            let (parsed_agent, message) = parse_progress_line(text);
                                            // Use source_agent for subagent output, parsed_agent for lead
                                            let final_agent = if parent_id.is_empty() { parsed_agent } else { source_agent.clone() };
                                            let entry = LogEntry { timestamp: now, agent: final_agent.clone(), message: message.clone(), log_type: "thinking".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };

                                            // Update agent status to Working + detect task completion in text
                                            {
                                                let mut st = state_clone.write().await;
                                                if let Some(ref mut s) = *st {
                                                    s.log.push(entry.clone());
                                                    s.raw_output.push(clean.clone());
                                                    if let Some(agent) = s.agents.iter_mut().find(|a| a.name == final_agent) {
                                                        if agent.status != AgentStatus::Done {
                                                            agent.status = AgentStatus::Working;
                                                        }
                                                    }
                                                    // Detect "[AgentName] Completed: task" or "task completed" patterns
                                                    let lower_msg = message.to_lowercase();
                                                    if lower_msg.contains("completed") || lower_msg.contains("done") || lower_msg.contains("finished") {
                                                        for task in s.tasks.iter_mut() {
                                                            if task.status == TaskStatus::Completed { continue; }
                                                            let task_agent = task.assigned_agent.as_deref().unwrap_or("").to_lowercase();
                                                            let final_lower = final_agent.to_lowercase();
                                                            let agent_match = !task_agent.is_empty() && (
                                                                task_agent == final_lower
                                                                || task_agent.contains(&final_lower)
                                                                || final_lower.contains(&task_agent)
                                                                || final_lower.split(|c: char| c == '-' || c == '_' || c == ' ').any(|w| w.len() > 2 && task_agent.contains(w))
                                                            );
                                                            let task_lower = task.title.to_lowercase();
                                                            let title_match = task_lower.split_whitespace()
                                                                .filter(|w| w.len() > 3)
                                                                .any(|w| lower_msg.contains(w));
                                                            if agent_match && title_match {
                                                                task.status = TaskStatus::Completed;
                                                                task.completed_at = Some(now);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                                        }
                                    }
                                    "tool_use" => {
                                        let tool = block.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                                        let tool_use_id = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                                        let input = block.get("input").and_then(|i| i.as_object());
                                        let detail = match tool {
                                            "Agent" => input.and_then(|i| i.get("description")).and_then(|d| d.as_str()).unwrap_or("spawning agent").to_string(),
                                            "Write" | "Edit" => input.and_then(|i| i.get("file_path")).and_then(|p| p.as_str()).unwrap_or("").to_string(),
                                            "Bash" => input.and_then(|i| i.get("command")).and_then(|c| c.as_str()).map(|c| if c.len() > 80 { format!("{}...", &c[..77]) } else { c.to_string() }).unwrap_or_default(),
                                            "Glob" => input.and_then(|i| i.get("pattern")).and_then(|p| p.as_str()).unwrap_or("").to_string(),
                                            "Grep" => input.and_then(|i| i.get("pattern")).and_then(|p| p.as_str()).unwrap_or("").to_string(),
                                            "Read" => input.and_then(|i| i.get("file_path")).and_then(|p| p.as_str()).unwrap_or("").to_string(),
                                            "TeamCreate" => {
                                                let tn = input.and_then(|i| i.get("team_name")).and_then(|n| n.as_str()).unwrap_or("unknown");
                                                format!("Creating team: {}", tn)
                                            },
                                            "TeamDelete" => "Deleting team".to_string(),
                                            "TaskCreate" => {
                                                let c = input.and_then(|i| i.get("content")).and_then(|c| c.as_str()).unwrap_or("");
                                                if c.len() > 60 { format!("{}...", &c[..57]) } else { c.to_string() }
                                            },
                                            "TaskUpdate" => {
                                                let st = input.and_then(|i| i.get("status")).and_then(|s| s.as_str()).unwrap_or("");
                                                let ow = input.and_then(|i| i.get("owner")).and_then(|o| o.as_str()).unwrap_or("");
                                                if !ow.is_empty() { format!("Assign to {} ({})", ow, st) } else { format!("Status -> {}", st) }
                                            },
                                            "TaskList" => "Checking task list".to_string(),
                                            "SendMessage" => {
                                                let mt = input.and_then(|i| i.get("type")).and_then(|t| t.as_str()).unwrap_or("message");
                                                let rc = input.and_then(|i| i.get("recipient")).and_then(|r| r.as_str()).unwrap_or("");
                                                let ct = input.and_then(|i| i.get("content")).and_then(|c| c.as_str()).unwrap_or("");
                                                let pv = if ct.len() > 50 { format!("{}...", &ct[..47]) } else { ct.to_string() };
                                                match mt {
                                                    "broadcast" => format!("Broadcast: {}", pv),
                                                    "shutdown_request" => format!("Shutdown -> {}", rc),
                                                    _ => format!("DM -> {}: {}", rc, pv),
                                                }
                                            },
                                            _ => "".to_string(),
                                        };
                                        let (msg, entry_file_path, entry_lines) = if tool == "Write" || tool == "Edit" {
                                            let fp = input.and_then(|i| i.get("file_path")).and_then(|p| p.as_str()).unwrap_or("");
                                            let lc: i64 = if tool == "Write" {
                                                input.and_then(|i| i.get("content")).and_then(|c| c.as_str()).map(|c| c.lines().count() as i64).unwrap_or(0)
                                            } else {
                                                input.and_then(|i| i.get("new_string")).and_then(|s| s.as_str()).map(|s| s.lines().count() as i64).unwrap_or(0)
                                            };
                                            let action = if tool == "Write" { "Write" } else { "Edit" };
                                            (format!("{}: {} (+{} lines)", action, fp, lc), Some(fp.to_string()), Some(lc))
                                        } else if detail.is_empty() {
                                            (format!("Using tool: {}", tool), None, None)
                                        } else {
                                            (format!("{}: {}", tool, detail), None, None)
                                        };
                                        let mut entry = LogEntry::new(now, source_agent.clone(), msg, "tool").with_tool(tool.to_string());
                                        entry.file_path = entry_file_path;
                                        entry.lines = entry_lines;
                                        {
                                            let mut st = state_clone.write().await;
                                            if let Some(ref mut s) = *st {
                                                s.log.push(entry.clone());
                                                // Update agent current task
                                                if let Some(agent) = s.agents.iter_mut().find(|a| a.name == source_agent) {
                                                    agent.current_task = Some(format!("{}: {}", tool, if detail.len() > 80 { format!("{}…", &detail[..77]) } else { detail.clone() }));
                                                    if agent.status != AgentStatus::Done {
                                                        agent.status = AgentStatus::Working;
                                                    }
                                                }
                                            }
                                        }
                                        let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());

                                        // Detect Agent tool → subagent spawning, register tool_use_id mapping
                                        if tool == "Agent" {
                                            let raw_name = input.and_then(|i| i.get("name")).and_then(|n| n.as_str()).unwrap_or("");
                                            let desc = input.and_then(|i| i.get("description")).and_then(|d| d.as_str()).unwrap_or("");
                                            let model_str = input.and_then(|i| i.get("model")).and_then(|m| m.as_str()).unwrap_or("sonnet");

                                            // Resolve the actual agent name:
                                            // 1. If raw_name matches a planned agent → use it
                                            // 2. If raw_name doesn't match any planned agent (or is empty)
                                            //    → pick the first Idle/Spawning planned agent (non-Lead) in order
                                            // 3. Only create a new agent entry if no planned slot is available
                                            let agent_name = {
                                                let mut st = state_clone.write().await;
                                                if let Some(ref mut s) = *st {
                                                    let planned_match = s.agents.iter().any(|a| a.name == raw_name && a.name != "Lead");
                                                    if planned_match {
                                                        // Exact match → activate it
                                                        if let Some(a) = s.agents.iter_mut().find(|a| a.name == raw_name) {
                                                            a.status = AgentStatus::Working;
                                                            a.current_task = Some("Starting...".into());
                                                        }
                                                        raw_name.to_string()
                                                    } else {
                                                        // No match → find first idle planned agent slot
                                                        let idle_name = s.agents.iter()
                                                            .find(|a| a.name != "Lead" && (a.status == AgentStatus::Idle || a.status == AgentStatus::Spawning))
                                                            .map(|a| a.name.clone());

                                                        if let Some(name) = idle_name {
                                                            // Re-use planned slot
                                                            if let Some(a) = s.agents.iter_mut().find(|a| a.name == name) {
                                                                a.status = AgentStatus::Working;
                                                                a.current_task = Some("Starting...".into());
                                                            }
                                                            name
                                                        } else if !raw_name.is_empty() {
                                                            // No idle slot, raw_name provided — add as new
                                                            if !s.agents.iter().any(|a| a.name == raw_name) {
                                                                s.agents.push(Agent {
                                                                    name: raw_name.to_string(),
                                                                    role: infer_role(raw_name),
                                                                    status: AgentStatus::Working,
                                                                    current_task: Some("Starting...".into()),
                                                                    model: Some(model_str.to_string()),
                                                                    spawned_at: now,
                                                                    model_reason: None,
                                                                });
                                                            }
                                                            raw_name.to_string()
                                                        } else {
                                                            // Truly unknown — use description truncated, don't create entry
                                                            desc.chars().take(30).collect::<String>()
                                                        }
                                                    }
                                                } else {
                                                    raw_name.to_string()
                                                }
                                            };

                                            if !tool_use_id.is_empty() {
                                                tool_use_to_agent.insert(tool_use_id.to_string(), agent_name.clone());
                                            }

                                            let _ = app_clone.emit("mission:agent-spawned", serde_json::json!({
                                                "agent_name": agent_name,
                                                "role": desc,
                                                "timestamp": now,
                                            }));
                                        }

                                        // Detect file writes — extract diff/line data and attribute to correct agent
                                        if tool == "Write" || tool == "Edit" {
                                            if let Some(path) = input.and_then(|i| i.get("file_path")).and_then(|p| p.as_str()) {
                                                let is_write = tool == "Write";
                                                let (lines, content_preview, diff_old, diff_new) = if is_write {
                                                    let content = input.and_then(|i| i.get("content")).and_then(|c| c.as_str()).unwrap_or("");
                                                    let line_count = content.lines().count() as i64;
                                                    let preview = if content.len() > 2000 { format!("{}…", &content[..1997]) } else { content.to_string() };
                                                    (Some(line_count), Some(preview), None, None)
                                                } else {
                                                    let old = input.and_then(|i| i.get("old_string")).and_then(|s| s.as_str()).unwrap_or("");
                                                    let new = input.and_then(|i| i.get("new_string")).and_then(|s| s.as_str()).unwrap_or("");
                                                    let changed = new.lines().count() as i64;
                                                    let old_p = if old.len() > 1500 { format!("{}…", &old[..1497]) } else { old.to_string() };
                                                    let new_p = if new.len() > 1500 { format!("{}…", &new[..1497]) } else { new.to_string() };
                                                    (Some(changed), Some(new_p.clone()), Some(old_p), Some(new_p))
                                                };
                                                {
                                                    let mut st = state_clone.write().await;
                                                    if let Some(ref mut s) = *st {
                                                        if let Some(existing) = s.file_changes.iter_mut().find(|fc| fc.path == path) {
                                                            existing.action = if is_write { "created".into() } else { "modified".into() };
                                                            existing.agent = source_agent.clone();
                                                            existing.timestamp = now;
                                                            existing.lines = lines;
                                                            existing.content_preview = content_preview.clone();
                                                            existing.diff_old = diff_old.clone();
                                                            existing.diff_new = diff_new.clone();
                                                        } else {
                                                            s.file_changes.push(FileChange {
                                                                path: path.to_string(),
                                                                action: if is_write { "created".into() } else { "modified".into() },
                                                                agent: source_agent.clone(),
                                                                timestamp: now,
                                                                lines,
                                                                content_preview: content_preview.clone(),
                                                                diff_old: diff_old.clone(),
                                                                diff_new: diff_new.clone(),
                                                            });
                                                        }
                                                    }
                                                }
                                                let _ = app_clone.emit("mission:file-change", serde_json::json!({
                                                    "path": path,
                                                    "action": if is_write { "created" } else { "modified" },
                                                    "agent": source_agent,
                                                    "timestamp": now,
                                                    "lines": lines,
                                                    "content_preview": content_preview,
                                                    "diff_old": diff_old,
                                                    "diff_new": diff_new,
                                                }));
                                            }
                                        }

                                        // Detect TeamCreate → store team name
                                        if tool == "TeamCreate" {
                                            let team = input.and_then(|i| i.get("team_name")).and_then(|n| n.as_str()).unwrap_or("mission");
                                            {
                                                let mut st = state_clone.write().await;
                                                if let Some(ref mut s) = *st {
                                                    s.team_name = Some(team.to_string());
                                                }
                                            }
                                            let _ = app_clone.emit("mission:team-event", serde_json::json!({
                                                "event": "created",
                                                "team_name": team,
                                                "timestamp": now,
                                            }));
                                        }

                                        // Detect TeamDelete → clear team
                                        if tool == "TeamDelete" {
                                            {
                                                let mut st = state_clone.write().await;
                                                if let Some(ref mut s) = *st {
                                                    s.team_name = None;
                                                }
                                            }
                                            let _ = app_clone.emit("mission:team-event", serde_json::json!({
                                                "event": "deleted",
                                                "timestamp": now,
                                            }));
                                        }

                                        // Detect SendMessage → store inter-agent message
                                        if tool == "SendMessage" {
                                            let mt = input.and_then(|i| i.get("type")).and_then(|t| t.as_str()).unwrap_or("message");
                                            let rc = input.and_then(|i| i.get("recipient")).and_then(|r| r.as_str()).unwrap_or("");
                                            let ct = input.and_then(|i| i.get("content")).and_then(|c| c.as_str()).unwrap_or("");
                                            {
                                                let mut st = state_clone.write().await;
                                                if let Some(ref mut s) = *st {
                                                    s.messages.push(AgentMessage {
                                                        timestamp: now,
                                                        from: source_agent.clone(),
                                                        to: if mt == "broadcast" { "all".to_string() } else { rc.to_string() },
                                                        content: ct.to_string(),
                                                        msg_type: mt.to_string(),
                                                    });
                                                }
                                            }
                                            let _ = app_clone.emit("mission:agent-message", serde_json::json!({
                                                "from": source_agent,
                                                "to": if mt == "broadcast" { "all" } else { rc },
                                                "content": ct,
                                                "msg_type": mt,
                                                "timestamp": now,
                                            }));
                                        }

                                        // Detect TaskUpdate → update task status/owner
                                        if tool == "TaskUpdate" {
                                            let task_id_input = input.and_then(|i| i.get("task_id")).and_then(|t| t.as_str()).unwrap_or("");
                                            let new_status = input.and_then(|i| i.get("status")).and_then(|s| s.as_str()).unwrap_or("");
                                            let new_owner = input.and_then(|i| i.get("owner")).and_then(|o| o.as_str()).unwrap_or("");
                                            let mut task_description = String::new();
                                            {
                                                let mut st = state_clone.write().await;
                                                if let Some(ref mut s) = *st {
                                                    if let Some(task) = s.tasks.iter_mut().find(|t| t.id == task_id_input) {
                                                        task_description = task.title.clone();
                                                        if !new_owner.is_empty() {
                                                            let old_owner = task.assigned_agent.clone();
                                                            task.assigned_agent = Some(new_owner.to_string());
                                                            let _ = app_clone.emit("mission:task-reassigned", serde_json::json!({
                                                                "task": task.title,
                                                                "from": old_owner,
                                                                "to": new_owner,
                                                                "timestamp": now,
                                                            }));
                                                        }
                                                        match new_status {
                                                            "in_progress" => { task.status = TaskStatus::InProgress; task.started_at = Some(now); }
                                                            "completed" => { task.status = TaskStatus::Completed; task.completed_at = Some(now); }
                                                            "blocked" => { task.status = TaskStatus::Blocked; }
                                                            _ => {}
                                                        }
                                                    }
                                                }
                                            }
                                            let _ = app_clone.emit("mission:task-update", serde_json::json!({
                                                "task_id": task_id_input,
                                                "agent": new_owner,
                                                "description": task_description,
                                                "status": new_status,
                                                "owner": new_owner,
                                                "timestamp": now,
                                            }));
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }

                    "user" => {
                        // Tool results from subagents
                        let mut st = state_clone.write().await;
                        if let Some(ref mut s) = *st {
                            s.raw_output.push(clean.clone());
                        }
                    }

                    "result" => {
                        let is_subagent_result = !parent_id.is_empty();
                        let text = json.get("result").and_then(|r| r.as_str())
                            .or_else(|| json.get("content").and_then(|c| {
                                if let Some(arr) = c.as_array() {
                                    arr.iter().filter_map(|item| item.get("text").and_then(|t| t.as_str())).next()
                                } else { c.as_str() }
                            }))
                            .unwrap_or("Execution completed");

                        let display = if text.len() > 500 { format!("{}...", &text[..500]) } else { text.to_string() };

                        if is_subagent_result {
                            // Subagent completed
                            let entry = LogEntry { timestamp: now, agent: source_agent.clone(), message: format!("Completed: {}", display), log_type: "result".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                            {
                                let mut st = state_clone.write().await;
                                if let Some(ref mut s) = *st {
                                    s.log.push(entry.clone());
                                    if let Some(agent) = s.agents.iter_mut().find(|a| a.name == source_agent) {
                                        agent.status = AgentStatus::Done;
                                        agent.current_task = Some("Completed".into());
                                    }
                                    // Try to mark matching tasks as completed — fuzzy match agent name
                                    let lower_name = source_agent.to_lowercase();
                                    let lower_text = text.to_lowercase();
                                    for task in s.tasks.iter_mut() {
                                        if task.status == TaskStatus::Completed { continue; }
                                        let task_agent = task.assigned_agent.as_deref().unwrap_or("").to_lowercase();
                                        let task_title = task.title.to_lowercase();
                                        // Match by: agent name matches OR task title appears in result text
                                        let agent_match = !task_agent.is_empty() && (
                                            task_agent == lower_name
                                            || task_agent.contains(&lower_name)
                                            || lower_name.contains(&task_agent)
                                            // Also split on common separators and match any word
                                            || lower_name.split(|c: char| c == '-' || c == '_' || c == ' ').any(|w| w.len() > 2 && task_agent.contains(w))
                                            || task_agent.split(|c: char| c == '-' || c == '_' || c == ' ').any(|w| w.len() > 2 && lower_name.contains(w))
                                        );
                                        let content_match = !task_title.is_empty() && (
                                            lower_text.contains(&task_title)
                                            || task_title.split_whitespace().filter(|w| w.len() > 3).all(|w| lower_text.contains(w))
                                        );
                                        if agent_match || content_match {
                                            task.status = TaskStatus::Completed;
                                            task.completed_at = Some(now);
                                        }
                                    }
                                }
                            }
                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                        } else {
                            // Lead result — mission done
                            let entry = LogEntry { timestamp: now, agent: "Lead".into(), message: format!("Result: {}", display), log_type: "result".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                            {
                                let mut st = state_clone.write().await;
                                if let Some(ref mut s) = *st {
                                    s.log.push(entry.clone());
                                    s.status = MissionStatus::Completed;
                                    s.phase = MissionPhase::Done;
                                    for a in s.agents.iter_mut() {
                                        if a.status != AgentStatus::Error {
                                            a.status = AgentStatus::Done;
                                        }
                                        if a.name == "Lead" {
                                            a.current_task = Some("Mission completed".into());
                                        }
                                    }
                                }
                            }
                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                            let _ = app_clone.emit("mission:status", serde_json::json!({ "status": "completed" }));
                        }
                    }

                    _ => {
                        let mut st = state_clone.write().await;
                        if let Some(ref mut s) = *st { s.raw_output.push(clean.clone()); }
                    }
                }
            } else {
                // Plain text fallback
                let events = parser.parse_line(&clean);
                for event in events {
                    handle_parsed_event(&state_clone, &app_clone, event).await;
                }
            }
        }

        // Post-mission: scan filesystem for file changes not caught by stream parsing
        {
            let project_path_str = {
                let st = state_clone.read().await;
                st.as_ref().map(|s| s.project_path.clone()).unwrap_or_default()
            };
            if !project_path_str.is_empty() {
                let p = std::path::Path::new(&project_path_str);
                if p.exists() {
                    let now = chrono::Utc::now().timestamp_millis();
                    let mut st = state_clone.write().await;
                    if let Some(ref mut s) = *st {
                        let existing_paths: std::collections::HashSet<String> = s.file_changes.iter().map(|f| f.path.clone()).collect();
                        fn scan_dir(dir: &std::path::Path, base: &std::path::Path, files: &mut Vec<String>) {
                            if let Ok(entries) = std::fs::read_dir(dir) {
                                for entry in entries.flatten() {
                                    let path = entry.path();
                                    let name = entry.file_name().to_string_lossy().to_string();
                                    if name == "node_modules" || name == ".git" || name == ".claude" || name == "dist" || name == "build" || name == "target" || name.starts_with('.') { continue; }
                                    if path.is_dir() {
                                        scan_dir(&path, base, files);
                                    } else {
                                        if let Ok(rel) = path.strip_prefix(base) {
                                            files.push(rel.to_string_lossy().to_string().replace('\\', "/"));
                                        }
                                    }
                                }
                            }
                        }
                        let mut found_files = Vec::new();
                        scan_dir(p, p, &mut found_files);
                        for fpath in found_files {
                            if !existing_paths.contains(&fpath) {
                                s.file_changes.push(FileChange {
                                    path: fpath.clone(),
                                    action: "created".into(),
                                    agent: "Agent".into(),
                                    timestamp: now,
                                    lines: None,
                                    content_preview: None,
                                    diff_old: None,
                                    diff_new: None,
                                });
                                let _ = app_clone.emit("mission:file-change", serde_json::json!({
                                    "path": fpath,
                                    "action": "created",
                                    "agent": "Agent",
                                    "timestamp": now,
                                }));
                            }
                        }
                        // Also mark any remaining pending tasks as completed if all agents are Done
                        let all_agents_done = s.agents.iter().all(|a| a.status == AgentStatus::Done || a.name == "Lead");
                        if all_agents_done && s.status == MissionStatus::Completed {
                            for task in s.tasks.iter_mut() {
                                if task.status != TaskStatus::Completed {
                                    task.status = TaskStatus::Completed;
                                    task.completed_at = Some(now);
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Spawn stderr reader for deploy process
    let state_clone2 = manager.state.clone();
    let app_clone2 = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() { continue; }
            let now = chrono::Utc::now().timestamp_millis();
            let entry = LogEntry { timestamp: now, agent: "System".into(), message: clean.clone(), log_type: "error".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
            { let mut st = state_clone2.write().await; if let Some(ref mut s) = *st { s.log.push(entry.clone()); } }
            let _ = app_clone2.emit("mission:log", serde_json::to_value(&entry).unwrap());
        }
    });

    Ok(())
}

// ─── Continue Mission (user intervention) ────────────────────────

#[tauri::command]
async fn continue_mission(
    app: AppHandle,
    state: tauri::State<'_, MissionManagerState>,
    message: String,
    context_json: String,
) -> Result<(), String> {
    let manager = state.0.read().await;

    // Try to get context from history snapshot first, then fall back to current state
    let history_state: Option<serde_json::Value> = if !context_json.is_empty() {
        serde_json::from_str(&context_json).ok()
    } else {
        None
    };

    // Get context from current mission state or history snapshot
    let (project_path, lead_model, completed_summary) = {
        if let Some(ref hs) = history_state {
            // Continue from history snapshot
            let path = hs.get("project_path").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let model = hs.get("agents").and_then(|a| a.as_array())
                .and_then(|arr| arr.iter().find(|a| a.get("name").and_then(|n| n.as_str()) == Some("Lead")))
                .and_then(|lead| lead.get("model").and_then(|m| m.as_str()))
                .unwrap_or("sonnet").to_string();
            let tasks = hs.get("tasks").and_then(|t| t.as_array()).map(|arr| {
                arr.iter().map(|t| format!("- [{:?}] {}",
                    t.get("status").and_then(|s| s.as_str()).unwrap_or("unknown"),
                    t.get("title").and_then(|tt| tt.as_str()).unwrap_or("")
                )).collect::<Vec<_>>().join("\n")
            }).unwrap_or_default();
            (path, model, tasks)
        } else {
            let st = manager.state.read().await;
            match st.as_ref() {
                Some(s) => {
                    let model = s.agents.iter()
                        .find(|a| a.name == "Lead")
                        .and_then(|a| a.model.clone())
                        .unwrap_or_else(|| "sonnet".to_string());

                    // Build summary of completed work from tasks
                    let summary: Vec<String> = s.tasks.iter()
                        .filter(|t| matches!(t.status, TaskStatus::Completed))
                        .map(|t| format!("- [DONE] {} (by {})", t.title, t.assigned_agent.as_deref().unwrap_or("unknown")))
                        .collect();
                    let in_progress: Vec<String> = s.tasks.iter()
                        .filter(|t| matches!(t.status, TaskStatus::InProgress))
                        .map(|t| format!("- [IN PROGRESS] {} (by {})", t.title, t.assigned_agent.as_deref().unwrap_or("unknown")))
                        .collect();
                    let pending: Vec<String> = s.tasks.iter()
                        .filter(|t| matches!(t.status, TaskStatus::Pending))
                        .map(|t| format!("- [PENDING] {}", t.title))
                        .collect();

                    let mut parts = Vec::new();
                    if !summary.is_empty() { parts.push(format!("Completed:\n{}", summary.join("\n"))); }
                    if !in_progress.is_empty() { parts.push(format!("In Progress:\n{}", in_progress.join("\n"))); }
                    if !pending.is_empty() { parts.push(format!("Pending:\n{}", pending.join("\n"))); }

                // Include recent log output so claude has context of what was actually done
                let recent_logs: Vec<String> = s.log.iter().rev()
                    .take(30)
                    .rev()
                    .filter(|l| l.log_type != "raw")
                    .map(|l| format!("[{}] {}", l.agent, l.message))
                    .collect();
                if !recent_logs.is_empty() {
                    parts.push(format!("Recent activity:\n{}", recent_logs.join("\n")));
                }

                // Include list of files changed so far
                let file_changes: Vec<String> = s.file_changes.iter()
                    .map(|f| format!("- {} ({})", f.path, f.action))
                    .collect();
                if !file_changes.is_empty() {
                    parts.push(format!("Files created/modified:\n{}", file_changes.join("\n")));
                }

                (s.project_path.clone(), model, parts.join("\n\n"))
            }
            None => return Err("No active mission to continue".into()),
        }
        // end else branch
        }
    };

    // Build continuation prompt
    let project_type_hint_cont = {
        let p = std::path::Path::new(&project_path);
        if p.join("package.json").exists() {
            let pkg = std::fs::read_to_string(p.join("package.json")).unwrap_or_default();
            if pkg.contains("\"vite\"") || pkg.contains("\"@vitejs") {
                "Node.js/Vite — verify with: npm install && npm run build"
            } else {
                "Node.js — verify with: npm install && node <entry>"
            }
        } else if p.join("requirements.txt").exists() || p.join("pyproject.toml").exists() {
            "Python — verify with: pip install -r requirements.txt && python <entry>"
        } else if p.join("Cargo.toml").exists() {
            "Rust — verify with: cargo build"
        } else {
            "Unknown — detect and verify appropriately"
        }
    };
    let continue_prompt = PROMPT_CONTINUE_MISSION
        .replace("{{PROJECT_PATH}}", &project_path.replace('\\', "/"))
        .replace("{{PROJECT_TYPE}}", project_type_hint_cont)
        .replace("{{SUMMARY}}", &if completed_summary.is_empty() { "No previous work recorded.".to_string() } else { completed_summary })
        .replace("{{MESSAGE}}", &message); // last — user content may contain {{ }}

    // Log the intervention
    let now = chrono::Utc::now().timestamp_millis();
    {
        let mut st = manager.state.write().await;
        if let Some(ref mut s) = *st {
            s.log.push(LogEntry {
                timestamp: now,
                agent: "User".into(),
                message: format!("Intervention: {}", message),
                log_type: "info".into(),
            tool_name: None,
            phase_hint: None, file_path: None, lines: None,
            });
            s.phase = MissionPhase::Deploying;
            s.status = MissionStatus::Running;
            s.messages = vec![];   // fresh message thread for continuation
            s.team_name = None;    // will be set when Lead calls TeamCreate
            // Keep previous agents visible but reset their status
            // They are from the previous run (dead processes) but show history
            for a in s.agents.iter_mut() {
                if a.name == "Lead" {
                    a.status = AgentStatus::Working;
                    a.current_task = Some("Continuing mission...".into());
                    a.model = Some(lead_model.clone());
                } else {
                    // Previous subagents stay visible with their Done/Error status
                    // New subagents will be added when Lead spawns them
                }
            }
            // Ensure Lead exists
            if !s.agents.iter().any(|a| a.name == "Lead") {
                s.agents.insert(0, Agent {
                    name: "Lead".into(),
                    role: "Orchestrator".into(),
                    status: AgentStatus::Working,
                    model: Some(lead_model.clone()),
                    current_task: Some("Continuing mission...".into()),
                    spawned_at: now,
                    model_reason: None,
                });
            }
        }
    }

    let _ = app.emit("mission:log", serde_json::json!({
        "timestamp": now,
        "agent": "User",
        "message": format!("Intervention: {}", message),
        "log_type": "info"
    }));
    let _ = app.emit("mission:status", serde_json::json!({ "status": "running" }));

    // Kill existing process if still running
    {
        let mut child_lock = manager.child.write().await;
        if let Some(ref mut child) = *child_lock {
            let _ = child.kill().await;
        }
        *child_lock = None;
    }

    // Spawn new claude process
    let clean_project_path = project_path.replace('/', "\\");

    let child_result = {
        let mut cmd = tokio::process::Command::new("claude");
        cmd.args(["-p", "--dangerously-skip-permissions", "--model", &lead_model, "--output-format", "stream-json", "--verbose", "--max-turns", "200"])
            .current_dir(&clean_project_path)
            .env_remove("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS")
            .env_remove("CLAUDECODE")
            .env_remove("CLAUDE_CODE_SESSION")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::piped());
        cmd.spawn()
    };

    let mut child = child_result.map_err(|e| format!("Failed to spawn claude for continuation: {}", e))?;

    // Write continuation prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        let _ = stdin.write_all(continue_prompt.as_bytes()).await;
        drop(stdin);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    // Store new child process
    {
        let mut child_lock = manager.child.write().await;
        *child_lock = Some(child);
    }

    // Update phase
    {
        let mut st = manager.state.write().await;
        if let Some(ref mut s) = *st {
            s.phase = MissionPhase::Executing;
        }
    }

    // Spawn stdout reader — parse stream-json like deploy_mission
    let state_clone = manager.state.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut tool_use_to_agent: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        let mut line_count: u64 = 0;

        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() { continue; }
            line_count += 1;

            // Emit raw line
            let _ = app_clone.emit("mission:raw-line", serde_json::json!({ "line": &clean, "line_number": line_count }));

            // Store raw output
            {
                let mut st = state_clone.write().await;
                if let Some(ref mut s) = *st {
                    s.raw_output.push(clean.clone());
                }
            }

            // Parse JSON
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&clean) {
                let msg_type = json.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let now = chrono::Utc::now().timestamp_millis();

                // Determine source agent from parent_tool_use_id
                let parent_id = json.get("parent_tool_use_id")
                    .and_then(|p| p.as_str())
                    .unwrap_or("")
                    .to_string();
                let source_agent = if !parent_id.is_empty() {
                    tool_use_to_agent.get(&parent_id).cloned().unwrap_or_else(|| "Subagent".to_string())
                } else {
                    "Lead".to_string()
                };

                match msg_type {
                    "assistant" => {
                        // Extract text and tool_use from assistant messages
                        if let Some(content) = json.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array()) {
                            for block in content {
                                let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                                match block_type {
                                    "text" => {
                                        let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("");
                                        if !text.trim().is_empty() {
                                            let (parsed_agent, message) = parse_progress_line(text);
                                            let final_agent = if parent_id.is_empty() { parsed_agent } else { source_agent.clone() };
                                            let entry = LogEntry { timestamp: now, agent: final_agent.clone(), message: message.clone(), log_type: "thinking".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                                            {
                                                let mut st = state_clone.write().await;
                                                if let Some(ref mut s) = *st {
                                                    s.log.push(entry.clone());
                                                    if let Some(agent) = s.agents.iter_mut().find(|a| a.name == final_agent) {
                                                        if agent.status != AgentStatus::Done {
                                                            agent.status = AgentStatus::Working;
                                                        }
                                                    }
                                                    // Detect task completion patterns
                                                    let lower_msg = message.to_lowercase();
                                                    if lower_msg.contains("completed") || lower_msg.contains("done") || lower_msg.contains("finished") {
                                                        for task in s.tasks.iter_mut() {
                                                            if task.status == TaskStatus::Completed { continue; }
                                                            let task_agent = task.assigned_agent.as_deref().unwrap_or("").to_lowercase();
                                                            let final_lower = final_agent.to_lowercase();
                                                            let agent_match = !task_agent.is_empty() && (
                                                                task_agent == final_lower
                                                                || task_agent.contains(&final_lower)
                                                                || final_lower.contains(&task_agent)
                                                            );
                                                            let task_lower = task.title.to_lowercase();
                                                            let title_match = task_lower.split_whitespace()
                                                                .filter(|w| w.len() > 3)
                                                                .any(|w| lower_msg.contains(w));
                                                            if agent_match && title_match {
                                                                task.status = TaskStatus::Completed;
                                                                task.completed_at = Some(now);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                                        }
                                    }
                                    "tool_use" => {
                                        let tool = block.get("name").and_then(|n| n.as_str()).unwrap_or("unknown");
                                        let tool_use_id = block.get("id").and_then(|i| i.as_str()).unwrap_or("");
                                        let input = block.get("input").and_then(|i| i.as_object());

                                        let detail = match tool {
                                            "Agent" => input.and_then(|i| i.get("description")).and_then(|d| d.as_str()).unwrap_or("spawning agent").to_string(),
                                            "Write" | "Edit" => input.and_then(|i| i.get("file_path")).and_then(|p| p.as_str()).unwrap_or("").to_string(),
                                            "Bash" => input.and_then(|i| i.get("command")).and_then(|c| c.as_str()).map(|c| if c.len() > 80 { format!("{}...", &c[..77]) } else { c.to_string() }).unwrap_or_default(),
                                            "Glob" | "Grep" => input.and_then(|i| i.get("pattern")).and_then(|p| p.as_str()).unwrap_or("").to_string(),
                                            "Read" => input.and_then(|i| i.get("file_path")).and_then(|p| p.as_str()).unwrap_or("").to_string(),
                                            _ => "".to_string(),
                                        };
                                        let (msg, entry_file_path, entry_lines) = if tool == "Write" || tool == "Edit" {
                                            let fp = input.and_then(|i| i.get("file_path")).and_then(|p| p.as_str()).unwrap_or("");
                                            let lc: i64 = if tool == "Write" {
                                                input.and_then(|i| i.get("content")).and_then(|c| c.as_str()).map(|c| c.lines().count() as i64).unwrap_or(0)
                                            } else {
                                                input.and_then(|i| i.get("new_string")).and_then(|s| s.as_str()).map(|s| s.lines().count() as i64).unwrap_or(0)
                                            };
                                            let action = if tool == "Write" { "Write" } else { "Edit" };
                                            (format!("{}: {} (+{} lines)", action, fp, lc), Some(fp.to_string()), Some(lc))
                                        } else if detail.is_empty() {
                                            (format!("Using tool: {}", tool), None, None)
                                        } else {
                                            (format!("{}: {}", tool, detail), None, None)
                                        };
                                        let mut entry = LogEntry::new(now, source_agent.clone(), msg, "tool").with_tool(tool.to_string());
                                        entry.file_path = entry_file_path;
                                        entry.lines = entry_lines;
                                        {
                                            let mut st = state_clone.write().await;
                                            if let Some(ref mut s) = *st {
                                                s.log.push(entry.clone());
                                            }
                                        }
                                        let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());

                                        // Track Agent tool → subagent mapping
                                        if tool == "Agent" {
                                            let raw_name = input.and_then(|i| i.get("description")).and_then(|d| d.as_str()).unwrap_or("agent");
                                            let agent_name = raw_name.chars().take(30).collect::<String>();
                                            let model_str = input.and_then(|i| i.get("model")).and_then(|m| m.as_str()).unwrap_or("sonnet");

                                            // Add agent to state if not exists
                                            {
                                                let mut st = state_clone.write().await;
                                                if let Some(ref mut s) = *st {
                                                    if !s.agents.iter().any(|a| a.name == agent_name) {
                                                        s.agents.push(Agent {
                                                            name: agent_name.clone(),
                                                            role: raw_name.to_string(),
                                                            status: AgentStatus::Working,
                                                            current_task: Some("Starting...".into()),
                                                            model: Some(model_str.to_string()),
                                                            spawned_at: now,
                                                            model_reason: None,
                                                        });
                                                    }
                                                }
                                            }

                                            if !tool_use_id.is_empty() {
                                                tool_use_to_agent.insert(tool_use_id.to_string(), agent_name.clone());
                                            }

                                            let _ = app_clone.emit("mission:agent-spawned", serde_json::json!({
                                                "agent_name": agent_name,
                                                "role": raw_name,
                                                "timestamp": now,
                                            }));
                                        }

                                        // Track file changes
                                        if tool == "Write" || tool == "Edit" {
                                            if let Some(path) = input.and_then(|i| i.get("file_path")).and_then(|p| p.as_str()) {
                                                let _ = app_clone.emit("mission:file-change", serde_json::json!({
                                                    "path": path,
                                                    "action": if tool == "Write" { "created" } else { "modified" },
                                                    "agent": source_agent,
                                                    "timestamp": now,
                                                }));
                                            }
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }

                    "user" => {
                        // Tool results — store raw
                        let mut st = state_clone.write().await;
                        if let Some(ref mut s) = *st {
                            s.raw_output.push(clean.clone());
                        }
                    }

                    "result" => {
                        let is_subagent = !parent_id.is_empty();
                        let text = json.get("result").and_then(|r| r.as_str())
                            .or_else(|| json.get("content").and_then(|c| {
                                if let Some(arr) = c.as_array() {
                                    arr.iter().filter_map(|item| item.get("text").and_then(|t| t.as_str())).next()
                                } else { c.as_str() }
                            }))
                            .unwrap_or("Completed");
                        let display = if text.len() > 500 { format!("{}...", &text[..500]) } else { text.to_string() };

                        if is_subagent {
                            let entry = LogEntry { timestamp: now, agent: source_agent.clone(), message: format!("Completed: {}", display), log_type: "result".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                            {
                                let mut st = state_clone.write().await;
                                if let Some(ref mut s) = *st {
                                    s.log.push(entry.clone());
                                    if let Some(agent) = s.agents.iter_mut().find(|a| a.name == source_agent) {
                                        agent.status = AgentStatus::Done;
                                        agent.current_task = Some("Completed".into());
                                    }
                                    // Fuzzy match tasks to agent
                                    let lower_name = source_agent.to_lowercase();
                                    for task in s.tasks.iter_mut() {
                                        if task.status == TaskStatus::Completed { continue; }
                                        let task_agent = task.assigned_agent.as_deref().unwrap_or("").to_lowercase();
                                        let agent_match = !task_agent.is_empty() && (
                                            task_agent == lower_name || task_agent.contains(&lower_name) || lower_name.contains(&task_agent)
                                        );
                                        if agent_match {
                                            task.status = TaskStatus::Completed;
                                            task.completed_at = Some(now);
                                        }
                                    }
                                }
                            }
                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                        } else {
                            // Lead result — continuation done
                            let entry = LogEntry { timestamp: now, agent: "Lead".into(), message: format!("Result: {}", display), log_type: "result".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
                            {
                                let mut st = state_clone.write().await;
                                if let Some(ref mut s) = *st {
                                    s.log.push(entry.clone());
                                    s.status = MissionStatus::Completed;
                                    s.phase = MissionPhase::Done;
                                    for a in s.agents.iter_mut() {
                                        if a.status != AgentStatus::Error {
                                            a.status = AgentStatus::Done;
                                        }
                                    }
                                }
                            }
                            let _ = app_clone.emit("mission:log", serde_json::to_value(&entry).unwrap());
                            let _ = app_clone.emit("mission:status", serde_json::json!({ "status": "completed" }));
                        }
                    }

                    _ => {
                        // Store other types as raw
                        let mut st = state_clone.write().await;
                        if let Some(ref mut s) = *st {
                            s.raw_output.push(clean.clone());
                        }
                    }
                }
            }
        }

        // Process completed — only mark if not already done via result message
        {
            let mut st = state_clone.write().await;
            if let Some(ref mut s) = *st {
                if s.status == MissionStatus::Running {
                    s.status = MissionStatus::Completed;
                    s.phase = MissionPhase::Done;
                }
            }
        }
        let _ = app_clone.emit("mission:status", serde_json::json!({ "status": "completed" }));
    });

    // Stderr reader
    let state_clone2 = manager.state.clone();
    let app_clone2 = app.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let clean = strip_ansi(&line);
            if clean.trim().is_empty() { continue; }
            let now = chrono::Utc::now().timestamp_millis();
            let entry = LogEntry { timestamp: now, agent: "System".into(), message: clean.clone(), log_type: "error".into() , tool_name: None, phase_hint: None, file_path: None, lines: None };
            { let mut st = state_clone2.write().await; if let Some(ref mut s) = *st { s.log.push(entry.clone()); } }
            let _ = app_clone2.emit("mission:log", serde_json::to_value(&entry).unwrap());
        }
    });

    Ok(())
}

// ─── App entry ──────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(MissionManagerState(Arc::new(RwLock::new(MissionManager::new()))))
        .invoke_handler(tauri::generate_handler![
            check_claude_available,
            get_system_info,
            enable_agent_teams,
            read_settings,
            scaffold_project,
            pick_folder,
            pick_files,
            read_file_content,
            get_file_info,
            save_clipboard_image,
            search_project_files,
            launch_in_terminal,
            save_to_history,
            load_history,
            get_mission_history,
            delete_history_entry,
            open_folder_in_explorer,
            launch_mission,
            stop_mission,
            get_mission_state,
            update_agent_model,
            deploy_mission,
            continue_mission,
            reset_mission,
            get_mission_detail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}


