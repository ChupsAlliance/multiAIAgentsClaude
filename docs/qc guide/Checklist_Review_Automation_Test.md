# Checklist Nghiệm Thu Automation Test (Playwright)

> Dùng file này để review một test case / một tính năng đã được viết automation test.
> Mỗi mục phải **PASS** trước khi chấp nhận code.

---

## Cách Dùng

1. Đọc code test và chạy thử trên máy local
2. Tick từng mục theo kết quả quan sát thực tế
3. Nếu có mục **FAIL** → ghi rõ lý do vào cột "Ghi chú" → trả lại cho người làm
4. Chỉ chấp nhận khi **toàn bộ mục đều PASS**

---

## Phần A — Cấu Trúc & Tổ Chức Code

| # | Tiêu chí | PASS | FAIL | Ghi chú |
|---|----------|:----:|:----:|---------|
| A1 | Mỗi test case chỉ kiểm tra **một** hành vi / luồng duy nhất | ☐ | ☐ | |
| A2 | Tên test mô tả rõ kịch bản — đọc tên là hiểu ngay đang test gì | ☐ | ☐ | |
| A3 | Locator và action được tách vào **Page Object** riêng, không viết trực tiếp trong file spec | ☐ | ☐ | |
| A4 | File spec chỉ chứa kịch bản (Given / When / Then), không chứa selector thô | ☐ | ☐ | |
| A5 | Cấu trúc thư mục đúng quy ước: `pages/`, `fixtures/`, `specs/` | ☐ | ☐ | |

---

## Phần B — Locator

| # | Tiêu chí | PASS | FAIL | Ghi chú |
|---|----------|:----:|:----:|---------|
| B1 | Element có `data-testid` → dùng `getByTestId()` | ☐ | ☐ | |
| B2 | Element không có `data-testid` → dùng `getByRole` hoặc `getByLabel`, **không** dùng CSS selector | ☐ | ☐ | |
| B3 | Không có selector dạng `nth-child`, class động, hay XPath phức tạp | ☐ | ☐ | |
| B4 | Tất cả `data-testid` / selector đã được xác nhận tồn tại trên trang thật (không do AI bịa) | ☐ | ☐ | |
| B5 | Tên `data-testid` đúng quy ước: `[loại]-[action/field]-[context]` (vd: `btn-submit-login`) | ☐ | ☐ | |

---

## Phần C — Assertion

| # | Tiêu chí | PASS | FAIL | Ghi chú |
|---|----------|:----:|:----:|---------|
| C1 | Mỗi test có **ít nhất một** `expect()` kiểm tra kết quả của hành động | ☐ | ☐ | |
| C2 | Dùng web-first assertions: `expect(locator).toBeVisible()`, `toHaveText()`, `toHaveURL()`... | ☐ | ☐ | |
| C3 | Không dùng `.textContent()` hay `.innerText()` để so sánh thủ công | ☐ | ☐ | |
| C4 | Assertion kiểm tra đúng kết quả mà kịch bản yêu cầu (không kiểm tra thứ không liên quan) | ☐ | ☐ | |

---

## Phần D — Độ Ổn Định (Không Flaky)

| # | Tiêu chí | PASS | FAIL | Ghi chú |
|---|----------|:----:|:----:|---------|
| D1 | Không có `waitForTimeout()` / `page.waitForTimeout()` ở bất kỳ đâu | ☐ | ☐ | |
| D2 | Chờ bằng assertion hoặc `waitForResponse` / `waitForLoadState` | ☐ | ☐ | |
| D3 | Test chạy **pass ít nhất 3 lần liên tiếp** mà không đổi gì | ☐ | ☐ | |
| D4 | Test có thể chạy **độc lập**, không cần test khác chạy trước | ☐ | ☐ | |
| D5 | Test có thể chạy **song song** với các test khác mà không xung đột dữ liệu | ☐ | ☐ | |

---

## Phần E — Dữ Liệu & Bảo Mật

| # | Tiêu chí | PASS | FAIL | Ghi chú |
|---|----------|:----:|:----:|---------|
| E1 | Không có password, token, hay thông tin nhạy cảm hardcode trong file test | ☐ | ☐ | |
| E2 | Dữ liệu nhạy cảm lấy từ biến môi trường (`process.env.XXX`) hoặc file `.env` | ☐ | ☐ | |
| E3 | Dữ liệu test được tạo/dọn trong `beforeEach` / `afterEach` nếu cần | ☐ | ☐ | |

---

## Phần F — Chạy Thực Tế

| # | Tiêu chí | PASS | FAIL | Ghi chú |
|---|----------|:----:|:----:|---------|
| F1 | Test chạy **xanh** (pass) trên máy local với lệnh `npx playwright test` | ☐ | ☐ | |
| F2 | Test chạy **xanh** ở chế độ headless (không mở trình duyệt) | ☐ | ☐ | |
| F3 | Khi test fail giả lập (sửa assertion sai), test báo **đỏ** đúng chỗ | ☐ | ☐ | |
| F4 | Screenshot / video / trace được sinh ra khi test fail | ☐ | ☐ | |

---

## Kết Quả Tổng

| Hạng mục | Tổng mục | Pass | Fail |
|----------|:--------:|:----:|:----:|
| A — Cấu trúc & tổ chức | 5 | | |
| B — Locator | 5 | | |
| C — Assertion | 4 | | |
| D — Độ ổn định | 5 | | |
| E — Dữ liệu & bảo mật | 3 | | |
| F — Chạy thực tế | 4 | | |
| **Tổng cộng** | **26** | | |

---

## Quyết Định

- **CHẤP NHẬN** — Toàn bộ 26 mục PASS
- **TRẢ LẠI** — Còn ít nhất 1 mục FAIL → ghi rõ mục nào, lý do, yêu cầu sửa lại

---

**Người review:** _____________________ | **Ngày:** ___________

**Test case / tính năng:** _____________________

> Tài liệu gốc: `AI_Playwright_Testing_Rules.md`
