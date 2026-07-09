# Dependency Graph Visualization — Design Spec

> **Topic C / Feature 4:** Task dependency graph trong PlanReview (static) và MissionDashboard (live)

---

## Goal

Hiển thị dependency graph của tasks dạng visual — nodes là tasks, edges là `depends_on` relationships. Dùng trong PlanReview (static, review plan) và MissionDashboard (live, theo dõi execution).

## Architecture

- `@dagrejs/dagre` tính layout (x,y coordinates) — ~30kb, không render UI
- SVG thuần render nodes và edges — không dùng react-flow
- Component dùng chung `PlanDependencyGraph.jsx` với prop `mode: 'plan' | 'live'`
- PlanReview: tab "Graph" toggle cạnh danh sách tasks
- MissionDashboard: tab "Graph" mới cạnh Tasks/Agents/Log/Files

## Tech Stack

React 19, `@dagrejs/dagre` npm package, SVG, Tailwind CSS, Lucide icons

---

## Global Constraints

- Chỉ thêm `@dagrejs/dagre` — không thêm react-flow hoặc d3
- `depends_on` trong task là array of **task titles** (string) — graph dùng title để resolve edges
- Isolated tasks (không depends_on, không ai depend vào) vẫn hiện trong graph
- Graph re-compute khi `tasks` prop thay đổi (live mode auto-update)
- UI text: tiếng Việt
- Không break TaskList, PlanReview drag-and-drop, MissionDashboard tabs hiện có

---

## Node Design

```
┌─────────────────────────┐
│  [●] Task title (wrap)  │
│  agent-name             │  ← chỉ trong mode='live'
│  ◆ pending / Working... │  ← status/priority indicator
└─────────────────────────┘
```

**Node width:** 180px fixed. **Node height:** auto (min 60px).

**Node màu theo mode:**

`mode='plan'` — màu theo priority:
| Priority | Border | Background |
|---|---|---|
| `high` | `border-red-500/60` | `bg-red-500/5` |
| `medium` | `border-yellow-500/60` | `bg-yellow-500/5` |
| `low` | `border-green-500/40` | `bg-green-500/5` |
| `null` | `border-vs-border` | `bg-vs-surface` |

`mode='live'` — màu theo status:
| Status | Border | Background | Extra |
|---|---|---|---|
| `pending` | `border-vs-border` | `bg-vs-surface` | — |
| `in_progress` | `border-vs-accent/60` | `bg-vs-accent/5` | `animate-pulse-subtle` |
| `completed` | `border-green-500/60` | `bg-green-500/10` | checkmark icon |
| (error implied by agent status) | `border-red-500/60` | `bg-red-500/5` | — |

---

## Edge Design

- SVG `<path>` với bezier curves (cubic)
- Màu: `stroke="#4b5563"` (vs-border equivalent), `stroke-width="1.5"`
- Arrowhead: SVG `<marker>` dạng filled triangle tại đầu edge (target node)
- Direction: dependency → task (A depends_on B → edge từ B đến A)

---

## Layout Algorithm

Dùng `dagre.layout()` với config:
```js
const g = new dagre.graphlib.Graph()
g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 })
g.setDefaultEdgeLabel(() => ({}))

// Set nodes với width/height
tasks.forEach(task => g.setNode(task.id, { width: 180, height: estimatedHeight(task) }))

// Set edges từ depends_on (resolve title → id)
tasks.forEach(task => {
  task.depends_on?.forEach(depTitle => {
    const depTask = tasks.find(t => t.title === depTitle)
    if (depTask) g.setEdge(depTask.id, task.id)
  })
})

dagre.layout(g)
// g.node(id).x, g.node(id).y → center coordinates
```

SVG viewBox tính từ max x+width, max y+height của tất cả nodes.

---

## Files Modified / Created

- **Create:** `src/components/mission/PlanDependencyGraph.jsx` — shared graph component
- **Modify:** `src/components/mission/PlanReview.jsx` — thêm tab "Graph", mount `PlanDependencyGraph`
- **Modify:** `src/components/mission/MissionDashboard.jsx` — thêm tab "Graph", mount `PlanDependencyGraph`

---

## `PlanDependencyGraph` Component

```jsx
// Props:
// tasks: Task[]
// mode: 'plan' | 'live'
// onNodeClick?: (task: Task) => void  // optional: highlight task detail

// Internal:
// - useMemo để compute dagre layout từ tasks (re-compute khi tasks thay đổi)
// - SVG với foreignObject cho node content (để dùng Tailwind classes)
// - Resize observer để fit SVG vào container width
// - Zoom: không có (graph scroll nếu overflow)

// Empty state: khi tasks.length === 0
// <p className="text-vs-muted text-sm text-center py-8">Chưa có tasks</p>

// No-deps state: khi không task nào có depends_on
// Vẫn render graph, nhưng tất cả nodes isolated (không có edges)
// Banner nhỏ: "Không có dependencies giữa các tasks"
```

---

## Integration: PlanReview

Tab switcher hiện tại trong PlanReview: `[Visual] [Document]` → thêm `[Graph]`.

Khi tab Graph active:
- Hiện `PlanDependencyGraph` với `tasks={missionState.tasks}` và `mode="plan"`
- `onNodeClick` → scroll/highlight task trong danh sách bên trái (nếu list còn visible)
- Graph chiếm full height của panel content area

---

## Integration: MissionDashboard

Tab bar hiện tại: `Tasks | Agents | Log | Files | Messages` → thêm `Graph`.

Khi tab Graph active:
- Hiện `PlanDependencyGraph` với `tasks={missionState.tasks}` và `mode="live"`
- Tasks auto-update vì `missionState` reactive → graph re-renders khi status thay đổi
- `onNodeClick` → switch sang tab Tasks và scroll tới task đó

---

## Testing Checklist

- [ ] Tab "Graph" hiện trong PlanReview
- [ ] Tab "Graph" hiện trong MissionDashboard
- [ ] Nodes render đúng số lượng tasks
- [ ] Edges render đúng theo `depends_on`
- [ ] Isolated tasks (không depends) vẫn hiện trong graph
- [ ] `mode='plan'`: node màu theo priority
- [ ] `mode='live'`: node màu theo status
- [ ] `in_progress` node có animation pulse
- [ ] Agent name hiện trong node khi `mode='live'`
- [ ] Click node trigger `onNodeClick`
- [ ] Graph re-render khi task status thay đổi (live mode)
- [ ] Empty state khi tasks = []
- [ ] No-edges banner khi không có depends_on
- [ ] Graph không vỡ layout với 1 task, 5 tasks, 15 tasks
- [ ] Arrowhead hiện đúng hướng (dependency → task)
- [ ] Không break PlanReview drag-and-drop khi switch tab
- [ ] Không break MissionDashboard tabs khác
