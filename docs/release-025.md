# Sửa form mở tab và đường dẫn Windows 0.2.5

Ảnh người dùng cho thấy window.prompt của UI WebView2 bị child webview Zalo che phần nhập và nút. Thay prompt của nút ＋ và 📂 bằng form React; native command ui_form_open chỉ dành cho UI ẩn child webviews trong lúc form mở. Khi đóng form, khôi phục layout; khi xác nhận mở đường dẫn, chuyển sang hộp xác nhận native hiện có. Tạm ngừng đọc vùng chat trong lúc form hoặc hộp xác nhận đang ẩn trang.

Form tab có URL HTTPS và tên tab, mặc định ERP Arito. Form đường dẫn có ô nhập, Hủy, Tiếp tục; có điều hướng bàn phím Tab/Escape và trạng thái xử lý/lỗi. Lỗi tạo tab không thêm tab rỗng vào danh sách.

Kiểm tra: TypeScript đạt, 87 test frontend đạt (gồm hide/restore, gửi URL ERP mặc định, hủy bằng Escape không mở file), 15 test Rust đạt. Native WebView2 với phiên Zalo thật chưa được kiểm tra lại; kết quả build cuối báo riêng.
