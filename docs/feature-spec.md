# Đặc tả tính năng hiện tại

Đối chiếu [route/menu](../client/src/App.jsx) và [API](api-data-reference.md), ngày 2026-10-09. Đây là đặc tả hành vi dashboard hiện có; quyền chi tiết theo [auth/RBAC](auth-rbac-spec.md).

## Bản đồ màn hình

| Màn hình / URL | Component | Nghiệp vụ và điều kiện |
|---|---|---|
| Đăng nhập `/login`, đăng ký `/register` | LoginPage, RegisterPage | Login bằng identifier; đăng ký tạo pending. Pending có session nhưng chưa có quyền bot |
| Trang chủ `/` | DashboardPage / PendingPage | Có `bots.view` thì dashboard; chỉ có `summary.view` chuyển Tổng kết; còn lại trang chờ |
| Danh sách `/bots` | HomePage | Bot đang active, chọn phạm vi của mình/người khác theo quyền; lọc/sắp xếp/phân trang |
| Bot `/bots/:username` | BotDetailPage | Account/config thuộc bot, thêm/đổi tên/gỡ account theo `config.edit` |
| Config `/bots/:username/accounts/:env` | AccountConfigPage | Sửa các field trade/signal được hỗ trợ; cảnh báo rời form chưa lưu |
| Signal `/signal-search` | SignalSearchPage và panel | Bốn tab mô tả dưới đây; từng API có quyền riêng |
| Position `/positions` | PositionsPage | Vị thế sàn và monitor, live/paper, mặc định của mình; `positions.view` |
| Account Static `/signals` | SignalHistoryPage | Kết quả lệnh thực tế và chi tiết; `statistics.view` cho API account-statics |
| Lãi lỗ `/ledger` | AccountLedgerPage | Ví/income/dòng tiền theo user, refresh từ sàn; `statistics.view` |
| Tổng kết `/summary` | SummaryPage | Tổng hợp phạm vi được xem; quyền vào trang là một trong summary/bots/statistics view |
| Lịch sử `/logs` | AuditLogsPage | Hai nguồn: sửa trên web và log runtime; `logs.view` |
| Hệ thống `/system` | SystemHealthPage | Heartbeat và cảnh báo hạ tầng; API yêu cầu `logs.view` scope `all` |
| User API `/user-apis`, `/user-apis/new`, `/user-apis/:username` | UserApisPage, UserApiDetailPage | Xem cờ có credential, tạo/sửa/xóa với quyền riêng; không trả raw secret |
| User `/admin/users` | AdminUsersPage | Quản trị tài khoản web, role/permission/scope theo từng hành động |
| Hồ sơ `/profile` | ProfilePage | Sửa hồ sơ/mật khẩu của chính mình theo spec auth |

Component nằm trong [pages](../client/src/pages). Gate UI chỉ hỗ trợ UX; server quyết định quyền và scope.

## Bot và config

- Bot username là định danh tài khoản bot; account `env` là cấu hình giao dịch của bot đó. Không nhầm với username đăng nhập web.
- `active` của bot là cờ hiển thị, không phải lệnh dừng giao dịch. `trade_config.ON` là cấu hình khác.
- Form config quản lý volume/leverage, mode, mở lệnh, TP/SL, trailing, copy, paper/monitor, signal, blacklist/whitelist và sync. Backend chỉ cập nhật field được gửi, không ghi đè toàn document.
- Bulk config tối đa 40 env, trả `updated` và `failed`; có thể thành công một phần, không được thông báo toàn bộ thành công khi `failed` khác rỗng.
- Copy có `new` (tạo mới), `replace` (ghi đè config đích, gỡ sync), `sync` (tạo config mới và gắn nguồn). Kiểm tra quyền xem nguồn và sửa đích.
- Lưu thành công nghĩa là Mongo đã cập nhật. Bot có thể cần reload/restart để nhận cấu hình, dashboard không xác nhận lệnh sàn đã thay đổi.

## Bốn tab Signal

| Tab | Dữ liệu/API | Điều cần hiểu |
|---|---|---|
| Lịch sử signal | `/api/signal-history`, `signal_infos` | Nhật ký signal nhận được; không phải profit của account |
| Tìm Signal | `/api/bots/config-search`, `account_statics` | Tìm config có lệnh thật với signal được chọn; bỏ config không có lệnh, lọc theo openTime |
| Thống kê Signal | GET `/api/signal-config` | Usage, channel, parse error, signal bị gỡ, user/config/signal lỗ theo dữ liệu được phép |
| Cấu hình Signal | GET/POST `/api/signal-config` | Thêm/gỡ danh sách signal trên config thuộc bot sở hữu/được gán, không chỉnh session Telegram |

Thêm/gỡ signal giữ nguyên các tên không được yêu cầu xóa, tối đa 40 config và 20 signal; mỗi config đổi thật ghi audit. Query/list và thao tác ghi không được dùng cùng một giả định scope rộng.

## Position

Hiển thị position cha theo account/symbol/side, tối đa hai dòng: số liệu ở dòng trên, nút ở dòng dưới. PnL mở = size hiện tại × (mark − entry). Account stream và position monitor ghi amount, entry, mark và unrealized hiện tại vào Mongo. Cột PnL ghi nhận đọc `stats` do position monitor ghi từ income của lệnh đang mở, và realized do account stream ghi khi sàn đẩy. Sổ sàn trên web là danh sách position đầy đủ do position-manager lấy (cùng nguồn với tin Telegram), làm mới khi account stream báo thay đổi và mỗi 14 phút. Delta websocket không được dùng làm cả danh sách. Sổ sàn cũ hơn 15 phút vẫn được giữ khi gọi lại Binance lỗi, kèm cảnh báo dữ liệu cũ. Volume là qty nhân mark. Bấm tiêu đề cột để sắp xếp. Nút Market, Limit, Reverse và Add hiện trên dòng nhưng chưa gửi lệnh lên sàn. Xoá monitor cần `positions.close`, chỉ xoá bản ghi và không đóng lệnh sàn. Có trạng thái pending, paper, không TP/SL và monitor chưa đồng bộ với sàn. Popup chi tiết lấy monitor, lệnh thường và algo orders đã lọc.

Danh sách vị thế là `positionRisk` của sàn. `monitor_positions` chỉ bổ sung thời gian vào lệnh, signal và qty riêng. Vị thế sàn không có monitor vẫn hiện. Monitor không còn trên sàn chỉ được gắn đã đóng khi sổ sàn tải được. Snapshot do monitor dựng không phải sổ sàn. Redis thiếu key hoặc API sàn lỗi thì vẫn hiện monitor và báo lỗi, không biến các dòng đó thành đã đóng.

`positionRisk`, `openOrders` và `openAlgoOrders` chỉ gọi khi chưa có sổ `wb:ex`, khi bấm Cập nhật sàn, hoặc khi sổ quá 15 phút. Binance-bot vá qty từ ACCOUNT_UPDATE vào `wb:ex` và báo `wb:ex:notify`. Web đọc Redis đó. Mark price là stream public, tính lại trên view mỗi 15 giây, không gọi ba API trên. Lệnh sàn vẫn qua `wb:ord`. Nút Market, Limit và Reverse chưa gửi lệnh. Nút xoá chỉ xoá bản ghi monitor.

## Số liệu: không so sánh khác nguồn như cùng một chỉ số

| Mục | Nguồn / thời gian |
|---|---|
| Account Static | `account_statics`, lọc openTime; mặc định ba ngày nếu không truyền from/to; sổ live/paper theo lựa chọn |
| Tìm Signal | Lệnh thật theo openTime, signal và config; điều kiện win dựa vào profit trong module này |
| Tổng kết | Lệnh live; lọc closeTime, fallback openTime nếu thiếu closeTime; win/loss dựa trạng thái WIN và LOSS/LOSE |
| Lãi lỗ ví | `futures_profits`, income và số dư ngày UTC; trading PnL tách dòng tiền |
| Dashboard | Dữ liệu bot sở hữu/được gán và các phần được cấp quyền; chú ý khoản lỗ hôm nay UTC |

Kiểm tra cùng audience, bot/env, khoảng thời gian, live/paper và định nghĩa thắng trước khi kết luận số sai. Account Static profit không tự bằng income ví vì phí, funding, nạp/rút và thời điểm ghi nhận có thể khác.

## Tổng kết và AI

`audience=system` chỉ dùng snapshot hệ thống cho admin/summary_viewer trong route; trường hợp khác tính theo actor/audience. Snapshot có generatedAt/staleAt/status; có thể trả dữ liệu cũ trong lúc refresh. Nút refresh bị giới hạn tần suất.

Dashboard có POST `/api/dashboard/attention`: server dựng lại facts theo actor, gửi dữ liệu đó cùng hướng dẫn tùy chọn đến nhà cung cấp AI. Facts có thể chứa tên bot/config/signal và số liệu vận hành; đây là truyền dữ liệu ra dịch vụ ngoài khi dùng tính năng. Không lấy số liệu client tự khai làm nguồn chuẩn. Kết quả là gợi ý/link để xem, không tự sửa cấu hình hay đặt lệnh. Thiếu key hoặc provider lỗi phải hiển thị lỗi, không coi là dashboard mất dữ liệu.

## Lịch sử và sức khỏe

- Audit: các mutation của web, nguồn `web_audit_logs`; xem actor/target/diff đã sanitize.
- Runtime: cảnh báo/lỗi bot ghi vào `bot_runtime_logs`; không đọc trực tiếp file PM2 log trên máy khác.
- Hệ thống: `bot_heartbeats`, trạng thái kết nối và snapshot; ngưỡng heartbeat cũ hiện 90 giây. Trang trống có thể do bot chưa ghi heartbeat, database khác hoặc scope không đủ.
- Một response `200` với danh sách trống không chứng minh query sai: kiểm tra filter, quyền và nguồn ghi dữ liệu trước.
