# Lỗi popup ERP bị treo

## Kết quả tái hiện trên Windows

- Bản 0.2.9 đã mở một cửa sổ trắng `Tauri App (Not Responding)` khi chọn **ERP System**.
- Bản 0.2.10 cũng tái hiện lỗi: xuất hiện cửa sổ trắng `LinguaHub popup (Not Responding)` và LinguaHub không đọc được cây trợ năng sau thao tác.
- Vì vậy, thay đổi ở 0.2.10 chưa giải quyết được lỗi thực tế.

## Nguyên nhân được xác định

WebView2 gọi `on_new_window` trên luồng giao diện. Trong 0.2.10, callback lấy popup có sẵn rồi gọi `queue_popup_slot`. Hàm này gọi `run_on_main_thread`; khi đã ở luồng giao diện, Tauri có thể chạy closure ngay tại chỗ. Closure đó tạo thêm controller WebView2 trong khi sự kiện `NewWindowRequested` vẫn đang được xử lý. Đây là đường chạy gây tái nhập WebView2 và khớp với cửa sổ trắng bị treo đã quan sát.

## Thay đổi trong 0.2.11

- Đưa việc nạp popup dự phòng sang async runtime.
- Chờ 100 ms để callback WebView2 kết thúc, sau đó mới đăng công việc tạo popup lên luồng giao diện.
- Giữ nguyên việc dùng chung WebView2 environment và chính sách chỉ nhận `about:blank` hoặc URL HTTPS không nhúng thông tin đăng nhập.

## Kiểm thử và trạng thái

- Rust: lần kiểm thử trước trên source 0.2.11 đạt **18/18**. Khi xác nhận lại tại workspace hiện tại, `cargo test` dừng trước khi chạy test vì build script của `whisper-rs-sys` trả lỗi ở bước CMake.
- TypeScript: `npm run typecheck` đạt.
- Vitest: `npm test` đạt, **22 file, 87/87** test.
- Vite build: `npm run build` đạt trong lần xác nhận lại này. Tauri release build và đóng gói NSIS Windows của 0.2.11 đã đạt trước đó.
- Installer 0.2.11: `release/LinguaHub-AI-Pro-Setup-0.2.11.exe`, 8.550.933 byte, SHA-256 `D7F94A8E73C9E8F427C16B06A6A8063440441199D9D8B4DCC265B6A90832BDA0`.
- Installer chưa ký số; Windows có thể hiện cảnh báo SmartScreen.
- Kiểm tra runtime 0.2.11 trên Windows: sau khi vào lại bảng điều khiển Arito, cửa sổ `about:blank` thoáng xuất hiện rồi được chuyển thành tab LinguaHub **Thành viên**. Tab nạp trang `https://id.arito.vn/app?id=sysuserinfo` và bảng dữ liệu hiển thị; cửa sổ popup riêng không còn trong danh sách cửa sổ. Không sửa dữ liệu ERP.
- Hộp thoại quyền gửi chữ chat đến ChatGPT đã được từ chối; kiểm tra ERP không cần và không gửi nội dung chat đến AI.
