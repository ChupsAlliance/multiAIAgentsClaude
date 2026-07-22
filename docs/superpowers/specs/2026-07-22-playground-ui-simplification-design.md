# Playground UI Simplification — Design

## Problem

Người dùng mới mở trang Playground (`src/pages/PlaygroundPage.jsx`) khó hiểu và khó dùng vì:

1. **Ngôn ngữ lẫn lộn**: tên trang/tab/nút dùng tiếng Anh ("Playground", "Builder", "History", "Launch", "Copy prompt", "Export .txt", "Browse") trong khi phần mô tả, hint, thông báo trạng thái lại dùng tiếng Việt ("Chọn template, điền thông tin...", "Đang tạo files...", "Vui lòng chọn project folder trước!").
2. **`alert()` gốc trình duyệt**: khi bấm Khởi chạy mà chưa chọn project folder, app hiện native `alert()` tiếng Việt — trải nghiệm không đồng bộ với phần UI còn lại, và xuất hiện đột ngột thay vì báo trước.
3. **Không giải thích rõ hệ quả của "Khởi chạy"**: nút Launch thực chất ghi file `.md` thật vào ổ đĩa và mở một terminal process thật, nhưng không có dòng nào giải thích điều này trước khi user bấm — chỉ có 1 dòng hint chung chung ở đầu trang.

## Goal

Đơn giản hoá UI hiện có của Playground (giữ nguyên toàn bộ luồng 3 bước: chọn template → điền field → chọn folder → Khởi chạy) để user mới dễ hiểu hơn, không redesign lại từ đầu. Ba thay đổi, tất cả đều là chỉnh sửa copy/text và mở rộng một điều kiện validate đã có sẵn — không đổi cấu trúc component, không đổi luồng, không đổi Tauri IPC calls.

## Design

### 1. Đồng bộ ngôn ngữ — tiếng Việt toàn bộ

Giữ **"Playground"** làm tên trang (tên thương hiệu tính năng, khớp style với "Mission Control", "Dashboard" ở Sidebar — không dịch tên trang). Dịch các tab/nút con còn tiếng Anh sang tiếng Việt:

| Vị trí trong `PlaygroundPage.jsx` | Hiện tại | Đổi thành |
|---|---|---|
| Tab switcher (dòng ~228) | "Builder" | "Xây dựng" |
| Tab switcher (dòng ~228) | `History (${history.length})` | `Lịch sử (${history.length})` |
| Nút Launch (dòng ~360) | "Launch — Tạo files & Mở terminal" | "Khởi chạy — Tạo tệp & Mở terminal" |
| Nút Copy (dòng ~374) | "Copy prompt" / "Copied!" | "Sao chép prompt" / "Đã sao chép!" |
| Nút Export (dòng ~381) | "Export .txt" | "Xuất .txt" |
| Nút chọn folder (dòng ~303) | "Browse" | "Chọn folder" |
| Label preview (dòng ~339) | "Preview prompt" | "Xem trước prompt" |

Các dòng đã tiếng Việt (label bước 1/2/3, `LaunchStatus` text, hint sau khi launch xong, mô tả template trong `templates.js`) giữ nguyên, không đổi giọng văn hay nội dung.

### 2. Thay `alert()` bằng inline warning

- Mở rộng biến `missingRequired` (hiện ở dòng ~203-205, chỉ kiểm tra field bắt buộc của template) thành một điều kiện gộp bao gồm cả việc thiếu `projectPath`. Đặt tên biến mới rõ nghĩa hơn (ví dụ `canLaunch` / `launchBlockedReason`) để phân biệt "thiếu field" và "thiếu folder" nếu cần hiển thị message khác nhau.
- Nút Khởi chạy (logic disable ở dòng ~354) tiếp tục disable khi thiếu bất kỳ điều kiện nào — hành vi disable không đổi, chỉ đổi cách tính điều kiện.
- Thêm dòng cảnh báo dạng text (theo pattern đã có ở dòng ~364-368 cho `missingRequired`) hiển thị khi thiếu `projectPath`: **"Chọn project folder để khởi chạy"**.
- Xoá dòng `alert('Vui lòng chọn project folder trước!')` trong `handleLaunch` (dòng ~136). Sau khi disable-logic được mở rộng đúng, nút Khởi chạy đã bị disable khi thiếu folder nên nhánh check này không còn đường để chạy tới — xoá hẳn thay vì giữ lại làm dead code.

### 3. Giải thích hành vi Khởi chạy — dòng text cố định

Thêm một dòng nhỏ, **luôn hiển thị** ngay dưới nút Khởi chạy — hiển thị bất kể trạng thái disable/enable, tách biệt và đặt phía trên dòng warning điều kiện ở mục 2:

> "Sẽ tạo tệp .md trong `.claude-agent-team/` và mở terminal thật tại folder đã chọn."

Mục đích: user luôn thấy hệ quả hành động trước khi tương tác, không chỉ khi gặp lỗi validate.

## What does NOT change

- Cấu trúc component (`TemplateCard`, `FieldInput`, `LaunchStatus`) — không tách/gộp lại.
- Luồng 3 bước (chọn template → điền field → chọn folder → Khởi chạy) và toàn bộ state/hooks liên quan.
- Các lệnh gọi Tauri (`scaffold_project`, `save_to_history`, `launch_in_terminal`, `pick_folder`, `load_history`, `delete_history_entry`, `open_folder_in_explorer`).
- View History (danh sách, nút "Dùng lại", xoá) — không đổi copy vì đã thuần Việt.
- Nội dung `templates.js` (mô tả, field labels, `buildPrompt`) — đã tiếng Việt, giữ nguyên.
- Style/màu sắc/layout — chỉ đổi text, không đổi Tailwind classes trừ khi cần cho dòng text mới ở mục 3.

## Acceptance Criteria

- Không còn label/nút tiếng Anh nào trong Playground ngoại trừ tên trang "Playground" chính nó.
- Bấm Khởi chạy khi thiếu project folder không còn kích hoạt `alert()` — nút đã bị disable từ trước với message giải thích lý do.
- Dòng giải thích hành vi Khởi chạy (mục 3) hiển thị ngay cả khi chưa chọn template/folder, không phụ thuộc trạng thái validate.
- Toàn bộ luồng scaffold → save history → launch terminal hoạt động y hệt trước khi sửa (không có thay đổi hành vi backend).

## Scope

Một file: `src/pages/PlaygroundPage.jsx`. Không đổi file khác.
