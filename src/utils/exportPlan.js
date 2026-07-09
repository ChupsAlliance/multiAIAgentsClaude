// src/utils/exportPlan.js

export function generateSlug(description) {
  if (!description?.trim()) return 'mission'
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')  // strip special chars
    .replace(/\s+/g, '-')           // spaces → dashes
    .replace(/-+/g, '-')            // collapse multiple dashes
    .slice(0, 40)
    .replace(/-$/, '')              // trailing dash
}

export function generateFilename(description, ext) {
  const slug = generateSlug(description)
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return `${slug}-${date}.${ext}`
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadJSON(missionState) {
  const { id, description, project_path, status, phase, agents, tasks,
          log, file_changes, plan_versions, started_at, ended_at } = missionState
  const data = { id, description, project_path, status, phase, agents, tasks,
                 log, file_changes, plan_versions, started_at, ended_at }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(blob, generateFilename(description, 'json'))
}

export function generateHTML(missionState) {
  const { description, project_path, status, agents = [], tasks = [], plan_versions = [], started_at } = missionState
  const date = started_at ? new Date(started_at).toLocaleDateString('vi-VN') : ''

  const agentRows = agents.map(a =>
    `<tr><td>${a.name}</td><td>${a.role}</td><td>${a.model || '—'}</td><td>${a.status}</td></tr>`
  ).join('')

  const taskRows = tasks.map(t => `
    <div class="task">
      <div class="task-title">${t.title} <span class="badge ${t.status}">${t.status}</span></div>
      ${t.why ? `<div class="task-why">${t.why}</div>` : ''}
      ${t.depends_on?.length ? `<div class="task-deps">Phụ thuộc: ${t.depends_on.join(', ')}</div>` : ''}
      ${t.assigned_agent ? `<div class="task-agent">Agent: ${t.assigned_agent}</div>` : ''}
    </div>
  `).join('')

  const versionRows = plan_versions.length ? plan_versions.map(v =>
    `<tr><td>${v.version}</td><td>${v.label}</td><td>${new Date(v.timestamp).toLocaleString('vi-VN')}</td></tr>`
  ).join('') : ''

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>${description || 'Mission Plan'}</title>
<style>
  body { font-family: 'Segoe UI', sans-serif; background: #1e1e2e; color: #cdd6f4; padding: 2rem; max-width: 900px; margin: 0 auto; }
  h1 { color: #89b4fa; font-size: 1.5rem; margin-bottom: 0.5rem; }
  h2 { color: #89b4fa; font-size: 1.1rem; margin-top: 2rem; border-bottom: 1px solid #313244; padding-bottom: 0.25rem; }
  .meta { color: #6c7086; font-size: 0.85rem; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.85rem; }
  th { background: #313244; padding: 0.5rem; text-align: left; color: #89b4fa; }
  td { padding: 0.4rem 0.5rem; border-bottom: 1px solid #313244; }
  .task { background: #313244; border-radius: 6px; padding: 0.75rem 1rem; margin-bottom: 0.5rem; }
  .task-title { font-weight: 600; margin-bottom: 0.25rem; }
  .task-why { color: #6c7086; font-size: 0.8rem; }
  .task-deps { color: #fab387; font-size: 0.8rem; margin-top: 0.25rem; }
  .task-agent { color: #a6e3a1; font-size: 0.8rem; }
  .badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
  .badge.completed { background: #a6e3a1; color: #1e1e2e; }
  .badge.in_progress { background: #89b4fa; color: #1e1e2e; }
  .badge.pending { background: #6c7086; color: #1e1e2e; }
</style>
</head>
<body>
<h1>${description || 'Mission Plan'}</h1>
<div class="meta">Project: ${project_path || '—'} | Ngày: ${date} | Status: ${status || '—'}</div>

<h2>Agents (${agents.length})</h2>
<table>
  <thead><tr><th>Tên</th><th>Vai trò</th><th>Model</th><th>Trạng thái</th></tr></thead>
  <tbody>${agentRows}</tbody>
</table>

<h2>Tasks (${tasks.length})</h2>
${taskRows || '<p style="color:#6c7086">Chưa có tasks</p>'}

${plan_versions.length ? `
<h2>Lịch sử version (${plan_versions.length})</h2>
<table>
  <thead><tr><th>Version</th><th>Nhãn</th><th>Thời gian</th></tr></thead>
  <tbody>${versionRows}</tbody>
</table>
` : ''}
</body>
</html>`
}

export function downloadHTML(missionState) {
  const html = generateHTML(missionState)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  downloadBlob(blob, generateFilename(missionState.description, 'html'))
}
