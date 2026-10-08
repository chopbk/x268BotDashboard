# Deploy trên Debian

Mô hình: domain HTTPS → Nginx → frontend `/var/www/web-bot`; `/api/*` → Express `127.0.0.1:4000` → MongoDB của bot. PM2 chỉ quản lý app `web-bot`, một instance. Bot giao dịch chạy riêng.

Hướng dẫn dành cho Debian 12/13 với user có quyền sudo. Thay `bot.example.com` bằng domain thật. Chạy npm/PM2 bằng cùng một user thường; chỉ các bước hệ thống dùng sudo. Nếu máy đã chạy bot, giữ nguyên Node/PM2 của bot đó; có thể dùng user riêng cho dashboard để không ảnh hưởng.

Chưa có domain: làm bước 1–3, rồi dùng [HTTPS cho IP](#https-cho-ip-khi-chưa-có-domain) thay bước 4.

## 1. Chuẩn bị máy (một lần)

Trỏ DNS A về IP server; nếu có AAAA thì IPv6 cũng phải tới đúng server. Cho phép TCP 80/443 trên firewall/security group, giữ cổng SSH đang dùng. MongoDB cần truy cập được từ server; không mở MongoDB/Redis ra Internet.

```sh
sudo apt update
sudo apt install -y git curl ca-certificates rsync nginx certbot python3-certbot-nginx
```

Cần Node.js >= 22, khuyến nghị 24 LTS. Nếu chưa có, cài bằng nvm dưới user chạy dashboard theo [hướng dẫn nvm](https://github.com/nvm-sh/nvm#installing-and-updating), rồi:

```sh
nvm install 24
nvm use 24
node --version
npm install -g pm2
```

Với shell SSH mới, chọn lại `nvm use 24` nếu Node mặc định của user là phiên bản khác. Xem [Node.js download](https://nodejs.org/en/download).

## 2. Clone source và cấu hình

```sh
git clone https://github.com/chopbk/x268BotDashboard.git "$HOME/web-bot"
cd "$HOME/web-bot"
cp .env.example .env
chmod 600 .env
nano .env
```

Nếu repo private, cấp quyền clone/pull bằng SSH deploy key hoặc GitHub credential helper; không nhúng token vào URL hay file commit.

Điền các giá trị riêng trong `.env`:

```dotenv
MONGODB=mongodb://127.0.0.1:27017/YOUR_BOT_DATABASE
WEB_JWT_SECRET=REPLACE_WITH_RANDOM_SECRET
WEB_ADMIN_EMAIL=admin@example.com
WEB_ADMIN_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
CLIENT_ORIGIN=https://bot.example.com
REDIS_URL=
```

Sinh JWT secret bằng `openssl rand -hex 32`. Dùng URI MongoDB thật (kèm xác thực nếu cần), đúng database của bot. Không dùng secret/mật khẩu minh họa. Admin được tạo khi chưa có admin hoạt động; thay mật khẩu bootstrap không đổi mật khẩu admin đã tồn tại. Redis có thể để trống cho một instance.

`ecosystem.config.cjs` đặt cố định `NODE_ENV=production`, `WEB_HOST=127.0.0.1`, `WEB_PORT=4000`, `WEB_TRUST_PROXY=true`; các giá trị này ưu tiên hơn `.env`. Secret và `CLIENT_ORIGIN` được app đọc từ `.env`, không đặt chúng trong PM2 config. Port 4000 phải chưa bị process khác sử dụng. Nếu cần đổi port, cập nhật đồng bộ PM2, Nginx và URL health trong script.

## 3. Deploy app

Tạo thư mục static do user hiện tại sở hữu, Nginx có quyền đọc:

```sh
sudo install -d -m 755 -o "$(id -un)" -g "$(id -gn)" /var/www/web-bot
cd "$HOME/web-bot"
npm run deploy
```

Script triển khai commit đang checkout; không tự pull, không đọc/in secret, không sửa Nginx và không restart các PM2 app khác. App chạy bình thường sẽ tự đọc `.env`. Script yêu cầu checkout sạch, cài dependency, chạy test server, build client, start/restart PM2, đợi health thành công rồi xuất frontend. Asset cũ được giữ để tab trình duyệt đang mở vẫn tải được; `index.html` được thay cuối cùng bằng rename.

Đường dẫn static mặc định là `/var/www/web-bot`. Nếu dùng `DEPLOY_WEB_ROOT=/duong/dan/khac npm run deploy`, phải sửa `root` trong Nginx tương ứng. Script không dùng sudo.

```sh
curl --fail http://127.0.0.1:4000/api/health
pm2 status web-bot
pm2 startup
```

Chạy câu lệnh sudo mà `pm2 startup` in ra, rồi `pm2 save`. Nếu user đã có startup service đúng Node hiện tại thì không cần tạo lại. Nếu sau này đổi Node, cập nhật startup hook theo [tài liệu PM2](https://pm2.keymetrics.io/docs/usage/startup/).

## 4. Nginx và HTTPS (một lần)

```sh
cd "$HOME/web-bot"
sudo cp deploy/nginx.conf /etc/nginx/sites-available/web-bot
sudo nano /etc/nginx/sites-available/web-bot
```

Đổi `server_name bot.example.com` thành domain thật, rồi:

```sh
sudo ln -s /etc/nginx/sites-available/web-bot /etc/nginx/sites-enabled/web-bot
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d bot.example.com --redirect
sudo certbot renew --dry-run
```

Lệnh tạo symlink chỉ chạy lần đầu. Certbot cần domain truy cập được qua port 80. Xem [Certbot trên Debian](https://manpages.debian.org/bookworm/certbot/certbot.1.en.html). Kiểm tra lịch tự gia hạn bằng `systemctl list-timers --all | grep certbot`.

```sh
curl --fail https://bot.example.com/api/health
```

Mở domain bằng HTTPS, đăng nhập admin và thử tải lại một trang con. Cookie production yêu cầu HTTPS. Nginx giữ nguyên `/api`; backend chỉ bind loopback, tin đúng một proxy hop. Nếu thêm CDN/load balancer phía trước, cần thiết kế lại việc xác định IP thật thay vì tin tùy ý header gửi vào.

## 5. Cập nhật những lần sau

Chạy trên Debian bằng đúng user đã khởi động PM2:

```sh
cd "$HOME/web-bot"
npm run update
```

`npm run update` chạy `scripts/update.sh`: kiểm tra checkout sạch và upstream, pull bằng `git pull --ff-only`, rồi chạy bản `scripts/deploy.sh` vừa cập nhật. Nếu pull lỗi thì dừng, không deploy. Server chưa có lệnh này cần chạy `git pull --ff-only` một lần để lấy script. Dùng `npm run deploy` khi muốn deploy code hiện tại mà không pull.

Không copy đè Nginx mẫu sau khi Certbot đã cấu hình HTTPS. `.env` vẫn được giữ vì không nằm trong Git. Script có restart backend nên có gián đoạn ngắn; không phải deploy không downtime.

## Khi deploy lỗi

- Test/build thất bại: chưa restart backend và chưa xuất frontend. Dependency trong checkout có thể đã đổi.
- Health thất bại: frontend cũ được giữ; backend có thể đã restart và lỗi. Xem `pm2 logs web-bot --lines 100`, kiểm tra MongoDB và `.env`. Script không tự rollback.
- Checkout bẩn: kiểm tra `git status`, không dùng reset/clean để xóa thay đổi chưa hiểu rõ.
- Lock còn sau khi process bị kill/mất điện: chỉ khi chắc chắn không còn deploy chạy, xóa thư mục lock rỗng bằng `rmdir "$(git rev-parse --git-path web-bot-deploy.lock)"`.

Muốn chạy lại commit tốt đã biết, checkout commit đó rồi deploy (chỉ khi không có thay đổi chưa commit):

```sh
git switch --detach GOOD_COMMIT
npm run deploy
```

Sau khi xử lý nguyên nhân, `git switch main` rồi pull/deploy lại. Rollback code không rollback dữ liệu MongoDB.

## Redis chưa cài

Để `REDIS_URL=` trong `.env` nếu chưa có Redis. Restart bằng `pm2 restart web-bot --update-env`; health sẽ báo `rateLimitStore: "memory"`. Nếu URL Redis còn được export trong shell hoặc lưu trong môi trường PM2, cần gỡ giá trị đó vì nó ưu tiên hơn `.env`.

Redis không bắt buộc cho một instance. Bản cũ có lỗi gọi `destroy()` trên client đã đóng sau khi kết nối thất bại, làm xuất hiện `[main] The client is closed`. Pull bản sửa rồi deploy lại; nhánh fallback giữ backend hoạt động khi Redis không sẵn sàng.

## HTTPS cho IP khi chưa có domain

Theo [Let’s Encrypt](https://letsencrypt.org/2026/03/11/shorter-certs-certbot), có thể cấp chứng chỉ cho IP công khai bằng Certbot >= 5.4 với webroot. Chứng chỉ IP có hạn 6 ngày nên phải bật tự gia hạn. Cookie production của dashboard vẫn dùng HTTPS; không đổi sang development để đăng nhập qua HTTP.

Các lệnh dưới đây chạy trên Debian, sau bước deploy app. Thay IP minh họa bằng IP thật:

```sh
cd "$HOME/web-bot"
WEB_PUBLIC_IP=192.0.2.10
```

Đặt `CLIENT_ORIGIN=https://IP_THAT` và `REDIS_URL=` (nếu chưa cài Redis) trong `.env`, rồi `pm2 restart web-bot --update-env`. Mở port 80/443 trên firewall/security group.

**1. Nginx HTTP để xác minh quyền sở hữu IP:**

```sh
sed "s/bot.example.com/$WEB_PUBLIC_IP/g" deploy/nginx.conf | sudo tee /etc/nginx/sites-available/web-bot > /dev/null
sudo ln -sfn /etc/nginx/sites-available/web-bot /etc/nginx/sites-enabled/web-bot
sudo nginx -t && sudo systemctl reload nginx
```

**2. Cài Certbot mới trong venv riêng**, tránh phụ thuộc bản cũ từ apt và không thay công cụ đang dùng cho website khác:

```sh
sudo apt install -y python3-venv
sudo python3 -m venv /opt/certbot-ip
sudo /opt/certbot-ip/bin/pip install --upgrade 'certbot>=5.4'
sudo /opt/certbot-ip/bin/certbot --version
sudo /opt/certbot-ip/bin/certbot certonly --config-dir /etc/letsencrypt-ip \
  --webroot --webroot-path /var/www/web-bot \
  --preferred-profile shortlived \
  --ip-address "$WEB_PUBLIC_IP" --cert-name web-bot-ip
```

Nhập email và chấp nhận điều khoản khi Certbot hỏi. Dùng `certonly --webroot` cho IP; không dùng quy trình `--nginx -d DOMAIN` ở bước domain.

**3. Chỉ sau khi cấp chứng chỉ thành công, cài Nginx HTTPS:**

```sh
sed "s/192.0.2.10/$WEB_PUBLIC_IP/g" deploy/nginx-ip.conf | sudo tee /etc/nginx/sites-available/web-bot > /dev/null
sudo nginx -t && sudo systemctl reload nginx
curl --fail "https://$WEB_PUBLIC_IP/api/health"
```

Mở `https://IP_THAT` để đăng nhập. HTTP được chuyển sang HTTPS, còn đường dẫn ACME vẫn dùng được để gia hạn.

**4. Bật tự gia hạn và reload chứng chỉ:**

```sh
sudo cp deploy/web-bot-cert-renew.service deploy/web-bot-cert-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now web-bot-cert-renew.timer
sudo /opt/certbot-ip/bin/certbot renew --config-dir /etc/letsencrypt-ip --cert-name web-bot-ip --dry-run
systemctl list-timers web-bot-cert-renew.timer
```

Timer kiểm tra hai lần/ngày và reload Nginx sau khi gia hạn thành công. Kiểm tra lỗi bằng `journalctl -u web-bot-cert-renew.service`; phải giữ port 80 truy cập được. Chứng chỉ IP được lưu riêng trong `/etc/letsencrypt-ip` nên không ảnh hưởng timer Certbot cũ và chứng chỉ của website khác.
