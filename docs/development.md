# Hướng dẫn đọc code, sửa và kiểm chứng

## Bắt đầu từ tác vụ

| Tác vụ | Thứ tự file nên đọc | Test gần nhất |
|---|---|---|
| Menu/điều hướng/form | App.jsx → navigation.jsx → page → api.js | Build client, kiểm tra quyền và rời form |
| User/session/phân quyền | auth-rbac-spec → access-control → middleware/auth → route → auth.jsx | auth-*, access-control, self-profile, security-middleware |
| Bot/config/copy/bulk | routes/bots → bot-directory → account-config-view → models | bot-directory, account-config-view |
| Tìm signal | SignalSearchPage → config-search → account_statics | config-search |
| Thêm/gỡ signal | SignalSetupPanel → routes/signal-setup → lib/signal-setup | signal-setup |
| Số liệu lệnh/ví | account-statics / account-ledger / system-summary | account-statics, account-ledger, system-summary |
| Position | PositionsPage → routes/positions → position-ws/live/cache → positions | positions |
| AI/dashboard | DashboardPage → routes/dashboard → dashboard-ai/brief/dashboard | dashboard |
| Lịch sử/Hệ thống | AuditLogsPage/SystemHealthPage → routes → lib → models | audit, runtime-logs, system-health |
| Deploy | update.sh → deploy.sh → ecosystem.config.cjs → deploy/nginx*.conf | `npm run test:deploy` |

Các file client ở [client/src](../client/src), backend ở [server/src](../server/src), test ở [server/test](../server/test).

## Quy trình thay đổi

1. Đọc [AGENTS](../AGENTS.md), kiểm tra `git status`; giữ nguyên thay đổi có sẵn.
2. Ghi chuỗi page → endpoint → middleware → hàm nghiệp vụ → collection/dịch vụ ngoài → nơi đọc kết quả.
3. Tìm các call site bằng `rg`; không suy ra endpoint từ tên menu. Đọc test mô tả các nhánh allow/deny và legacy.
4. Vá đúng lớp: quyền ở server, UI chỉ phản ánh quyền; query scope trước khi tổng hợp dữ liệu. Không đổi định nghĩa số liệu ở một màn hình mà quên nguồn khác.
5. Test đúng tác động, cập nhật docs liên quan; kiểm tra diff không lẫn secret/dữ liệu vận hành.
6. Commit riêng và push theo rule repo. Chỉ push phần được phép, không tự reset, force-push hoặc gộp thay đổi của người khác.

## Chạy kiểm tra

```sh
# Một module
node --test server/test/config-search.test.js

# Backend, frontend, script deploy
npm --prefix server test
npm --prefix client run build
npm run test:deploy

git diff --check
```

Tests có mock/query giả để kiểm tra logic; test pass không chứng minh Mongo production, API sàn, Nginx/TLS hoặc WebSocket qua proxy đang hoạt động. Muốn kiểm chứng integration phải dùng môi trường được phép và ghi rõ điều đã/ chưa thử. Không chạy entry server local với dữ liệu thật chỉ để kiểm tra import: startup có bootstrap admin và job ghi snapshot/index.

## Checklist xem dữ liệu bằng tay

- Chưa login: `/api/auth/me` trả 401; CSRF endpoint trả JSON/cookie; sau login `/me` trả session.
- Cùng user/role nhưng khác menu: reload session, kiểm tra permission trả từ server và commit/frontend đã deploy.
- Bốn tab Signal: test riêng lịch sử, tìm, thống kê, cấu hình; bước ghi cần account/config thử nghiệm.
- Position: kiểm tra REST và WS riêng, account được phép, sổ live/paper, fresh/stale và fallback; không mở/đóng lệnh để thử màn chỉ đọc.
- Lịch sử: nhìn request thật `/api/audit-logs` hoặc `/api/runtime-logs`, filter và response; đừng thử endpoint đoán tên.
- Số liệu: kiểm tra audience, env, UTC, openTime/closeTime, paper và nguồn DB trước khi so sánh.

## Chẩn đoán vận hành

| Triệu chứng | Kiểm tra đầu tiên |
|---|---|
| 403 trang chủ từ Nginx | `/var/www/web-bot/index.html` có tồn tại, quyền đọc và root đúng site |
| CSRF báo không lấy được token | Network: status/content-type `/api/auth/csrf`; 502 là upstream, HTML 200 có thể route API rơi vào SPA |
| 403 khi POST | Origin có đúng CLIENT_ORIGIN, HTTPS, cookie và X-CSRF-Token không; không tắt CSRF để chữa proxy |
| Backend crash Cannot find module | Dependency khai báo ở server/package.json + lock, npm ci trong đúng server, không chỉ npm install ở gốc |
| Local khác server | Commit đang chạy, deploy đã hoàn tất, hash index build so với Nginx root, PM2 cwd, session và DB/filter |
| Runtime/Lịch sử trống | Đúng collection, bot producer đang ghi, khoảng thời gian và scope; 200 rỗng không tự là lỗi |
| Position không realtime | Network WS có upgrade 101, proxy Upgrade/Connection, Redis snapshot/version/at, trạng thái fallback |
| Hệ thống báo stale | Heartbeat thực tế, thời gian máy, version/tuổi snapshot; không coi health HTTP 200 là mọi process khỏe |
| Redis unavailable | Kiểm tra REDIS_URL và dịch vụ; memory fallback là giảm chức năng, không phải xác nhận Redis đang chạy |

Lệnh chẩn đoán đọc-only trên server:

```sh
git log -1 --oneline
pm2 status web-bot
pm2 logs web-bot --lines 50 --nostream
curl --fail http://127.0.0.1:4000/api/health
ls -l /var/www/web-bot/index.html
sha256sum client/dist/index.html /var/www/web-bot/index.html
sudo nginx -t
```

Log có thể chứa thông tin vận hành; che token, credential và dữ liệu cá nhân trước khi chia sẻ. Không dump `.env`, PM2 env hoặc Mongo document chứa credential vào issue.

## Khi sửa docs

Đổi route thì cập nhật [API](api-data-reference.md); đổi menu/hành vi thì cập nhật [tính năng](feature-spec.md); đổi cách truyền/lưu dữ liệu thì cập nhật [luồng](flows.md) và [kiến trúc](architecture.md). Auth giữ [spec authoritative](auth-rbac-spec.md). Không biến docs tổng quan thành bản sao toàn bộ field map dễ lỗi thời.
