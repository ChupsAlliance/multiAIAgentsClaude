'use strict';
// Port of file commands from lib.rs → Node.js
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = function registerFiles(getMainWindow) {

  // ─── pick_folder ────────────────────────────────────────────────
  ipcMain.handle('pick_folder', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) {
      throw new Error('No folder selected');
    }
    return result.filePaths[0];
  });

  // ─── pick_files ─────────────────────────────────────────────────
  ipcMain.handle('pick_files', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['md', 'txt', 'pdf', 'json', 'yaml', 'yml', 'toml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) {
      throw new Error('No files selected');
    }
    return result.filePaths;
  });

  // ─── read_file_content ──────────────────────────────────────────
  ipcMain.handle('read_file_content', async (_event, args) => {
    const p = args.path || args;
    return fs.readFileSync(p, 'utf-8');
  });

  // ─── get_file_info ──────────────────────────────────────────────
  ipcMain.handle('get_file_info', async (_event, args) => {
    const p = args.path || args;
    const stat = fs.statSync(p);
    return {
      name: path.basename(p),
      path: p,
      size: stat.size,
      is_dir: stat.isDirectory(),
      extension: path.extname(p).replace('.', ''),
    };
  });

  // ─── save_clipboard_image ───────────────────────────────────────
  ipcMain.handle('save_clipboard_image', async (_event, args) => {
    const { base64Data } = args;
    const bytes = Buffer.from(base64Data, 'base64');

    const tempDir = path.join(os.tmpdir(), 'agent-teams-guide');
    fs.mkdirSync(tempDir, { recursive: true });

    const filename = `clipboard_${Date.now()}.png`;
    const filepath = path.join(tempDir, filename);
    fs.writeFileSync(filepath, bytes);

    return {
      name: filename,
      path: filepath,
      size: bytes.length,
    };
  });

  // ─── search_project_files ───────────────────────────────────────
  ipcMain.handle('search_project_files', async (_event, args) => {
    const { projectPath, query } = args;
    const root = projectPath;
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error('Invalid project path');
    }

    const queryLower = query.toLowerCase();
    const results = [];
    const maxResults = 20;
    const maxDepth = 6;
    const skipDirs = ['node_modules', '.git', 'dist', 'build', 'target', '.next',
                      '__pycache__', '.venv', 'venv', '.claude', '.idea', '.vscode'];

    function walk(dir, depth) {
      if (depth > maxDepth || results.length >= maxResults) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

      for (const entry of entries) {
        if (results.length >= maxResults) return;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (skipDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
          walk(fullPath, depth + 1);
        } else {
          if (entry.name.toLowerCase().includes(queryLower)) {
            const rel = path.relative(root, fullPath);
            let size = 0;
            try { size = fs.statSync(fullPath).size; } catch {}
            const ext = path.extname(entry.name).replace('.', '').toLowerCase();
            const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'];
            results.push({
              name: entry.name,
              path: fullPath,
              relative: rel,
              size,
              is_image: imageExts.includes(ext),
            });
          }
        }
      }
    }

    walk(root, 0);
    return results;
  });

  // ─── scaffold_project ───────────────────────────────────────────
  ipcMain.handle('scaffold_project', async (_event, args) => {
    const { projectPath, templateId, config } = args;
    if (!fs.existsSync(projectPath)) {
      throw new Error(`Directory not found: ${projectPath}`);
    }

    const agentDir = path.join(projectPath, '.claude-agent-team');
    fs.mkdirSync(agentDir, { recursive: true });
    const createdFiles = [];

    function writeTemplate(name, content) {
      const fp = path.join(agentDir, name);
      fs.writeFileSync(fp, content, 'utf-8');
      createdFiles.push(fp);
    }

    switch (templateId) {
      case 'code-review':
        writeTemplate('review-security.md', '# Security Review\n\n_Filled by security reviewer teammate_\n\n## Issues Found\n\n| Severity | File | Line | Description |\n|----------|------|------|-------------|\n\n## Summary\n\n');
        writeTemplate('review-performance.md', '# Performance Review\n\n_Filled by performance reviewer teammate_\n\n## Issues Found\n\n| Severity | File | Line | Description |\n|----------|------|------|-------------|\n\n## Summary\n\n');
        writeTemplate('review-quality.md', '# Code Quality Review\n\n_Filled by quality reviewer teammate_\n\n## Issues Found\n\n| Severity | File | Line | Description |\n|----------|------|------|-------------|\n\n## Summary\n\n');
        writeTemplate('review-report.md', '# Combined Review Report\n\n_Auto-generated by Lead agent after all reviews complete_\n\n## Critical\n\n## Major\n\n## Minor\n\n## Conclusion\n\n');
        break;

      case 'feature': {
        const featureName = (config && config.feature_name) || 'new-feature';
        writeTemplate(`api-design-${featureName}.md`, '# API Design\n\n_Backend agent fills this first_\n\n## Endpoints\n\n| Method | Path | Description |\n|--------|------|-------------|\n\n## TypeScript Interfaces\n\n```typescript\n// Backend agent fills this\n```\n\n');
        writeTemplate(`progress-${featureName}.md`, '# Progress Tracker\n\n## Backend Agent\n- [ ] Service class\n- [ ] API endpoints\n- [ ] Unit tests\n\n## Frontend Agent\n- [ ] Components\n- [ ] State management\n- [ ] API integration\n\n## Tests Agent\n- [ ] Integration tests\n- [ ] E2E scenarios\n\n');
        break;
      }

      case 'debug': {
        const num = (config && config.num_hypotheses) || 3;
        for (let i = 1; i <= num; i++) {
          writeTemplate(`hypothesis-${i}.md`, `# Hypothesis ${i}\n\n_Teammate ${i} investigates this theory_\n\n## Theory\n\n## Evidence For\n\n## Evidence Against\n\n## Files Investigated\n\n## Conclusion\n\n`);
        }
        writeTemplate('root-cause-analysis.md', '# Root Cause Analysis\n\n_Synthesized by Lead after teammates share findings_\n\n## Most Likely Cause\n\n## Evidence\n\n## Fix Applied\n\n## Prevention\n\n');
        break;
      }

      case 'research':
        writeTemplate('pros.md', '# Advantages & Use Cases\n\n_Filled by \'pros\' teammate_\n\n## Key Benefits\n\n## Best Use Cases\n\n## Evidence / References\n\n');
        writeTemplate('cons.md', '# Disadvantages & Risks\n\n_Filled by \'cons\' teammate_\n\n## Key Risks\n\n## Limitations\n\n## When to Avoid\n\n');
        writeTemplate('alternatives.md', '# Alternative Approaches\n\n_Filled by \'alternatives\' teammate_\n\n## Option A\n\n## Option B\n\n## Comparison Table\n\n| Criteria | Current | Option A | Option B |\n|----------|---------|----------|----------|\n\n');
        writeTemplate('summary.md', '# Research Summary\n\n_Synthesized by Lead_\n\n## Recommendation\n\n## Rationale\n\n## Trade-offs\n\n');
        break;

      case 'migration':
        writeTemplate('migration-plan.md', '# Migration Plan\n\n_Filled by architect teammate_\n\n## Scope\n\n## Breaking Changes\n\n## Step-by-step Plan\n\n');
        writeTemplate('migration-progress.md', '# Migration Progress\n\n## Files Migrated\n- [ ] \n\n## Issues Encountered\n\n## Blockers\n\n');
        writeTemplate('migration-tests.md', '# Migration Test Results\n\n_Filled by test teammate_\n\n## Tests Passing\n\n## Tests Failing\n\n## Coverage Report\n\n');
        break;
    }

    return {
      agent_dir: agentDir,
      created_files: createdFiles,
    };
  });

  console.log('[IPC] files OK');
};
