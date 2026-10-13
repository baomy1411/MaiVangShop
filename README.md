# Hà Thanh Tâm – Vườn Mai Vàng

Website bán mai vàng dùng Node.js, Express và PostgreSQL (Neon miễn phí). Giao diện đã được làm mới theo nhận diện xanh lá – vàng, có logo chữ Hà Thanh Tâm, thiết kế responsive cho điện thoại và máy tính.

## Chạy trên máy
1. Cài Node.js bản LTS: https://nodejs.org
2. Tạo cơ sở dữ liệu miễn phí tại https://neon.com, sao chép chuỗi kết nối (Connection string).
3. Sao chép `.env.example` thành `.env`, điền `DATABASE_URL` và các giá trị khác.
4. Mở thư mục này trong VS Code, mở Terminal (Ctrl + `), chạy `npm install`.
5. Chạy `npm run dev` (hoặc `node --env-file=.env server.js`), mở http://localhost:3000.

Lần chạy đầu, terminal sẽ in email và mật khẩu quản trị. Đăng nhập rồi vào mục **Quản trị**. Nên đặt `ADMIN_EMAIL`, `ADMIN_PASSWORD` và `JWT_SECRET` bằng biến môi trường trước khi triển khai.

## Trước khi đưa website lên mạng
- Thông tin liên hệ (98/120 Bùi Văn Ba, Quận 7; 0938 333 540) nằm ở `SHOP` đầu `public/app.js` và chân trang `public/index.html`.
- Thay thông tin chuyển khoản trong `public/app.js` bằng ngân hàng, số tài khoản và tên chủ tài khoản chính xác; hiện đang để lời nhắc, không phải thông tin thanh toán thật.
- Thêm ảnh sản phẩm vào `public/img/`; trong **Quản trị → Sản phẩm**, điền đường dẫn ảnh như `/img/mai-01.jpg`.
- Thêm địa chỉ vườn/cửa hàng, khu vực giao hàng, phí vận chuyển, lịch giao, chính sách đổi/trả và thông tin liên hệ thực tế.
- Hosting phải chạy được Node.js (ví dụ Render). Netlify chỉ host file tĩnh nên không chạy được website này. Dữ liệu nằm ở Neon Postgres nên không mất khi deploy lại; đặt `DATABASE_URL` trong biến môi trường của hosting.
- Bật HTTPS, đặt `NODE_ENV=production`, dùng `JWT_SECRET` riêng và bảo vệ biến môi trường. Sao lưu cơ sở dữ liệu định kỳ.
- Kiểm tra đặt hàng, tồn kho, tài khoản quản trị và giao diện trên điện thoại trước khi công bố.

## Ảnh sản phẩm
Chép ảnh vào `public/img/`, sau đó nhập đường dẫn `/img/ten-anh.jpg` khi thêm hoặc sửa sản phẩm trong trang quản trị.

## Cấu hình nâng cao (biến môi trường)
- `BASE_URL`: địa chỉ website thật, ví dụ https://tenmien.com (dùng cho email và VNPay).
- Phí giao hàng: `SHIP_FEE` (mặc định 30000), `FREE_SHIP_FROM` (mặc định 2000000, miễn phí giao từ mức này).
- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `SHOP_EMAIL` (email nhận thông báo đơn mới). Chưa cấu hình thì nội dung email được in ra Terminal.
- VNPay: `VNPAY_TMN`, `VNPAY_SECRET`, `VNPAY_URL` (mặc định là sandbox thử nghiệm). Đăng ký merchant tại VNPay, khai báo IPN URL là `BASE_URL/api/payment/vnpay-ipn`.
- Chuyển khoản QR: điền `SHOP.bank` đầu file `public/app.js`.
