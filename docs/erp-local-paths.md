# Tab ERP và đường dẫn Windows

Nút ＋ mở nhiều tab HTTPS, mặc định https://id.arito.vn/app?id=appdrawer. Các tab dùng phiên WebView2 của ứng dụng. Danh sách tab hiện chỉ giữ trong lần chạy; lần mở sau có thể tạo lại tab, phiên đăng nhập vẫn do WebView2 lưu.

Nút 📂 cho nhập đường dẫn đầy đủ đến file, folder, ổ mapping hoặc UNC. Mỗi lần mở đều xác nhận đường dẫn. Chỉ .exe trực tiếp được chạy; không nhận tham số lệnh, script, shortcut hoặc đường dẫn thiết bị. File thông thường dùng ứng dụng mặc định của Windows.

ERP có thể tạo liên kết bằng JavaScript:

```js
const path = String.raw`Z:\Tai lieu\bao cao.xlsx`;
location.href = 'linguahub-local://open?path=' + encodeURIComponent(path);
```

Liên kết này chỉ được xử lý trong tab web tùy chỉnh của LinguaHub. Không cần đăng ký protocol toàn Windows. Người dùng xác nhận mỗi lần; tab web không có quyền gọi lệnh Tauri. Nút ERP hiện có không tự thay đổi: cần dùng liên kết trên hoặc nút 📂. Popup ERP hiện chưa hỗ trợ; có thể mở URL HTTPS thành tab riêng bằng ＋.

Ổ mapping/UNC cần khả dụng với tài khoản Windows đang chạy ứng dụng. Không tự đăng nhập ổ mạng hoặc nâng quyền. Chưa kiểm thử với ERP Arito đăng nhập thật, ổ mạng thật hoặc chương trình .exe của người dùng.
