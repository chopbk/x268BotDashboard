# Đặc tả tính năng hiện tại

Đối chiếu [route/menu](../client/src/App.jsx) và [API](api-data-reference.md), ngày 2026-10-09. Đây là đặc tả hành vi dashboard hiện có; quyền chi tiết theo [auth/RBAC](auth-rbac-spec.md).

## Bản đồ màn hình

| Màn hình / URL | Component | Nghiệp vụ và điều kiện |
|---|---|---|
| Đăng nhập `/login`, đăng ký `/register` | LoginPage, RegisterPage | Login bằng identifier; đăng ký tạo pending. Pending có session nhưng chưa có quyền bot |
| Trang chủ `/` | OverviewPage (tab Tổng quan / Thống kê tổng hợp) / PendingPage | `bots.view` \| `summary.view` \| `statistics.view` → shell tab; không có quyền → trang chờ. Tab Tổng quan = DashboardPage (`bots.view`); tab Thống kê = SummaryPage. `/summary` redirect `/?tab=summary`. — [dashboard-overview-spec](dashboard-overview-spec.md) |
| Danh sách `/bots` | HomePage | Active, phạm vi, chủ sở hữu; peek Static/Config/lãi lỗ; nút Config → `/config-lab?user=` |
| Config `/config-lab`, `/config-lab/:username/:env` | ConfigLabPage + AccountConfigPage | Tạo/sửa/copy/sync/bulk/xoá config; 6 nhóm form; APPLY_CONFIG |
| `/bots/:username`, `/bots/.../accounts/:env` | Redirect | Chuyển sang Config Lab (UI cũ không còn dùng) |
| Signal `/signal-search` | SignalSearchPage và panel | Tab lịch sử / tìm / scorecard / thống kê / cấu hình; từng API có quyền riêng |
| Terminal `/terminal` | TerminalPage | Workspace giao dịch (R1): vị thế, lệnh, lịch sử, panel chi tiết. Menu Position đã gỡ; `/positions` redirect sang `/terminal`. Gate: `positions.view` \| `orders.view` \| `statistics.view`. Khối **Dòng tiền** trong Tổng quan đọc snapshot Smart Money chung. Spec: [terminal-workspace-spec](terminal-workspace-spec.md), [smart-money-spec](smart-money-spec.md) |
| Thị trường `/market` | MarketHubPage | Hub P0: tab **Kỹ thuật** (ma trận market-v1) và **Dòng tiền** (Smart Money: Tổng quan / Đáng chú ý / Watchlist). URL `tab=technical\|flow`, `flowTab=overview\|notable\|watchlist`. Gate: Terminal **hoặc** `market.view` / `smart_money.view`. `/smart-money` redirect vào Dòng tiền. Tab Kỹ thuật: cột **Signal** (72h, `signals.history`) + panel signal đáng chú ý khi chọn symbol/`signals=1`. API/collector scoring không gộp. — [market-hub-spec](market-hub-spec.md), [market-scoring-spec](market-scoring-spec.md), [smart-money-spec](smart-money-spec.md) |
| Báo cáo `/reports` | ReportsPage | Tab **Hiệu quả lệnh** = TradePerformancePage: mặc định `username=__all__` + `scope=mine` + `range=today` (UTC), sổ Live, theo closeTime; **Làm mới** kéo income sàn hôm nay rồi reload Static; bảng nhóm có **PnL Static** + **Income DB**; chart PnL thu nhỏ khi ≤3 ngày; tab **Ví & dòng tiền** = AccountLedgerPage (mặc định tất cả user + hôm nay; **Cập nhật hôm nay** bấm được cả khi xem Tất cả qua `refresh-all`; chưa hỗ trợ Paper); **Báo cáo cũ** → Account Static. `statistics.view`. URL giữ bộ lọc. |
| Account Static `/signals?view=statics` | AccountStaticLegacyPage | Legacy so sánh signal/config; giữ trong giai đoạn chuyển đổi. openTime mặc định 3 ngày; AI gợi ý lọc |
| Tổng kết (cũ) `/summary` | Redirect | → `/?tab=summary` (giữ query range/audience) |
| Lịch sử `/logs` | AuditLogsPage | Hai nguồn: sửa trên web và log runtime; `logs.view` |
| Hệ thống `/system` | SystemHealthPage | Heartbeat + bảng Process (`logs.view` scope `all`). Sửa env: `processes.edit`; restart: `processes.restart`; role `ops` có sẵn cả hai + xem Hệ thống — [remote-process-env-admin-spec](remote-process-env-admin-spec.md). Panel **Peer proxy**: probe sức khỏe từng IP + lịch sử + runtime log liên quan (không gắn env process; `BINANCE_PEER_*` sửa ở Env process) |
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
- Thêm account: tên env luôn uppercase; trùng tên không phân biệt hoa/thường bị từ chối. Có thể `copyFrom` (gõ hoặc chọn) từ mọi config actor được `config.view` — giống `/aa?a=NEW&copy=EXIST`.
- Lưu thành công nghĩa là Mongo config đã cập nhật; server enqueue `APPLY_CONFIG` (MQTT đánh thức bot). Bot ghi ACK vào outbox Mongo; UI chỉ báo “đã áp dụng” khi outbox terminal succeeded — xem [bot-command-bridge](bot-command-bridge.md). Bot offline/timeout → “Đã lưu DB — chờ áp dụng” + nút thử lại.

### Config

Menu `/config-lab` yêu cầu `config.view`. Tạo account (uppercase + `copyFrom`), bulk Config
nhanh (On/Long/Short/Paper/Monitor/mode/cost/leverage/signals) và xoá hàng loạt cùng user,
deep-link Position/Static. Chi tiết 6 nhóm, signal thẻ + gợi ý, Sync from picker, copy
new/replace/sync, đổi tên/xoá, APPLY/ACK trên savebar. Danh sách `/bots` chỉ quản trị bot
(Active/phạm vi/chủ). Route UI config cũ redirect sang đây. Chi tiết: [spec Config](config-lab-spec.md).

## Tab Signal

| Tab | Dữ liệu/API | Điều cần hiểu |
|---|---|---|
| Lịch sử signal | `/api/signal-history`, `signal_infos` | Nhật ký signal nhận được; không phải profit của account |
| Tìm Signal | `/api/bots/config-search`, `account_statics` | Tìm config có lệnh thật với signal được chọn; bỏ config không có lệnh, lọc theo openTime |
| Scorecard | `/api/provider-scorecard` | Xếp hạng channel: feed từ `signal_infos` + lệnh/PnL từ `account_statics`; xem [spec](provider-scorecard-spec.md) |
| Thống kê Signal | GET `/api/signal-config` | Usage, channel, parse error, signal bị gỡ, user/config/signal lỗ theo dữ liệu được phép |
| Cấu hình Signal | GET/POST `/api/signal-config` | Thêm/gỡ danh sách signal trên config thuộc bot sở hữu/được gán, không chỉnh session Telegram |

Thêm/gỡ signal giữ nguyên các tên không được yêu cầu xóa, tối đa 40 config và 20 signal; mỗi config đổi thật ghi audit. Query/list và thao tác ghi không được dùng cùng một giả định scope rộng.

Scorecard không thay Tìm Signal hay Tổng kết: win = `status` WIN, thời gian = openTime, sổ live mặc định; Tổng kết vẫn dùng closeTime lệnh đóng.

## Terminal

Vùng `main` mặc định full-width (cạnh sidebar), giống Terminal; form Config vẫn hẹp hơn qua override. Panel Terminal desktop (≥1024px) nằm cạnh bảng, mặc định hẹp (~360px); dưới 1024px dùng drawer. Mọi tab Terminal dùng vùng nội dung full chiều cao còn lại, bảng cuộn trong container. Bảng mật độ compact: cột Tài khoản gộp Monitor + config đang chạy, không tách hàng “Chưa có monitor”. Tab Lệnh/Monitor/Timeline nhúng đúng phần nội dung case trong panel. Các gap R1 còn lại: [review Terminal](terminal-review.md).

Menu `/terminal` là UI vị thế chính (thay menu Position). Dùng cùng API Position/Orders/Trading. Bố cục: summary + tab Vị thế / Lệnh chờ / Lịch sử vị thế / Lịch sử lệnh + panel chi tiết (Tổng quan / Lệnh / Monitor / Giao dịch; panel mặc định ~480px) + CLI `/` dưới trang. **Tổng quan** có nút AI phân tích (popup), Journal ngay trong tab; Monitor gộp timeline. Ticket mở hỗ trợ Qty / % ví / USDT notional / rủi ro $; đóng đơn hoặc **Đóng toàn bộ** theo bộ lọc. Tab **Ví & dòng tiền** (`/reports?tab=ledger`) có khối AI đánh giá rủi ro tài khoản. Chi tiết: [ai-decision-support-spec](ai-decision-support-spec.md), [terminal-workspace-spec](terminal-workspace-spec.md), [terminal-r2-tools-spec](terminal-r2-tools-spec.md).

## Position (nguồn dữ liệu / API)

Logic vị thế (API `/api/positions`, WS, monitor) vẫn dùng chung cho Terminal. Hiển thị position cha theo account/exchange/instrumentId/side (+ positionIdx). Badge sàn + filter exchange trên Terminal; OKX giữ `BTC-USDT-SWAP` và `quantityUnit: contracts`. PnL mở = size hiện tại × (mark − entry). Account stream và position monitor ghi amount, entry, mark và unrealized hiện tại vào Mongo. Cột PnL ghi nhận lấy từ `stats` monitor đã lưu hoặc khi mở Chi tiết / case reconcile (ưu tiên `positionHistory`, fallback `userTrades` + funding; cache 3 phút). Cập nhật sàn không kéo income/history. Ô Symbol và Signal lọc ngay theo tên gần đúng. Nút Thêm monitor position tạo bản ghi monitor, không mở lệnh sàn. Nút xoá ghi Xoá monitor kèm env và signal. Sổ Live chỉ hiện vị thế đang mở. Lệnh limit chưa khớp không hiện ở sổ đó; chọn Lệnh chờ mới thấy. Sổ sàn nhận delta ACCOUNT_UPDATE ngay qua Redis và được REST đối chiếu mỗi 45 giây khi có người xem. Delta chỉ vá đúng vị thế, qty=0 xóa dòng; snapshot rỗng xóa hết dòng live. Quá 90 giây chưa đối chiếu thì cảnh báo dữ liệu cũ, độc lập kết nối giá. Version chung bảo vệ bot và web khỏi REST đến muộn. Volume là qty nhân mark. Bấm tiêu đề cột để sắp xếp. Mỗi dòng vị thế live có form đóng kiểu Binance: `Market | Limit`, ô giá limit và ô Amount (%). Modal Confirm có preview qty/PnL/phí ước tính/sibling. Nút Mở position và Reverse gọi API trading trực tiếp. Dòng TP/SL/Trailing lấy từ lệnh sàn; modal có tab Position TP/SL và Trailing Stop (`PUT .../tpsl`, Algo Order). Bấm Symbol hoặc **Chi tiết** mở màn case: tóm tắt sàn + TP/SL; bảng order mở (huỷ/sửa = cancel+đặt lại, hàng thêm order cuối bảng nút Thêm); ownership chỉ monitor mở còn qty (bỏ `isClosed`); lịch sử order 7 ngày trước timeline monitor; cảnh báo lệch ở cuối. Huỷ algo dùng `algoId`. Reconcile an toàn không đóng vị thế. Xoá monitor cần `positions.close`, chỉ xoá bản ghi Mongo. Có trạng thái pending, paper, không TP/SL và monitor chưa đồng bộ với sàn. Popup chi tiết lấy monitor, lệnh thường và algo orders đã lọc.

Tab **Order đang mở**: khung đặt lệnh (Buy/Sell, Market/Limit/Stop/Stop Limit, hedge side, reduce-only, mark gợi ý giá) gọi `POST /api/trading/orders`; bảng order có nút **Huỷ** từng dòng và huỷ hàng loạt (`orders.cancel`). Algo huỷ qua `/fapi/v1/algoOrder`.

Danh sách vị thế là `positionRisk` của sàn. `monitor_positions` chỉ bổ sung thời gian vào lệnh, signal và qty riêng. Vị thế sàn không có monitor vẫn hiện. Monitor không còn trên sổ sàn thì không hiện ở danh sách. Hai monitor cùng một vị thế mà mỗi bản ghi đang lưu amount cả sàn thì không báo lệch qty. Snapshot do monitor dựng không phải sổ sàn. Redis thiếu key hoặc API sàn lỗi thì vẫn hiện monitor và báo lỗi, không biến các dòng đó thành đã đóng.

Khi sổ live đổi (đóng, mở, đổi size), Terminal hiện toast trong trang. Tab đang ẩn thì dùng thông báo trình duyệt nếu user đã bật. Đổi bộ lọc tài khoản không tạo toast giả. Mở trang dùng `mode=fast` (Mongo+Redis) để hiện bảng ngay; WS/`reconcileLive` nền chỉ lấy sổ live rồi patch. Nút Đồng bộ chỉ REST live: hàng đợi 1 account, `positionRisk` → `openOrders` → `openAlgoOrders`, giãn ~400ms. Income/history/trades khi mở Chi tiết / case reconcile (cache 3 phút). Ẩn tab dừng watcher. HTTP fallback 30 giây cũng `mode=fast`. Mark price public mỗi 15 giây. Xem [flows §4](flows.md#4-position-live).

## Số liệu: không so sánh khác nguồn như cùng một chỉ số

| Mục | Nguồn / thời gian |
|---|---|
| Hiệu quả giao dịch (Account Static) | `account_statics`; UI Báo cáo analytics mặc định hôm nay UTC + tất cả user của tôi, theo closeTime, lệnh đã đóng, sổ Live. Win rate/profit factor theo `profit` hợp lệ. Cột Income DB từ `futures_profits` cùng kỳ (gần `/i`, khác PnL lệnh). `roe` không gọi ROI tài khoản. Deep-link Ledger khi có quyền. API cũ không gửi `analytics`/`range` vẫn lọc openTime mặc định 3 ngày |
| Provider Scorecard | Feed `signal_infos` (hệ thống) + trades `account_statics` (scope bot); cùng openTime; win = status WIN |
| Tìm Signal | Lệnh thật theo openTime, signal và config; điều kiện win dựa vào profit trong module này |
| Tổng kết | Lệnh live; lọc closeTime, fallback openTime nếu thiếu closeTime; win/loss dựa trạng thái WIN và LOSS/LOSE |
| Lãi lỗ ví | `futures_profits`, income và số dư ngày UTC; trading PnL tách dòng tiền |
| Attribution trên Ledger | `account_statics` live đã đóng cùng kỳ; equity từ 0 theo closeTime; Max DD trên equity lệnh; slippage khi khớp `stats` hoặc `signal_infos.prices` |
| Dashboard | Bot sở hữu/được gán; đã chốt / ví / uPnL Redis tách riêng; ngày UTC; AI attention thêm attributionIssues (DD/PF/signal lỗ/slippage) deep-link Ledger |

Kiểm tra cùng audience, bot/env, khoảng thời gian, live/paper và định nghĩa thắng trước khi kết luận số sai. Account Static profit không tự bằng income ví vì phí, funding, nạp/rút và thời điểm ghi nhận có thể khác.

## Tổng kết và AI

`audience=system` chỉ dùng snapshot hệ thống cho admin/summary_viewer trong route; trường hợp khác tính theo actor/audience. Snapshot có generatedAt/staleAt/status; có thể trả dữ liệu cũ trong lúc refresh. Nút refresh bị giới hạn tần suất.

Dashboard có POST `/api/dashboard/attention`: server dựng lại facts theo actor, gửi dữ liệu đó cùng hướng dẫn tùy chọn đến nhà cung cấp AI. Facts có thể chứa tên bot/config/signal và số liệu vận hành; đây là truyền dữ liệu ra dịch vụ ngoài khi dùng tính năng. Không lấy số liệu client tự khai làm nguồn chuẩn. Kết quả là gợi ý/link để xem, không tự sửa cấu hình hay đặt lệnh. Thiếu key hoặc provider lỗi phải hiển thị lỗi, không coi là dashboard mất dữ liệu.

## Lịch sử và sức khỏe

- Audit: các mutation của web, nguồn `web_audit_logs`; xem actor/target/diff đã sanitize.
- Runtime: cảnh báo/lỗi bot ghi vào `bot_runtime_logs`; không đọc trực tiếp file PM2 log trên máy khác.
- Hệ thống: `bot_heartbeats` + join `bot_profile` (Rev/Drift); ngưỡng heartbeat 90 giây. Admin mở panel trên cùng `/system` để sửa env / restart PM2 — [remote-process-env-admin-spec](remote-process-env-admin-spec.md).
- Một response `200` với danh sách trống không chứng minh query sai: kiểm tra filter, quyền và nguồn ghi dữ liệu trước.
