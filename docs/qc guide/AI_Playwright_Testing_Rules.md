# Bộ Quy Tắc Dùng AI Để Automation Test Với Playwright

> Phiên bản: 1.1 | Cập nhật: 2026-06-05

---

## 1. Mục Tiêu

Cung cấp hướng dẫn thực tế để team sử dụng AI (GitHub Copilot, Claude, ChatGPT, v.v.) kết hợp Playwright nhằm tăng tốc độ viết và duy trì automation test, đảm bảo chất lượng và khả năng bảo trì lâu dài.

---

## 2. Tiêu Chí Đánh Giá Test Tốt

Mỗi test case được viết ra phải đáp ứng **toàn bộ** các tiêu chí sau:

| # | Tiêu chí | Mô tả |
|---|----------|-------|
| 1 | **Độc lập** | Mỗi test không phụ thuộc vào kết quả của test khác. Có thể chạy độc lập hoặc song song. |
| 2 | **Xác định** | Cùng môi trường, cùng dữ liệu → luôn cho kết quả như nhau (không flaky). |
| 3 | **Tập trung** | Một test chỉ kiểm tra một hành vi hoặc một luồng duy nhất. |
| 4 | **Đọc được** | Tên test và các bước phải tự mô tả, không cần đọc code mới hiểu. |
| 5 | **Bảo trì được** | Selector và logic được tổ chức (Page Object / Fixture) để dễ cập nhật khi UI thay đổi. |
| 6 | **Có assertion rõ ràng** | Mỗi test phải có ít nhất một `expect()` kiểm tra kết quả thực sự của hành động. |

---

## 3. Nguyên Tắc Khi Dùng Playwright

### 3.1 Locator — Ưu Tiên Theo Thứ Tự Này

Playwright khuyến nghị dùng locator theo mức độ bền vững giảm dần:

```
1. getByTestId()        → Bền nhất — dev gắn data-testid vào element (khuyến nghị cho team)
2. getByRole()          → Gắn với ngữ nghĩa HTML (button, dialog, checkbox...)
3. getByLabel()         → Dựa vào label form
4. getByPlaceholder()   → Dựa vào placeholder input
5. getByText()          → Dựa vào nội dung hiển thị
6. locator('css')       → Chỉ dùng khi không còn cách nào trên
```

**Tránh:** `locator('div > span:nth-child(3)')` — dễ vỡ khi UI thay đổi nhỏ.

### 3.1a Chiến Lược `data-testid` — Dev Và Tester Phối Hợp

**Tại sao `getByTestId` đứng đầu trong thực tế?**

- Không bị ảnh hưởng khi đổi text, đổi class CSS, hay đổi cấu trúc HTML
- Dev kiểm soát được tên → tester không cần đoán selector
- AI sinh code chính xác hơn vì tên có ngữ nghĩa rõ ràng

**Quy ước đặt tên `data-testid` cho dev:**

| Loại control | Pattern | Ví dụ |
|-------------|---------|-------|
| Button | `btn-[action]-[context]` | `btn-submit-login`, `btn-delete-user` |
| Input text | `input-[field]` | `input-email`, `input-search` |
| Password | `input-password-[context]` | `input-password-login` |
| Dropdown/Select | `select-[field]` | `select-province`, `select-role` |
| Checkbox | `checkbox-[field]` | `checkbox-agree-terms` |
| Radio | `radio-[field]-[value]` | `radio-gender-male` |
| Link | `link-[destination]` | `link-forgot-password` |
| Modal/Dialog | `modal-[name]` | `modal-confirm-delete` |
| Form | `form-[name]` | `form-login`, `form-register` |
| Table row | `row-[entity]-[id]` | `row-user-123` |
| Tab | `tab-[name]` | `tab-profile`, `tab-settings` |
| Alert/Toast | `alert-[type]` | `alert-error`, `alert-success` |

**Cấu hình Playwright để dùng attribute tùy chỉnh** (nếu team không dùng `data-testid`):

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    testIdAttribute: 'data-qa', // hoặc 'data-cy', 'data-automation-id', 'data-e2e'
  },
});
```

Sau khi cấu hình, tester vẫn gọi `getByTestId()` bình thường — Playwright tự map sang attribute đúng.

**Ví dụ thực tế:**

```html
<!-- HTML do dev viết -->
<button data-testid="btn-submit-login" type="submit">Đăng nhập</button>
<input data-testid="input-email" type="email" />
<span data-testid="alert-error" class="text-red-500">Sai mật khẩu</span>
```

```typescript
// Test cực kỳ dễ đọc, không vỡ dù đổi text hay CSS
await page.getByTestId('input-email').fill('user@example.com');
await page.getByTestId('btn-submit-login').click();
await expect(page.getByTestId('alert-error')).toBeVisible();
```

**Yêu cầu với dev khi không có `data-testid`:** Tester cần cung cấp danh sách element cần gắn → dev gắn vào trong cùng sprint → không để tester phải dùng CSS selector tạm.

### 3.2 Assertion — Luôn Dùng Web-First Assertions

```typescript
// ✅ Đúng — tự động chờ element ổn định
await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();
await expect(page.getByText('Thành công')).toBeVisible();

// ❌ Sai — không có retry, dễ flaky
const text = await page.locator('.message').textContent();
expect(text).toBe('Thành công');
```

### 3.3 Chờ Đúng Cách — Không Dùng `waitForTimeout`

```typescript
// ❌ Tránh — giả định thời gian, không đáng tin
await page.waitForTimeout(3000);

// ✅ Dùng — chờ đúng trạng thái
await page.waitForLoadState('networkidle');
await expect(page.getByRole('dialog')).toBeVisible();
await page.waitForResponse(resp => resp.url().includes('/api/save'));
```

### 3.4 Tổ Chức Code — Page Object Model (POM)

```
tests/
├── pages/
│   ├── LoginPage.ts       ← encapsulate locators & actions
│   └── DashboardPage.ts
├── fixtures/
│   └── auth.fixture.ts    ← tái sử dụng trạng thái đã login
└── specs/
    └── login.spec.ts      ← chỉ chứa kịch bản test
```

### 3.5 Dữ Liệu Test

- Không hardcode dữ liệu nhạy cảm (password, token) trong file test.
- Dùng biến môi trường qua `.env` + `process.env`.
- Dùng `test.beforeEach` / `test.afterEach` để tạo/dọn dữ liệu.

### 3.6 Cấu Hình Cơ Bản Nên Có

```typescript
// playwright.config.ts
export default defineConfig({
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.BASE_URL,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
});
```

---

## 4. Dùng AI Hiệu Quả Khi Đã Có Kịch Bản Cụ Thể

### Quy Trình 5 Bước

```
[Kịch bản ngắn]
      ↓
[Bước 1] Làm rõ kịch bản
      ↓
[Bước 2] Prompt AI sinh code
      ↓
[Bước 3] Review code AI sinh ra
      ↓
[Bước 4] Chạy thử & sửa
      ↓
[Bước 5] Refactor vào POM
```

---

### Bước 1 — Làm Rõ Kịch Bản Trước Khi Prompt

Một kịch bản tốt cần có đủ 4 phần:

| Phần | Câu hỏi cần trả lời |
|------|---------------------|
| **Given** | Trạng thái ban đầu là gì? (đã login chưa? dữ liệu có sẵn?) |
| **When** | Người dùng làm gì? (click, nhập, chọn...) |
| **Then** | Kết quả kỳ vọng là gì? (thông báo, URL, dữ liệu...) |
| **Edge cases** | Nếu sai thì sao? Cần test không? |

**Ví dụ kịch bản đã làm rõ:**
```
Given: Người dùng chưa đăng nhập, truy cập trang /login
When: Nhập email hợp lệ + sai password → click "Đăng nhập"
Then: Hiển thị thông báo lỗi "Sai mật khẩu" bên dưới form
      Không chuyển trang
```

---

### Bước 2 — Cấu Trúc Prompt Hiệu Quả

**Template prompt chuẩn:**

```
Bối cảnh:
- Framework: Playwright + TypeScript
- URL: [url trang]
- Tôi đang viết theo mô hình Page Object (POM)

Kịch bản cần test:
[Dán kịch bản đã làm rõ ở bước 1]

Yêu cầu sinh code:
1. Ưu tiên getByTestId() nếu element có data-testid, sau đó mới dùng getByRole / getByLabel
2. Tuyệt đối không dùng CSS selector giòn (nth-child, class động)
3. Dùng web-first assertions (expect().toBeVisible(), expect().toHaveText())
4. Không dùng waitForTimeout — thay bằng assertion hoặc waitForResponse
5. Tách locator và action vào class Page Object riêng
6. Thêm comment ngắn giải thích assertion kỳ vọng gì

Thông tin thêm về UI (nếu có):
[Dán HTML snippet — đặc biệt chú ý có data-testid không, nếu có thì liệt kê ra]
```

---

### Bước 3 — Review Code AI Sinh Ra

Checklist bắt buộc trước khi chấp nhận code từ AI:

**Locator:**
- [ ] Element có `data-testid` → AI có dùng `getByTestId()` chưa? Nếu chưa thì yêu cầu sửa lại.
- [ ] Element không có `data-testid` → AI có dùng `getByRole` / `getByLabel` không? Hay đang dùng CSS selector giòn?
- [ ] AI có "bịa" `data-testid` hoặc selector không có thật không? → Kiểm tra lại trên browser / HTML thật.

**Assertion:**
- [ ] Có `waitForTimeout` nào không? → Xóa và thay bằng `expect().toBeVisible()` hoặc `waitForResponse`.
- [ ] `expect()` có kiểm tra đúng thứ kịch bản yêu cầu (thông báo, URL, trạng thái) không?

**Chung:**
- [ ] Test name có mô tả đúng hành vi đang test không?
- [ ] Có dữ liệu hardcode nhạy cảm (password, token) không?
- [ ] Test có thể chạy độc lập mà không cần test khác chạy trước không?

---

### Bước 4 — Chạy Thử Và Debug

```bash
# Chạy test đơn lẻ với headed mode để quan sát
npx playwright test login.spec.ts --headed

# Dùng Playwright Inspector để debug từng bước
npx playwright test login.spec.ts --debug

# Dùng codegen để capture selector thật từ trang
npx playwright codegen https://your-website.com
```

Khi test fail, yêu cầu AI giải thích bằng cách cung cấp:
- Error message đầy đủ
- Screenshot / trace file (`.zip`)
- HTML của element liên quan

---

### Bước 5 — Refactor Vào Page Object

Sau khi test chạy xanh, yêu cầu AI refactor:

```
Prompt: "Hãy tách test này thành Page Object Model.
Selector và action vào file LoginPage.ts.
File spec chỉ giữ lại kịch bản Given/When/Then.
Giữ nguyên tất cả assertion."
```

---

## 5. Những Điều Không Nên Làm Với AI

| Đừng làm | Lý do |
|-----------|-------|
| Chấp nhận code AI mà không chạy thử | AI có thể sinh selector không tồn tại |
| Để AI tự chọn locator từ mô tả mơ hồ | Sẽ ra CSS selector giòn |
| Dùng AI để viết cả suite test cùng lúc | Test sẽ phụ thuộc nhau, khó debug |
| Bỏ qua review checklist vì "AI đáng tin" | AI không biết UI thật của trang bạn |
| Đưa token/password thật vào prompt | Rò rỉ thông tin nhạy cảm |

---

## 6. Công Cụ Hỗ Trợ

| Công cụ | Mục đích |
|---------|----------|
| `npx playwright codegen` | Capture selector thật từ trình duyệt |
| Playwright Trace Viewer | Phân tích test fail theo từng bước |
| VS Code Playwright Extension | Chạy/debug test ngay trong editor |
| AI Chat (Claude, Copilot...) | Sinh code, giải thích lỗi, refactor |

---

## 7. Nguồn Tham Khảo

> Tất cả nội dung trong tài liệu này dựa trên các nguồn chính thức dưới đây.

1. **Playwright — Best Practices**
   https://playwright.dev/docs/best-practices

2. **Playwright — Locators (hướng dẫn chọn locator)**
   https://playwright.dev/docs/locators

3. **Playwright — Assertions (web-first assertions)**
   https://playwright.dev/docs/test-assertions

4. **Playwright — Page Object Models**
   https://playwright.dev/docs/pom

5. **Playwright — codegen (tự động tạo test)**
   https://playwright.dev/docs/codegen

6. **Playwright — Trace Viewer**
   https://playwright.dev/docs/trace-viewer

7. **Playwright — Configuration**
   https://playwright.dev/docs/test-configuration

8. **GitHub Copilot — Testing with AI (Microsoft Learn)**
   https://learn.microsoft.com/en-us/training/modules/introduction-to-github-copilot/

9. **Anthropic — Claude for developers**
   https://docs.anthropic.com/en/docs/overview

---

*Tài liệu này nên được review và cập nhật mỗi quý hoặc khi Playwright ra phiên bản major mới.*
