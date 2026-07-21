# Định Nghĩa Các Loại Test & Cách Lên Kịch Bản Hiệu Quả

> Phiên bản: 1.1 | Cập nhật: 2026-06-05
> Tài liệu này dành cho cả Dev và Tester — không cần kinh nghiệm automation trước.

---

## 1. Tổng Quan — Tại Sao Cần Phân Loại Test?

Không phải mọi lỗi đều cần E2E test để phát hiện. Mỗi loại test có **mục tiêu khác nhau**, **tốc độ khác nhau**, và **chi phí duy trì khác nhau**.

```
                   ▲ Chi phí cao, chạy chậm, ít số lượng
                   │
              ┌────┴────┐
              │  E2E    │  ← Playwright, Cypress — test toàn bộ luồng từ UI
              └────┬────┘
           ┌───────┴───────┐
           │  Integration  │  ← API test, test nhiều module cùng nhau
           └───────┬───────┘
      ┌────────────┴────────────┐
      │       Unit Test         │  ← Test từng hàm, component độc lập
      └─────────────────────────┘
                   │
                   ▼ Chi phí thấp, chạy nhanh, nhiều số lượng
```

**Quy tắc tỉ lệ khuyến nghị:**
- **70%** Unit test
- **20%** Integration / API test
- **10%** E2E test (chỉ các luồng quan trọng nhất)

---

## 2. Định Nghĩa Từng Loại Test

### 2.1 Unit Test

| Mục | Nội dung |
|-----|---------|
| **Kiểm tra gì** | Một hàm, một class, một component UI độc lập |
| **Cách ly** | Hoàn toàn — mock tất cả dependency bên ngoài |
| **Tốc độ** | Rất nhanh (mili giây / test) |
| **Người viết** | Dev |
| **Công cụ phổ biến** | Jest, Vitest, pytest, JUnit |

**Ví dụ phù hợp:**
- Hàm tính tổng tiền thuế
- Component Button hiển thị đúng text
- Hàm validate định dạng email

**Ví dụ KHÔNG phù hợp:**
- Nhấn nút Login thấy trang Dashboard (đó là E2E)
- Lưu dữ liệu vào database (đó là Integration)

```typescript
// ✅ Unit test — test logic thuần, không cần browser
test('tính thuế VAT 10%', () => {
  expect(calculateVAT(100_000)).toBe(10_000);
});
```

---

### 2.2 Integration Test (API Test)

| Mục | Nội dung |
|-----|---------|
| **Kiểm tra gì** | Sự phối hợp giữa các module — thường là API endpoint |
| **Cách ly** | Một phần — có thể kết nối database test thật, mock service bên ngoài |
| **Tốc độ** | Trung bình (giây / test) |
| **Người viết** | Dev hoặc Tester |
| **Công cụ phổ biến** | Playwright (request), Supertest, Postman/Newman, RestAssured |

**Ví dụ phù hợp:**
- `POST /api/login` trả về token khi đúng credentials
- `GET /api/users` trả về danh sách đúng format
- Lưu form rồi GET lại thấy dữ liệu đúng

```typescript
// ✅ API test với Playwright
test('POST /api/login trả về token', async ({ request }) => {
  const res = await request.post('/api/login', {
    data: { email: 'user@test.com', password: 'Test@123' }
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('token');
});
```

---

### 2.3 E2E Test (End-to-End)

| Mục | Nội dung |
|-----|---------|
| **Kiểm tra gì** | Toàn bộ luồng người dùng từ UI đến database |
| **Cách ly** | Không — chạy trên browser thật, server thật |
| **Tốc độ** | Chậm (giây đến phút / test) |
| **Người viết** | Tester (có thể có Dev hỗ trợ) |
| **Công cụ phổ biến** | Playwright, Cypress, Selenium |

**Ví dụ phù hợp:**
- Đăng nhập → vào trang chủ → tạo đơn hàng → xem lịch sử
- Đăng ký tài khoản mới → xác thực email → đăng nhập lần đầu

**Ví dụ KHÔNG phù hợp:**
- Test từng trường validation riêng lẻ (Unit test làm tốt hơn, nhanh hơn)
- Test API response format (Integration test làm tốt hơn)

---

### 2.4 Smoke Test

| Mục | Nội dung |
|-----|---------|
| **Kiểm tra gì** | Các chức năng cốt lõi hoạt động được không (không đi sâu) |
| **Mục đích** | Chạy sau mỗi deploy để phát hiện sự cố nghiêm trọng ngay lập tức |
| **Tốc độ** | Nhanh — chỉ happy path, không edge case |
| **Người viết** | Tester |

**Ví dụ:**
- Trang login mở được, có thể đăng nhập
- Menu chính hiển thị đúng
- API sức khỏe `/healthz` trả về 200

---

### 2.5 Regression Test

| Mục | Nội dung |
|-----|---------|
| **Kiểm tra gì** | Các tính năng cũ không bị vỡ sau khi thêm tính năng mới |
| **Mục đích** | Bảo vệ những gì đã hoạt động |
| **Khi chạy** | Trước mỗi release, sau mỗi merge lớn |
| **Người viết** | Tester |

> Regression test **không phải loại test riêng** — đây là tập hợp E2E + Integration test chạy lại toàn bộ để đảm bảo không có gì bị vỡ.

---

### 2.6 Component Test (Playwright)

| Mục | Nội dung |
|-----|---------|
| **Kiểm tra gì** | Component UI (React, Vue, Angular) trong môi trường browser thật nhưng cô lập |
| **Đặc điểm** | Nhanh hơn E2E, thực tế hơn Unit test |
| **Công cụ** | `@playwright/experimental-ct-*` |

```typescript
// ✅ Component test — test component Button trong browser thật
import { test, expect } from '@playwright/experimental-ct-react';
import Button from './Button';

test('Button hiển thị text và gọi onClick', async ({ mount }) => {
  let clicked = false;
  const component = await mount(
    <Button onClick={() => { clicked = true; }}>Lưu</Button>
  );
  await expect(component).toContainText('Lưu');
  await component.click();
  expect(clicked).toBe(true);
});
```

---

## 3. Bảng So Sánh Nhanh

| Tiêu chí | Unit | Integration | E2E | Smoke |
|----------|:----:|:-----------:|:---:|:-----:|
| Tốc độ | ⚡⚡⚡ | ⚡⚡ | ⚡ | ⚡⚡ |
| Độ tin cậy (ít flaky) | ★★★ | ★★ | ★ | ★★ |
| Phản ánh thực tế | ★ | ★★ | ★★★ | ★★ |
| Chi phí viết & duy trì | Thấp | Trung bình | Cao | Thấp |
| Phù hợp khi dev vừa xong | ✅ Tốt nhất | ✅ Tốt | ⚠️ Tốn thời gian | ✅ Tốt |

---

## 4. Dev Vừa Code Xong — Loại Test Nào Áp Dụng Ngay?

### Nguyên tắc: Bắt đầu từ "gần code nhất"

```
Dev commit code
      │
      ├── Logic nghiệp vụ? ──────────────→ Unit Test (Jest/Vitest)
      │
      ├── API endpoint mới? ──────────────→ API/Integration Test (Playwright request)
      │
      ├── Tính năng UI hoàn chỉnh? ───────→ E2E Test (Playwright browser)
      │
      └── Deploy lên môi trường mới? ─────→ Smoke Test
```

### Quy trình tối giản cho dev

**Bước 1 — Xác định phạm vi:**

| Dev vừa làm gì | Loại test phù hợp | Thời gian ước tính |
|----------------|-------------------|-------------------|
| Thêm hàm tính toán / validate | Unit test | 15–30 phút |
| Thêm API endpoint | Integration/API test | 30–60 phút |
| Hoàn thành 1 màn hình / tính năng | E2E (happy path) | 1–2 giờ |
| Fix bug | Test tái hiện bug (bất kỳ loại phù hợp) | 30 phút |

**Bước 2 — Happy path trước, edge case sau:**

Đừng viết 10 kịch bản cùng lúc. Viết **1 kịch bản happy path** chạy xanh trước, rồi mới thêm edge case.

---

## 5. Cách Lên Kịch Bản Đơn Giản Nhất

### 5.1 Công thức 3 câu hỏi

Trước khi viết bất kỳ dòng code nào, trả lời 3 câu hỏi này:

```
1. SETUP    → Cần gì để bắt đầu test?     (đã login? dữ liệu có sẵn?)
2. ACTION   → Làm đúng 1 việc gì?          (nhấn, nhập, gửi form)
3. VERIFY   → Biết thành công bằng cái gì? (text, URL, dữ liệu trong DB)
```

### 5.2 Template kịch bản tối thiểu

```
Tên test: [Động từ] + [Đối tượng] + [Kết quả]
Ví dụ:   "Đăng nhập thành công với email và mật khẩu hợp lệ"

SETUP  : Người dùng chưa đăng nhập, có tài khoản hợp lệ trong hệ thống
ACTION : Nhập email + password đúng → click nút "Đăng nhập"
VERIFY : URL chuyển sang /dashboard + hiển thị tên người dùng
```

### 5.3 Ví dụ thực tế — từ user story ra kịch bản

**User story:**
> "Là người dùng, tôi muốn đăng nhập để truy cập hệ thống"

**Kịch bản tối thiểu (Happy Path):**

```
TEST 1: Đăng nhập thành công
  SETUP  : Tài khoản user@test.com / Test@123 tồn tại
  ACTION : Nhập email → Nhập password → Click "Đăng nhập"
  VERIFY : Chuyển trang /dashboard, hiển thị "Xin chào, User"
```

**Kịch bản mở rộng (sau khi TEST 1 xanh):**

```
TEST 2: Đăng nhập thất bại — sai mật khẩu
  SETUP  : Tài khoản user@test.com tồn tại
  ACTION : Nhập email đúng → Nhập password SAI → Click "Đăng nhập"
  VERIFY : Ở lại trang /login, hiển thị "Sai email hoặc mật khẩu"

TEST 3: Đăng nhập thất bại — bỏ trống email
  SETUP  : Truy cập trang /login
  ACTION : Không nhập gì → Click "Đăng nhập"
  VERIFY : Hiển thị thông báo "Email không được để trống"
```

### 5.4 Thứ tự ưu tiên khi lên kịch bản

```
Ưu tiên 1: Happy path          → luồng thành công bình thường
Ưu tiên 2: Unhappy path phổ biến → sai input, không có quyền
Ưu tiên 3: Boundary / edge case  → giới hạn ký tự, số lớn, rỗng
Ưu tiên 4: Error recovery        → mất kết nối, timeout
```

> **Quy tắc:** Nếu chỉ có 1 tiếng để viết test — viết Happy Path. Nếu có 3 tiếng — thêm Unhappy Path phổ biến nhất.

---

## 6. Phân Rã Kịch Bản Theo Từng Loại Chức Năng

### 6.1 Phương Pháp — Cây Kịch Bản

Với bất kỳ chức năng nào, đặt câu hỏi: **"Điều gì có thể xảy ra?"** rồi xếp vào 5 nhóm theo thứ tự ưu tiên:

```
[Chức năng]
│
├── 1. Happy path       → Làm đúng, kết quả đúng          (luôn viết trước)
├── 2. Validation       → Input sai trước khi gửi         (mỗi rule = 1 test)
├── 3. Business error   → Gửi rồi mới lỗi từ server/logic (mỗi lỗi = 1 test)
├── 4. Phân quyền       → Role khác nhau, kết quả khác    (nếu có)
└── 5. Edge case        → Giới hạn, dữ liệu cực trị       (chỉ khi thực sự cần)
```

**Quy ước đặt tên test case:**

```
[TC<số>] [Hành động] + khi + [Điều kiện] → [Kết quả kỳ vọng]

Ví dụ:
TC01  Đăng nhập khi email và password hợp lệ            → vào dashboard
TC05  Đăng nhập khi password sai                        → hiển thị thông báo lỗi
TC08  Đăng nhập khi nhập sai 5 lần liên tiếp            → bị block 15 phút
```

---

### 6.2 Ví Dụ 1 — Form Có Nhiều Field (Đăng Ký Tài Khoản)

```
Chức năng: Đăng ký tài khoản mới
│
├── Happy path
│   └── TC01  Điền đầy đủ thông tin hợp lệ → tạo tài khoản thành công, hiển thị "Đăng ký thành công"
│
├── Validation — mỗi field là một test riêng
│   ├── TC02  Bỏ trống Họ tên           → "Họ tên không được để trống"
│   ├── TC03  Bỏ trống Email            → "Email không được để trống"
│   ├── TC04  Email sai định dạng       → "Email không hợp lệ"
│   ├── TC05  Password dưới 8 ký tự     → "Mật khẩu tối thiểu 8 ký tự"
│   ├── TC06  Xác nhận password không khớp → "Mật khẩu không trùng khớp"
│   └── TC07  Số điện thoại không đúng 10 số → "Số điện thoại không hợp lệ"
│
├── Business error
│   └── TC08  Email đã tồn tại trong hệ thống → "Email này đã được đăng ký"
│
└── Edge case
    └── TC09  Họ tên nhập đúng 100 ký tự (giới hạn tối đa) → đăng ký thành công
```

**Nguyên tắc khi test form:**
- Mỗi lần test validation, chỉ để **một field sai**, các field còn lại điền đúng
- Không test "bỏ trống tất cả" — đó là test của 3 field cùng lúc, không rõ cái nào gây lỗi

---

### 6.3 Ví Dụ 2 — Danh Sách / Bảng Dữ Liệu

```
Chức năng: Màn hình danh sách người dùng
│
├── Happy path — hiển thị
│   ├── TC01  Truy cập trang danh sách           → hiển thị đúng cột và dữ liệu
│   └── TC02  Có dữ liệu → hiển thị đúng số bản ghi
│
├── Tìm kiếm
│   ├── TC03  Tìm theo tên có kết quả            → hiển thị đúng bản ghi khớp
│   ├── TC04  Tìm theo tên không có kết quả      → hiển thị "Không tìm thấy dữ liệu"
│   └── TC05  Xóa từ khóa tìm kiếm               → hiển thị lại toàn bộ danh sách
│
├── Lọc (Filter)
│   ├── TC06  Lọc theo trạng thái "Hoạt động"    → chỉ hiển thị user đang hoạt động
│   ├── TC07  Lọc theo trạng thái "Bị khóa"      → chỉ hiển thị user bị khóa
│   └── TC08  Kết hợp lọc + tìm kiếm             → kết quả đúng cả hai điều kiện
│
├── Phân trang
│   ├── TC09  Sang trang 2                        → hiển thị đúng trang và dữ liệu
│   └── TC10  Đổi số dòng hiển thị (10 → 25)     → danh sách cập nhật đúng
│
├── Sắp xếp
│   ├── TC11  Click cột "Tên" → sắp xếp A→Z
│   └── TC12  Click lại cột "Tên" → sắp xếp Z→A
│
└── Edge case — trạng thái rỗng
    └── TC13  Không có dữ liệu nào                → hiển thị "Danh sách trống"
```

**Lưu ý:** TC13 (empty state) thường bị bỏ quên — đây là lỗi UI phổ biến.

---

### 6.4 Ví Dụ 3 — Phân Quyền (Role-based Access)

```
Chức năng: Quản lý người dùng — phân quyền theo role
│
├── Role: Admin
│   ├── TC01  Admin truy cập trang /admin/users  → hiển thị danh sách + nút Thêm/Sửa/Xóa
│   ├── TC02  Admin tạo user mới                 → tạo thành công
│   ├── TC03  Admin xóa user                     → xóa thành công
│   └── TC04  Admin sửa thông tin user           → cập nhật thành công
│
├── Role: Manager
│   ├── TC05  Manager truy cập /admin/users      → hiển thị danh sách, KHÔNG có nút Xóa
│   ├── TC06  Manager sửa thông tin user         → cập nhật thành công
│   └── TC07  Manager truy cập trực tiếp URL xóa → bị từ chối (403 hoặc redirect)
│
└── Role: User thường
    ├── TC08  User truy cập /admin/users          → redirect về trang chủ
    └── TC09  User gọi API DELETE /users/:id      → trả về 403 Forbidden
```

**Nguyên tắc khi test phân quyền:**
- Luôn test **cả hai hướng**: được phép (expect thành công) và bị từ chối (expect lỗi/redirect)
- Không bỏ qua TC07, TC09 — test trực tiếp URL/API bỏ qua UI là cách hacker hay thử

---

### 6.5 Ví Dụ 4 — CRUD Hoàn Chỉnh

```
Chức năng: Quản lý sản phẩm (CRUD)
│
├── Create (Tạo mới)
│   ├── TC01  Điền đầy đủ thông tin hợp lệ → tạo thành công, xuất hiện trong danh sách
│   ├── TC02  Bỏ trống tên sản phẩm        → validation error
│   └── TC03  Tên sản phẩm đã tồn tại      → "Tên sản phẩm đã được sử dụng"
│
├── Read (Xem)
│   ├── TC04  Xem chi tiết sản phẩm        → hiển thị đúng thông tin
│   └── TC05  Xem sản phẩm không tồn tại   → trang 404
│
├── Update (Sửa)
│   ├── TC06  Sửa tên và giá → cập nhật thành công, danh sách phản ánh ngay
│   └── TC07  Sửa thành tên đã tồn tại     → validation error
│
└── Delete (Xóa)
    ├── TC08  Xóa sản phẩm có xác nhận     → xóa thành công, không còn trong danh sách
    ├── TC09  Hủy xóa (cancel)             → sản phẩm vẫn còn
    └── TC10  Xóa sản phẩm đang được dùng  → "Không thể xóa — đang có đơn hàng liên kết"
```

---

### 6.6 Bảng Tham Chiếu Nhanh — Số Lượng Test Case Hợp Lý

| Loại chức năng | Happy path | Validation | Business error | Phân quyền | Edge case | Tổng |
|----------------|:----------:|:----------:|:--------------:|:----------:|:---------:|:----:|
| Form đơn giản (3-4 field) | 1 | 3-5 | 1-2 | — | 1 | ~6-9 |
| Form phức tạp (7+ field) | 1-2 | 6-10 | 2-4 | — | 1-2 | ~10-18 |
| Danh sách / bảng | 2 | — | — | — | 2-3 | ~5-7 |
| Danh sách + search + filter | 2 | 2-3 | — | — | 2 | ~8-12 |
| CRUD đầy đủ | 4 | 3-5 | 2-3 | — | 2 | ~12-16 |
| Chức năng có phân quyền | +1-2/role | — | — | 2-3/role | 1 | cộng thêm |

> **Nếu số test case vượt quá bảng trên nhiều** → kiểm tra lại xem có đang test cùng một điều kiện nhiều lần không.

---

## 7. Nhận Diện Test Không Flaky

### 6.1 Flaky là gì?

> **Flaky test** = test khi chạy cho ra kết quả **không nhất quán** (lúc pass, lúc fail) dù **không có gì thay đổi** trong code.

Flaky test nguy hiểm hơn không có test, vì team sẽ mất niềm tin và bắt đầu **bỏ qua kết quả** — kể cả khi có lỗi thật.

---

### 6.2 Dấu Hiệu Test KHÔNG Flaky ✅

Một test ổn định có **tất cả** đặc điểm sau:

| # | Đặc điểm | Giải thích |
|---|----------|-----------|
| 1 | **Deterministic** | Cùng input → luôn cùng output, bất kể chạy lúc nào |
| 2 | **Không phụ thuộc thời gian** | Không dùng `waitForTimeout`, `sleep`, `Date.now()` để ra quyết định |
| 3 | **Dữ liệu tự kiểm soát** | Tự tạo dữ liệu trong `beforeEach`, tự dọn trong `afterEach` |
| 4 | **Độc lập** | Không cần test khác chạy trước hoặc sau |
| 5 | **Chờ đúng sự kiện** | Chờ element visible / API response — không chờ theo giây |
| 6 | **Pass ổn định 10 lần liên tiếp** | Tiêu chí đơn giản nhất để xác nhận |

---

### 6.3 Nguyên Nhân Gây Flaky — Và Cách Khắc Phục

#### ❌ Nguyên nhân 1: Chờ theo thời gian cố định

```typescript
// ❌ Flaky — trang load nhanh hơn 2s thì ok, chậm hơn thì fail
await page.waitForTimeout(2000);
await page.getByTestId('btn-submit').click();

// ✅ Chờ đúng trạng thái
await expect(page.getByTestId('btn-submit')).toBeEnabled();
await page.getByTestId('btn-submit').click();
```

---

#### ❌ Nguyên nhân 2: Dữ liệu phụ thuộc vào test khác

```typescript
// ❌ Flaky — nếu test "tạo user" chạy trước thì pass, không thì fail
test('xóa user admin', async ({ page }) => {
  // Giả định user "admin" đã có sẵn — do test khác tạo ra
  await page.getByTestId('btn-delete-admin').click();
});

// ✅ Tự tạo dữ liệu, không phụ thuộc
test('xóa user', async ({ page, request }) => {
  // Tạo user qua API trước
  const { id } = await createUserViaAPI(request, { name: 'Test User' });

  await page.goto(`/users/${id}`);
  await page.getByTestId('btn-delete-user').click();
  await expect(page.getByTestId('alert-success')).toBeVisible();
});
```

---

#### ❌ Nguyên nhân 3: Race condition — click trước khi element sẵn sàng

```typescript
// ❌ Flaky — element có thể chưa render xong
await page.goto('/dashboard');
await page.getByTestId('btn-create-order').click(); // đôi khi miss

// ✅ Chờ element trước khi tương tác
await page.goto('/dashboard');
await expect(page.getByTestId('btn-create-order')).toBeVisible();
await page.getByTestId('btn-create-order').click();
```

---

#### ❌ Nguyên nhân 4: Phụ thuộc vào dữ liệu môi trường không kiểm soát được

```typescript
// ❌ Flaky — số lượng item có thể thay đổi tùy môi trường
await expect(page.getByTestId('table-user')).toHaveCount(5);

// ✅ Kiểm tra điều kiện tương đối, hoặc dùng dữ liệu tự tạo
await expect(page.getByTestId('table-user')).toHaveCount({ minimum: 1 });
// Hoặc: seed dữ liệu cụ thể trước, rồi check đúng số đó
```

---

#### ❌ Nguyên nhân 5: Nhiều test dùng cùng dữ liệu, chạy song song

```typescript
// ❌ Flaky khi chạy parallel — 2 test cùng sửa user có id=1
test('test A', async () => { await editUser(1, 'name A'); });
test('test B', async () => { await editUser(1, 'name B'); }); // xung đột

// ✅ Mỗi test tạo dữ liệu riêng
test('test A', async () => { const u = await createUser(); await editUser(u.id, 'name A'); });
test('test B', async () => { const u = await createUser(); await editUser(u.id, 'name B'); });
```

---

### 6.4 Checklist "Test Này Có Flaky Không?"

Trước khi commit test, tự hỏi:

```
☐ Nếu tôi chạy test này 10 lần liên tiếp ngay bây giờ → kết quả có giống nhau không?

☐ Nếu tôi chạy test này vào 2 giờ sáng, khi server đang ít tải → kết quả có thay đổi không?

☐ Nếu test khác trong suite không chạy → test này vẫn pass chứ?

☐ Test có dùng waitForTimeout không? → Nếu có: dừng lại và sửa

☐ Dữ liệu test có bị test khác tạo ra / xóa không? → Nếu có: tự tạo trong beforeEach

☐ Test có phụ thuộc vào giờ hiện tại, random number, hay dữ liệu "có sẵn" trong DB không?
```

Nếu **tất cả** đều trả lời ổn → test này không flaky.

---

### 6.5 Cách Kiểm Tra Nhanh Một Test Có Flaky Không

```bash
# Chạy 10 lần, đếm pass/fail
npx playwright test login.spec.ts --repeat-each=10

# Chạy song song 4 worker để test xung đột dữ liệu
npx playwright test login.spec.ts --workers=4

# Nếu kết quả 10/10 pass → test ổn định
# Nếu có ít nhất 1 lần fail → flaky, cần điều tra
```

---

## 8. Tóm Tắt Nhanh — Dán Lên Tường

```
┌─────────────────────────────────────────────────────────┐
│           CHỌN LOẠI TEST                                 │
│  Logic nghiệp vụ      → Unit Test                        │
│  API / nhiều module   → Integration Test                 │
│  Luồng người dùng     → E2E Test (Playwright)            │
│  Sau mỗi deploy       → Smoke Test                       │
├─────────────────────────────────────────────────────────┤
│           PHÂN RÃ KỊCH BẢN                               │
│  1. Happy path        – luồng thành công (viết trước)    │
│  2. Validation        – lỗi input (mỗi field = 1 test)   │
│  3. Business error    – lỗi từ server/logic              │
│  4. Phân quyền        – role khác nhau, kết quả khác     │
│  5. Edge case         – chỉ khi thực sự cần              │
├─────────────────────────────────────────────────────────┤
│           LÊN KỊCH BẢN TỐI THIỂU                         │
│  1. SETUP  – cần gì để bắt đầu?                          │
│  2. ACTION – làm đúng 1 việc                             │
│  3. VERIFY – biết thành công bằng cái gì?               │
├─────────────────────────────────────────────────────────┤
│           TEST KHÔNG FLAKY KHI                           │
│  ✅ Tự tạo / dọn dữ liệu (beforeEach / afterEach)       │
│  ✅ Không có waitForTimeout                              │
│  ✅ Chờ bằng expect().toBeVisible() hoặc waitForResponse │
│  ✅ Chạy 10 lần → 10 lần cùng kết quả                   │
│  ✅ Chạy được khi không có test nào chạy trước           │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Nguồn Tham Khảo

1. **Google Testing Blog — Just Say No to More End-to-End Tests**
   https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html

2. **Google Testing Blog — Test Flakiness**
   https://testing.googleblog.com/2020/12/test-flakiness-one-of-main-challenges.html

3. **Playwright — API Testing**
   https://playwright.dev/docs/api-testing

4. **Playwright — Component Testing**
   https://playwright.dev/docs/test-components

5. **Playwright — Parallelism and sharding**
   https://playwright.dev/docs/test-parallel

6. **Martin Fowler — TestPyramid**
   https://martinfowler.com/bliki/TestPyramid.html

7. **Martin Fowler — Eradicating Non-Determinism in Tests**
   https://martinfowler.com/articles/nonDeterminism.html

---

*Xem thêm: `AI_Playwright_Testing_Rules.md` — nguyên tắc và quy ước khi viết Playwright test*
*Xem thêm: `Checklist_Review_Automation_Test.md` — tiêu chí nghiệm thu trước khi merge*
