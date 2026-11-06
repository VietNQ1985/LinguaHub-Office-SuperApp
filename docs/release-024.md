# LinguaHub 0.2.4

- Panel tự tìm việc sau 1,8 giây khi nội dung ổn định, chỉ đọc vùng đang mở với quyền hiện có. Không tự lưu. Giới hạn 3 gợi ý; Thêm, Sửa, Bỏ. Nội dung đã phân tích được ghi nhớ tối đa 100 mục trong RAM để hạn chế gửi lại.
- Sửa gợi ý gồm người giao (chỉ tự điền nếu có tên khớp nguyên văn nguồn), hạn, ghi chú, Chờ phản hồi, giờ nhắc. Hạn mơ hồ giữ nguyên trong ghi chú để người dùng xác nhận; không tự chuyển thành ngày.
- Trùng tên việc chưa hoàn thành: đề nghị cập nhật và xem trước. Chưa có đối sánh ngữ nghĩa giữa các tên việc khác nhau. Lưu cập nhật giữ ID, trạng thái và checklist hiện có.
- Công việc có bộ lọc Chờ phản hồi; người giao được sửa và hiển thị trong danh sách. Nhắc hạn cần app đang chạy.
- ＋ mở tối đa 20 tab HTTPS với tên tùy chọn, mặc định Arito. Danh sách tab lưu cục bộ để bấm mở lại sau khi khởi động. Chưa tự khôi phục trang hiện tại sau khi điều hướng; dùng địa chỉ ban đầu. Phiên đăng nhập do WebView2 lưu.
- Nút 📂 mở đường dẫn Windows sau xác nhận, gồm ổ mapping và UNC. .exe chạy trực tiếp không truyền tham số; chặn script, shortcut, đường dẫn thiết bị. ERP có thể dùng protocol nội bộ mô tả trong erp-local-paths.md. Không tự sửa các nút ERP hiện có.

Kiểm tra: TypeScript đạt, 85 test frontend đạt; 15 test Rust của 0.2.4 đạt. Chưa kiểm thử đăng nhập Arito thật, folder UNC/mapping thật hoặc chạy exe người dùng; không thực hiện các hành động đó khi build. Kết quả build cuối được báo riêng.
