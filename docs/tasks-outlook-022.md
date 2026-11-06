# Công việc và Outlook 0.2.3

## Hành vi

Gợi ý công việc nằm ngay đầu panel của WhatsApp, Teams, Zalo Web và Outlook. Bấm **Gợi ý công việc** để phân tích chat/email đang hiển thị; chỉ nội dung đó được gửi đến mô hình đã chọn. Không có yêu cầu AI tự chạy khi có tin mới. Cùng nội dung, cùng mô hình chỉ được phân tích một lần cho mỗi lượt đang mở.

Đề xuất phải có trích dẫn khớp nguồn, được gộp theo tên, có **Thêm/Bỏ** ngay trong panel. Chỉ bấm Thêm mới lưu. Không tự đặt hạn từ ngôn ngữ mơ hồ. Đổi ứng dụng, chat hoặc nội dung sẽ hủy tác vụ còn chạy và xóa đề xuất cũ.

Tab **Công việc** là nơi quản lý danh sách đã lưu: thêm nhanh, tìm kiếm, lọc nguồn, Hôm nay (gồm việc đến hạn và quá hạn), Quá hạn, Quan trọng, Đang làm, Đã xong. Chọn một việc mở khung chi tiết: ghi chú, checklist tối đa 30 bước, hạn hoàn thành và giờ nhắc riêng. Hoàn thành nhanh bằng checkbox; giữ được công việc 0.2.1.

Nhắc hạn tiếp tục dùng SQLite và thông báo chung của 0.2.1: cần app chạy, hoạt động khi ẩn dưới khay; khi mở lại kiểm tra các nhắc chưa phát. Không chứa tiêu đề/trích dẫn công việc trên toast.

## Outlook

Bộ đọc ưu tiên UniqueMessageBody trong ngăn đọc, giữ đoạn và danh sách, loại danh sách thư, thư ẩn và vùng soạn. Nội dung dài chia thành phần nhỏ cho luồng dịch hiện có. Quyền đọc được kiểm tra lại theo dịch vụ; nếu Outlook chưa cấp quyền, nút Bật dịch hiển thị thay cho trạng thái đang dịch cũ. Sự kiện dịch vụ được phát sau khi native workspace đã mở xong để kiểm tra đúng dịch vụ.

## Nguồn tham khảo thiết kế

- [Todoist Inbox](https://www.todoist.com/help/todoist/get-started/use-the-inbox-in-todoist-HwHvYErS): thu thập đầu việc trước khi tổ chức.
- [Todoist filters](https://www.todoist.com/help/todoist/features/introduction-to-filters-V98wIH): tìm và lọc theo nhu cầu.

## Kiểm tra

Typecheck và 83 test frontend đạt; 13 test Rust đạt. Playwright kiểm tra hiển thị và thêm đề xuất với dữ liệu mẫu, đã lưu ảnh ở output/playwright. Lỗi console duy nhất trong harness là favicon không có (404). Native installer được build riêng. Chưa xác minh lại bản dịch AI trên email riêng của tài khoản thật sau khi cài bản mới; không gửi dữ liệu riêng trong quá trình kiểm thử.
