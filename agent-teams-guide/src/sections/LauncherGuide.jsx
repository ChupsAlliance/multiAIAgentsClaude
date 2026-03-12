import { SectionHeader } from '../components/SectionHeader'
import { InfoBox } from '../components/InfoBox'

export function LauncherGuide() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={3}
        titleVi="Launcher — Tạo Mission"
        titleEn="Launcher — Create a Mission"
        description="Launcher là màn hình đầu tiên khi mở Mission Control. Nơi bạn nhập yêu cầu, chọn project, đính kèm tài liệu tham khảo, và tùy chỉnh model/mode."
      />

      <div className="space-y-6 text-sm leading-relaxed">
        {/* Requirement textarea */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Nhập yêu cầu (Requirement)
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Viết mô tả yêu cầu bằng ngôn ngữ tự nhiên (tiếng Việt hoặc tiếng Anh).
            App tự nhận dạng ngôn ngữ và hướng dẫn agents viết UI/docs phù hợp.
          </p>
          <div className="rounded-lg border border-vs-border overflow-hidden">
            <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
              <span className="text-white font-medium text-sm">Ví dụ yêu cầu tốt</span>
            </div>
            <div className="p-4 space-y-2 text-xs text-vs-text font-mono">
              <p className="text-vs-string">"Tạo ứng dụng React quản lý bài kiểm tra. Hỗ trợ single choice A,B,C,D.
              Có form tạo câu hỏi, xem danh sách, và chạy bài kiểm tra."</p>
              <p className="text-vs-muted mt-2">→ Cụ thể, rõ ràng, nêu đủ features cần có</p>
            </div>
          </div>
        </div>

        {/* @mention */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            @mention — Đính kèm file từ project
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Gõ <kbd className="bg-vs-panel border border-vs-border text-vs-keyword px-1.5 py-0.5 rounded text-xs">@</kbd>{' '}
            trong textarea để mở dropdown tìm file trong project. Chọn file → nội dung file sẽ được inject vào prompt.
          </p>
          <div className="overflow-x-auto rounded-lg border border-vs-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel">
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Thao tác</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Kết quả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vs-border">
                {[
                  ['Gõ @', 'Mở dropdown, hiện tất cả files trong project'],
                  ['Gõ @comp', 'Filter — chỉ hiện files chứa "comp" trong tên'],
                  ['↑↓ để chọn, Enter để xác nhận', 'File được thêm vào Reference Materials'],
                  ['Esc', 'Đóng dropdown, không chọn gì'],
                ].map(([action, result]) => (
                  <tr key={action} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-vs-keyword">{action}</td>
                    <td className="px-4 py-2 text-vs-text">{result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InfoBox type="info">
            File text dưới 500KB sẽ được đọc nội dung và inject vào prompt. File lớn hơn chỉ đính kèm path.
            Image files không đọc nội dung — chỉ lưu reference.
          </InfoBox>
        </div>

        {/* Drag & Drop */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Drag & Drop — Kéo file/folder vào
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Kéo file hoặc folder từ File Explorer vào Launcher. App tự nhận dạng loại:
          </p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { type: 'File', icon: '📄', desc: 'Đọc nội dung (nếu < 500KB), inject vào prompt' },
              { type: 'Folder', icon: '📁', desc: 'Lưu path để agent explore cấu trúc' },
              { type: 'Image', icon: '🖼️', desc: 'Lưu reference — agent nhận image path' },
            ].map(({ type, icon, desc }) => (
              <div key={type} className="rounded-lg border border-vs-border p-3 text-center">
                <div className="text-2xl mb-1">{icon}</div>
                <div className="text-white text-xs font-semibold">{type}</div>
                <div className="text-vs-muted text-[10px] mt-1">{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Clipboard paste */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Ctrl+V — Paste ảnh từ clipboard
          </h3>
          <p className="text-vs-text ml-3">
            Copy ảnh (screenshot, từ browser...) rồi{' '}
            <kbd className="bg-vs-panel border border-vs-border text-vs-keyword px-1.5 py-0.5 rounded text-xs">Ctrl+V</kbd>{' '}
            trong textarea. Ảnh sẽ được lưu tạm và thêm vào Reference Materials tự động.
            Hữu ích khi muốn agents tham khảo design mockup hoặc error screenshot.
          </p>
        </div>

        {/* Model selection */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Chọn Model
          </h3>
          <div className="overflow-x-auto rounded-lg border border-vs-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel">
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Model</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Đặc điểm</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Phù hợp cho</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vs-border">
                {[
                  ['Sonnet 4.6', 'Nhanh, tiết kiệm', 'Hầu hết tasks — build feature, refactor, debug'],
                  ['Opus 4.6', 'Mạnh nhất, chậm hơn', 'Kiến trúc phức tạp, multi-agent điều phối lớn'],
                  ['Haiku 4.5', 'Siêu nhanh, rẻ', 'Prototype, draft, tasks đơn giản'],
                ].map(([model, trait, use]) => (
                  <tr key={model} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-vs-keyword font-semibold">{model}</td>
                    <td className="px-4 py-2 text-vs-text">{trait}</td>
                    <td className="px-4 py-2 text-vs-string">{use}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InfoBox type="tip">
            Model ở Launcher là model cho <strong>Lead agent</strong> (agent chính).
            Trong Plan Review, bạn có thể chọn model riêng cho từng subagent.
          </InfoBox>
        </div>

        {/* Execution mode */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Chọn Execution Mode
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                mode: 'Standard',
                badge: 'Mặc định',
                badgeColor: 'bg-vs-green/20 text-vs-green',
                borderColor: 'border-vs-green',
                desc: 'Agents chạy song song qua Lead. Lead tự verify build. Ổn định, đủ cho 90% tasks.',
              },
              {
                mode: 'Agent Teams',
                badge: 'Thử nghiệm',
                badgeColor: 'bg-yellow-500/20 text-yellow-400',
                borderColor: 'border-yellow-500',
                desc: 'Agents giao tiếp trực tiếp qua SendMessage. Cần enable experimental flag.',
              },
            ].map(({ mode, badge, badgeColor, borderColor, desc }) => (
              <div key={mode} className={`rounded-lg border ${borderColor} p-4`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-white font-semibold text-sm">{mode}</span>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${badgeColor}`}>{badge}</span>
                </div>
                <p className="text-vs-text text-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Team size hint + Project path */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Cấu hình khác
          </h3>
          <div className="space-y-3">
            <div className="flex items-start gap-3 bg-vs-panel/50 border border-vs-border rounded-lg p-3">
              <span className="text-vs-accent shrink-0 mt-0.5">▸</span>
              <div>
                <span className="text-white font-medium">Team Size Hint</span>
                <p className="text-vs-muted text-xs mt-0.5">
                  Slider chọn 2–8 agents. Đây là <em>gợi ý</em> — Lead có thể dùng ít/nhiều hơn tùy task.
                  Mặc định: 3 agents.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-vs-panel/50 border border-vs-border rounded-lg p-3">
              <span className="text-vs-accent shrink-0 mt-0.5">▸</span>
              <div>
                <span className="text-white font-medium">Project Path</span>
                <p className="text-vs-muted text-xs mt-0.5">
                  Chọn thư mục project. Agents sẽ cd vào đây để đọc/viết code.
                  Nút "Browse" mở folder picker. Bỏ trống = agents tự tạo project mới.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-vs-panel/50 border border-vs-border rounded-lg p-3">
              <span className="text-vs-accent shrink-0 mt-0.5">▸</span>
              <div>
                <span className="text-white font-medium">Mission History</span>
                <p className="text-vs-muted text-xs mt-0.5">
                  Phía dưới Launcher hiện 50 missions gần nhất. Click vào để xem lại
                  (read-only). Nút 🗑 xóa mission khỏi history.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Prompt Preview */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Xem System Prompt trước khi launch
          </h3>
          <p className="text-vs-text ml-3">
            Nút <strong>"Xem System Prompt"</strong> (icon mắt 👁) ở Launcher cho phép
            xem toàn bộ prompt sẽ gửi cho Lead agent. Hữu ích để debug hoặc verify
            references đã được inject đúng.
          </p>
        </div>
      </div>
    </div>
  )
}
