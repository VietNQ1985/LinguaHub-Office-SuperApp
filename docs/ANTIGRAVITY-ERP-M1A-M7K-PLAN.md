# Bàn giao Antigravity: tích hợp M1A và M7K vào Office ERP

> Cập nhật: người dùng đã yêu cầu Codex trực tiếp triển khai. Bản này giữ làm kế hoạch tham khảo; xem ERP-M1A-M7K-PROGRESS.md cho kết quả thực tế.

Ngày giao: 07/11/2026. Người yêu cầu: VietNQ. Antigravity triển khai; Codex theo dõi và review kết quả.

## Mục tiêu và giới hạn

Tích hợp hai luồng bookmarklet đã có vào panel ERP của LinguaHub Office SuperApp desktop:
1. M1A: đọc phiếu, đối chiếu Cont/Xe/Mooc/Seal và hồ sơ M7K liên kết.
2. M7K/ĐKKN: dashboard đọc các mẫu trên grid đang tải, OCR tuần tự, nhập đúng số ĐKKN và đối chiếu kết quả.

Sau triển khai phải chạy test và mở giao diện dev cho người dùng xem. CHƯA build EXE, installer hoặc release; không cài đè ứng dụng.

M7K có một bookmarklet khác để nạp 5 ảnh GDTTM đã xác thực vào dòng mẫu. Chưa có xác nhận người dùng chọn luồng upload này; khảo sát và ghi đề xuất riêng, không tự chạy upload hoặc Lưu phiếu.

## Repo và hiện trạng bàn giao

- Repo: https://github.com/VietNQ1985/LinguaHub-Office-SuperApp
- Local: C:\Users\VietNguyenQuoc\.codex\visualizations\2026\11\06\01a1b145-74bf-7dd0-9baa-6e195a6d29c2\LinguaHub-Office-SuperApp
- Nhánh đã tạo: codex/erp-bookmarklet-integration, từ commit 9ea9a9f của nhánh Antigravity hiện có.
- Đọc git status và git diff trước. package-lock.json đã có thay đổi trước tác vụ này; không reset hoặc ghi đè.
- Codex đã tạo mã khởi đầu CHƯA KIỂM CHỨNG: src-tauri/erp-tools/m1a-m7k.js, command erp_bookmarklet_launch trong commands.rs, đăng ký trong lib.rs, bridge/type trong main.tsx, ErpBookmarkletPanel.tsx và test, thêm panel vào SampleFilePanel.tsx, docs/erp-bookmarklet-integration.md.
- Các mã khởi đầu trên cần review, sửa hoặc hoàn thiện; không coi là hoàn thành. Chưa chạy test sau các thay đổi này.
- Giữ các tiện ích AI, ERP, PDF exporter, Gemini parser và các thay đổi Antigravity đã làm. Repo AI Pro gốc ở D:\Documents\ChatGPT\LinguaHub-AI-Pro nằm ngoài phạm vi sửa.

## Source bookmarklet và nghiệp vụ cần giữ

Nguồn gốc chỉ đọc:
- C:\Users\VietNguyenQuoc\Documents\ARITO-TTM\giam-dinh-file-checker\m1a-extension\m1a-extension.js (VERSION 3.0.49).
- scripts/build-dkkn-bookmarklet.js: cùng lõi, thay START_MODE từ m1a sang dkkn để mở dashboard M7K/ĐKKN.
- DKKN-BOOKMARKLET-README.md và các tests/fixture cùng thư mục.
- m7k-bookmarklet.js là luồng nạp 5 ảnh khác, không nhầm với dashboard OCR.

M1A chỉ đọc/VIEW phiếu và hồ sơ liên kết; không sửa, xóa, Lưu hoặc in ARITO. M7K/ĐKKN đọc các dòng đang tải, không tự đổi trang. Không đoán Sample Code, số ĐKKN hoặc Seal không có trong nguồn. Giữ phiên bản và copyright nguồn.

## Các bước triển khai

### A. Khảo sát và chốt đường đi dữ liệu

Đọc source mới nhất và test gốc để xác nhận controller/form, các field, file đính kèm, luồng OCR và kết quả. Ghi ánh xạ M1A -> M7K/ĐKKN -> mẫu -> ảnh -> đối chiếu -> trích nguồn. Xác nhận không có source mới hơn trước khi vendor. Tạo checksum để truy nguyên source.

### B. Tích hợp Tauri có kiểm soát

Hai action cố định được gọi từ panel, chỉ chạy trên tab ERP người dùng đang xem. Kiểm tra màn hình/controller trước khi chạy, báo lỗi dễ hiểu nếu sai hoặc chưa đăng nhập. Không nhận JavaScript tùy ý từ renderer, không chạy nhầm tab ẩn, không tự quét nền khi mở panel. Nút bấm lặp lại phải mở lại công cụ hiện có thay vì tạo observer/popup trùng.

Review scaffold hiện có, đặc biệt wrapper eval, callback xác nhận popup thực sự mở, SPA navigation, đóng/mở lại, nhiều tab và cleanup. Nếu cần chỉnh lõi bookmarklet, lưu rõ phần khác biệt để cập nhật source sau này.

### C. Bố trí trong panel ERP

Đặt nhóm M1A/M7K ở vị trí dễ thấy, không chìm dưới danh sách file dài. Hiển thị công cụ phù hợp màn hình, bước tiếp theo và trạng thái. Giữ luồng chọn Sample ID, file tools, PDF exporter, nút AI/Cài đặt. Có trạng thái đang mở, lỗi và thử lại; chặn double click khi đang xử lý.

### D. AI, dữ liệu và quyền

Mặc định không tự gửi ảnh/chữ lên cloud. Chỉ chạy OCR khi người dùng yêu cầu trong popup. Scaffold dùng cấu hình Gemini/Google Vision riêng theo origin ERP; ghi rõ khác với cấu hình Office. Không tự sao chép key Office vào localStorage/trang ERP, không log hoặc đưa key vào Git. Nếu đề xuất dùng chung cấu hình qua backend, mô tả rõ consent và cách giữ key ở backend trước khi đổi luồng.

Chỉ lưu lịch sử/kết quả vào AI Memory khi người dùng bật đúng phạm vi; nguồn trích dẫn phải liên kết đúng phiếu/mẫu/ảnh. Trạng thái Cloud cần đúng provider và đúng quyền thủ công/nền; kiểm tra lại các điểm Codex đã nêu trong review trước.

### E. Kiểm thử và trình diễn

- Typecheck, tests liên quan panel/bridge/controller guard, bộ test hiện có; cargo check hoặc cargo test phù hợp, không đóng gói EXE.
- Test thiếu tab, sai màn hình, đúng M1A, đúng M7K, nhiều tab, chuyển trang SPA, mở lại popup, hủy thao tác, lỗi OCR/quota/model và double click.
- Test giao diện dev: các nút có thể thao tác, trạng thái/lỗi, panel hẹp và chuyển ERP/AI/Cài đặt; lưu screenshot.
- Phân biệt rõ fixture/mock với test Tauri/WebView2 và dữ liệu ARITO thực. Không dùng kết quả fixture để kết luận OCR thực đã đạt.
- Test ARITO thực chỉ đọc trên phiên người dùng đã mở. Nếu cần gửi ảnh thực ra cloud, dùng quyền đúng phạm vi và ghi rõ dữ liệu dùng; không tự upload, sửa, Lưu, xóa, in phiếu.
- Mở dev UI cho anh xem, báo lệnh/URL/tiến trình đang chạy. Không gọi dist, tauri build, build-windows hoặc phát hành/cài installer.

## Báo cáo và phối hợp với Codex

Cập nhật docs/ERP-M1A-M7K-PROGRESS.md sau mỗi mốc A, B, C-D, E hoặc khi bị chặn. Ghi giờ cập nhật, commit, file sửa, kết quả test và đường dẫn screenshot; không ghi key hay dữ liệu riêng tư.

Hoàn tất: commit đúng file của tác vụ trên nhánh đã bàn giao, tạo PR riêng dựa trên nhánh Antigravity hiện tại nếu các PR trước chưa merge. Báo base/head chính xác để diff không lẫn công việc cũ. Không merge.

Codex sẽ đọc progress/diff/test artifact, review lỗi nghiệp vụ và quyền dữ liệu, cập nhật người dùng rồi yêu cầu sửa nếu còn vấn đề. Antigravity báo rõ mốc đã xong, mốc còn thiếu và bằng chứng; không chỉ báo “done”.
