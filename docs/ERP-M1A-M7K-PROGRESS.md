# Tiến độ tích hợp ERP: M1A / M7K

Cập nhật 07/11/2026 bởi Codex trên nhánh `codex/erp-bookmarklet-integration`. Chưa tạo installer hoặc build EXE.

| Mốc | Trạng thái | Bằng chứng / ghi chú |
|---|---|---|
| A. Khảo sát bookmarklet và ánh xạ nghiệp vụ | Hoàn tất | Dùng lõi M1A/M7K v3.0.49; giữ copyright Nguyễn Quốc Việt; source ARITO gốc không sửa. SHA-256 ghi trong `erp-bookmarklet-integration.md`. |
| B. Tích hợp Tauri, đúng tab/controller | Hoàn tất | Hai mã công cụ cố định; chỉ chạy trên tab ERP đang xem và đúng controller hiển thị. M1A và M7K mở popup riêng trong webview ERP. |
| C. Panel Office ERP | Hoàn tất | Thêm nút M1A và Dashboard M7K/ĐKKN vào panel hồ sơ; chống bấm lặp, bỏ kết quả cũ khi đổi workspace. |
| D. Ranh giới dữ liệu/AI | Hoàn tất phần tích hợp | Không gửi dữ liệu cho đến khi người dùng bấm OCR/đối chiếu trong popup; key lưu riêng theo trang ERP. Fixture chặn fetch. Chưa chạy dữ liệu thật hoặc OCR thật. |
| E. Kiểm thử và giao diện dev | Hoàn tất trên fixture | M1A và M7K mở đúng, trường key và thao tác hiện đủ; console sau sửa có 0 lỗi/0 cảnh báo. Ảnh trong `docs/screenshots/erp-m1a-popup.png` và `erp-m7k-popup.png`. |

## Kết quả kiểm tra

- `npm test`: 32 file, 116 test đạt.
- `npm run typecheck`: đạt.
- `npm run version:check`: đạt, version 0.4.2 đồng bộ.
- `npm run build`: đạt; chỉ build frontend Vite, không build Tauri/EXE.
- `cargo check --lib` (Windows): đạt; có một cảnh báo import `PathBuf` chưa dùng trong `src-tauri/src/db.rs`, không thuộc phần tích hợp.
- `npm run dev -- --port 1421`: fixture đang mở tại `http://127.0.0.1:1421/erp-tools-preview.html`. Đây là controller giả lập, không chứng minh ERP thật, không chạy OCR và không gửi dữ liệu nghiệp vụ.

Không chạy `cargo test --release` hoặc build installer trong lượt này. Cần kiểm thử riêng trên phiên ARITO thật trước khi xác nhận đọc phiếu/OCR thực tế.
