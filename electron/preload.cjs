'use strict';
const path = require('path');
const { contextBridge, ipcRenderer } = require('electron');

// Commands the frontend can invoke (whitelist)
const ALLOWED_COMMANDS = [
  // system
  'check_claude_available', 'check_backends_available', 'get_system_info', 'enable_agent_teams',
  'read_settings', 'open_folder_in_explorer', 'launch_in_terminal', 'open_url',
  'check_for_updates',
  // files
  'pick_folder', 'pick_files', 'read_file_content', 'get_file_info',
  'save_clipboard_image', 'search_project_files', 'scaffold_project',
  'read_skill_folder',
  // history
  'save_to_history', 'load_history', 'get_mission_history',
  'delete_history_entry', 'get_mission_detail',
  'list_mission_chats', 'get_mission_chat', 'delete_mission_chat', 'ask_mission_chat',
  // mission
  'launch_mission', 'deploy_mission', 'continue_mission', 'replan_mission',
  'stop_mission', 'reset_mission', 'get_mission_state', 'get_incomplete_missions',
  'update_agent_model', 'update_agent_backend',
  'read_planning_template', 'answer_question', 'read_superpowers_skill', 'mockup_respond', 'retry_agent',
  'save_plan_version', 'get_plan_versions', 'export_plan_markdown', 'export_plan_pdf',
  'ask_mission_live',
  // recording (ghi lại business events)
  'recording_start', 'recording_stop_and_save', 'recording_discard', 'recording_status',
  'list_recordings', 'get_recording', 'delete_recording', 'rename_recording',
  // replay (phát lại recording)
  'replay_start', 'replay_pause', 'replay_resume', 'replay_seek', 'replay_stop',
  // office
  'load_office_layout', 'save_office_layout',
  // pixel-agents persistence
  'pa:save-layout', 'pa:save-seats',
];

// Events the backend can push to frontend (whitelist)
const ALLOWED_EVENTS = [
  'mission:status', 'mission:agent-spawned', 'mission:log',
  'mission:file-change', 'mission:task-update', 'mission:raw-line',
  'mission:plan-ready', 'mission:agent-message', 'mission:team-event',
  'mission:task-reassigned', 'mission:question', 'mission:answer-sent',
  'mission:mockup', 'mission:companion-answer',
  // replay playback progress (thanh tua thời gian thực)
  'replay:progress',
  // replayed business events, re-emitted by replayEngine.cjs on the same
  // channel names as their live mission:* counterparts but prefixed with
  // `replay:` (see useReplay.js's `channels` list) — without these, every
  // replayed mission:* event is silently dropped here and replayMissionState
  // never advances past its initial empty state.
  'replay:mission:status', 'replay:mission:agent-spawned', 'replay:mission:log',
  'replay:mission:file-change', 'replay:mission:task-update', 'replay:mission:raw-line',
  'replay:mission:plan-ready', 'replay:mission:agent-message', 'replay:mission:agent-stuck',
  'replay:mission:question', 'replay:mission:answer-sent', 'replay:mission:mockup',
  'claude-output',
];

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Invoke an IPC command (frontend → main process)
   * Mirrors Tauri's invoke(command, args) API
   */
  invoke(command, args = {}) {
    if (!ALLOWED_COMMANDS.includes(command)) {
      return Promise.reject(new Error(`IPC command not allowed: ${command}`));
    }
    return ipcRenderer.invoke(command, args);
  },

  /**
   * Listen for events from main process (main → frontend)
   * Mirrors Tauri's listen(event, callback) API
   * Returns an unlisten function
   */
  on(event, callback) {
    if (!ALLOWED_EVENTS.includes(event)) {
      console.warn(`[preload] Event not in allowlist: ${event}`);
      return () => {};
    }
    const handler = (_event, data) => callback(data);
    ipcRenderer.on(event, handler);
    // Return unlisten function (like Tauri)
    return () => ipcRenderer.removeListener(event, handler);
  },

  /**
   * Get paths for webview preload and pixel-agents assets
   */
  getPaths() {
    return {
      webviewPreload: path.join(__dirname, 'webview-preload.cjs'),
      pixelAgentsDist: path.join(__dirname, '../src/assets/pixel-agents-webview'),
    };
  },
});
