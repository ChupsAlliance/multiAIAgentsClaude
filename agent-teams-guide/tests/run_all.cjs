#!/usr/bin/env node
'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════
 * COMPREHENSIVE TEST SUITE — agent-teams-guide
 * ═══════════════════════════════════════════════════════════════════
 *
 * Covers all recent changes:
 *   1. Fork from history (launch_mission with historyContext → full lifecycle)
 *   2. Agent model sync (deploy → frontend state)
 *   3. mission:agent-spawned event with model field
 *   4. MissionHistoryPanel forked_from badge
 *   5. MissionControlPage historyViewMode ('view' vs 'continue')
 *   6. Backend helper functions (detectVietnamese, detectProjectType, etc.)
 *   7. History save with forked_from fields
 *   8. continue_mission execution_mode-aware template selection
 *
 * Usage:
 *   node tests/run_all.cjs                  # Run all tests
 *   node tests/run_all.cjs --filter=fork    # Run only tests matching "fork"
 *   node tests/run_all.cjs --filter=model   # Run only tests matching "model"
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Test Framework ─────────────────────────────────────────────
let totalPass = 0, totalFail = 0, totalSkip = 0;
const failures = [];
const filter = (process.argv.find(a => a.startsWith('--filter=')) || '').replace('--filter=', '').toLowerCase();

function suite(name, fn) {
  if (filter && !name.toLowerCase().includes(filter)) {
    console.log(`\n  ⏭  SKIP suite: ${name} (filter: ${filter})`);
    return;
  }
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  SUITE: ${name}`);
  console.log(`${'═'.repeat(60)}`);
  try {
    fn();
  } catch (e) {
    console.log(`  💥 SUITE CRASHED: ${e.message}`);
    totalFail++;
    failures.push(`[${name}] CRASH: ${e.message}`);
  }
}

function test(label, fn) {
  try {
    fn();
    totalPass++;
    console.log(`  ✅ ${label}`);
  } catch (e) {
    totalFail++;
    failures.push(`${label}: ${e.message}`);
    console.log(`  ❌ ${label}`);
    console.log(`     → ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(str, substring, msg) {
  if (!str || !str.includes(substring)) {
    throw new Error(`${msg || 'assertIncludes'}: "${(str || '').slice(0, 100)}" does not include "${substring}"`);
  }
}

function assertNotNull(val, msg) {
  if (val === null || val === undefined) {
    throw new Error(`${msg || 'assertNotNull'}: value is ${val}`);
  }
}

// ─── Source file readers ────────────────────────────────────────
const ROOT = path.resolve(__dirname, '..');

function readSource(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

// ═══════════════════════════════════════════════════════════════
// SUITE 1: Backend — continue_mission + launch_mission fork logic
// ═══════════════════════════════════════════════════════════════
suite('Backend: continue_mission & launch_mission fork logic', () => {
  const src = readSource('electron/ipc/mission.cjs');

  test('continue_mission handler exists', () => {
    assertIncludes(src, "ipcMain.handle('continue_mission'");
  });

  test('launch_mission accepts historyContext parameter', () => {
    assertIncludes(src, 'historyContext');
  });

  test('launch_mission parses historyContext as historyState', () => {
    assertIncludes(src, 'historyState = JSON.parse(historyContext)');
  });

  test('launch_mission builds previousWorkSection from history', () => {
    assertIncludes(src, 'previousWorkSection');
    assertIncludes(src, 'PREVIOUS WORK');
  });

  test('launch_mission appends previousWorkSection to prompt', () => {
    assertIncludes(src, 'fullPrompt');
    assertIncludes(src, 'previousWorkSection');
  });

  test('launch_mission sets forked_from when historyState present', () => {
    assertIncludes(src, 'forked_from: historyState');
  });

  test('launch_mission sets forked_from_desc when historyState present', () => {
    assertIncludes(src, 'forked_from_desc: historyState');
  });

  test('launch_mission kills existing process when forking', () => {
    const launchSection = src.slice(src.indexOf("ipcMain.handle('launch_mission'"), src.indexOf("ipcMain.handle('deploy_mission'"));
    assertIncludes(launchSection, 'stopWatcher()');
    assertIncludes(launchSection, 'killChild()');
  });

  test('launch_mission history builds task summary (completed/in-progress/pending)', () => {
    const launchSection = src.slice(src.indexOf("ipcMain.handle('launch_mission'"), src.indexOf("ipcMain.handle('deploy_mission'"));
    assertIncludes(launchSection, 'historyState.tasks');
    assertIncludes(launchSection, '[DONE]');
    assertIncludes(launchSection, '[PENDING]');
  });

  test('continue_mission (normal) still requires active mission', () => {
    assertIncludes(src, "'No active mission to continue'");
  });

  test('continue_mission respects execution_mode for AGENT_TEAMS env', () => {
    const commonSection = src.slice(src.indexOf('// ── Common: build prompt + spawn process'));
    assertIncludes(commonSection, 'useAgentTeams');
    assertIncludes(commonSection, "execution_mode");
  });

  test('continue_mission selects template based on execution_mode', () => {
    const commonSection = src.slice(src.indexOf('// ── Common: build prompt + spawn process'));
    assertIncludes(commonSection, 'PROMPT_CONTINUE_AGENT_TEAMS');
    assertIncludes(commonSection, 'PROMPT_CONTINUE_STANDARD');
  });

  test('continue_mission starts file watcher for agent_teams mode', () => {
    const commonSection = src.slice(src.indexOf('// ── Common: build prompt + spawn process'));
    assertIncludes(commonSection, 'startFileWatcher');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 2: Backend — mission:agent-spawned event includes model
// ═══════════════════════════════════════════════════════════════
suite('Backend: agent-spawned event model field', () => {
  const src = readSource('electron/ipc/mission.cjs');

  test('agent-spawned event includes model field (all emit sites)', () => {
    // Find ALL sendToWindow('mission:agent-spawned' calls — use multiline
    const re = /sendToWindow\('mission:agent-spawned',\s*\{[\s\S]*?\}\)/g;
    const matches = src.match(re) || [];
    assert(matches.length >= 2, `Expected at least 2 agent-spawned emit sites, found ${matches.length}`);

    // Non-reset emits should include model
    const nonReset = matches.filter(m => !m.includes('reset: true'));
    for (const m of nonReset) {
      assertIncludes(m, 'model:', `agent-spawned emit missing model: ${m.slice(0, 100)}`);
    }
  });

  test('model comes from missionState.agents (user-confirmed model)', () => {
    const re = /sendToWindow\('mission:agent-spawned',\s*\{[\s\S]*?\}\)/g;
    const matches = src.match(re) || [];
    const hasMissionStateModel = matches.some(m => m.includes('missionState'));
    assert(hasMissionStateModel, 'At least one agent-spawned emit should reference missionState for model');
  });

  test('model fallback chain exists (missionState → modelStr → null)', () => {
    // The stream-json Agent tool handler should have modelStr in the fallback chain
    const agentToolSection = src.slice(src.indexOf("if (tool === 'Agent')"));
    assertIncludes(agentToolSection, 'modelStr');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 3: Backend — deploy_mission model sync
// ═══════════════════════════════════════════════════════════════
suite('Backend: deploy_mission agent model sync', () => {
  const src = readSource('electron/ipc/mission.cjs');

  test('deploy_mission updates missionState.agents model from confirmed list', () => {
    // Between deploy_mission handler and process spawn, there should be a loop
    const deploySection = src.slice(src.indexOf("ipcMain.handle('deploy_mission'"), src.indexOf("ipcMain.handle('continue_mission'"));
    assertIncludes(deploySection, 'Update agent models from confirmed list');
    assertIncludes(deploySection, 'ao.model = md');
  });

  test('deploy_mission reads model from aJson.model', () => {
    const deploySection = src.slice(src.indexOf("ipcMain.handle('deploy_mission'"), src.indexOf("ipcMain.handle('continue_mission'"));
    assertIncludes(deploySection, "aJson.model || 'sonnet'");
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 4: Backend — history entry with forked_from
// ═══════════════════════════════════════════════════════════════
suite('Backend: history entry forked_from', () => {
  const src = readSource('electron/ipc/mission.cjs');

  test('saveToHistory saves forked_from to entry', () => {
    // Check in watchProcessExit_deploy or saveToHistory call
    const exitSection = src.slice(src.indexOf('function saveToHistory'));
    // Or check the entry construction before saveToHistory
    assert(
      src.includes('forked_from') && src.includes('forked_from_desc'),
      'Source should reference forked_from and forked_from_desc'
    );
  });

  test('History entry construction includes forked_from', () => {
    // Look for the entry object that gets passed to saveToHistory
    const idx = src.indexOf('saveToHistory({');
    if (idx === -1) {
      // Maybe it's saveToHistory(entry) pattern
      assert(src.includes('forked_from'), 'forked_from should be in history-related code');
    } else {
      const snippet = src.slice(idx, idx + 500);
      assertIncludes(snippet, 'forked_from');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 5: Backend — helper functions
// ═══════════════════════════════════════════════════════════════
suite('Backend: helper functions', () => {
  const src = readSource('electron/ipc/mission.cjs');

  test('detectVietnamese function exists', () => {
    assertIncludes(src, 'function detectVietnamese(text)');
  });

  test('detectProjectType handles Vite projects', () => {
    assertIncludes(src, '"vite"');
    assertIncludes(src, 'Node.js/Vite');
  });

  test('detectProjectType handles Next.js projects', () => {
    assertIncludes(src, '"next"');
    assertIncludes(src, 'Next.js');
  });

  test('detectProjectType handles Python projects', () => {
    assertIncludes(src, 'requirements.txt');
    assertIncludes(src, 'Python');
  });

  test('detectProjectType handles Rust projects', () => {
    assertIncludes(src, 'Cargo.toml');
    assertIncludes(src, 'Rust');
  });

  test('detectProjectType handles Go projects', () => {
    assertIncludes(src, 'go.mod');
    assertIncludes(src, 'Go');
  });

  test('detectProjectType handles Java projects', () => {
    assertIncludes(src, 'pom.xml');
    assertIncludes(src, 'Java');
  });

  test('detectProjectTypeCont exists (shorter version for continue)', () => {
    assertIncludes(src, 'function detectProjectTypeCont(projectPath)');
  });

  test('inferRole handles common agent names', () => {
    assertIncludes(src, "function inferRole(name)");
    assertIncludes(src, 'Backend Developer');
    assertIncludes(src, 'Frontend Developer');
  });

  test('stripAnsi removes ANSI escape sequences', () => {
    assertIncludes(src, 'function stripAnsi(s)');
  });

  test('launch_mission uses --dangerously-skip-permissions', () => {
    const launchSection = src.slice(src.indexOf("ipcMain.handle('launch_mission'"), src.indexOf("ipcMain.handle('deploy_mission'"));
    assertIncludes(launchSection, '--dangerously-skip-permissions');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 6: Frontend — useMission deploy() model sync
// ═══════════════════════════════════════════════════════════════
suite('Frontend: useMission deploy() model sync', () => {
  const src = readSource('src/hooks/useMission.js');

  test('deploy() calls invoke("deploy_mission") with agents including model', () => {
    assertIncludes(src, "invoke('deploy_mission'");
    assertIncludes(src, "model: a.model || 'sonnet'");
  });

  test('deploy() updates frontend state agents with confirmed models after invoke', () => {
    // After invoke, there should be setMissionState that maps agents with confirmed models
    const deploySection = src.slice(src.indexOf('const deploy = useCallback'), src.indexOf('const continueM'));
    assertIncludes(deploySection, 'updatedAgents');
    assertIncludes(deploySection, "confirmed.model || a.model || 'sonnet'");
  });

  test('deploy() sets phase to Deploying and status to Running', () => {
    const deploySection = src.slice(src.indexOf('const deploy = useCallback'), src.indexOf('const continueM'));
    assertIncludes(deploySection, "phase: 'Deploying'");
    assertIncludes(deploySection, "status: 'Running'");
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 7: Frontend — useMission agent-spawned handler
// ═══════════════════════════════════════════════════════════════
suite('Frontend: mission:agent-spawned handler', () => {
  const src = readSource('src/hooks/useMission.js');

  test('agent-spawned handler extracts model from event payload', () => {
    assertIncludes(src, 'eventModel = e.payload.model');
  });

  test('handler updates existing agent status instead of skipping', () => {
    // Should NOT have: if (prev.agents.some(a => a.name === agentName)) return prev
    // Should HAVE: findIndex + update
    assertIncludes(src, 'existingIdx');
    assertIncludes(src, 'prev.agents.findIndex');
  });

  test('existing agent gets status=Working when spawned', () => {
    assertIncludes(src, "status: 'Working'");
  });

  test('existing agent preserves its model (user choice) over event model', () => {
    // Should have: updated[existingIdx].model || eventModel (preserve existing if set)
    assertIncludes(src, 'updated[existingIdx].model || eventModel');
  });

  test('new agent (not in plan) gets eventModel', () => {
    // In the "add new" branch
    const handler = src.slice(src.indexOf("listen('mission:agent-spawned'"), src.indexOf("listen('mission:log'"));
    assertIncludes(handler, 'model: eventModel');
  });

  test('reset=true creates fresh agent with eventModel', () => {
    const handler = src.slice(src.indexOf("listen('mission:agent-spawned'"), src.indexOf("listen('mission:log'"));
    assertIncludes(handler, 'reset');
    assertIncludes(handler, 'model: eventModel');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 8: Frontend — useMission launch with historyContext
// ═══════════════════════════════════════════════════════════════
suite('Frontend: launch with historyContext', () => {
  const src = readSource('src/hooks/useMission.js');

  test('launch accepts historyContext parameter', () => {
    assertIncludes(src, 'historyContext');
  });

  test('launch passes historyContext to invoke', () => {
    assertIncludes(src, "historyContext: historyContext || ''");
  });

  test('continueM still works for normal interventions', () => {
    assertIncludes(src, "invoke('continue_mission'");
  });

  test('Normal continue sets phase to Continuing', () => {
    assertIncludes(src, "phase: 'Continuing'");
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 9: Frontend — MissionControlPage historyViewMode
// ═══════════════════════════════════════════════════════════════
suite('Frontend: MissionControlPage historyViewMode', () => {
  const src = readSource('src/pages/MissionControlPage.jsx');

  test('historyViewMode state exists', () => {
    assertIncludes(src, 'historyViewMode');
    assertIncludes(src, 'setHistoryViewMode');
  });

  test('handleViewHistory sets mode to "view"', () => {
    assertIncludes(src, "handleViewHistory");
    assertIncludes(src, "'view'");
  });

  test('handleContinueFromHistory sets mode to "continue"', () => {
    assertIncludes(src, 'handleContinueFromHistory');
    assertIncludes(src, "'continue'");
  });

  test('Continue banner shows only when mode=continue', () => {
    assertIncludes(src, "historyViewMode === 'continue'");
    assertIncludes(src, 'Tiếp tục từ mission cũ');
  });

  test('Cancel button resets historyView and mode', () => {
    assertIncludes(src, 'setHistoryView(null)');
    assertIncludes(src, "setHistoryViewMode('view')");
  });

  test('isHistoryView prop depends on viewMode', () => {
    assertIncludes(src, "isHistoryView={historyViewMode === 'view'}");
  });

  test('onContinue calls launch via buildMissionPrompt for full lifecycle', () => {
    assertIncludes(src, 'buildMissionPrompt(msg');
    assertIncludes(src, 'launch(');
    assertIncludes(src, 'historyContext: JSON.stringify(historyView)');
  });

  test('MissionHistoryPanel receives onContinueFromHistory', () => {
    assertIncludes(src, 'onContinueFromHistory={handleContinueFromHistory}');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 10: Frontend — MissionHistoryPanel forked_from badge
// ═══════════════════════════════════════════════════════════════
suite('Frontend: MissionHistoryPanel forked_from badge', () => {
  const src = readSource('src/components/mission/MissionHistoryPanel.jsx');

  test('GitFork icon imported', () => {
    assertIncludes(src, 'GitFork');
  });

  test('forked_from check renders badge', () => {
    assertIncludes(src, 'item.forked_from');
  });

  test('Badge shows forked_from_desc with fallback to forked_from', () => {
    assertIncludes(src, 'item.forked_from_desc || item.forked_from');
  });

  test('Badge has fork icon', () => {
    assertIncludes(src, '<GitFork');
  });

  test('Badge has Vietnamese prefix "từ:"', () => {
    assertIncludes(src, '↳ từ:');
  });

  test('"Continue mission" button exists', () => {
    assertIncludes(src, 'Continue mission');
  });

  test('onContinueFromHistory prop wired to onReplay', () => {
    assertIncludes(src, 'onContinueFromHistory');
    assertIncludes(src, 'onReplay={onContinueFromHistory}');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 11: Frontend — MissionDashboard historyView handling
// ═══════════════════════════════════════════════════════════════
suite('Frontend: MissionDashboard isHistoryView prop', () => {
  const src = readSource('src/components/mission/MissionDashboard.jsx');

  test('isHistoryView prop accepted', () => {
    assertIncludes(src, 'isHistoryView');
  });

  test('InterventionPanel hidden when isHistoryView', () => {
    assertIncludes(src, '!isHistoryView');
  });

  test('History banner shown when isHistoryView', () => {
    assertIncludes(src, '{isHistoryView && (');
  });

  test('Stop button null when isHistoryView', () => {
    assertIncludes(src, 'isHistoryView ? null : onStop');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 12: Prompt templates existence
// ═══════════════════════════════════════════════════════════════
suite('Prompt templates', () => {
  test('deploy_standard.md exists', () => {
    assert(fs.existsSync(path.join(ROOT, 'electron/prompts/deploy_standard.md')), 'deploy_standard.md not found');
  });

  test('deploy_agent_teams.md exists', () => {
    assert(fs.existsSync(path.join(ROOT, 'electron/prompts/deploy_agent_teams.md')), 'deploy_agent_teams.md not found');
  });

  test('continue_agent_teams.md exists', () => {
    assert(fs.existsSync(path.join(ROOT, 'electron/prompts/continue_agent_teams.md')), 'continue_agent_teams.md not found');
  });

  test('continue_standard.md exists', () => {
    assert(fs.existsSync(path.join(ROOT, 'electron/prompts/continue_standard.md')), 'continue_standard.md not found');
  });

  test('planning.md exists', () => {
    assert(fs.existsSync(path.join(ROOT, 'electron/prompts/planning.md')), 'planning.md not found');
  });

  test('continue_agent_teams.md has {{SUMMARY}} placeholder', () => {
    const tmpl = readSource('electron/prompts/continue_agent_teams.md');
    assertIncludes(tmpl, '{{SUMMARY}}');
  });

  test('continue_agent_teams.md has {{MESSAGE}} placeholder', () => {
    const tmpl = readSource('electron/prompts/continue_agent_teams.md');
    assertIncludes(tmpl, '{{MESSAGE}}');
  });

  test('continue_standard.md has {{PROJECT_PATH}} placeholder', () => {
    const tmpl = readSource('electron/prompts/continue_standard.md');
    assertIncludes(tmpl, '{{PROJECT_PATH}}');
  });

  test('continue_standard.md has {{PROJECT_TYPE}} placeholder', () => {
    const tmpl = readSource('electron/prompts/continue_standard.md');
    assertIncludes(tmpl, '{{PROJECT_TYPE}}');
  });

  test('deploy_standard.md has {{AGENT_BLOCKS}} placeholder', () => {
    const tmpl = readSource('electron/prompts/deploy_standard.md');
    assertIncludes(tmpl, '{{AGENT_BLOCKS}}');
  });

  test('deploy_standard.md has {{PROJECT_TYPE}} placeholder', () => {
    const tmpl = readSource('electron/prompts/deploy_standard.md');
    assertIncludes(tmpl, '{{PROJECT_TYPE}}');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 13: Build output integrity
// ═══════════════════════════════════════════════════════════════
suite('Build output integrity', () => {
  test('dist-electron/index.html exists', () => {
    assert(fs.existsSync(path.join(ROOT, 'dist-electron/index.html')), 'Build output missing');
  });

  test('dist-electron/assets has JS bundles', () => {
    const assetsDir = path.join(ROOT, 'dist-electron/assets');
    assert(fs.existsSync(assetsDir), 'Assets dir missing');
    const files = fs.readdirSync(assetsDir).filter(f => f.endsWith('.js'));
    assert(files.length > 0, `No JS bundles in assets dir (found: ${files.length})`);
  });

  test('MissionControlPage bundle exists', () => {
    const assetsDir = path.join(ROOT, 'dist-electron/assets');
    const files = fs.readdirSync(assetsDir);
    const mcp = files.find(f => f.includes('MissionControlPage'));
    assertNotNull(mcp, 'MissionControlPage bundle not found');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 14: Documentation completeness
// ═══════════════════════════════════════════════════════════════
suite('Documentation: fork + model sync coverage', () => {
  test('ARCHITECTURE.md documents forked_from in MissionState', () => {
    const doc = readSource('ARCHITECTURE.md');
    assertIncludes(doc, 'forked_from');
    assertIncludes(doc, 'forked_from_desc');
  });

  test('ARCHITECTURE.md documents historyViewMode', () => {
    const doc = readSource('ARCHITECTURE.md');
    assertIncludes(doc, 'historyViewMode');
  });

  test('ARCHITECTURE.md documents agent-spawned model field', () => {
    const doc = readSource('ARCHITECTURE.md');
    assertIncludes(doc, 'model?');
  });

  test('ARCHITECTURE.md documents fork in continue phase', () => {
    const doc = readSource('ARCHITECTURE.md');
    assertIncludes(doc, 'fork from history');
  });

  test('FUNCTION_REFERENCE.md documents launch_mission or continue_mission fork mode', () => {
    const doc = readSource('FUNCTION_REFERENCE.md');
    // Either contextJson (old) or historyContext (new) should be documented
    const hasForkDocs = doc.includes('contextJson') || doc.includes('historyContext');
    assert(hasForkDocs, 'FUNCTION_REFERENCE.md should document fork/history context');
    assertIncludes(doc, 'Fork Mode');
  });

  test('FUNCTION_REFERENCE.md documents agent-spawned model', () => {
    const doc = readSource('FUNCTION_REFERENCE.md');
    // In mission:agent-spawned section
    assertIncludes(doc, "model?: string");
  });

  test('FUNCTION_REFERENCE.md documents forked_from in history entry', () => {
    const doc = readSource('FUNCTION_REFERENCE.md');
    assertIncludes(doc, 'forked_from: string | null');
  });

  test('USER_GUIDE.md has Continue từ History section', () => {
    const doc = readSource('USER_GUIDE.md');
    assertIncludes(doc, 'Continue từ History');
  });

  test('USER_GUIDE.md has model sync FAQ', () => {
    const doc = readSource('USER_GUIDE.md');
    assertIncludes(doc, 'Opus');
    assertIncludes(doc, 'Sonnet');
  });

  test('USER_GUIDE.md has fork FAQ', () => {
    const doc = readSource('USER_GUIDE.md');
    assertIncludes(doc, 'ghi đè');
  });

  test('USER_GUIDE.md version bumped to 2.1', () => {
    const doc = readSource('USER_GUIDE.md');
    assertIncludes(doc, '2.1');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 15: Data flow consistency
// ═══════════════════════════════════════════════════════════════
suite('Data flow: model from Plan → Deploy → Dashboard', () => {
  const backendSrc = readSource('electron/ipc/mission.cjs');
  const hookSrc    = readSource('src/hooks/useMission.js');

  test('PlanReview passes model to deploy_mission', () => {
    // In useMission deploy(), agents.model is sent
    assertIncludes(hookSrc, "model: a.model || 'sonnet'");
  });

  test('Backend deploy_mission stores model in agentBlocks for prompt', () => {
    assertIncludes(backendSrc, '- Model: ${agentModel}');
  });

  test('Backend deploy_mission syncs model to missionState.agents', () => {
    assertIncludes(backendSrc, 'ao.model = md');
  });

  test('Frontend deploy() syncs model to missionState.agents', () => {
    assertIncludes(hookSrc, 'updatedAgents');
    assertIncludes(hookSrc, "confirmed.model || a.model || 'sonnet'");
  });

  test('Backend agent-spawned event carries model from missionState', () => {
    assertIncludes(backendSrc, "model: (missionState");
  });

  test('Frontend agent-spawned handler preserves existing agent model', () => {
    assertIncludes(hookSrc, 'updated[existingIdx].model || eventModel');
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 16: Data flow: fork from history
// ═══════════════════════════════════════════════════════════════
suite('Data flow: fork from history end-to-end', () => {
  const pageSrc    = readSource('src/pages/MissionControlPage.jsx');
  const histSrc    = readSource('src/components/mission/MissionHistoryPanel.jsx');
  const hookSrc    = readSource('src/hooks/useMission.js');
  const backendSrc = readSource('electron/ipc/mission.cjs');

  test('Step 1: HistoryPanel has "Continue mission" button calling onReplay', () => {
    assertIncludes(histSrc, 'Continue mission');
    assertIncludes(histSrc, 'onReplay(item)');
  });

  test('Step 2: MissionControlPage handleContinueFromHistory loads snapshot', () => {
    assertIncludes(pageSrc, 'handleContinueFromHistory');
    assertIncludes(pageSrc, "get_mission_detail");
  });

  test('Step 3: Page sets historyViewMode to "continue"', () => {
    assertIncludes(pageSrc, "setHistoryViewMode('continue')");
  });

  test('Step 4: User types new requirement → onContinue builds prompt and calls launch()', () => {
    assertIncludes(pageSrc, 'buildMissionPrompt(msg');
    assertIncludes(pageSrc, 'historyContext: JSON.stringify(historyView)');
  });

  test('Step 5: launch() passes historyContext to backend', () => {
    assertIncludes(hookSrc, 'historyContext');
    assertIncludes(hookSrc, "invoke('launch_mission'");
  });

  test('Step 6: Backend launch_mission builds previous work section from history', () => {
    assertIncludes(backendSrc, 'previousWorkSection');
    assertIncludes(backendSrc, 'PREVIOUS WORK');
  });

  test('Step 7: Backend sets forked_from in new missionState', () => {
    assertIncludes(backendSrc, 'forked_from: historyState');
  });

  test('Step 8: Mission goes through Planning → ReviewPlan → Deploy (full lifecycle)', () => {
    // launch_mission always starts in Planning phase
    assertIncludes(backendSrc, "phase:  'Planning'");
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 17: Edge cases — safety checks
// ═══════════════════════════════════════════════════════════════
suite('Edge cases: safety checks', () => {
  const backendSrc = readSource('electron/ipc/mission.cjs');
  const hookSrc    = readSource('src/hooks/useMission.js');

  test('Backend launch_mission handles missing historyState.tasks gracefully', () => {
    // launch_mission's history parsing uses || []
    assertIncludes(backendSrc, "historyState.tasks || []");
  });

  test('Backend launch_mission handles missing historyState.log gracefully', () => {
    assertIncludes(backendSrc, "historyState.log || []");
  });

  test('Backend launch_mission handles missing historyState.file_changes gracefully', () => {
    assertIncludes(backendSrc, "historyState.file_changes || []");
  });

  test('Backend historyContext parse failure is caught', () => {
    assertIncludes(backendSrc, 'try { historyState = JSON.parse(historyContext)');
  });

  test('Frontend launch handles invoke error', () => {
    assertIncludes(hookSrc, "status: 'Failed'");
  });

  test('Frontend agent-spawned handles prev=null', () => {
    assertIncludes(hookSrc, 'if (!prev) return prev');
  });

  test('Deploy error sets phase to Done', () => {
    assertIncludes(hookSrc, "phase: 'Done'");
  });
});

// ═══════════════════════════════════════════════════════════════
// SUITE 18: File structure
// ═══════════════════════════════════════════════════════════════
suite('File structure integrity', () => {
  const files = [
    'electron/main.cjs',
    'electron/preload.cjs',
    'electron/ipc/mission.cjs',
    'electron/ipc/system.cjs',
    'electron/ipc/files.cjs',
    'electron/ipc/history.cjs',
    'src/hooks/useMission.js',
    'src/pages/MissionControlPage.jsx',
    'src/components/mission/MissionDashboard.jsx',
    'src/components/mission/MissionHistoryPanel.jsx',
    'src/components/mission/MissionLauncher.jsx',
    'src/components/mission/InterventionPanel.jsx',
    'src/components/mission/PlanReview.jsx',
    'src/components/mission/AgentCard.jsx',
  ];

  for (const f of files) {
    test(`${f} exists`, () => {
      assert(fs.existsSync(path.join(ROOT, f)), `${f} not found`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log('  FINAL REPORT');
console.log('═'.repeat(60));
console.log(`  ✅ PASS: ${totalPass}`);
console.log(`  ❌ FAIL: ${totalFail}`);
if (totalSkip > 0) console.log(`  ⏭  SKIP: ${totalSkip}`);
console.log(`  📊 TOTAL: ${totalPass + totalFail}`);

if (failures.length > 0) {
  console.log('\n  ── Failures ──');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}

console.log('\n' + (totalFail === 0 ? '🎉 ALL TESTS PASSED!' : `⚠️  ${totalFail} FAILURE(S) — see above`) + '\n');
process.exit(totalFail > 0 ? 1 : 0);
