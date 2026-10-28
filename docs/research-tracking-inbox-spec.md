# Theo dõi kịch bản & Inbox nghiên cứu

Ngày: 2026-10-28. Trạng thái: **Đề xuất triển khai; chưa có runtime/API/UI mới**.
Phạm vi: web-bot. Phiên bản thiết kế: research-v1.

## 1. Mục tiêu và quyết định sản phẩm

Người dùng lưu một setup đang xem, biết điều gì đã thay đổi kể từ lúc lưu và đọc lại bằng chứng mà không phải hỏi AI từ đầu. Thành công của tính năng là theo dõi đáng tin cậy, không phải số lượng báo cáo hoặc lời khuyên mua/bán.

P0 gồm nút Theo dõi ở chi tiết setup Kỹ thuật, danh sách kịch bản cá nhân, timeline bất biến và Inbox cá nhân. P0 hoạt động hoàn toàn bằng template và dữ liệu có sẵn; AI là phần bổ sung P1. Không yêu cầu cài hoặc chạy OpenAlice.

Không nằm trong P0: lịch tùy ý/ngôn ngữ tự nhiên, tin tức/web search, watchlist chỉ có symbol mà chưa có setup, tự đặt lệnh, thay SL/TP/config, MQTT signal, backtest, đánh giá lợi nhuận, chia sẻ nghiên cứu, Telegram/email, nhập dữ liệu từ Alice. Không thay market-v1 hoặc lifecycle setup hiện hành.

Nguồn ý tưởng: [OpenAlice Quick Start](https://www.openalice.ai/docs/getting-started/quick-start) — theo dõi tài sản, công việc và Inbox. Thiết kế dưới đây dùng kiến trúc web-bot; không giả định Alice có API tích hợp đã được kiểm chứng.

## 2. Nền hiện có và chuỗi dữ liệu

Đã đối chiếu source: `server/src/routes/market.js`, `lib/market/setup-engine.js`, `lib/market/location.js`, `lib/decision-support/run-decision.js`, `lib/decision-support/ai-report.js`, `routes/terminal.js`. Đường dẫn đều tính từ gốc repo.

- Market có read API, snapshot, setup ID, lifecycle, vùng entry và điều kiện vô hiệu.
- Decision support có báo cáo AI với evidence, missingData và snapshot ID; báo cáo vị thế không phải nguồn chuẩn cho setup thị trường.
- Terminal có journal cá nhân và lịch sử báo cáo; giữ nguyên schema/route cũ.
- Smart Money có watchlist; theo dõi kịch bản là tài nguyên khác, không thay watchlist.

Chuỗi mới:

```text
Market detail → chọn setup → POST theo dõi
 → server kiểm quyền + đọc snapshot chuẩn → lưu baseline và kịch bản
Collector hiện có → snapshot Market
 → worker theo dõi đọc snapshot → đánh giá thay đổi xác định bằng code
 → CAS cập nhật kịch bản + pending event trong cùng document
 → materializer upsert event bất biến → upsert Inbox → xác nhận đã xuất
Client Theo dõi / Inbox → API theo actor → timeline + bằng chứng + link Market
```

Worker không tự gọi sàn để bù dữ liệu. Không gọi pipeline phân tích vị thế cho mọi lượt quét; tránh phát sinh REST/AI ngoài ý muốn. P0 chỉ đọc bộ setup cùng exchange/marketType/timeframe của Market Kỹ thuật; không ghép với setup riêng của Market Dashboard.

## 3. Luồng và giao diện

### 3.1 Tạo theo dõi

Tại panel chi tiết coin → setup active → nút **Theo dõi kịch bản**. Form gồm tên (mặc định symbol + hướng + khung), ghi chú, thời hạn (mặc định 7 ngày, tối đa 30 ngày). Hiển thị vùng entry, mức vô hiệu, nguồn, thời điểm dữ liệu; giải thích đây là theo dõi điều kiện, không phải lệnh giao dịch.

Client gửi identity setup và phiên bản nguồn đang xem. Server đọc lại nguồn, không tin vùng giá hay lifecycle client gửi. Snapshot đổi thì trả 409 `source_changed` với preview mới để người dùng xem lại. Thiếu/cũ dữ liệu trả 409 `source_unavailable`; setup đã terminal trả 409 `setup_not_active`. Tạo thành công lưu baseline bất biến, hiện link Xem theo dõi; không tạo thông báo Inbox cho chính hành động tạo.

Một user chỉ có một theo dõi đang hoạt động hoặc tạm dừng cho cùng identity setup. Tạo lại sau khi archive/terminal được phép nhưng chỉ khi setup nguồn vẫn active; baseline mới không nhận sự kiện đã xảy ra trước lúc tạo.

### 3.2 Danh sách và chi tiết

Đề xuất URL `/research?status=watching` và `/research/:id`; nhãn menu **Theo dõi**. Bảng: tên, coin/hướng/khung, tình trạng setup, tình trạng dữ liệu, thay đổi cuối, kiểm tra gần nhất. Bộ lọc watching/paused/terminal/archived; phân trang phía server.

Chi tiết gồm baseline, quan sát mới nhất, điều kiện đang theo dõi, timeline và thao tác Tạm dừng/Tiếp tục/Lưu trữ. Có link Market đúng symbol và timeframe; chưa có nút giao dịch. Không hiển thị “đã thắng/thua” từ trạng thái invalidated/expired.

Tên/ghi chú được sửa với revision; baseline và các event cũ không sửa. P0 không cho đổi setup hoặc ngưỡng: tạo kịch bản mới. Tạm dừng ngừng đánh giá; tiếp tục quan sát trạng thái hiện tại, ghi rõ khoảng thời gian bỏ qua, không giả vờ đã theo dõi liên tục.

### 3.3 Inbox

URL `/inbox`, badge số chưa đọc, bộ lọc chưa đọc/tất cả/lưu trữ. Mỗi mục có tiêu đề cụ thể, thay đổi trước→sau, thời điểm sự kiện và thời điểm hệ thống phát hiện, nguồn, link kịch bản. Xem trước không tự đánh dấu đã đọc; mở chi tiết thành công mới PATCH readAt.

Một event tạo tối đa một mục Inbox cho chủ sở hữu. Đọc hoặc lưu trữ Inbox không đổi kịch bản. Lưu trữ kịch bản không xóa lịch sử/Inbox. P0 không có xóa vĩnh viễn; không triển khai thông báo ngoài web.

Desktop dùng list + panel; mobile dùng trang chi tiết. Bàn phím truy cập được, Escape đóng drawer và trả focus; trạng thái có chữ, không chỉ màu. Poll badge/list mỗi 60 giây khi tab visible; dừng khi hidden; GET không tạo job/AI.

## 4. Trạng thái và quy tắc đánh giá

Tách ba trục:

| Trục | Giá trị | Ý nghĩa |
|---|---|---|
| Theo dõi | watching, paused, terminal, archived | Ý định theo dõi của user và kết thúc |
| Setup nguồn | active, invalidated, expired, unknown | Sao chép semantics engine, không tạo công thức thứ hai |
| Dữ liệu | fresh, stale, missing, incompatible | Chất lượng quan sát, không phải kết quả setup |

Terminal reason: setup_invalidated, setup_expired, tracking_expired. archived là thao tác user từ bất kỳ trạng thái nào; không resume terminal/archived. Hết thời hạn vẫn kết thúc khi paused; đây là giới hạn thời gian theo dõi, không kết luận setup đã hết hiệu lực.

Ưu tiên đánh giá: quyền hiện tại → archive/terminal → hết hạn theo dõi → paused → kiểm tra nguồn → lifecycle → firstTouchedAt. Setup invalidated/expired thắng sự kiện chạm vùng nếu cùng một quan sát; một event chứa đầy đủ các thay đổi liên quan. Không coi mất setup khỏi snapshot là invalidated hoặc expired; trả missing. Không thay bằng primarySetup khác cùng coin. Nâng version engine mà identity không tương thích → incompatible, yêu cầu tạo theo dõi mới.

Các event tạo Inbox P0:

- `entry_touched`: firstTouchedAt mới sau baseline, evidence closed_candle từ engine; chỉ một lần mỗi kịch bản. Chạm vùng không đồng nghĩa khớp lệnh.
- `setup_invalidated`, `setup_expired`: terminal được nguồn xác nhận.
- `tracking_expired`: đến expiresAt do user chọn; khác setup_expired.
- `data_unavailable`: stale/missing/incompatible liên tục ít nhất 10 phút; một lần mỗi đợt.
- `data_recovered`: nguồn fresh trở lại, chỉ gửi nếu đợt đó từng gửi unavailable. Nếu cùng lúc có event terminal/chạm vùng thì gộp thông tin phục hồi vào event đó.

Không gửi Inbox khi giá đổi từng tick, entryState dao động, điểm thay đổi nhỏ, không có thay đổi hoặc chỉ sửa ghi chú. Pause/resume/archive tạo timeline thao tác, không tạo Inbox.

Freshness kế thừa contract read model Market và thời điểm nến/snapshot thực tế, không dùng thời điểm HTTP đọc. Nếu read model chưa expose đủ freshness thì adapter phải bổ sung metadata theo chính sách collector hiện hành trước khi bật tính năng; không tự coi có giá mới là nến/setup mới. Nguồn ngoài thứ tự bị bỏ qua bằng source watermark. Bắt đầu một đợt lỗi chỉ khi có lần kiểm tra xác nhận lỗi, không suy diễn khoảng downtime là dữ liệu lỗi.

P0 quan sát snapshot hiện tại, không bảo đảm bắt mọi trạng thái trung gian khi worker/collector ngừng. Sau downtime ghi observationGap và chỉ mô tả những gì nguồn chứng minh; giữ occurredAt nếu nguồn có, luôn lưu detectedAt. Không replay nến để tạo engine thứ hai.

## 5. Dữ liệu đề xuất

Tên collection dưới đây là mới, chưa tồn tại trong API hiện hành.

### `web_research_tracks`

- `_id`, `ownerUserId` từ session; `title` ≤120 ký tự, `note` ≤2000.
- `source`: exchange, marketType, symbol, timeframe, setupId, setupVersion, zoneVersion; identity lấy từ nguồn server. P0 chỉ chấp nhận nguồn collector đang hỗ trợ.
- `baseline`: snapshotId/source watermark, capturedAt, sourceAsOf, lifecycle, firstTouchedAt, entryLow/entryHigh, invalidationLevel, reasons, freshness và formulaVersion. Chỉ lưu projection cần thiết, không nguyên document nguồn.
- `latestObservation`: cùng projection, checkedAt, lastFreshAt, dataStatus, observationGap.
- `status`, `terminalReason`, `expiresAt`, `pausedAt`, `archivedAt`.
- `revision`: tăng ở mọi mutation hoặc cập nhật worker; `eventSequence`: số thứ tự event.
- `lastProcessedWatermark`, `entryTouchNotified`, `unavailableSince`, `dataEpisode`, `unavailableNotified`.
- `nextCheckAt`, `leaseOwner`, `leaseUntil`, `leaseToken`; `pendingEvent` tối đa một event chờ materialize.
- timestamps; `activeIdentity` tồn tại chỉ khi watching/paused, giá trị là canonical identity nguồn.

Indexes: unique partial `(ownerUserId, activeIdentity)` khi activeIdentity tồn tại; `(status,nextCheckAt,leaseUntil)` cho worker; `(ownerUserId,status,updatedAt,_id)` cho list. Tạo index và xử lý duplicate key trước bật flag.

### `web_research_events`

Event bất biến: trackId, ownerUserId, sequence, type, from/to, evidence, occurredAt nullable, detectedAt, sourceWatermark, formulaVersion, templateVersion, gap metadata, createsInbox. Unique `(trackId,sequence)`; index `(ownerUserId,trackId,sequence)`.

Snapshot/evidence cần đọc lịch sử nằm trong event, không chỉ là link tới collection có TTL. Payload tối đa 32 KB; không lưu credential, raw account document hoặc prompt không giới hạn.

### `web_research_inbox`

ownerUserId, eventId, trackId, title, summary, severity info/attention, createdAt, readAt nullable, archivedAt nullable. Unique `(ownerUserId,eventId)`; index `(ownerUserId,archivedAt,readAt,createdAt,_id)`. Nội dung template phản ánh bằng chứng, không hứa lợi nhuận.

Không TTL tự động trong P0 cho track/event/inbox. Giới hạn 50 track watching/paused và 500 track tổng/user; 429 khi vượt, không âm thầm xóa lịch sử. Cần kế hoạch export/xóa có chủ đích trước mở quota rộng hơn. Run metrics vận hành giữ 30 ngày, không chứa nội dung riêng tư.

## 6. Worker, chống trùng và phục hồi

Tick 60 giây, batch 100, tối đa 4 đánh giá đồng thời/process. Claim từng track bằng Mongo atomic lease 120 giây, token tăng đơn điệu; cập nhật kết quả bằng CAS revision + leaseToken + status. Worker cũ hết lease không được ghi đè worker mới. Dữ liệu đọc gộp theo source identity; một user tạo nhiều track không tăng số lần gọi sàn.

Mỗi claim đọc owner mới nhất và kiểm quyền; mất quyền/disabled thì không đọc dữ liệu nghiên cứu, không tạo event/AI, đặt lần kiểm tra quyền tiếp theo sau 5 phút. Khi quyền trở lại tiếp tục từ nguồn mới và ghi gap. Không dùng JWT cũ hoặc quyền chụp lúc tạo.

Đánh giá và ghi pendingEvent + state mới trong cùng atomic update track. Khi có pendingEvent, chặn chuyển trạng thái tiếp theo cho đến khi materialize xong. Materializer upsert event theo trackId+sequence, upsert Inbox theo owner+eventId, rồi clear pending bằng CAS. Crash ở bất cứ bước nào đều retry được; không cần Mongo replica-set transaction. Mutation của user gặp pending chưa flush trả 409 `transition_pending`, không ghi đè outbox. Event lịch sử được materialize ngay cả khi owner vừa mất quyền nhưng API không được hiển thị cho họ khi chưa có quyền.

Không giữ lease trong lúc gọi AI. Lỗi Mongo/source bất thường retry backoff 1/2/5 phút, tối đa 5 phút; một track lỗi không chặn batch. Shutdown dừng claim mới, công việc chưa xong chờ lease hết. Quota track phải được thực thi atomically bằng counter/slot reservation theo owner, không count-then-insert dễ race; bù slot khi create fail và reconcile định kỳ từ track.

Vận hành có counters: queued/due, processed, lag, lease conflicts, source unavailable, pendingEvent age, inbox dedupe, errors. Báo health degraded nếu oldest due hoặc pending >5 phút; đây là health worker, không phải thị trường. Test mục tiêu: từ snapshot cập nhật đến Inbox ≤2 phút ở tải tối đa đã kiểm thử; không cam kết số lượng user trước load test.

## 7. Phân quyền

Authority: [auth-rbac-spec.md](auth-rbac-spec.md). Đây là contract đề xuất cho endpoint mới, không thay role/permission hiện có.

P0 dùng cùng predicate đọc Market: market.view OR positions.view OR orders.view OR statistics.view. Tái sử dụng một helper server, không sao chép role map. `smart_money.view` đơn lẻ không đủ để theo dõi setup Kỹ thuật.

Mọi tài nguyên mới là cá nhân: ownerUserId phải bằng actor.id, kể cả admin. Không có scope all/sharing ở P0. Chỉ có quyền đọc thị trường vẫn được tạo ghi chú/theo dõi của mình như watchlist cá nhân; không suy ra quyền ghi tài nguyên bot. Không lưu account/env/position trong P0, tránh mở rộng quyền dữ liệu giao dịch qua research.

Mọi request cần requireAuth và quyền hiện tại; detail/event/inbox lọc owner ngay trong query, ID khác owner trả 404. List/count/pagination và badge cùng scope; client không gửi owner. Mutation cần CSRF và rate limit sẵn có. Worker kiểm cùng predicate như API. Khi triển khai phải thêm endpoint mới vào auth spec và regression test; spec này không tự cấp permission cho pending/disabled.

Nội dung note/evidence/AI coi là dữ liệu không tin cậy; render text hoặc Markdown đã sanitize, không HTML/script. Không dùng note làm lệnh tool. Không nhúng credential hoặc URL nội bộ nhạy cảm vào báo cáo.

## 8. API đề xuất

Prefix `/api/research`. Response list `{items,nextCursor}`; cursor opaque theo updatedAt/_id cho tracks, createdAt/_id cho Inbox, sequence cho event; limit mặc định 20, tối đa 100. Cursor chỉ phân trang, không mang quyền. Trường ISO time UTC; UI đổi theo múi giờ người dùng.

| Method/path | Contract |
|---|---|
| GET `/tracks` | status, symbol, cursor, limit; chỉ của actor |
| POST `/tracks` | title?, note?, source identity, expectedSourceWatermark, expiresAt, requestId UUID; 201 hoặc 200 retry |
| GET `/tracks/:id` | baseline/latest + revision + freshness; timeline tải riêng |
| PATCH `/tracks/:id` | expectedRevision + title/note; không sửa source/baseline |
| POST `/tracks/:id/actions` | expectedRevision, requestId, action pause/resume/archive |
| GET `/tracks/:id/events` | sequence cursor; lịch sử bằng chứng |
| GET `/inbox` | unread?, archived?, cursor, limit |
| GET `/inbox/unread-count` | `{count}` trong scope, chỉ unarchived |
| GET `/inbox/:id` | Nội dung + event evidence trong scope |
| PATCH `/inbox/:id` | read:boolean và/hoặc archived:boolean; setter idempotent |

Create/actions: lưu receipt theo `(ownerUserId,requestId)` cùng payload hash, giữ 7 ngày; trùng key khác payload →409. Retry sau thành công trả resource/result cũ, không tạo event mới. Receipt pending cần lease và phục hồi liên kết track/action event; commit track phải lưu requestId để retry sau crash tìm được kết quả, không execute lại. Sau TTL, uniqueness activeIdentity vẫn ngăn tạo trùng track đang chạy. Mutation revision sai →409, client reload để người dùng xem lại, không tự ghi đè.

400 input sai/unknown field; 401 session; 403 quyền/CSRF; 404 ngoài owner/không tồn tại; 409 revision/source/state conflict; 429 quota + Retry-After; 503 flag tắt/dependency lỗi. HTTP body theo giới hạn 100 KB hiện hành. Không endpoint generic eval, shell, SQL hoặc trade.

## 9. AI và các pha sau

P1 thêm nút **Giải thích thay đổi** trên một event; server lấy snapshot bất biến của event và baseline của chính owner. Dùng provider adapter hiện có, schema riêng research-v1, không gọi lại runPositionDecision vì scope và input khác nhau. AI chỉ viết summary, supportingEvidenceIds, contradictingEvidenceIds, missingData; mọi evidence ID phải tồn tại. Không sửa lifecycle, ngưỡng hoặc số liệu.

Thiếu provider, timeout hoặc output sai schema → giữ template và hiển thị lý do; sự kiện/Inbox đã được lưu trước đó. Timeout tối đa 20 giây; quota đề xuất 20 giây/request, 20 lần/user/ngày UTC, concurrency 1/user; reservation atomic và idempotency trước gọi provider. Cache theo owner+eventId+promptVersion+model, không chia sẻ dữ liệu riêng tư. P1 chưa gọi AI tự động.

P2 riêng: lịch báo cáo và quản lý Runs; retrospective ghép journal với trade identity đúng exchange/account/side/thời điểm; đánh giá sector; AutoQuant. Các phần này cần spec bổ sung và quyền dữ liệu tương ứng; không suy kết quả PnL từ giá cuối hoặc setup invalidated.

## 10. Kế hoạch triển khai và rollout

1. P0a: models/indexes, helper quyền, adapter snapshot, create/list/detail và UI Theo dõi. Cập nhật auth/API/feature/flows docs khi code tồn tại.
2. P0b: evaluator, lease/CAS/outbox, Inbox, pause/resume/archive, metrics; đây mới là P0 hoàn chỉnh để bật cho user.
3. Chạy fixture và integration test; staging kiểm UI, failover/restart, snapshot cũ và quyền bị thu hồi. Load test quy mô mục tiêu trước mở rộng.
4. Flag đề xuất `RESEARCH_TRACKING_ENABLED=false` mặc định. Tắt flag: API đọc lịch sử vẫn phục vụ theo quyền, mutation trả 503, worker ngừng claim; pending outbox vẫn được drain an toàn. UI báo tạm dừng theo dõi. Bật lại ghi gap, không tạo lại baseline/event cũ.
5. Rollback code giữ collection/index; không xóa dữ liệu, không thay collector hoặc bot. Nếu backend chưa có route thì frontend rollout phải tương thích 404/503 và ẩn entry mới.

Không thêm dependency trong P0; dùng Express/Mongoose và hạ tầng hiện có. Module mới đề xuất `lib/research/{source-adapter,evaluator,worker,outbox,store}.js`, `routes/research.js`, models tương ứng; UI `ResearchPage`, `ResearchDetailPage`, `InboxPage`. Tên là kế hoạch, không phải file đã tồn tại.

## 11. Nghiệm thu bắt buộc

| Case | Kết quả cần chứng minh |
|---|---|
| Tạo trên snapshot fresh và setup active | Baseline server chính xác; source client giả bị loại; không Inbox thừa |
| Nguồn đổi giữa mở form và lưu | 409 + preview mới, không âm thầm đổi ngưỡng |
| Double submit/retry sau mất response | Một track/action event; requestId khác payload bị từ chối |
| Hai process đánh giá cùng track | Một chuyển trạng thái và một Inbox |
| Crash sau state/event/inbox write | Outbox khôi phục đủ, không mất hoặc nhân đôi sự kiện |
| Pause/archive/sửa cạnh tranh với worker | CAS chặn ghi đè; response conflict rõ ràng |
| Chạm vùng chỉ bằng tick/forming candle | Không entry_touched; chỉ evidence closed_candle hợp lệ |
| firstTouchedAt đã có ở baseline | Không thông báo lại như sự kiện mới |
| Invalidated và touched cùng quan sát | Một event ưu tiên invalidated, evidence giữ đầy đủ |
| Setup biến khỏi snapshot hoặc đổi version | missing/incompatible, không tự kết luận invalidated |
| Dữ liệu thiếu/rồi hồi phục | Giữ last valid; debounce 10 phút; mỗi đợt tối đa một unavailable và một recovered |
| Downtime/missed observations | Có gap; không bịa thời điểm sự kiện hoặc trạng thái trung gian |
| Terminal/pause/hết expiresAt | Terminal không hồi sinh; paused vẫn hết hạn theo dõi |
| User khác/admin đoán ID, count, cursor | Không thấy nội dung cá nhân; 404 detail, list/count đúng owner |
| Pending/disabled/mất quyền giữa phiên | API và worker chặn; không AI, không rò qua badge/cache |
| Concurrent create vượt quota | Atomic quota giữ đúng giới hạn, create lỗi trả lại slot |
| Không cấu hình AI | Toàn bộ P0 hoạt động bằng template |
| Tắt flag rồi bật lại | Lịch sử đọc được, không mất pending và không lặp event |
| Mobile/keyboard/hidden tab | Layout đọc được, focus đúng, polling dừng khi hidden |
| Regression | Market/setup/scoring, journal, decision support và trading không đổi |

Khi triển khai: chạy server tests liên quan + toàn bộ server suite và client build theo development guide; thêm kiểm chứng integration Mongo cho lease/outbox/unique index (mock đơn thuần không đủ). Không cần chạy runtime test cho lần chỉ viết spec này.

## 12. Phụ thuộc cần xác nhận khi triển khai

- Adapter phải xác nhận projection snapshot thật có identity, watermark, freshness và terminal setup đủ cho contract. Thiếu field thì bổ sung additive, không đoán từ primarySetup.
- P0 không bảo đảm nhận terminal đã biến mất khỏi nguồn trong downtime; UI phải trình bày missing/gap đúng như mục 4. Bảo đảm bắt mọi transition cần durable source event stream ở pha riêng.
- Quota và batch ở trên là giới hạn thiết kế ban đầu, chưa có số đo tải production. Chỉ tăng sau đo lag, CPU, Mongo và kích thước lịch sử.
