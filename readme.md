# Bot Dashboard

Web dashboard quản lý và theo dõi hệ thống bot giao dịch. Frontend dùng React/Vite; backend dùng Express và MongoDB. Dashboard đọc dữ liệu của bot và cập nhật cấu hình được cấp quyền; tiến trình bot giao dịch chạy riêng.

## Chức năng

- Quản lý bot, account và cấu hình giao dịch: volume, đòn bẩy, TP/SL, trailing, danh sách signal.
- Theo dõi lịch sử signal, giao dịch, hiệu suất và lãi lỗ ví.
- Quản lý thông tin API sàn, tài khoản web và quyền truy cập theo phạm vi.
- Xem lịch sử chỉnh sửa; hỗ trợ sao chép và đồng bộ cấu hình.

## Chạy local

Cần Node.js/npm và MongoDB. Redis là tùy chọn cho rate limit dùng chung.

```sh
npm --prefix server ci
npm --prefix client ci
cp .env.example .env
```

Điền `.env` ở thư mục gốc:

- `MONGODB`: URI database của bot.
- `WEB_JWT_SECRET`: chuỗi ngẫu nhiên mạnh, ít nhất 16 ký tự.
- `WEB_ADMIN_EMAIL`, `WEB_ADMIN_PASSWORD`: bootstrap admin khi chưa có admin hoạt động; mật khẩu ít nhất 8 ký tự.
- `WEB_PORT`: port backend, mặc định `4000`.
- `CLIENT_ORIGIN`: origin frontend, local là `http://localhost:5173`.
- `REDIS_URL`: để trống nếu dùng rate limit trong bộ nhớ.
- `WEB_TRUST_PROXY`: chỉ bật khi chạy sau reverse proxy được kiểm soát; backend tin một proxy hop.

Chạy trong hai terminal:

```sh
npm run dev:server
```

```sh
npm run dev:client
```

Mở `http://localhost:5173`. Vite chuyển request `/api` sang backend.

## Kiểm tra và production

Hướng dẫn đầy đủ: [Deploy trên Debian](docs/deploy-debian.md), gồm cài Node.js/PM2, cấu hình MongoDB, Nginx, HTTPS và tự khởi động sau reboot.

Sau khi chuẩn bị server theo hướng dẫn, cập nhật bằng:

```sh
npm run update
```

Lệnh `update` pull code mới bằng `git pull --ff-only` rồi chạy script deploy. Script chạy trên server, kiểm tra checkout sạch, cài dependency, test/build, restart riêng PM2 `web-bot`, kiểm tra health rồi xuất frontend vào `/var/www/web-bot`. Dùng `npm run deploy` nếu chỉ muốn triển khai commit đang checkout, không pull.

```sh
npm --prefix server test
npm --prefix client run build
npm run test:deploy
```

Phục vụ `client/dist` bằng Nginx hoặc static server hỗ trợ SPA fallback về `index.html`. Proxy `/api` sang backend và giữ nguyên tiền tố `/api`.

Chạy backend bằng `NODE_ENV=production npm --prefix server start`, hoặc quản lý `server/src/index.js` bằng PM2. Cấu hình `CLIENT_ORIGIN` đúng domain, bật HTTPS để cookie đăng nhập production hoạt động và giới hạn truy cập trực tiếp backend khi dùng reverse proxy.

Health check: `GET /api/health`. Thay đổi cấu hình có thể cần restart tiến trình bot để được áp dụng.

## Dữ liệu riêng tư

Không commit `.env`, API key, mật khẩu, token, log hoặc bản sao database. Dữ liệu vận hành được đọc từ MongoDB; các tên signal trong ví dụ/test là dữ liệu minh họa. Việc sửa source không xóa nội dung đã có trong lịch sử Git.
