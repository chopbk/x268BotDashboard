# Spec đăng ký, đăng nhập và phân quyền

Trạng thái: **authoritative**  
Phạm vi: `web-bot` client + server  
Cập nhật: 2026-10-07

Tài liệu này là nguồn chuẩn cho hành vi auth/RBAC. Code, UI và test phải cùng tuân thủ.
Nếu thay đổi có chủ đích làm khác tài liệu này, phải cập nhật tài liệu và regression test
trong cùng thay đổi.

## 1. Mục tiêu và ranh giới tin cậy

- Người dùng được tự đăng ký nhưng tài khoản mới không có quyền sử dụng bot.
- Admin duyệt tài khoản bằng cách đổi role và gán phạm vi bot.
- Server là nguồn quyết định quyền duy nhất. Client chỉ dùng permission để điều hướng và
  ẩn/hiện UI; việc ẩn UI không thay thế authorization ở API.
- Authentication trả lời câu hỏi “đây là ai”. Permission trả lời “được làm gì”.
  `botUsernames` trả lời “được làm trên bot nào”. Cả ba lớp phải được kiểm tra độc lập.

## 2. Dữ liệu user

Collection MongoDB: `web_users`.

| Field | Quy tắc |
|---|---|
| `email` | Bắt buộc, trim, lowercase, unique |
| `username` | Unique khi có; đăng ký mới bắt buộc; legacy user có thể chưa có |
| `telegramId` | Optional, unique khi có; ID Telegram ổn định dùng để link |
| `telegramUsername` | Optional; username Telegram đã bỏ `@`, lowercase; không dùng làm khóa ổn định |
| `phone` | Optional; số điện thoại đã bỏ khoảng trắng/ký tự phân cách |
| `passwordHash` | Bắt buộc; bcrypt 12 rounds; không bao giờ trả cho client |
| `name` | Bắt buộc, trim |
| `role` | Một trong các role tại mục 3 |
| `customPermissions` | Optional; danh sách quyền hiệu lực tùy chỉnh cho user thường |
| `botUsernames` | Danh sách username bot được truy cập; mặc định `[]` |
| `disabled` | Tài khoản bị khóa nếu `true`; mặc định `false` |
| timestamps | `createdAt`, `updatedAt` do Mongoose quản lý |

Model chuẩn: `server/src/models/web-user.js`. Danh sách role chuẩn không được khai báo
lặp lại; model và validator phải lấy từ `server/src/auth/access-control.js`.

## 3. Role và permission

Nguồn chuẩn duy nhất: `server/src/auth/access-control.js`.

### 3.1 Role lifecycle

| Role | Ý nghĩa | Được gán khi |
|---|---|---|
| `pending` | Đã đăng ký, chưa được duyệt, có 0 permission | Tự đăng ký |
| `viewer` | Chỉ xem dữ liệu được phép | Admin duyệt |
| `summary_viewer` | Chỉ xem số liệu tổng kết, không có danh sách chi tiết | Admin cấp |
| `member` | Xem bot/config/position do mình sở hữu | Admin cấp |
| `trader` | Xem và vận hành bot/config/position do mình sở hữu | Admin cấp |
| `collaborator` | Sửa của mình, xem tài nguyên được gán | Admin cấp |
| `operator` | Xem và sửa tài nguyên của mình hoặc được gán | Admin cấp |
| `supervisor` | Xem toàn hệ thống, chỉ sửa tài nguyên của mình | Admin cấp |
| `auditor` | Xem chi tiết toàn hệ thống, không sửa | Admin cấp |
| `admin` | Quản trị hệ thống và thấy mọi bot | Bootstrap hoặc admin khác cấp |
| `user` | Legacy, quyền tương đương `viewer` | Không cấp mới; giữ đến khi có migration |

Role không hợp lệ hoặc không xác định phải có 0 permission, không được fail-open.

### 3.2 Permission matrix

Permission được chia theo domain, không gắn trực tiếp vào màn hình:

| Domain | Permission |
|---|---|
| Tổng kết | `summary.view` |
| Bot | `bots.view`, `bots.create`, `bots.edit`, `bots.delete`, `bots.operate` |
| Config | `config.view`, `config.edit` |
| Signal/hiệu suất | `signals.history`, `statistics.view` |
| Position | `positions.view`, `positions.open`, `positions.close` |
| API | `credentials.view`, `credentials.manage` |
| User | `users.view`, `users.create`, `users.edit`, `users.permissions`, `users.disable`, `users.reset_password` |
| Log | `logs.view` |

`config.*` bao trọn `Account_Config`: signal, trade config, symbol blacklist/whitelist và
các thuộc tính config khác. `signals.view`, `signals.manage`, `users.manage` chỉ là alias
legacy để đọc dữ liệu cũ; không cấp mới qua UI.

Role chỉ là template permission + scope. Các role mới dùng quan hệ chủ sở hữu và được gán;
`viewer`/`user` giữ lại làm legacy với scope `assigned`. Admin luôn có toàn bộ quyền và
scope `all`. Pending luôn có 0 quyền.

Một permission được định nghĩa trước chưa có nghĩa là endpoint tương ứng đã tồn tại.
Khi thêm endpoint mới, phải gắn `requireAuth` và `requirePermission(...)` ở server.

### 3.3 Quyền tùy chỉnh theo user

- Role là template mặc định. User không có field `customPermissions` kế thừa toàn bộ
  permission của role.
- Với `viewer`, `operator` và legacy `user`, nếu `customPermissions` là một mảng thì mảng
  đó thay thế template role. Mảng rỗng có nghĩa là 0 quyền.
- `pending` luôn có 0 quyền, kể cả database chứa custom permission do dữ liệu lỗi.
- Mọi role khác `pending` luôn có `users.edit` và `users.reset_password` với scope `own`,
  kể cả khi `customPermissions` thay template. Hai quyền này chỉ đủ để sửa hồ sơ và
  mật khẩu của chính mình qua `PATCH /api/auth/me`, không mở trang quản trị user.
- `admin` luôn có toàn bộ permission của template admin; không được hạ quyền admin bằng
  custom permission vì sẽ phá invariant phục hồi/quản trị.
- Permission không xác định phải bị loại bỏ/fail-closed.
- Admin UI lấy catalog permission từ server, không duy trì một role map độc lập ở client.
- Đổi role mà không gửi custom permission phải reset về template role mới.

`credentials.view` và `credentials.manage` phải tách biệt. Quyền xem API/credential không
tự động cho phép sửa/xóa; các API chứa secret còn phải che/mask dữ liệu theo thiết kế
endpoint, không được hiểu permission xem là quyền trả raw secret mặc định.

### 3.4 Phạm vi bot

- Mỗi permission có scope độc lập trong `permissionScopes[permission]`:
  `all`, `assigned`, `own`, hoặc `own_assigned` tùy catalog server cho phép.
- `permissionScopes` phải lưu bằng object/Mongoose `Mixed`, không dùng Mongoose `Map`, vì
  permission key chứa dấu chấm như `config.view` và Map sẽ từ chối khi validate.
- `assigned` đối chiếu username tài nguyên với `webUser.botUsernames`; `own` đối chiếu
  user id/username/email của chính actor. Admin luôn có scope `all`.
- Permission có scope tài nguyên nhưng document cũ chưa có `permissionScopes` mặc định
  về `assigned`; đây là tương thích ngược an toàn, không fail-open.
- Quyền xem không suy ra quyền sửa và scope xem không dùng thay scope sửa. Ví dụ hợp lệ:
  `config.view=all`, `config.edit=assigned`.
- Với tài nguyên bot, `own` đối chiếu `user_accounts.ownerUserId`; `assigned` đối chiếu
  `web_users.botUsernames`; `own_assigned` là hợp của hai tập này.
- `user_accounts.visibility=private` là lớp bảo vệ bổ sung nằm trên permission scope.
  User thường có scope `all` vẫn không thấy tài nguyên private, trừ khi là owner hoặc
  được gán đích danh. Admin luôn thấy. Document cũ thiếu field được coi là `public`.
- `user_accounts.active` là cờ hiển thị trên tab Bot, không phải lớp quyền. Thiếu field
  được coi là đang active. Tắt cờ không chặn API và không đổi lệnh của bot.
- `pending` không có `bots.view`, nên không được gọi `/api/bots`, kể cả nếu dữ liệu lỗi
  khiến `botUsernames` không rỗng.
- Không được chỉ lọc bot ở client. Query và kết quả phải được giới hạn ở server.
- Nếu sau này thêm scope account/env, scope mới phải được kiểm tra thêm, không thay thế
  ngầm `botUsernames` nếu chưa có migration rõ ràng.

## 4. Đăng ký

`POST /api/auth/register` áp dụng rate limit theo IP + email/username: tối đa 5 lần
trong một giờ. Request vượt ngưỡng trả `429` và `Retry-After`.

### 4.1 Contract

`POST /api/auth/register` là public.

Request:

```json
{
  "name": "Nguyen Van A",
  "username": "nguyenvana",
  "email": "user@example.com",
  "password": "at-least-8-characters"
}
```

Server phải:

1. Trim `name`; normalize email và username bằng trim + lowercase.
2. Validate email, tên không rỗng, username và password dài tối thiểu 8 ký tự.
   Username dài 3-32 ký tự, bắt đầu bằng chữ/số và chỉ gồm `a-z`, `0-9`, `.`, `_`, `-`.
3. Bỏ qua mọi `role`, `permissions`, `botUsernames`, `disabled` do client cố gửi.
4. Hash password bằng bcrypt 12 rounds.
5. Tạo user với email/username unique và cố định `role: "pending"`,
   `botUsernames: []`, `disabled: false`.
6. Tạo JWT/cookie và trả session user, không trả `passwordHash`.

Đăng ký lần đầu thành công trả HTTP `201`.

### 4.2 Retry và double-submit

Đăng ký phải retry-safe đối với duplicate request:

- Client phải có khóa submit đồng bộ, không chỉ dựa vào state/render của React.
- Nếu insert gặp duplicate email hoặc username, server đọc chủ sở hữu của cả hai giá trị.
- Nếu cùng một user sở hữu email/username, user vẫn là `pending`, không bị khóa và
  password khớp, coi đây là retry
  của request đã thành công: tạo cookie, trả session với HTTP `200`.
- Với legacy pending account chưa có username, retry cùng email + đúng password được phép
  gắn username nếu username đó chưa thuộc user khác.
- Nếu email và username thuộc hai user khác nhau, password không khớp, user không còn
  `pending`, hoặc đã bị khóa: trả HTTP `409` với lỗi
  `Email hoặc username đã được sử dụng`.
- Không được reset password, đổi tên, đổi role hoặc đổi scope trong nhánh retry.

Đây là invariant đã có regression test. Không được đơn giản hóa mọi duplicate key thành
`409`, vì request đầu có thể đã tạo user trong khi client chỉ nhận kết quả request lặp.

### 4.3 UI sau đăng ký

- Đăng ký thành công tự đăng nhập và điều hướng `/`.
- User `pending` thấy `PendingPage`, không thấy menu bot/admin và không gọi `/api/bots`.
- Trang chờ phải cho phép logout.

## 5. Đăng nhập, session và logout

### 5.1 Login

`POST /api/auth/login` nhận `identifier`, `password`. `identifier` có thể là email hoặc
username. Server vẫn chấp nhận field `email` cũ như compatibility input.

Login áp dụng rate limit theo IP + identifier: tối đa 10 lần trong 15 phút. Các identifier
khác nhau có bucket riêng nhưng vẫn gắn với IP gửi request.

- Identifier được trim + lowercase. Nếu đúng định dạng email thì tìm theo email; ngược
  lại nếu đúng định dạng username thì tìm theo username.
- Sai định dạng, user không tồn tại, sai password hoặc `disabled: true` đều trả HTTP
  `401` với cùng thông báo `Email/username hoặc mật khẩu không đúng`.
- Việc verify user không tồn tại phải dùng dummy bcrypt hash để giảm timing leak.
- User `pending` được đăng nhập; trạng thái thiếu quyền do authorization xử lý.
- Thành công trả session user và set auth cookie.

### 5.2 JWT và cookie

- JWT chỉ chứa `sub` là user id. Không nhét role, permissions hoặc bot scope vào JWT.
- JWT hết hạn sau 12 giờ.
- Cookie tên `wb_token`, `httpOnly`, `sameSite: "lax"`, `path: "/"`.
- Cookie dùng `secure: true` khi `NODE_ENV=production`.
- `WEB_JWT_SECRET` phải dài tối thiểu 16 ký tự khi server khởi động.

Lý do JWT chỉ chứa `sub`: `requireAuth` phải đọc user mới nhất từ Mongo ở mọi request,
nhờ đó đổi role, scope hoặc `disabled` có hiệu lực ở backend ngay lập tức. Không cache
permission theo JWT trong 12 giờ.

### 5.3 Session response

`POST /login`, đăng ký thành công/retry và `GET /api/auth/me` trả:

```json
{
  "id": "mongo-object-id",
  "email": "user@example.com",
  "username": "nguyenvana",
  "telegramId": null,
  "telegramUsername": null,
  "phone": null,
  "name": "Nguyen Van A",
  "role": "pending",
  "permissions": [],
  "botUsernames": []
}
```

`permissions` luôn được server tính từ role, không đọc từ document hay request client.
Không trả `passwordHash`, `disabled`, token hoặc secret trong JSON.

### 5.4 Auth middleware và logout

- `requireAuth` đọc cookie, verify JWT, lấy user mới nhất từ Mongo, loại password hash.
- Thiếu/sai/hết hạn token, user không tồn tại hoặc bị khóa: HTTP `401`.
- `POST /api/auth/logout` xóa cookie với cùng cookie options và trả `{ "ok": true }`.
- Sau khi admin đổi role của một user đang đăng nhập, backend áp dụng ngay ở request kế;
  client có thể cần gọi lại `/me` hoặc reload để menu phản ánh permission mới.

### 5.5 CSRF

- `GET /api/auth/csrf` cấp cookie `wb_csrf` không `httpOnly` và trả token tương ứng.
- Mọi `POST`, `PATCH`, `PUT`, `DELETE` phải có `Origin` đúng `CLIENT_ORIGIN`, cookie
  `wb_csrf` và header `X-CSRF-Token` khớp nhau.
- Token được so sánh constant-time. Sai origin/token trả `403`; client phải lấy token
  trước mutation, kể cả login/register/logout.
- Mutation Bot, User và User API có thêm rate limit 60 request/phút theo IP + session;
  endpoint test credential/import/restore sau này phải dùng cùng lớp giới hạn này.

### 5.6 Giới hạn tải và request trùng

- Mọi `/api` bị giới hạn 300 request trong 5 phút theo IP.
- Mỗi endpoint bị giới hạn 60 request/phút theo IP + session; login/register vẫn giữ
  bucket nghiêm ngặt riêng theo identifier tại mục 4 và 5.1.
- Server chỉ nhận tối đa 40 request đồng thời toàn process và 8 request đồng thời cho
  một session; vượt ngưỡng trả `503` kèm `Retry-After`.
- API timeout sau 30 giây, JSON body tối đa 100 KB. Reverse proxy chỉ được tin khi đặt
  `WEB_TRUST_PROXY=true`; không bật nếu Node còn được truy cập trực tiếp từ Internet.
- Client debounce ô tìm kiếm, abort request cũ khi filter đổi và deduplicate request có
  cùng method, URL và payload trong thời gian request trước còn chạy.
- Có `REDIS_URL` thì rate limit dùng atomic counter + TTL trên Redis để mọi instance chia
  sẻ quota. Không cấu hình hoặc Redis tạm lỗi thì tự fallback về memory để giữ availability;
  `/api/health.rateLimitStore` cho biết store đang thực sự dùng là `redis` hay `memory`.

## 6. Quản trị user

Mọi route dưới `/api/admin/users` đi qua `requireAuth`, sau đó kiểm tra permission cụ thể:
list/catalog dùng `users.view`, tạo dùng `users.create`, sửa profile dùng `users.edit`,
đổi role/quyền/bot scope dùng `users.permissions`, khóa dùng `users.disable`, đổi password
dùng `users.reset_password`. Route quản trị chỉ nhận scope `all`. Scope `own` không so với
username bot và chỉ đủ để gọi `PATCH /api/auth/me`.

Không kiểm tra bằng chuỗi `role === "admin"` tại route. Role map sang permission tại
`access-control.js`.

Admin có thể:

- xem danh sách user, không có password hash;
- tạo user trực tiếp với username, mặc định `viewer` nếu không truyền role;
- gán Telegram ID, Telegram username và số điện thoại để link với người dùng thật;
- đổi tên, username, role, trạng thái khóa, password và `botUsernames`;
- dùng template của role hoặc chọn từng permission riêng cho user thường;
- duyệt đăng ký bằng cách đổi `pending` sang `viewer` hoặc `operator` và gán bot.

UI phải phản ánh từng quyền hành động: `users.view` chỉ hiển thị danh sách và chi tiết
read-only; không hiển thị form tạo nếu thiếu `users.create`, và không cho tương tác role,
permission, scope hay bot assignment nếu thiếu `users.permissions`. Tương tự, profile,
khóa tài khoản và đổi mật khẩu chỉ mở khi có permission tương ứng. Server vẫn là lớp
bảo vệ quyết định. `users.create` không tự bao gồm `users.permissions`: người chỉ có
quyền tạo chỉ được tạo user theo role mặc định, không được tự gửi role/quyền/scope.

Các invariant:

- Role, login username và bot username phải được server validate; đây là hai loại
  username khác nhau (`web_users.username` và bot `user_accounts.username`).
- Telegram ID nếu có phải là 5-20 chữ số và unique. Telegram username nếu có dài 5-32
  ký tự theo format Telegram; bỏ `@` và lowercase. Phone nếu có theo dạng quốc tế hợp lệ.
- Không lưu bot username không tồn tại.
- Phải luôn còn ít nhất một `admin` không bị khóa. Không được hạ role hoặc khóa admin
  hoạt động cuối cùng.
- UI không cho tự khóa chính mình, nhưng server invariant vẫn là lớp bảo vệ quyết định.
- `pending` chỉ xuất hiện trong select khi đang sửa tài khoản pending; không phải role
  mặc định khi admin chủ động tạo user.

## 7. Endpoint authorization hiện tại

| Endpoint | Auth | Permission/scope |
|---|---|---|
| `POST /api/auth/register` | Public | Luôn tạo `pending` |
| `GET /api/auth/csrf` | Public | Cấp token/cookie CSRF; không tạo session |
| `POST /api/auth/login` | Public | Không áp permission |
| `POST /api/auth/logout` | Public/idempotent | Xóa cookie |
| `GET /api/auth/me` | `requireAuth` | Không áp permission |
| `PATCH /api/auth/me` | `requireAuth` | `users.edit` cho tên, Telegram ID, Telegram username và số điện thoại. `users.reset_password` cho mật khẩu mới, bắt buộc đúng mật khẩu hiện tại. Không đổi email, username, role hay quyền. Không trả `passwordHash` |
| `GET /api/dashboard` | `requireAuth` | Không thêm permission riêng. Chỉ bot actor đang sở hữu hoặc được gán, kể cả admin. Không có `bots.view` thì các mục đều rỗng. `configs` chỉ khi có `config.view`. `profitToday` là lệnh đóng `account_statics`, không paper, theo `closeTime` trong ngày UTC. `incomeToday` là tổng `futures_profits.profit` của ngày UTC. API key thiếu chỉ khi có `credentials.view`, và response không trả key. Signal bị chặn chỉ khi có `logs.view`, lấy log `source=callHandleSignalBot` 7 ngày. Lỗi parse và signal bị gỡ chỉ khi có `config.view` hoặc `signals.history`. `mine` tối đa 5 bot |
| `GET /api/positions` | `requireAuth` | `positions.view` + scope từng bot. Chỉ xem. Query `account` ngoài phạm vi trả 403. Không trả API key, secret hay listenKey. Ghép theo tài khoản sàn + symbol + side/position mode. `positionAmt` của monitor là qty riêng; `position.positionAmt` là snapshot qty sàn. PnL sàn nằm một lần ở dòng cha. PnL monitor nếu có thì là ước tính. Live, paper, lệnh chờ và NOTPSL tách riêng. `closed: false` không đủ để hiện đang theo dõi; cần heartbeat monitor còn mới và `updatedAt` trong 90 giây |
| `GET /api/positions/ws` | `requireAuth` | WebSocket, cookie phiên. `positions.view` + scope đúng `account` trong message `watch` hoặc `resume`. Server gửi snapshot Redis đã lọc quyền, không gửi nguyên Pub/Sub. Message chỉ nhận `watch`, `resume`, `pause`. `pause` hoặc đóng socket thì ngừng subscribe tài khoản đó. Reconnect nhận lại snapshot vì Pub/Sub có thể mất sự kiện. Không nhận lệnh giao dịch |
| `GET /api/positions/detail` | `requireAuth` | `positions.view` + scope bot của monitor. Order thường/algo, fills, logs, stats và snapshot config. Order monitor là dự kiến; order trả từ sàn là đã xác nhận |
| `GET /api/summary` | `requireAuth` | `summary.view` hoặc `bots.view` hoặc `statistics.view`. `audience=mine` chỉ user bot đang active mà actor sở hữu hoặc được gán. `audience=system` (mặc định) lấy user bot active mà scope `bots.view` hoặc `statistics.view` cho phép, không dùng scope `summary.view`; bot private vẫn chỉ khi sở hữu hoặc được gán, trừ admin. Admin và `summary_viewer` với `audience=system` đọc snapshot toàn hệ thống. `audience=mine` luôn tính trực tiếp, không dùng snapshot chung. Mặc định hôm nay, `range=today\|3d\|7d\|30d\|90d\|all`, `today` là ngày UTC hiện tại. Position mở là `monitor_positions` có `closed` khác `true`, bỏ paper (`isPaper` hoặc `config.PAPER`). Profit, balance và ROI trong `userRanks` lấy `futures_profits` theo `day` UTC: profit cộng kỳ, balance và ROI là ngày cuối. Volume, số lệnh, win rate, profit thẻ và xếp hạng signal/symbol vẫn là `account_statics` lệnh đóng, không paper, theo `closeTime`. Signal trong kỳ là số tên signal khác nhau mà user bot trong phạm vi đã vào lệnh: `account_statics.typeSignal`, không paper, theo `openTime` |
| `POST /api/summary/refresh` | `requireAuth` | Cùng quyền với GET. Cùng `range` và `audience` với GET. Admin và `summary_viewer` khi `audience=system` tính lại snapshot dùng chung. Các trường hợp còn lại chỉ tính lại đúng phạm vi, không ghi đè snapshot hệ thống. Giới hạn 6 lần / 15 phút |
| `GET /api/signal-history` | `requireAuth` | `signals.history`; nhật ký signal của cả hệ thống từ `signal_infos`, không lọc theo user bot hay account config. Màn hình là tab Lịch sử trong Signal → Tìm Signal. Bấm một signal xem số lượng và lịch sử; nút Tìm config chuyển sang tìm config với đúng tên đó. Query `from`/`to` lọc `openTime`; không truyền thì chỉ 3 ngày gần nhất. Query `signal` lọc đúng một kênh; danh sách kênh để chọn vẫn lấy trong khoảng thời gian, không bị thu hẹp bởi chính bộ lọc đó |
| `GET /api/signal-config` | `requireAuth` | `config.view` hoặc `signals.history`. Danh sách user để thêm/xoá, và mục Signal đang dùng, chỉ lấy account của user bot đang sở hữu hoặc được gán. Danh sách chọn bỏ user `active === false`. `username` khác hai nhóm đó trả 403. Channel, lỗi parse và signal bị gỡ hiện ở tab Thống kê Signal. Channel chỉ trả tên, OCR, ảnh; không trả session, apiId, apiHash. Phạm vi không phải tất cả thì channel, lỗi parse và signal bị gỡ chỉ gồm signal/config được xem. Lỗi parse là log `source=parse` 7 ngày. Signal bị gỡ là log `source=autoremove` 14 ngày. `usage` gộp từng signal đang dùng: số config, số config đang bật, số config bật tự gỡ, có channel cùng tên hay không, số lỗi parse và số lần bị gỡ. `summary` đếm channel, signal, signal chưa có channel, lỗi parse và lần bị gỡ. `orphanChannels` là channel không trùng tên signal trên config của mình |
| `POST /api/signal-config` | `requireAuth` | `config.edit` + scope user, và user bot phải đang sở hữu hoặc được gán. `action=add` thêm signal, giữ signal cũ. `action=remove` chỉ gỡ các tên được gửi. Tối đa 40 config và 20 signal. Mỗi config đổi thật ghi audit `config.updated` |
| `GET /api/account-statics` | `requireAuth` | `statistics.view` + scope bot; lịch sử lệnh và bảng so sánh signal/config/side từ `account_statics`. Không truyền `book` thì sổ live, trừ khi mọi config đang chọn bật `trade_config.PAPER`: lúc đó mở sổ paper. `book=live\|paper\|all` là chọn tường minh, `copy=copy\|manual`, `closed=closed\|open`. Query `from`/`to` lọc `openTime`; không truyền thì chỉ 3 ngày gần nhất. Query `signal`, `status`, `profit` lọc danh sách và số tổng. Bảng signal giữ theo user, config, symbol, side và thời gian. `byConfig` nhóm theo config và có tính signal đang chọn, để so config live hoặc paper của cùng một signal. Gồm win rate, profit, ROI/cost, long/short, volume, max lãi/lỗ. `scope=mine` và `scope=assigned` là bot actor sở hữu hoặc được gán, chỉ user đang active. `scope=all` thêm bot mà `statistics.view` cho phép, vẫn bỏ user tắt. Popup Static trong ngày gửi `from`/`to` theo ngày UTC |
| `GET /api/account-statics/:id` | `requireAuth` | `statistics.view` + scope bot; chi tiết một lệnh `account_statics`. Query `username` bắt buộc; lệnh phải thuộc account config của user bot đó. Kèm `symbolInfo` (`tickSize`, `stepSize`, số thập phân) từ `futures_symbols`, không trả `marketInfo` |
| `GET /api/account-ledger` | `requireAuth` | `statistics.view` + scope bot. Lãi lỗ ví của user được xem: số dư, khả dụng, lãi lỗ chưa chốt, margin, income, nạp/rút/chuyển, đường số dư, trading PnL tách dòng tiền, so số dư DB với sàn. `days=7\|14\|30\|90`, mặc định 14. `username` chọn user; không truyền thì user của chính mình nếu có. Danh sách kèm `mine` và `active`: mặc định chỉ user của mình và đang active, tick mới thêm user khác hoặc account đang tắt. `scope=mine` và `scope=assigned` là income ngày UTC của bot sở hữu hoặc được gán, chỉ user đang active. `scope=all` thêm bot mà `statistics.view` cho phép, vẫn bỏ user tắt |
| `POST /api/account-ledger/:username/refresh` | `requireAuth` | `statistics.view` + scope bot. Gọi Binance futures của user đó cho ngày UTC hôm nay rồi ghi `futures_profits`. Không trả API key/secret. Giới hạn 6 lần / 15 phút |
| `GET /api/bots` | `requireAuth` | `bots.view` + scope riêng; phân trang server bằng `page`, `limit`, hỗ trợ `q`, `visibility`, `active`. `audience=mine` là bot actor sở hữu hoặc được gán. `audience=all` thêm bot mà `bots.view` cho phép. Màn danh sách bot luôn gửi `active=true` và sắp xếp bằng `sort=username|visibility|owner|configs`, `dir=asc|desc`. Không truyền `audience` thì giữ scope quyền, để màn gán user và tìm signal vẫn thấy bot được phép |
| `GET /api/bots/:username` | `requireAuth` | `bots.view` + scope; một user bot theo đúng tên, không phụ thuộc trang danh sách |
| `GET /api/bots/config-search` | `requireAuth` | `config.view`; `signal` là một hoặc nhiều tên cách nhau bởi dấu phẩy. Chỉ config của bot actor được xem. Hiệu suất lấy lệnh thật `account_statics` đúng các signal đó và bỏ config có 0 lệnh. Mỗi dòng kèm tóm tắt volume, mode, TP, SL và trailing. `days=1\|3\|7\|30\|90` hoặc `from`/`to`. Lọc thêm `minWinRate`, `minTrades`, `profit` với `profitOp=gt\|lt`, `q` theo user/config, `sort=recent\|profit\|winrate` |
| `POST /api/bots` | `requireAuth` | `bots.create=all`; creator là owner, chọn public/private |
| `PATCH /api/bots/:username` | `requireAuth` | `bots.edit` + scope; sửa tên/visibility/active, chỉ admin đổi owner |
| `DELETE /api/bots/:username` | `requireAuth` | `bots.delete` + scope riêng |
| `POST /api/bots/:username/accounts` | `requireAuth` | `config.edit` + scope; thêm env, tạo `Account_Config` nếu chưa có |
| `PATCH /api/bots/:username/accounts/:env` | `requireAuth` | `config.edit` + scope; đổi tên env |
| `DELETE /api/bots/:username/accounts/:env` | `requireAuth` | `config.edit` + scope; gỡ env, xoá `Account_Config` nếu không user bot nào còn giữ |
| `GET /api/bots/assigned-configs` | `requireAuth` | `config.view`. `scope=mine` (mặc định) là bot sở hữu hoặc được gán. `scope=all` thêm bot mà `config.view` cho phép. Chỉ user đang active |
| `GET /api/bots/:username/configs` | `requireAuth` | `config.view` + scope; tóm tắt On, Long/Short, signal, mode, volume của từng account |
| `GET /api/bots/:username/configs/:env` | `requireAuth` | `config.view` + scope; đủ field lệnh `/sc` (on, volume, open, tp, sl, trailing, copy, signal, blacklist, sync), không trả nguyên document |
| `POST /api/bots/:username/configs/bulk` | `requireAuth` | `config.edit` + scope; áp cùng một patch lên các env trong `envs` (tối đa 40). Field không gửi giữ nguyên. Mỗi config ghi audit `config.updated` |
| `PATCH /api/bots/:username/configs/:env` | `requireAuth` | `config.edit` + scope; chỉ `$set` field được sửa, không ghi đè cả `trade_config` |
| `POST /api/bots/:username/configs/:env/copy` | `requireAuth` | `config.view` trên nguồn, `config.edit` trên đích. `mode=new` tạo `Account_Config` mới. `mode=replace` ghi đè config đích đã có và gỡ sync của đích. `mode=sync` tạo config mới, chép nội dung nguồn và đặt `sync_from` về nguồn |
| `GET /api/user-apis` | `requireAuth` | `credentials.view` + scope riêng; phân trang server bằng `page`, `limit`, tìm bằng `q`. Response không có raw secret |
| `GET /api/user-apis/:username` | `requireAuth` | `credentials.view` + cùng scope. Chỉ trả cờ đã có key/secret/passphrase |
| `POST /api/user-apis` | `requireAuth` | `credentials.manage` + scope username; tạo document `user_apis` |
| `PATCH /api/user-apis/:username` | `requireAuth` | `credentials.manage` + scope; key/secret/passphrase để trống thì giữ giá trị cũ |
| `DELETE /api/user-apis/:username` | `requireAuth` | `credentials.manage` + scope; xoá document `user_apis`, không xoá user bot hay account config |
| `GET /api/admin/users` | `requireAuth` | `users.view` + scope; phân trang server bằng `page`, `limit`, tìm bằng `q` |
| Các `/api/admin/users/*` còn lại | `requireAuth` | permission `users.*` theo field/action và scope |
| `GET /api/admin/users/access-control` | `requireAuth` | `users.view`; trả catalog gồm group + allowedScopes và template role |
| `GET /api/audit-logs` | `requireAuth` | `logs.view`; scope `all`, `assigned`, `own` được lọc tại query server. Đây là lịch sử chỉnh sửa web, collection `web_audit_logs` |
| `GET /api/runtime-logs` | `requireAuth` | `logs.view`; log lỗi runtime của binance-bot trong `bot_runtime_logs`, giữ 30 ngày. Category `open`, `exchange`, `monitor`, `tpsl`, `listener`, `mqtt`, `signal`, `process`. Scope không phải `all` chỉ thấy log của bot user được gán và không thấy listener, MQTT, PM2 |
| `GET /api/system-health` | `requireAuth` | `logs.view` scope `all`. Heartbeat `bot_heartbeats`: MongoDB, Redis, MQTT, Telegram V1/V2, Discord, trader, monitor, signal, DCA/MTF, poster/webhook, PM2. Kèm RAM, CPU, restart, RUN, NODE_ENV, MQTT, TELE_CLIENT. Cảnh báo listener mất heartbeat, trader không nhận MQTT, monitor không heartbeat, position NOTPSL, snapshot lỗi hoặc quá hạn, Redis fallback memory, credential lỗi |

Quy ước HTTP:

- `400`: input không hợp lệ.
- `401`: chưa/xác thực không thành công.
- `403`: đã xác thực nhưng thiếu permission.
- `409`: xung đột email/username không thể coi là retry hợp lệ.
- `500`: lỗi nội bộ, không lộ chi tiết nhạy cảm.

## 8. Bootstrap admin

Khi server khởi động, `bootstrapAdmin` kiểm tra admin đang hoạt động:

- Nếu đã có ít nhất một active admin: không làm gì.
- Nếu chưa có: dùng `WEB_ADMIN_EMAIL` và `WEB_ADMIN_PASSWORD`.
- Nếu email bootstrap đã tồn tại, kích hoạt lại, đặt role `admin` và cập nhật password.
- Password bootstrap phải dài tối thiểu 8 ký tự.
- Không commit `.env` hoặc log password/secret.

Hành vi bootstrap là đường phục hồi quyền quản trị; không được xóa nếu chưa có cơ chế
recovery thay thế.

## 9. File ownership và luồng gọi

```text
RegisterPage/LoginPage
  -> client/src/auth.jsx
  -> /api/auth/*
  -> routes/auth.js
  -> password.js + token.js + WebUser
  -> sessionUser()
  -> AuthProvider user state
  -> App route/menu gating

Protected API
  -> requireAuth (cookie -> JWT sub -> Mongo user)
  -> requirePermission (server-side role -> permissions)
  -> optional resource scope via canAccessBot
  -> route handler

AdminUsersPage
  -> /api/admin/users
  -> requireAuth -> users.manage
  -> load permission catalog từ /api/admin/users/access-control
  -> validate profile/role/custom permissions/bots/last-active-admin
  -> WebUser

UserApisPage / UserApiDetailPage
  -> /api/user-apis
  -> requireAuth -> credentials.view hoặc credentials.manage
  -> scope botUsernames (admin qua users.manage thấy tất cả)
  -> user_apis, không trả raw secret
```

SignalHistoryPage dùng hai nguồn tách biệt: `signal_infos` là nhật ký signal của cả hệ thống,
không lọc theo user bot hay account config; `account_statics` là kết quả giao dịch thực tế
của từng `env`. Không suy diễn profit từ SignalInfo và không dùng `Signal_History` legacy
làm nguồn chuẩn. Tab Account Static query theo User bot thì lấy hợp các env thuộc
`user_accounts.accounts`; query theo Account Config thì env đó phải thuộc User bot đã được
authorize. UI mở tab Account Static trước. Ô User bot mặc định chỉ user của người đang xem và đang active; chọn Người khác mới hiện user active còn lại mà họ được phép xem. Bấm một dòng để xem chi tiết lệnh; giá vào, giá đóng và TP dùng `tickSize` của `futures_symbols` để giữ đúng số thập phân. UI có tab riêng để lọc/phân trang.

File chuẩn:

- Role/permission map: `server/src/auth/access-control.js`
- Password hashing: `server/src/auth/password.js`
- JWT/cookie: `server/src/auth/token.js`
- Authentication/authorization middleware: `server/src/middleware/auth.js`
- Public auth API: `server/src/routes/auth.js`
- Admin user API: `server/src/routes/admin-users.js`
- Audit writer/redaction: `server/src/lib/audit.js`
- Audit model/API: `server/src/models/audit-log.js`, `server/src/routes/audit-logs.js`
- Bot scope API: `server/src/routes/bots.js`
- Tóm tắt account config: `server/src/lib/account-config-view.js`
- User API: `server/src/routes/user-apis.js`, `server/src/lib/user-api-directory.js`
- Safe response shape: `server/src/lib/public-user.js`
- Client session state: `client/src/auth.jsx`
- Client route/menu gating: `client/src/App.jsx`

## 10. Quy tắc khi mở rộng

Khi thêm tính năng được bảo vệ:

1. Thêm permission vào `PERMISSIONS` nếu chưa có.
2. Gán permission cho role rõ ràng trong `ROLE_PERMISSIONS`.
3. Khai báo group và `allowedScopes` trong catalog server.
4. Gắn `requireAuth` + permission cụ thể và kiểm tra scope của chính permission đó.
5. Client dùng permission từ session để hiển thị UI, nhưng không được coi đó là bảo mật.
6. Thêm test cho allow và deny, bao gồm `pending`, `disabled` và ngoài scope.
7. Cập nhật bảng endpoint/permission trong tài liệu này.

Không được:

- nhận permission trực tiếp từ client;
- chấp nhận permission client gửi mà không kiểm tra với catalog server;
- hard-code quyền chỉ ở JSX;
- dùng `role === ...` thay cho permission ở endpoint nghiệp vụ;
- cho admin toàn quyền bằng cách bỏ qua mọi middleware;
- tự động nâng `pending` lên `viewer` khi login;
- xóa legacy `user` trước khi migrate toàn bộ document và kiểm chứng;
- thay đổi retry duplicate registration mà không chạy regression test;
- trả toàn bộ Mongoose document ra API.

## 11. Test bắt buộc

Sau mọi thay đổi auth/RBAC:

```sh
npm --prefix server test
npm --prefix client run build
```

Tối thiểu phải giữ các case:

- đăng ký mới tạo `pending`, username/email unique, scope rỗng, cookie/session hợp lệ;
- double-submit cùng email + username + password đăng nhập lại được;
- legacy pending account có thể nhận username qua retry an toàn;
- duplicate email/username nhưng sai password, khác owner, user không pending hoặc user
  disabled trả `409`;
- login bằng email và username; login sai/disabled/không tồn tại;
- user không có custom permission kế thừa role template;
- custom permission thay thế template cho viewer/operator;
- pending luôn 0 quyền và admin luôn đủ quyền dù document chứa override sai;
- profile Telegram/phone được normalize/validate và Telegram ID không trùng;
- `pending` bị `403` khi gọi `/api/bots`;
- viewer/operator chỉ thấy bot được gán;
- admin thấy mọi bot và quản lý user;
- `config.view=all` được xem config bot khác nhưng `config.edit=assigned` không được sửa;
- member chỉ xem tài nguyên có `ownerUserId` của mình; operator truy cập hợp own+assigned;
- bot private của admin bị ẩn với user thường có scope all, nhưng user được gán vẫn xem được;
- `credentials.view` và `credentials.manage` có scope độc lập;
- document cũ chưa có `permissionScopes` mặc định về `assigned`;
- `credentials.view` / `credentials.manage` từ chối viewer và operator theo template;
- response user API không chứa raw `api_key`, `api_secret`, `password`;
- user không có `users.manage` chỉ thấy user API của `botUsernames`;
- non-admin bị `403` ở `/api/admin/users`;
- không thể khóa/hạ role active admin cuối cùng;
- response không chứa `passwordHash`;
- client build thành công và pending page không gọi API bot.
- mutation thiếu/sai CSRF token hoặc sai Origin bị từ chối;
- login/register và mutation nhạy cảm trả `429` khi vượt rate limit nhưng không khóa
  identifier khác cùng IP trước khi bucket riêng của identifier đó đầy;

Nếu chưa có test integration cho một case, phải kiểm tra thủ công luồng UI -> API -> Mongo
và ghi rõ phần chưa được tự động hóa trong phần bàn giao.

## 12. Audit log và lịch sử chỉnh sửa

Collection MongoDB: `web_audit_logs`.

Mọi thay đổi user quan trọng phải được ghi ở server sau khi mutation thành công:

- `user.registered`: user tự đăng ký;
- `user.created`: admin tạo user;
- `user.updated`: admin sửa profile, role, permission, bot scope, trạng thái hoặc password;
- `user.username_linked`: pending legacy user được gắn username trong registration retry.
- `bot.created`, `bot.renamed`, `bot.deleted`: thay đổi user bot;
- `bot.access_updated`: thay đổi owner, public/private hoặc cờ active của bot;
- `bot.account_added`, `bot.account_renamed`, `bot.account_deleted`: thay đổi config/env
  được gắn vào bot;
- `credential.created`, `credential.updated`, `credential.deleted`: thay đổi cấu hình API.

Mỗi record gồm:

- `action`;
- `actor`: id/email/username/name của người thực hiện hoặc system;
- `targetType` và `target`: đối tượng bị thay đổi;
- `changes`: diff `{ field: { from, to } }` đã sanitize;
- `createdAt`.

Invariant bảo mật:

- Không bao giờ ghi password, `passwordHash`, JWT/token, secret, API key hoặc API secret.
- Đổi password chỉ ghi `{ "changed": true }`, không ghi giá trị trước/sau.
- Đổi API key, API secret hoặc passphrase chỉ ghi `{ "changed": true }`; audit chỉ được
  dùng các boolean public `hasApiKey`, `hasApiSecret`, `hasPassword`, không đọc raw secret.
- Phone trong diff phải mask, chỉ giữ 4 số cuối.
- Không ghi nguyên request body hoặc nguyên Mongoose document vào audit log.
- Lỗi ghi audit phải được log ở server nhưng không được trả secret hoặc làm client hiểu
  mutation chưa xảy ra sau khi database chính đã lưu thành công.
- API đọc audit bắt buộc `requireAuth` + `logs.view`; client ẩn menu nếu thiếu quyền,
  nhưng server middleware mới là lớp bảo vệ quyết định.
- Audit log là append-only qua application: không cung cấp API sửa/xóa log.

Client có route `/logs`, hai tab. Tab sửa trên web hỗ trợ tìm theo action/actor/target, phân trang và mở
chi tiết diff. Client chỉ render dữ liệu audit đã sanitize từ server.

### Log runtime của bot

Collection `bot_runtime_logs`, process binance-bot ghi thêm, web chỉ đọc. Không copy file log PM2.
Mỗi dòng có `at`, `level`, `category`, process PM2 (`processName`, `pmId`), `usernames` từ `RUN`,
`env`, `symbol`, `signal`, `source`, `message` đã cắt 500 ký tự và xoá key/secret.

Category:

- `open`: lỗi mở lệnh;
- `exchange`: lỗi API sàn, rate limit, timeout, chữ ký;
- `monitor`: lỗi monitor vị thế;
- `tpsl`: lỗi TP/SL;
- `listener`: lỗi listener Telegram/Discord;
- `mqtt`: lỗi MQTT;
- `signal`: signal bị bỏ, không mở lệnh;
- `process`: process PM2 khởi động, crash, lỗi loader.

Logger chỉ ghi `error`/`warn` khi nội dung khớp một category. Signal bị bỏ được ghi rõ tại
`callHandleSignalBot`. Dòng trùng category và nội dung trong 60 giây được gộp. TTL 30 ngày.

Test bắt buộc thêm:

- identity audit không chứa password hash/phone ngoài ý muốn;
- secret fields bị loại bỏ khỏi diff;
- phone trong diff bị mask;
- user thiếu `logs.view` nhận `403` ở audit API;
- create/update/register tạo đúng action và actor/target.
