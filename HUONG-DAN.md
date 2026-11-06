# LinguaHub Office SuperApp 0.2.16 — Hướng dẫn sử dụng

LinguaHub gom các ứng dụng nhắn tin/họp (WhatsApp, Telegram, Microsoft Teams, Outlook, Zalo Web, Zoom, Google Meet) vào một cửa sổ. Khung bên phải dịch tin nhắn sang tiếng Việt, gợi ý câu trả lời bằng tiếng Anh và có phụ đề cuộc họp.

Có 2 bản, chức năng giống nhau:

| | Bản Tauri (Rust) — khuyên dùng | Bản Electron |
|---|---|---|
| Thư mục | `LinguaHub-Office-SuperApp` | `LinguaHub-AI-Pro` |
| RAM | nhẹ hơn (~500–750 MB khi mở vài app) | nặng hơn (~800 MB+) |
| Nhận dạng giọng nói | whisper.cpp chạy trên máy, nhanh (1–2 giây) | transformers.js trong trình duyệt, chậm hơn |

---

## 1. Lần mở đầu tiên: chọn ứng dụng

Màn hình **"Anh dùng ứng dụng nào?"** hiện ra. Tick các app cần dùng rồi bấm tiếp. App nào chưa chọn sẽ không được tải, để tiết kiệm RAM.

Muốn đổi sau này: **Cài đặt → 🧩 Ứng dụng và quyền → Ứng dụng**.

Mỗi app đăng nhập như trên trình duyệt (quét QR WhatsApp/Zalo/Telegram, tài khoản Microsoft/Google). Phiên đăng nhập được lưu lại cho lần sau.

## 2. Dịch tin nhắn

1. Mở một cuộc trò chuyện.
2. Ở khung phải, bấm **Bật dịch** và cho phép LinguaHub đọc chữ trong chat. Quyền này nằm trong **Cài đặt → Ứng dụng và quyền**.
3. LinguaHub đọc các tin **đang hiển thị trên màn hình**: không chụp màn hình, không đọc chat đang ẩn.
   - Tin tiếng Việt được bỏ qua.
   - Ngôn ngữ khác được dịch sang tiếng Việt, mô hình AI tự nhận ra ngôn ngữ.
4. Bấm vào một dòng dịch để xem câu gốc.

## 3. Trả lời

Thẻ **Trả lời** có ba nút trên một hàng:

- **Nói** 🎙: nói tiếng Việt, app chuyển thành chữ.
- **Dịch**: dịch câu tiếng Việt anh gõ sang tiếng Anh theo ngữ cảnh cuộc chat.
- **Gợi ý**: tạo 3 câu trả lời dựa trên các tin đang hiển thị.

Mỗi gợi ý có các nút:

- **➤ Gửi**: dán thẳng câu vào ô chat của app đang mở và gửi đi. Hãy kiểm tra đúng người nhận trước khi bấm.
- **Sửa**: đưa câu vào ô soạn để chỉnh.
- **Nghe**: đọc to câu tiếng Anh.
- **Chép**: sao chép câu.

Bấm vào phần tiếng Việt của gợi ý để xem đầy đủ nghĩa.

## 4. Gọi điện Zalo

Zalo Web không có tính năng gọi. Trong tab Zalo Web có nút 📞 (gọi thoại) và 🎥 (gọi video). Khi bấm:

1. LinguaHub mở **Zalo PC** (phải cài sẵn).
2. Tìm đúng tên người đang chat. Nếu tìm ra **đúng 1** người thì bấm gọi.

> ⚠ Zalo PC chỉ đăng nhập được 1 tài khoản. Cuộc gọi luôn đi từ tài khoản đang mở trên Zalo PC. Nếu anh dùng nhiều tài khoản Zalo, hãy chuyển Zalo PC sang đúng tài khoản trước khi bấm gọi.

## 5. Cuộc họp (Teams / Zoom / Meet)

- **Teams:** bật phụ đề có sẵn của Teams. LinguaHub đọc phụ đề đó rồi dịch, nên nhẹ máy nhất.
- **Zoom / Meet:** bật **Phụ đề cuộc họp**. LinguaHub nghe âm thanh máy tính và nhận dạng giọng nói ngay trên máy, rồi dịch.
- Chat trong cuộc họp cũng được đọc và gợi ý trả lời như chat thường.

## 6. Cài đặt

Cài đặt chia thành 5 nhóm:

- **🧩 Ứng dụng và quyền:** chọn app; cấp quyền đọc chat và quyền gửi nội dung lên AI đám mây.
- **🤖 AI:**
  - **Chọn mô hình:** mô hình dịch và mô hình gợi ý trả lời có thể khác nhau.
  - **Nguồn AI:**
    - **Ollama trên máy:** miễn phí, không gửi dữ liệu ra ngoài. Mặc định dùng `qwen2.5:7b`, chiếm khoảng 3 GB RAM khi đang dùng và tự nhả sau 3 phút rảnh.
    - **ChatGPT:** đăng nhập bằng tài khoản ChatGPT trả phí. Tài khoản Free sẽ báo lỗi.
    - **Gemini:** cần API key.
    - **Máy AI riêng:** máy chủ tương thích OpenAI, ví dụ qua ngrok.
- **🎙 Giọng nói** (bản Tauri):
  - Chọn mô hình cho nút **Nói** (khuyên dùng **PhoWhisper Small** cho tiếng Việt) và cho **Phụ đề cuộc họp** (khuyên dùng **Whisper Small**).
  - Mô hình tải một lần từ huggingface.co, app hỏi trước khi tải.
- **🎨 Giao diện.**
- **🔒 Riêng tư, thông báo và dữ liệu:**
  - Che email/số điện thoại trước khi gửi AI đám mây.
  - Thông báo tin nhắn mới: bấm vào thông báo sẽ nhảy tới đúng app.
  - Thời hạn giữ dữ liệu học; xoá dữ liệu trên máy.

## 7. Học tiếng Anh

Gồm từ vựng rút ra từ các cuộc chat, lịch ôn, bài học trong ngày và luyện nói (ghi âm rồi nghe lại).

## 8. Quyền riêng tư

- Bản Office SuperApp lưu dữ liệu tại `%APPDATA%\com.linguahub.office.superapp`; hồ sơ WebView2 và phiên đăng nhập nằm trong `%LOCALAPPDATA%\com.linguahub.office.superapp`. Các thư mục này tách biệt với LinguaHub AI Pro 0.2.16.
- Bản Office SuperApp tạo kho SQLite mới, không tự dò hoặc sao chép dữ liệu từ LinguaHub AI Pro hay bản Electron. Muốn chuyển dữ liệu thì cần một quy trình nhập riêng có xác nhận của người dùng.

- Không lưu nội dung chat, mật khẩu hay cookie vào cơ sở dữ liệu của app.
- API key và token ChatGPT được mã hoá bằng Windows (DPAPI) và chỉ dùng được trên máy này, dưới tài khoản Windows này.
- Dùng Ollama và nhận dạng giọng nói trên máy thì không có gì gửi ra ngoài. Dùng ChatGPT/Gemini thì chữ tin nhắn được gửi tới nhà cung cấp đó, và app hỏi xác nhận riêng trước.

## 9. Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| ChatGPT báo `invalid_grant` / không kết nối | Tài khoản ChatGPT Free không dùng được; dùng tài khoản Plus/Pro hoặc chuyển sang Ollama. |
| Không dịch | Kiểm tra đã **Bật dịch** và đã cấp quyền đọc chat; Ollama phải đang chạy. |
| Nút Nói chậm lần đầu | Lần đầu phải tải mô hình (150–500 MB); các lần sau 1–2 giây. |
| App hiện "Tải WhatsApp cho Windows" | LinguaHub đã tự ẩn các quảng cáo tải app; nếu trang đổi giao diện thì báo để cập nhật. |
| Gọi Zalo không được | Cài và đăng nhập Zalo PC đúng tài khoản; tên liên hệ phải tìm ra duy nhất 1 người. |
| RAM cao | Bỏ bớt app không dùng trong **Ứng dụng**; app ẩn đã tự chuyển sang chế độ ít bộ nhớ. |


## Bổ sung 0.2.1: Outlook, công việc và nhắc hạn

- Outlook: mở email rồi bật dịch. Bộ đọc lấy phần thư đang mở; không đọc danh sách hộp thư hoặc thư nháp. Các đoạn dài được chia để dịch. Cần kiểm tra trên Outlook thực tế vì giao diện Microsoft có thể đổi selector.
- Khay hệ thống: icon có chấm đỏ khi bất kỳ ứng dụng được theo dõi nào có tin chưa đọc; rê chuột để xem tổng số. Đọc hết thì dấu đỏ biến mất.
- Trong panel của WhatsApp, Teams, Zalo Web hoặc Outlook, bấm **Gợi ý công việc** để AI tìm việc trong chat/email đang hiển thị. Xem trích dẫn rồi bấm **Thêm** hoặc **Bỏ**; không tự lưu. Tab **Công việc** dùng để quản lý việc đã lưu, hạn, checklist và giờ nhắc.
- Công việc và trích dẫn đã lưu nằm trong SQLite trên máy. Không gửi công việc sang AritoActive, lịch Google hoặc Outlook.
- Nhắc hạn hoạt động khi app đang chạy (kể cả ẩn dưới khay). Đóng hoàn toàn hoặc tắt máy thì không thể nhắc; khi mở lại, các nhắc chưa phát được kiểm tra lại. Thông báo chỉ báo có việc đến hạn, không chứa nội dung công việc. Bấm thông báo mở mục Công việc.
- Xóa dữ liệu cục bộ cũng xóa toàn bộ công việc. Hoàn thành công việc sẽ bỏ nhắc. Đổi giờ nhắc cho phép nhắc lại; giữ nguyên giờ thì không lặp.

Kiểm tra tự động: frontend 79 test đạt; typecheck/build đạt. Kiểm tra Rust và đóng gói được ghi trong báo cáo thực hiện. Chưa xác minh đầy đủ DOM Outlook, icon khay và Windows toast trên các phiên chat đăng nhập thật.


## 0.2.2: Tab Công việc riêng

Tab Công việc có ô thêm nhanh, tìm kiếm và bộ lọc. Chọn một việc để sửa ghi chú, checklist, hạn xử lý và giờ nhắc. Các bộ lọc nằm bên trái; việc đã hoàn thành ở Đã xong.

Outlook kiểm tra quyền riêng khi đổi tab. Nếu chưa đọc được thư, bấm **Bật dịch** để cấp quyền, rồi chọn một thư đang mở trong ngăn đọc.

## 0.2.3: Gợi ý công việc ngay trong panel

Mở chat hoặc email cần xử lý, cấp quyền đọc khi được hỏi, rồi bấm **Gợi ý công việc** ở đầu panel bên phải. AI chỉ chạy sau thao tác này; cùng nội dung và mô hình không bị gửi lặp. Mỗi gợi ý kèm trích dẫn nguồn để anh kiểm tra, sau đó bấm **Thêm** hoặc **Bỏ** ngay trong panel. Tab **Công việc** chỉ mở danh sách để quản lý hạn, nhắc hẹn, checklist và trạng thái.

Khi đổi chat, ứng dụng hoặc nội dung được cập nhật, gợi ý cũ bị xóa để tránh lưu nhầm ngữ cảnh. Việc đã lưu nằm cục bộ và không tự gửi sang AritoActive, lịch Google hoặc Outlook.
