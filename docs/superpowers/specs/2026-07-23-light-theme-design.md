# App-wide Light Theme — Design

## Problem

Ứng dụng hiện chỉ có một giao diện: VS Code dark theme, với màu sắc được hardcode trực tiếp bằng các Tailwind class tên `vs-*` (`bg-vs-bg`, `text-vs-muted`, `border-vs-accent`, ...) rải rác trong 49/58 file component, cộng thêm 206 chỗ dùng `text-white` (giả định nền tối) và 75 chỗ dùng `bg-white/N` / `bg-black/N` làm lớp phủ tint tinh tế trên nền tối. Không có cơ chế theme nào tồn tại — `darkMode: 'class'` đã cấu hình trong Tailwind nhưng chưa dùng đến. Người dùng muốn làm việc ở môi trường sáng (ánh sáng ban ngày, máy chiếu, sở thích cá nhân) không có lựa chọn nào khác ngoài dark.

## Goal

Thêm một light theme đầy đủ, chuyển đổi được bằng nút bấm, mirror theo VS Code Light+ theme, áp dụng nhất quán trên toàn bộ app (không chỉ một vài trang) — bao gồm cả các màu syntax-highlight và các chỗ dùng `text-white`/`bg-white/N`/`bg-black/N` hiện đang giả định nền tối.

## Design

### 1. Palette — mirror VS Code Light+

Giữ nguyên toàn bộ tên token `vs-*` hiện có; chỉ đổi **giá trị** mỗi token phân giải tới theo theme đang active.

| Token | Dark (hiện tại, giữ nguyên) | Light (mới) |
|---|---|---|
| `vs-bg` | `#1e1e1e` | `#ffffff` |
| `vs-sidebar` | `#252526` | `#f3f3f3` |
| `vs-panel` | `#2d2d2d` | `#f8f8f8` |
| `vs-border` | `#3e3e42` | `#e0e0e0` |
| `vs-text` | `#d4d4d4` | `#1e1e1e` |
| `vs-muted` | `#858585` | `#6e6e6e` |
| `vs-comment` | `#6a9955` | `#008000` |
| `vs-keyword` | `#569cd6` | `#0000ff` |
| `vs-string` | `#ce9178` | `#a31515` |
| `vs-number` | `#b5cea8` | `#098658` |
| `vs-fn` | `#dcdcaa` | `#795e26` |
| `vs-type` | `#4ec9b0` | `#267f99` |
| `vs-accent` | `#007acc` | `#007acc` (không đổi — xanh dương của VS Code hoạt động tốt trên cả hai nền) |
| `vs-accent2` | `#0098ff` | `#0098ff` (không đổi, cùng lý do) |
| `vs-green` | `#4ec9b0` | `#267f99` (đồng bộ với `vs-type` vì cùng giá trị gốc) |
| `vs-yellow` | `#dcdcaa` | `#795e26` (đồng bộ với `vs-fn`) |
| `vs-red` | `#f44747` | `#e51400` |
| `vs-orange` | `#ce9178` | `#a31515` (đồng bộ với `vs-string`) |

**Hai token mới** để thay thế các chỗ dùng màu trắng/đen cứng hiện tại:

| Token mới | Dark | Light | Thay thế cho |
|---|---|---|---|
| `vs-heading` | `#ffffff` | `#1e1e1e` | mọi chỗ dùng `text-white` (206 chỗ) — text tiêu đề/nhấn mạnh, trước đây giả định nền tối |
| `vs-overlay` | trắng (giữ hướng tint hiện tại) | đen (đảo hướng tint) | mọi chỗ dùng `bg-white/N` hoặc `bg-black/N` làm lớp phủ tinh tế (75 chỗ) — dùng `bg-vs-overlay/N` để giữ đúng "hướng" tint (sáng hơn nền một chút) ở cả hai theme |

`vs-overlay` cần được định nghĩa dưới dạng giá trị RGB (không phải named color) để hỗ trợ cú pháp opacity của Tailwind (`bg-vs-overlay/5`, `/10`, `/20`, ...).

### 2. Cơ chế kỹ thuật — CSS custom properties

- Định nghĩa toàn bộ token màu ở trên dưới dạng CSS custom properties (`--vs-bg`, `--vs-text`, ...) trong file CSS toàn cục (`src/index.css`), dưới `:root` (giá trị dark, mặc định) và `.light` (override).
- `tailwind.config.js` trỏ mỗi màu `vs-*` tới `var(--vs-xxx)` thay vì hex literal, dùng cú pháp `rgb(var(--vs-xxx) / <alpha-value>)` để giữ khả năng dùng opacity modifier (`bg-vs-bg/50` nếu có nơi cần).
- **Không cần sửa 49 file component đang dùng `vs-*`** — chỉ giá trị token thay đổi, tên class giữ nguyên.
- Class `.light` được gắn/gỡ trên phần tử `<html>` bởi logic toggle (mục 4).

### 3. Migration `text-white` / `bg-white/N` / `bg-black/N`

Thay thế cơ học trên toàn bộ codebase (ước tính ~50 file bị ảnh hưởng):
- `text-white` → `text-vs-heading` (206 chỗ)
- `bg-white/N` và `bg-black/N` (dùng làm overlay tint, không phải nền đặc) → `bg-vs-overlay/N`, giữ nguyên giá trị N (75 chỗ)
- 1 chỗ dùng `bg-white` đặc (không phải overlay) được rà soát thủ công riêng — không tự động thay thế vì có thể là trường hợp đặc biệt (cần đọc code để xác nhận ý định trước khi đổi).

### 4. Toggle & persistence

- Nút bấm hình mặt trời/mặt trăng đặt ở footer của `Sidebar` (gần khối branding hiện có ở đầu sidebar, không làm rối giao diện).
- Bấm nút toggle class `.light` trên `<html>`.
- Trạng thái theme lưu vào `localStorage` (key mới, ví dụ `theme`, giá trị `'dark'` hoặc `'light'`).
- Đọc giá trị từ `localStorage` khi app khởi động, áp dụng class **trước khi React render lần đầu** (ví dụ trong `index.html` hoặc đầu `main.jsx`) để tránh hiện tượng nháy sai theme (FOUC).
- Mặc định: `dark` — user hiện tại không thấy thay đổi gì cho tới khi họ chủ động bật light theme.

## What does NOT change

- Không có auto-detect theo system preference (`prefers-color-scheme`) — chỉ toggle thủ công.
- Không có trang settings riêng — toggle nằm ngay trong Sidebar hiện có.
- Không đổi cấu trúc component, routing, hay bất kỳ Tauri IPC call nào.
- Không đổi nội dung `templates.js`, layout Tailwind (spacing/sizing), hay animation — chỉ đổi token màu và thêm nút toggle.
- `vs-accent`/`vs-accent2` giữ nguyên giá trị ở cả hai theme (không cần token light riêng).

## Acceptance Criteria

- Bấm nút toggle trong Sidebar chuyển ngay lập tức toàn bộ app giữa dark/light mà không cần reload trang.
- Reload trang giữ nguyên theme đã chọn lần trước (đọc từ `localStorage`), không có nháy sai theme.
- Không còn `text-white`, `bg-white/N`, hay `bg-black/N` nào trong codebase (trừ 1 chỗ `bg-white` đặc đã rà soát riêng và xử lý theo kết luận rà soát).
- Toàn bộ 49 file dùng `vs-*` hiển thị đúng màu light-theme khi bật, không cần sửa các file đó.
- Màu syntax-highlight (`vs-keyword`, `vs-string`, `vs-comment`, `vs-number`, `vs-fn`, `vs-type`) đọc được rõ ràng trên nền trắng ở light mode.
- Mặc định app vẫn là dark theme cho user hiện tại (không có thay đổi hành vi nếu không tương tác với toggle).

## Testing Approach

Đây là thay đổi chủ yếu về mặt hiển thị (màu sắc), nên automated test chỉ kiểm tra được phần logic:
- Test toggle: bấm nút cập nhật đúng `localStorage` và class `.light` trên `<html>`.
- Test persistence: giá trị `localStorage` đọc đúng khi app khởi động lại (mock `localStorage` trong test).

Độ chính xác màu sắc/contrast trên từng trang (Playground, Mission Control, các modal) cần xác minh thủ công bằng trình duyệt sau khi implement — Vitest/RTL không thể assert có ý nghĩa trên màu render thực tế.

## Scope

Nhiều file bị ảnh hưởng (ước tính ~50-55 file), nhưng tất cả đều thuộc một trong ba loại thay đổi cơ học đã liệt kê ở trên (mục 1-3): không có file nào cần redesign logic hay cấu trúc, chỉ đổi token màu/class name theo quy tắc rõ ràng.
