# M1A / M7K trong Office ERP

Panel Hồ sơ ERP có hai nút mở công cụ trong tab ERP đang xem:

- Đối chiếu M1A: mở phiếu M1A; đối chiếu dữ liệu và hồ sơ M7K liên kết bằng lõi bookmarklet hiện có.
- Dashboard M7K / ĐKKN: mở grid ĐKKN/M7K, nhập số ĐKKN trong popup; đọc các mẫu đang tải và OCR tuần tự. Không tự chuyển trang.

Nguồn: ARITO-TTM/giam-dinh-file-checker/m1a-extension/m1a-extension.js, v3.0.49. Giữ copyright Nguyễn Quốc Việt. Bản Office có patch tích hợp 1; không sửa source ARITO-TTM gốc. Office thay START_MODE thành dkkn khi mở dashboard M7K.

Kiểm tra source gốc và cả bốn bản bookmarklet đã xuất đều thấy phần body M1A bị thiếu. Bản Office khôi phục các vùng dữ liệu/nút mà logic đang dùng, tách Google Vision OCR và Gemini đối chiếu file, bổ sung test lưu/xóa đúng key. Bỏ observer/interval tự mount lặp gây vòng cập nhật DOM; wrapper chỉ khởi chạy khi người dùng bấm và tái tạo sau khi ERP dựng lại DOM.

SHA-256 source gốc (UTF-8 như đọc từ đĩa): 09303f0ab9fa642b6221222c80aab1ee63613803f94156afc9abfeba7f4cee25.

Tauri chỉ nhận hai mã công cụ cố định, kiểm tra tab hiện tại và controller DOM trước khi chạy script đóng gói. Không nhận JavaScript tùy ý từ renderer, không tìm rồi chạy trên tab ERP ẩn.

Công cụ gốc chỉ VIEW/đọc; người dùng chủ động chạy OCR trong popup. Gemini/Google Vision có cấu hình key/model riêng theo origin ERP, không tự chuyển key Office vào trang. Luồng nạp 5 ảnh GDTTM là bookmarklet khác, chưa nằm trong hai nút này.

Chưa build EXE cho thay đổi này. Chạy npm run dev -- --port 1421 rồi mở http://127.0.0.1:1421/erp-tools-preview.html để xem giao diện dev. Fixture dùng popup/lõi thật với controller giả lập, chặn toàn bộ fetch; không có dữ liệu ARITO hoặc key thật. Kiểm tra giao diện bằng fixture chỉ chứng minh thao tác panel; cần kiểm tra lại trên phiên ARITO thực để xác nhận đọc dữ liệu và OCR.
