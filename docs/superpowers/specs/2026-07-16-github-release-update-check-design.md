# Kiểm tra bản cập nhật từ GitHub Releases

## Bối cảnh

App "Claude Agent Teams" là ứng dụng Electron, đóng gói thành `.exe` (NSIS installer) và publish thủ công lên GitHub Releases của repo `ChupsAlliance/multiAIAgentsClaude` (public). Hiện tại không có cách nào để người dùng biết họ đang chạy bản cũ hay mới nhất — phải tự vào GitHub kiểm tra.

App đã có sẵn:
- `ChangelogModal` + `useChangelog()` hook (`src/components/ChangelogModal.jsx`) — modal "What's New" tự động mở khi phát hiện version mới (so với `localStorage` key `changelog_seen_version`), có nút "What's New" ở `Sidebar` footer.
- Hằng số `APP_VERSION` trong `src/data/changelog.js` — **hiện đang lệch** với `package.json` (changelog.js ghi `0.8.0`, package.json ghi `0.7.1`, mục changelog mới nhất là `0.9.0`). Đây là nguồn gây nhầm lẫn cần dọn dẹp trong lúc làm tính năng này.
- IPC pattern chuẩn: whitelist ở `electron/preload.cjs` (`ALLOWED_COMMANDS`), handler đăng ký ở `electron/ipc/*.cjs`, gọi từ frontend qua `invoke(command, args)`.
- `open_url` IPC đã có sẵn để mở link ngoài bằng `shell.openExternal`.

## Mục tiêu

Khi mở app, tự động kiểm tra GitHub Releases xem có bản mới hơn bản đang chạy không:
- Nếu có bản mới → hiện modal với link tải trực tiếp đến file `.exe` trên release đó.
- Nếu đã là bản mới nhất → không làm phiền, chỉ hiện trạng thái "✓ Đang dùng bản mới nhất" trong modal What's New sẵn có.
- Nếu không kiểm tra được (mất mạng, rate limit...) → im lặng bỏ qua, không chặn hay làm chậm trải nghiệm mở app.

## Kiến trúc

### 1. Backend — IPC handler mới

Thêm vào `electron/ipc/system.cjs`:

```js
ipcMain.handle('check_for_updates', async () => {
  try {
    const res = await fetch(
      'https://api.github.com/repos/ChupsAlliance/multiAIAgentsClaude/releases/latest',
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { hasUpdate: false };

    const release = await res.json();
    const latestVersion = release.tag_name.replace(/^v/, '');
    const currentVersion = app.getVersion();

    const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;
    const exeAsset = release.assets.find(a => a.name.endsWith('.exe'));

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      downloadUrl: exeAsset?.browser_download_url || release.html_url,
      releaseNotesUrl: release.html_url,
    };
  } catch {
    return { hasUpdate: false, error: true };
  }
});
```

- `compareSemver`: hàm nhỏ tự viết so sánh 2 chuỗi `x.y.z` (không cần thêm dependency).
- Timeout 5s qua `AbortSignal.timeout` — tránh app treo chờ mạng chậm.
- Mọi lỗi (network, JSON parse, rate limit 403/404) đều bị catch và trả `hasUpdate: false` — không throw, không log ra UI.
- Không cache — chỉ gọi 1 lần mỗi khi app khởi động (nhẹ, dưới rate limit 60 req/h không auth).

### 2. Preload whitelist

Thêm `'check_for_updates'` vào mảng `ALLOWED_COMMANDS` trong `electron/preload.cjs`.

### 3. Version nguồn thật — dọn dẹp `APP_VERSION`

Thay vì dùng hằng số `APP_VERSION` (`src/data/changelog.js`, hiện đang lệch), lấy version thật từ Electron main process:
- Thêm field `app_version: app.getVersion()` vào response của `get_system_info` (đã có sẵn, gọi 1 lần lúc mount ở `Sidebar`) — tránh phải thêm IPC riêng.
- `useChangelog()` và `ChangelogModal` nhận `currentVersion` qua prop/context thay vì import trực tiếp `APP_VERSION`.
- Xoá `export const APP_VERSION` khỏi `changelog.js` sau khi migrate xong (không cần backward-compat shim vì chỉ có 2 nơi dùng nó).

### 4. Frontend — gộp vào ChangelogModal

`useChangelog()` hook (`src/components/ChangelogModal.jsx`):
- Khi mount, gọi song song: `invoke('get_system_info')` (lấy `app_version`) + `invoke('check_for_updates')`.
- Giữ nguyên logic `shouldAutoShow` hiện tại (so `currentVersion` với `localStorage[changelog_seen_version]`), **thêm điều kiện**: nếu `hasUpdate === true`, luôn `setShouldAutoShow(true)` bất kể đã xem changelog chưa.
- Trả thêm `updateInfo` (`{ hasUpdate, latestVersion, downloadUrl }`) từ hook.

`ChangelogModal` component:
- Nhận thêm prop `updateInfo`.
- Nếu `updateInfo.hasUpdate`: hiện banner nổi bật ở đầu nội dung modal (trên danh sách changelog):
  > 🎉 **Bản mới v{latestVersion} đã có sẵn!**
  > [Tải về ngay] (mở `downloadUrl` qua `invoke('open_url', { url })`)
- Nếu không có update: hiện dòng nhỏ ở footer modal, cạnh "X versions · CHANGELOG.md":
  > ✓ Đang dùng bản mới nhất
- Không có nút "check thủ công" riêng — theo yêu cầu, chỉ tự động check lúc khởi động.

## Data flow

```
App mount
  → Sidebar/App effect: invoke('get_system_info') → { app_version, ... }
  → useChangelog(): invoke('check_for_updates') (song song, không block UI)
  → merge kết quả → nếu hasUpdate hoặc changelog chưa xem → mở ChangelogModal
  → Modal hiện: [banner update nếu có] + [danh sách changelog] + [trạng thái up-to-date nếu không có update]
```

## Error handling

| Tình huống | Xử lý |
|---|---|
| Mất mạng / DNS fail | catch → `{ hasUpdate: false }`, app chạy bình thường |
| GitHub rate limit (403) | `res.ok === false` → `{ hasUpdate: false }` |
| Timeout > 5s | `AbortSignal.timeout` throw → catch → `{ hasUpdate: false }` |
| Release không có asset `.exe` | fallback `downloadUrl` = `release.html_url` (trang release trên GitHub) |
| `tag_name` không đúng format semver | `compareSemver` trả `0`/an toàn, coi như không có update |

## Testing

- Unit test `compareSemver` (các case: major/minor/patch lớn hơn, bằng nhau, có/không có prefix `v`).
- Unit test IPC handler `check_for_updates` với `fetch` mock: happy path, 404, timeout, response thiếu `assets`.
- Test thủ công: tạm sửa `app.getVersion()` (hoặc mock) về version cũ hơn bản GitHub release mới nhất hiện tại, xác nhận banner + link tải hoạt động đúng, bấm nút mở đúng `.exe` URL.

## Ngoài phạm vi (out of scope)

- Không tự động tải/cài đặt bản mới (không dùng `electron-updater`/`autoUpdater`) — chỉ mở link tải, người dùng tự chạy installer.
- Không có nút "check thủ công" trong Settings.
- Không cache kết quả check giữa các lần mở app (mỗi lần mở app gọi lại API, chấp nhận được với rate limit hiện tại).
