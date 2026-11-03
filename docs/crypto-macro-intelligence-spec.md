# Spec BA: Bối cảnh crypto, kinh tế vĩ mô và sự kiện

Ngày: **2026-11-03**. Version: **1.2**. Trạng thái: **P0a/P0b + News P1a (RSS)**; UX tiếng Việt; reaction/reminder/EU/correlation chưa.
Repo: `web-bot`. Spike nguồn: [crypto-macro-provider-spike.md](crypto-macro-provider-spike.md).

### Trạng thái shipped vs chưa làm

| Hạng mục | Trạng thái |
|---|---|
| P0a metric registry, per-metric provenance macro CG/F&G, snapshot/revision Mongo | **Shipped** |
| P0b tab Kinh tế & Tin tức — Bối cảnh + Lịch; yields/VIX/FRED; brief; checklist giờ VN | **Shipped** (mặc định `MARKET_ECONOMY_ENABLED=true`) |
| Calendar schedule this-week + coverage gap rõ + tìm kiếm + gợi ý VI | **Shipped kỹ thuật**; terms redistributor còn mở; next-week unavailable |
| News RSS allowlist (Google News VI/EN crypto+macro), tab Tin tức | **Shipped P1a** (`MARKET_ECONOMY_NEWS_ENABLED` mặc định true) |
| Actual/consensus/surprise từ official release | **Chưa** — schedule-only |
| AI rewrite / reaction / Inbox reminder / EU / correlation | **Chưa (P1b+/P2)** |

## 1. Quyết định sản phẩm

Mở rộng **Thị trường** thành nơi chuẩn bị và kiểm chứng nhận định crypto theo ba lớp: kỹ thuật, dòng tiền phái sinh, bối cảnh kinh tế/sự kiện. Giữ menu và engine hiện có; thêm tab **Kinh tế & Tin tức**. Không biến trang Tổng quan tài khoản thành terminal tin tức và không thay market-v1/mdash-v1 bằng một điểm tổng hợp mới.

Giá trị cốt lõi: người dùng biết sự kiện nào sắp diễn ra, số liệu nào thực sự mới, thị trường liên quan đang phản ứng thế nào, và dữ liệu nào chưa đủ để kết luận. Hệ thống đưa bằng chứng và đường dẫn kiểm chứng; không tự suy CPI cao = phải Short BTC.

Quyết định mặc định đủ để triển khai khi qua gate nguồn:

- P0 ưu tiên Mỹ/USD, lịch công bố, lợi suất, VIX, recap có bằng chứng. EU ở P1.
- Lịch mặc định ngày hôm nay theo Asia/Ho_Chi_Minh; API lưu UTC. Thời gian thống kê PnL cũ vẫn UTC.
- BTCUSDT/ETHUSDT làm benchmark phản ứng crypto; nguồn Futures hiện có, ghi rõ venue/instrument.
- Không thêm dependency; không sao chép stack Next.js/SQLite của OpenTerminal.
- Feed consensus/actual không đạt chuẩn thì ẩn phần thiếu và ghi lý do; không tạo giá trị giả cho đủ giao diện.
- Không gửi Telegram/email, không tự pause bot, không thay sizing hoặc mở/đóng lệnh trong scope này.

## 2. Người dùng, nhu cầu và tiêu chí giá trị

| Persona | Công việc cần giải quyết | Kết quả mong muốn |
|---|---|---|
| Operator bot | Trước phiên: hôm nay có CPI/FOMC/NFP không, giờ nào? | Thấy sự kiện kế tiếp và nguồn lịch trong <=30 giây |
| Người phân tích crypto | BTC tăng cùng USD/lợi suất hay đang phân kỳ? | Xem các số liệu cùng thời điểm/phiên, hiểu giới hạn so sánh |
| Người theo dõi nhiều coin | Tin nào liên quan coin đang xem? | Đọc headline có nguồn và mở đúng coin kỹ thuật/dòng tiền |
| Người nghiên cứu | Sau công bố, giá phản ứng ra sao và actual có đúng kỳ không? | Xem release, revision và return sau sự kiện; không nhầm tương quan với nguyên nhân |

User stories:

- US01: tôi xem nhanh các sự kiện quan trọng trong 24 giờ tới, đổi timezone và không bị lệch giờ DST.
- US02: tôi mở một sự kiện, so forecast/previous/actual đúng metric, kỳ, đơn vị và trạng thái revision.
- US03: tôi xem đường cong lợi suất và mức thay đổi theo basis point của các kỳ hạn cùng ngày.
- US04: tôi chuyển từ tin/sự kiện sang kỹ thuật hoặc dòng tiền BTC/ETH mà không mất ngữ cảnh URL.
- US05: tôi đọc recap có link tới facts, nhận biết ngay phần dữ liệu cũ hoặc chưa có.
- US06 (P1): tôi đo phản ứng sau công bố trên nến đã đóng và theo dõi sự kiện bằng Inbox cá nhân nếu đã có quyền phù hợp.

Không dùng số lượt mở lệnh hay lợi nhuận ngắn hạn làm KPI thành công của tính năng.

## 3. Baseline đã kiểm tra và gap thật

Chuỗi hiện tại: `MarketHubPage` → `market-hub.js` chuẩn hóa URL/quyền → chỉ mount tab active → API domain → read model/store → collector nền. Ba tab hiện có: Kỹ thuật, Dashboard, Dòng tiền.

| Năng lực | Evidence hiện tại | Quyết định |
|---|---|---|
| BTC/ETH giá, dominance, market cap, F&G | `market-dash/collector/macro.js`, `getDashOverview`, `MarketDashPage` | **Reuse**, không gọi CoinGecko lần hai |
| Macro snapshot freshness | Macro gán updatedAt mỗi lần collect; fallback giữ số cũ với stale chung; read-api tính tuổi updatedAt | Bổ sung provenance từng metric trước khi sử dụng cho recap; fallback không được làm mới tuổi số cũ |
| Volume thị trường | Collector đã lấy totalVolume nhưng topBar chưa công bố đầy đủ | Additive expose nếu hợp lệ; không thêm provider |
| Heatmap/Pulse/Scanner | `market-dash/read-api.js`, `docs/market.md` | Giữ nguyên formula/universe/cadence; không làm crypto board thứ hai |
| BTC regime/breadth/brief | `market/market-context.js`, Market Intelligence P0 | Kế thừa facts và nhãn; không tạo brief kỹ thuật song song |
| Funding/OI/taker, Smart Money | Domain hiện có | Link/ghép facts được phép; không thay collector hoặc diễn giải OI là tiền ròng vào crypto |
| Lịch kinh tế, US yields/VIX, RSS | Chưa thấy implementation chuyên biệt trong domain đã rà | Năng lực mới |
| Inbox và research | Model `web_inbox_items` và domain research đã có | Chỉ tích hợp P1, kiểm tra route/quyền thực tế trước khi mở rộng |
| Layout kéo thả, TV, cổ phiếu/options | Không phục vụ nhu cầu cốt lõi copy-trade Futures | Loại khỏi roadmap này |

Specs liên quan: [Market Intelligence](market-intelligence-spec.md), [Market Hub](market-hub-spec.md), [Market Dashboard](market.md), [Research & Inbox](research-tracking-inbox-spec.md), [Trực quan hóa](data-visualization-spec.md), [Auth](auth-rbac-spec.md).

## 4. Lọc tính năng OpenTerminal và bổ sung BA

| Ý tưởng | Phù hợp | Phương án web-bot | Đợt |
|---|---|---|---|
| Crypto board/dominance | Cao nhưng trùng | Nâng provenance + volume, lịch sử dominance từ thời điểm thu thập | P0/P1 |
| Chart và indicator | Đã có nền | Giữ chart hiện tại; bổ sung marker event sau khi đủ semantics | P1 |
| US yield curve/VIX | Cao | Macro cards + curve, phiên quan sát và lịch sử | P0 |
| ETF proxy dollar/equity/gold/oil | Có giá trị nhưng nguồn chưa chốt | Adapter tùy chọn; nhãn proxy rõ, không chặn core yields/calendar | P1 |
| EU curve/ECB/HICP | Trung bình | Region EU theo nhu cầu, tách khỏi US | P1 |
| Economic calendar | Rất cao | Lịch có event identity, actual revisions, giờ chính xác/ước tính | P0 |
| Tin tức gộp nguồn | Cao | RSS allowlist, dedupe, link tài sản đã xác minh | P1 |
| Market recap | Cao | Template bằng facts; AI rewrite tùy chọn | P0/P1 |
| Watchlist/link symbol | Cao, có nền | Tái dùng watchlist đúng quyền; liên kết từ news/detail về tab hiện hành | P1 |
| AI chat tổng quát | Trung bình, có nền AI | Không làm chat mới; mở rộng facts/report có version khi cần | P1 |
| Stock fundamentals/options/earnings/insider/FINRA | Thấp với sản phẩm hiện tại | Không làm; không gọi stock short-volume là crypto short ratio | Ngoài scope |
| TV/workspace kéo thả | Thấp so với chi phí | Không làm trong roadmap này | Ngoài scope |
| **Countdown và cửa sổ sự kiện** | Rất cao | Tính từ lịch đã xác minh; trạng thái sắp tới/đến giờ/chờ actual | P0 |
| **Observed reaction** | Cao | Return BTC/ETH + high/low sau công bố; tách quan sát và nguyên nhân | P1 |
| **Historical surprise/revision** | Cao cho nghiên cứu | Lưu first-seen actual, revised actual, forecast biết trước công bố | P0 lưu / P1 UI |
| **Nguồn và chất lượng từng fact** | Bắt buộc | asOf/observedAt/collectedAt, kỳ tham chiếu, publication lag, partial | P0 |
| **Event reminder cá nhân** | Hữu ích, không bắt buộc | Opt-in Inbox, không gửi ra ngoài | P1 |
| **Correlation BTC–macro** | Hữu ích nhưng dễ sai | Research view cùng phiên, đủ mẫu và return definition | P2 |

P0 là một phần có ích độc lập: lịch + core macro + recap bằng facts, không cần news/AI hoặc quote ETF để chạy.

## 5. Information architecture và URL

```text
Thị trường
  Kỹ thuật | Dashboard | Dòng tiền | Kinh tế & Tin tức

Kinh tế & Tin tức
  Bối cảnh | Lịch kinh tế | Tin tức (P1)

Bối cảnh
  [BTC/ETH, BTC.D/ETH.D từ snapshot hiện có]
  [Sự kiện High kế tiếp: tên · giờ VN · countdown · xem lịch]
  [US 2Y] [US 10Y] [10Y−2Y] [VIX close]
  [Yield curve + dữ liệu] [Các công bố gần nhất + trạng thái]
  [Bản tin bối cảnh: tối đa 4 facts có link]

Lịch kinh tế
  Hôm nay | Tuần này | 7 ngày tới | Tùy chọn
  USD/EUR | High/Medium/All | timezone | từ khóa
  Giờ | Sự kiện | Kỳ | Mức ảnh hưởng | Forecast | Previous | Actual
  [Panel sự kiện: nguồn · revision · phản ứng BTC/ETH ở P1]
```

URL mới, tên đề xuất chưa có runtime:

- `/market?tab=economy&econView=context&region=us`
- `/market?tab=economy&econView=calendar&econRange=today&econImpact=high&econCurrency=USD&econTz=Asia%2FHo_Chi_Minh&event=EVENT_ID`
- `/market?tab=economy&econView=news&newsSymbol=BTCUSDT&newsTopic=crypto` (P1).

`tab=economy`; `econView=context|calendar|news`; mặc định context, region us. Calendar mặc định today, high+medium, USD. Query mới có namespace, không tái sử dụng `tf/top/side` với nghĩa khác. newsSymbol không ghi đè symbol panel kỹ thuật cho tới khi user chọn “Xem kỹ thuật”. Giữ query các tab không active; chỉ gửi allowlist đúng domain vào API.

Đổi view/tab/event dùng history push; gõ tìm kiếm debounce 300ms và replace; Back/Forward/reload khôi phục state. URL lặp key lấy giá trị đầu rồi chuẩn hóa. Input timezone không hợp lệ về Asia/Ho_Chi_Minh, không dùng offset cố định cho vùng có DST. Range custom tối đa 31 ngày; sự kiện ngoài phạm vi vẫn mở detail bằng ID nếu được lưu.

Khi provider chưa có lịch tuần tới: 7 ngày tới vẫn truy vấn đúng range, thông báo **coverage chỉ tới ...**, không biến phần chưa có thành “không có sự kiện”. View news trước P1 không hiển thị; deep-link fallback context với notice.

Desktop >=1200px: hai cột curve/calendar summary và detail; tablet drawer; mobile 360px card/list, panel toàn chiều rộng, không tràn trang. Không mount tab inactive; chỉ mở tối đa hai chart chính. Giữ layout Tổng quan tài khoản; P1 có thể thêm một link sự kiện nhỏ, không copy toàn bộ macro sang đó.

## 6. Luồng nghiệp vụ

### F1 — Chuẩn bị trước phiên

Vào Bối cảnh → đọc nguồn/tuổi từng card → xem event High kế tiếp trong 24h → mở lịch hoặc event detail → mở kỹ thuật BTC/ETH khi có quyền. Nếu chưa có coverage lịch, hiển thị “Chưa xác nhận lịch”, không “không có rủi ro”. Không tự POST refresh hoặc chạy AI khi mở trang.

### F2 — Trước/sau công bố

Chọn event → thấy scheduledAt, độ chính xác giờ, referencePeriod, forecast/previous → tới giờ chuyển **Đến giờ công bố — chờ actual** → khi nguồn actual hợp lệ có observedAt thì hiện **Đã có số liệu** → P1 mở reaction theo nến đóng. Đổi giờ công bố tạo schedule revision, giữ event identity và lịch sử, countdown tính lại.

Một sự kiện có thể có nhiều metric (headline CPI, core CPI, YoY/MoM); release group chung nhưng mỗi metric có identity riêng. Không nhét nhiều con số vào cùng actual hoặc dùng tên gần giống để ghép.

### F3 — Đọc tin theo coin (P1)

Chọn tab news → nguồn/giờ/topic → chọn ticker được asset registry xác nhận → mở headline về site nguồn hoặc chọn “Xem kỹ thuật / Dòng tiền”. Symbol mơ hồ như ONE/NEAR không tự gán coin bằng substring; thông tin không xác minh được vào mục tin chung.

### F4 — Nhắc sự kiện (P1)

User có `market.view` bấm Theo dõi, chọn 15 hoặc 60 phút → lưu subscription actor → worker tạo Inbox đúng một lần trước scheduledAt → user mở Inbox dẫn event detail. Không catch-up reminder cho event đã qua khi restart. User bỏ theo dõi/hết quyền → dừng tạo reminder mới.

## 7. Yêu cầu chức năng và business rules

### FR01 — Crypto context reuse

Dùng topBar/getMacro hiện có cho BTC.D, ETH.D, totalMarketCap, totalVolume, F&G. Hiển thị global USD khác Binance Futures USDT; không cộng hai đại lượng. Không dùng lịch sử dominance của provider khác làm cùng chuỗi mà không đánh dấu đổi nguồn.

Thêm provenance từng metric theo additive, giữ legacy field. Khi fallback giữ giá cũ, giữ observedAt/sourceAsOf cũ; collectedAt mới chỉ thể hiện lần thử gần nhất. Không đánh đồng CG global mới với F&G cũ bằng một cờ stale chung. Lịch sử bắt đầu từ lần thu thập, không backfill giả bằng snapshot hiện tại.

### FR02 — Core macro US

Registry khởi đầu:

| Metric | Series/source candidate | Hiển thị |
|---|---|---|
| US 3M, 2Y, 5Y, 10Y, 30Y | FRED DGS3MO/DGS2/DGS5/DGS10/DGS30 | % lợi suất, observationDate, Δbp từ phiên có dữ liệu trước |
| Spread 10Y−2Y | Derive DGS10−DGS2 | bp, cùng observationDate; thiếu ngày chung thì null |
| VIX | FRED VIXCLS | Index, **daily close**, không gọi realtime hay thước đo IV của BTC |
| Fed target range | DFEDTARL + DFEDTARU, sau khi mapping được xác minh | lower/upper %, không chỉ lấy upper làm toàn range |
| CPI/Core CPI/NFP/unemployment | Provider release/series mapping xác minh | Latest release, referencePeriod, SA/NSA và unit rõ |

`deltaBp=(yield_latest-yield_previous)*100` khi yield lưu dạng phần trăm. Cùng kỳ hạn/cùng source, previous là quan sát hợp lệ liền trước. Spread âm chỉ gọi “đường cong đảo ngược ở cặp 10Y−2Y”; không tự dự đoán recession/giá BTC.

Yield curve dùng ngày chung mới nhất cho mọi tenor được vẽ. Thiếu tenor: gap và coverage; không nối chuỗi khác ngày mà giấu khác biệt. Nếu không có ngày chung đủ hai tenor, dùng bảng số theo từng ngày và ẩn curve. Chart có trục tenor/% và bảng thay thế.

P1 ETF proxies: SPY/QQQ/UUP/GLD/USO/TLT hoặc nguồn chỉ số gốc đã được xác minh. Mỗi card có assetType, currency, session/date và provider. UUP không gọi DXY spot; GLD không gọi giá vàng giao ngay; USO không gọi WTI front-month. P1 EU: ECB curve/DFR/HICP, tách series và ngày, không ghép US/EU thành một curve.

### FR03 — Economic calendar

Fields bắt buộc: stable eventId, releaseGroupId, metricKey, country/currency, title, scheduledAt hoặc scheduledDate, timePrecision, impact, referencePeriod, source/sourceEventId/sourceUrl, status, coverage.

State nghiệp vụ: `scheduled | due | released | postponed | cancelled | unknown`. Quality độc lập. Giờ không chắc/all-day → `timePrecision=date|tentative`, không countdown giây và không tự gán 00:00 thành giờ công bố.

- Countdown dựa serverNow và scheduledAt, cập nhật local; server mới quyết định due/released. Lệch clock client >60s có thông báo, không làm thay timestamp nguồn.
- Badge “Trong 60 phút”/“Trong 15 phút” là cửa sổ thời gian cấu hình UX, không là xác suất biến động hay khuyến nghị giảm vị thế.
- Không có release sau giờ dự kiến → due, actual=null; tuyệt đối không dùng previous làm actual.
- Forecast/actual phải kèm numericValue nếu parse được, displayValue gốc, unit, scale, SA/NSA, period, source và knownAt.
- Forecast đóng băng phiên bản cuối **đã biết trước actual/công bố**, không dùng forecast cập nhật sau để tính surprise lịch sử. Thu thập muộn không chứng minh giá trị đã được biết trước sự kiện: `forecastKnownBeforeRelease=false`.
- Previous có original/revised nếu nguồn phân biệt. Actual có firstObserved/revisions; không ghi đè mất lịch sử.
- Giá trị null/chuỗi rỗng/NaN khác 0. Event cancelled/postponed không xóa khỏi lịch sử.

**Surprise:** chỉ tính khi forecast và actual cùng metric/period/unit/scale/adjustment. Rate → percentage point (có thể đổi bp hiển thị); payroll → nghìn việc làm; CPI YoY → pp. Không tính phần trăm surprise chia forecast khi forecast=0. Không gắn “tốt/xấu cho BTC” tự động.

FRED series là chuỗi quan sát, không mặc nhiên là first-release actual. Không ghép latest theo regex tên sự kiện; không lấy CPI seasonally adjusted YoY thay NSA consensus, không lấy revision mới làm actual thời điểm cũ. Nếu chỉ có series-derived thì hiển thị mục **Quan sát từ series**, không đưa vào actual/surprise và không đánh dấu released từ đó.

### FR04 — News feed (P1)

RSS/API từ danh sách nguồn cố định được kiểm tra quyền sử dụng, mặc định crypto/macro. Chỉ title, publisher, canonical URL, publishedAt, collectedAt, topic, liên kết asset có evidence; không scrape toàn bài.

- Source không có publishedAt: hiển thị “Chưa rõ giờ đăng”; không lấy collectedAt làm thời gian tin.
- Dedupe theo canonical URL/provider ID; tiêu đề gần giống dùng nhóm tin, không xóa mất hai sự kiện khác chỉ vì giống 80 ký tự đầu.
- Sort theo publishedAt giảm dần + ID ổn định; filter trước limit, cursor ổn định.
- Link chỉ http/https, URL provider allowlist khi fetch; client render text, không inject HTML. Không cho user nhập URL nguồn tùy ý.
- Coin mapping qua registry ID/aliases có kiểm soát. Không gọi tin “verified fact” chỉ vì có RSS.
- Không có sentiment score trong P1; không tự tạo trading signal từ headline.

### FR05 — Context brief / recap

P0 template bằng code: tối đa 4 facts (crypto context, yield/VIX, event kế tiếp, release gần nhất), mỗi fact có evidenceRefs, asOf, quality và link drill-down. Giữ nguyên technical brief hiện hành; recap này có tiêu đề **Bối cảnh kinh tế**, không tạo Market Pulse thứ hai.

Thiếu metric thì bỏ mệnh đề và báo coverage. Không khẳng định quan hệ nhân quả (“BTC giảm vì CPI”) từ dữ liệu đồng thời. SnapshotId/version tạo từ các input; timestamp xuất bản recap khác timestamp từng metric.

P1 AI rewrite theo nút bấm, dùng pipeline AI/provider hiện có; không tạo key/SDK/dependency mới. Chỉ gửi facts public đã lọc, không gửi account position/config. Validate mọi con số/evidence refs, lỗi thì fallback template. Tin và nội dung nguồn là dữ liệu không đáng tin, không là chỉ dẫn cho AI. AI không được đặt lệnh, tạo subscription hoặc mở quyền.

### FR06 — Phản ứng sau công bố (P1)

Observed reaction BTC/ETH Futures: H=5m/15m/1h. Chỉ bật nếu có actual publication timestamp đáng tin; scheduledAt chỉ cho chế độ **quanh giờ dự kiến**, nhãn riêng.

Baseline `P_base` là giá đóng nến 1m cuối cùng có closeTime **strictly trước** timestamp event; P_H là close nến 1m cuối cùng có closeTime <= eventTime+H. `returnPct=100*(P_H/P_base−1)`; dùng cùng venue/instrument, không trộn Spot/Futures. Chờ đủ horizon và nến đóng; missing candle/baseline hoặc mốc cuối lệch quá 2 phút → null và reason. Peak/trough đo high/low từ nến 1m đầu tiên mở sau event đến horizon; loại nến giao cắt event để tránh gán biến động trước event cho sau event. Công khai khoảng trống tối đa một nến ở biên.

Hiển thị scheduledAt, publicationAt và firstSeenAt riêng; polling thấy actual muộn không dùng firstSeenAt làm giờ công bố. Không tính PnL tài khoản, không gọi return sau sự kiện là tác động nhân quả. Event gần nhau hiển thị badge “Có sự kiện khác trong cửa sổ”. Không dùng reaction như backtest chiến lược.

### FR07 — Nhắc sự kiện (P1)

Subscription opt-in, actor sở hữu; offsets allowlist 15/60 phút, tối đa 50 event active/user. Inbox unique key gồm owner + eventId + offset; sửa giờ trước reminder thì cập nhật lịch, sau khi đã gửi chỉ tạo một schedule_changed event có revision, không gửi lại nhắc cũ. Khi cancelled thì hủy nhắc chưa gửi.

Worker kiểm tra quyền mới nhất và subscription còn active trước ghi; lease/idempotency qua Mongo, không timer per user. Không notify retrospective data/backfill. Mở detail không tự subscribe/đánh dấu read; dùng semantics Inbox hiện hành. Reminder chỉ đảm bảo best-effort với polling, UI nêu rõ không phải báo động thời gian thực.

## 8. Nguồn dữ liệu và gate trước triển khai

| Domain | Candidate | Cam kết P0 / điều kiện |
|---|---|---|
| Crypto global/F&G | Collector CG/alternative.me hiện có | Reuse; lưu timestamp gốc và quyền attribution hiện hành |
| US daily yields/VIX | FRED series, CSV/API tùy quyền nguồn | Verify unit/frequency/observation date/terms; không hứa miễn key vĩnh viễn |
| Lịch schedule | Provider lịch có event identity; Forex Factory feed là candidate tham khảo | Spike parse/coverage/timezone/terms và 429; feed một tuần không hứa tuần sau |
| Actual/consensus | Release-specific official/provider có period/unit/vintage rõ | Nếu chưa có actual đáng tin thì schedule-only, không chặn lịch |
| EU | ECB SDMX/API | P1, verify series IDs/schema/terms |
| Proxies | Provider quote phù hợp, chưa chốt | P1 gated; không gọi scrape endpoint là SLA ổn định |
| News | RSS publisher/aggregator cho phép sử dụng | P1, verify publisher attribution và access |
| Reaction | Candle store Binance Futures hiện có | P1, verify 1m retention và closeTime; không tải vô hạn theo event/client |

Provider spike bàn giao trước code UI kết nối thật: fixtures hợp lệ/lỗi, metric mapping registry, timezone/DST, độ trễ, quota, nguồn URL, terms/attribution, fallback và chi phí. Không mặc định source public = được redistribute trên web nhiều user.

P0 gate: ít nhất calendar schedule + core macro đạt. Nếu feed calendar không đạt, macro vẫn triển khai độc lập nhưng phải ghi **P0 calendar blocked**, không tuyên bố toàn đợt hoàn thành. Mock chỉ dùng QA/dev và được gắn nhãn, không làm fallback production.

## 9. Dữ liệu, contracts và kiến trúc đề xuất

Tất cả tên endpoint/model sau là **proposal**, chưa có trong runtime. Dùng namespace `/api/market/economy/*`, không tạo API `/api/macro` song song ngoài Market.

```text
Providers allowlist
 → collector tasks trong lifecycle scheduler thị trường hiện có
 → parse/validate + metric registry + publication/vintage metadata
 → Mongo latest/history/event revisions (+ Redis read snapshot)
 → read-api theo quyền
 → MarketHub economy / dashboard links / P1 Inbox
```

Không kéo toàn bộ OpenTerminal. Mở rộng module market-dash/market hiện tại bằng task/service có trách nhiệm rõ; không viết lại engine. GET mới chỉ đọc stored snapshots, không gọi sàn/feed/AI. Shared lease riêng từng task, tránh task macro giữ lease scanner; không thay cadence ticker/derivatives.

### Envelope

```json
{
  "schemaVersion": 1,
  "formulaVersion": "economy-context-v1",
  "generatedAt": "2026-11-03T03:00:00.000Z",
  "serverNow": "2026-11-03T03:00:00.000Z",
  "coverage": { "status": "partial", "reasons": ["calendar_next_week_unavailable"] },
  "metrics": [{
    "id": "us.yield.10y",
    "value": 4.00,
    "unit": "percent",
    "source": "fred",
    "sourceSeriesId": "DGS10",
    "observationDate": "2026-11-02",
    "sourceAsOf": null,
    "lastSuccessfulFetchAt": "2026-11-03T02:55:00.000Z",
    "lastAttemptAt": "2026-11-03T02:55:00.000Z",
    "frequency": "business_daily",
    "quality": "fresh",
    "marketState": "closed",
    "reason": null
  }]
}
```

Ví dụ số giả, không là báo giá thật. Các metric khác có referencePeriod, adjustment, scale, venue/instrument, sourceUrl khi cần. `quality=fresh|stale|missing|error|warming`; `coverage=complete|partial|unavailable` độc lập; giữ enum domain cũ, thêm mapping có version.

### APIs

| Endpoint | Contract |
|---|---|
| GET `/context?region=us` | Core metrics, latest crypto refs, next event, template brief, source health |
| GET `/series/:metricId?range=30d|90d|1y` | Registry allowlist; units/observation dates, gaps; không nhận arbitrary FRED ID/URL |
| GET `/calendar?from=&to=&currencies=USD&impact=high,medium&limit=50&cursor=` | UTC [from,to), <=31 ngày; count + coverageFrom/To + pagination |
| GET `/events/:eventId` | Event, metric records, revision history phân trang, provenance |
| GET `/events/:eventId/reaction` (P1) | Stored reaction windows + candle coverage; GET không enqueue backfill |
| GET `/news?symbol=&topic=&limit=30&cursor=` (P1) | Metadata headlines, registry assets, source health; max limit 100 |
| POST `/brief` (P1) | Optional AI rewrite snapshotId hiện có; CSRF/quota/cost cap, không nhận facts tự do từ client |
| PUT `/subscriptions/:eventId` (P1) | Idempotent set offsets, owner từ session; không nhận ownerUserId client |
| DELETE `/subscriptions/:eventId` (P1) | Chỉ subscription actor; có CSRF |

Prefix mọi dòng là `/api/market/economy`. Input sai trả 400; unknown allowed resource ID trả 404; unauthorized 401/403; quota 429 + Retry-After. Có stored partial/stale trả 200 kèm trạng thái; DB/read system không phục vụ được trả 503. Không dùng 200 với actual=0 giả khi nguồn lỗi.

### Persistence đề xuất

- `market_economy_metrics`: unique metricId/source/observationPeriod/vintageKey; lưu latest/revisions tối thiểu. Index query metricId+date. Source series backfill đánh dấu historical, không giả availableAt là ngày quan sát.
- `market_economy_events`: unique source/sourceEventId/metricKey; canonical eventId, releaseGroupId, schedule revisions. Không lấy scheduledAt làm identity vì lịch có thể đổi.
- `market_economy_event_values`: append-only eventId/field/vintageKey; forecast/actual/previous revisions, firstSeenAt và knownBeforeRelease. Khi provider không có revision ID, hash normalized value+referencePeriod+source chỉ tạo revision lúc giá trị đổi.
- `market_economy_news` (P1): unique canonicalUrlHash/providerArticleId; publishedAt index, assetIds/topic. TTL 30 ngày.
- `market_economy_subscriptions` (P1): ownerUserId/eventId unique; offsets, revision, active.
- Latest cache Redis tái dùng store infrastructure. News/reminder không trộn với per-account cache. Events/values/metrics giữ 24 tháng mặc định; purge job riêng theo observation/event date có policy, không tự xóa subscription đang active. Reaction giữ cùng event; Inbox retention hiện tại giữ nguyên.

Đây là logical data model; implementation có thể gộp model nếu bảo toàn revision/history/query budget, phải cập nhật spec. Không tạo Mongo indexes tự phát khi đọc GET; theo startup/migration convention hiện có.

## 10. Phân quyền và giới hạn tin cậy

Authority: [auth-rbac-spec](auth-rbac-spec.md) và `server/src/auth/access-control.js`. Không thêm role hoặc sửa template quyền trong scope này.

- Đọc economy/context/calendar/news/series/reaction: cùng gate **market read** hiện tại (`market.view` OR `positions.view` OR `orders.view` OR `statistics.view`) + requireAuth. UI `canEconomy=canTechnical`; chỉ có smart_money.view không tự được economy.
- Template brief thuộc GET read. P1 AI POST cùng market-read gate + CSRF + rate limit 1/15s/user và giới hạn quota AI hiện có, lấy mức nghiêm hơn.
- Subscription/Inbox: riêng `market.view`, theo ownership; quyền Terminal chỉ đủ xem economy, không tự mở quyền Inbox. Không cấp permission mới vì muốn bật reminder.
- Các endpoint đọc public-market data không đưa tài khoản/vị thế bot vào payload; link Terminal vẫn theo quyền riêng. Mất quyền trong phiên dừng poll/AI/subscription tương ứng; không tin session cache cũ.
- User không có quyền nhận 403 dù dữ liệu market dùng cache chung. Pending/disabled xử lý theo auth hiện tại.
- Không có refresh collector public trong P0. Nếu thêm manage refresh sau, cần market.manage + queue lease/quota riêng, không GET refresh.

Khi triển khai phải cập nhật bảng endpoint/quyền trong authoritative spec cùng tests; tài liệu này chưa sửa quyền runtime.

## 11. Cadence, freshness và hiệu năng

| Tác vụ | Cadence đề xuất | Lưu ý |
|---|---|---|
| Crypto global/F&G | Giữ 5 phút collector hiện có | F&G daily, timestamp nguồn quyết định tuổi observation |
| Daily yields/VIX/series | 60 phút | Chỉ kỳ vọng quan sát mới theo lịch công bố/phiên; không polling 1s |
| Calendar schedule | 15 phút | Giá trị coverage có thể ngắn hơn range yêu cầu |
| Release actual | 5 phút từ T−15 tới T+120 phút, sau đó 60 phút trong 24h | Chỉ khi provider quota/terms cho phép; không cam kết công bố tức thời |
| News P1 | 5 phút/source | Jitter/bounded concurrency, dedup toàn server |
| Reminder P1 | 60 giây | Lease và idempotency bền qua restart |
| Browser context/calendar | 60 giây khi visible | Countdown local 1s không fetch server 1s |

Freshness gồm **source freshness** và **fetch health**. Daily source cuối tuần vẫn là phiên cuối đã công bố, không tự stale sau 15 phút; stale khi bỏ lỡ kỳ công bố kế tiếp theo source calendar + grace period hoặc collector quá hạn. Chưa có calendar release đáng tin: badge “Chưa xác minh độ mới”, không đánh fresh tuyệt đối. Fetch lỗi giữ last-good với tuổi thật, kể cả khi metric khác vừa thành công.

Timeout provider 12s, concurrency tối đa 3/provider mặc định, no-overlap, exponential backoff 1/5/15/60 phút + jitter; Retry-After thắng lịch retry. Circuit mở sau 5 failure liên tiếp, probe sau 15 phút; thành công phục hồi từng nguồn. Multi-instance dùng lease per task; restart không replay reminder/AI.

GET context mục tiêu p95 <700ms với snapshot đã có; payload <=100KB. Calendar page <=50 mặc định; detailed history/news tải lazy. Đây là mục tiêu phải đo bằng fixture/load test, chưa là số đo production. Shared server quota hiện hành là trần tổng, route mới không bypass.

## 12. Phasing và dependency

| Đợt | Nội dung | Điều kiện hoàn thành |
|---|---|---|
| P0a — Data foundation | Provider spike, registry units, per-metric timestamp, snapshot/revision store | Mapping/terms/fixtures/coverage đạt; legacy macro fields còn tương thích |
| P0b — Calendar + US context | Tab economy, context cards, calendar/detail, countdown, code brief | US yields/VIX + schedule hoạt động; actual chỉ bật metric đã kiểm chứng; rõ coverage |
| P1a — Tin và liên kết | RSS feed, asset mapping, drill-down, template/optional AI mở rộng | Không trùng news domain; provenance/AI evidence tests |
| P1b — Nghiên cứu sự kiện | Reaction, actual/surprise history, opt-in Inbox | 1m history/publication timestamp/ownership/dedupe đạt |
| P1c — Cross-asset/EU | ETF proxy, ECB/HICP, lịch sử dominance | Provider/normalization/session lịch giao dịch đạt |
| P2 — Correlation/replay | Research correlation, vintage-aware replay | Đủ lịch sử thực, không look-ahead; spec riêng trước code |

Không gộp tất cả thành một PR lớn. Mỗi đợt có docs, migration nếu có, tests, feature flag/quy trình bật và rollback độc lập. Không ước lượng ngày công cứng trước provider spike.

Feature flags đề xuất: `MARKET_ECONOMY_ENABLED`, `MARKET_ECONOMY_NEWS_ENABLED`, `MARKET_ECONOMY_REACTION_ENABLED`, `MARKET_ECONOMY_REMINDERS_ENABLED`; mặc định false cho năng lực mới đến khi đạt release gate. Disabled thì ẩn tab/chức năng và dừng task tương ứng, không dừng market-dash hiện tại. Startup disabled không gây lỗi cấu hình provider mới.

## 13. Acceptance và test matrix

| ID | Given / When | Then |
|---|---|---|
| AC01 | Snapshot crypto hiện tại; mở economy nhiều client | Dùng cùng source/store, không tăng CG request theo số client; fields cũ không đổi |
| AC02 | CG thành công, F&G lỗi và fallback | F&G giữ observedAt cũ, warning riêng; CG không bị đánh stale theo F&G |
| AC03 | Daily yields cuối tuần/holiday | Hiện phiên gần nhất/next expected; không gọi realtime, không stale chỉ vì qua vài phút |
| AC04 | 2Y/10Y khác ngày, mark null/blank | Spread null hoặc dùng ngày chung có công bố; không coerce thành 0 |
| AC05 | Event giờ New York qua DST, user chọn VN/UTC | Cùng instant UTC, hiển thị đúng giờ; event date-only không countdown |
| AC06 | Đến scheduledAt nhưng chưa có actual | due/chờ số liệu, không copy previous; không chuyển released vì series-derived |
| AC07 | CPI YoY NSA forecast nhưng actual SA/MoM | Surprise null, lý do mismatch; không ghép regex tên gần giống |
| AC08 | Provider sửa actual/previous/giờ sau thu thập | Revision lưu được, first-seen còn nguyên, eventId không đổi |
| AC09 | Forecast thu thập sau release | Không tính historical surprise như forecast biết trước |
| AC10 | Range lịch 7 ngày nhưng feed chỉ tuần hiện tại | Coverage partial với coverageTo, không hiển thị ngày thiếu như không có event |
| AC11 | Provider timeout/429/sai schema | Backoff/last-good đúng tuổi, không retry loop, domain còn lại vẫn phục vụ |
| AC12 | Đổi tab/filter nhanh, hidden, Back/Forward | Request abort/stale response bỏ qua, một poll active, state theo URL |
| AC13 | Market-read allowed/denied, smart-money-only, pending/disabled | Server và UI cùng gate, cache không bypass; không cấp Inbox từ Terminal permission |
| AC14 | News HTML/script/URL lạ/ticker mơ hồ | Text an toàn, link hợp lệ, không SSRF, không gán coin sai |
| AC15 | Hai nguồn đăng cùng tin / hai tin tên gần giống | Dedupe/group đúng, vẫn giữ provenance và tin khác biệt |
| AC16 | Reaction chưa đủ H, gap nến, lịch lệch publication | Pending/null có lý do; chỉ nến đóng và đúng mốc, không look-ahead |
| AC17 | Hai worker/restart/sửa giờ/hủy event | Một reminder mỗi key; không notify quá hạn/backfill; revoke quyền ngừng gửi |
| AC18 | AI thiếu evidence/tạo số/nguồn cài instruction | Reject/fallback template; không ghi subscription/giao dịch |
| AC19 | Mobile 360px, keyboard, touch, reduced-motion | Đọc được toàn bộ state; tooltip focus, Escape/return focus; bảng thay chart |
| AC20 | So fixture market-v1/mdash-v1 trước/sau | Scores/setups/pulse/SLTP/own-qty không đổi; không thêm MQTT/trade side effect |

Test unit: validators, units/bp/spread, calendar DST/date-only, identity/revisions, strict surprise matching, reaction boundary, RSS normalization. Integration mock provider: cache/lease/rate-limit, source outage, quyền, migration/index. Không dùng feed live làm điều kiện deterministic của test và không khởi động app trên DB thật để test import.

Khi triển khai: `npm --prefix server test`, `npm --prefix client run build`, các pure client tests có liên quan, `git diff --check`; browser/network QA desktop/mobile, server request counts dưới tải. Lượt chỉ spec: kiểm tra link và consistency, không chạy runtime test/build.

## 14. Rủi ro, rollout và đo giá trị

| Rủi ro | Cách giảm |
|---|---|
| Provider lịch không cho phân phối hoặc thiếu consensus/actual | Gate terms/coverage; lịch schedule-only có nhãn; thay adapter trước khi phát hành phần phụ thuộc |
| Thay nguồn âm thầm làm thay đơn vị/meaning | Registry + contract tests + version/source-change marker |
| Revision/history gây look-ahead | firstSeenAt/vintage bất biến; không dùng backfill như lịch sử đã biết |
| Quá tải feed khi nhiều client/instance | Shared task lease/cache, GET read-only, quota/backoff |
| Hiểu macro như signal tự động | Facts và phản biện riêng, không score chung/automation giao dịch |
| Nhắc sự kiện bị trễ | Best-effort label, đo lag, không dựa reminder để điều khiển bot |

Rollout: fixtures → staging với nguồn được phép → P0a collector shadow → so mapping/date/coverage tối thiểu một chu kỳ công bố hỗ trợ hoặc replay fixture first-release/revision → bật read UI → P1 từng flag. Nếu chưa trải qua release thật thì ghi rõ chưa verify live release. Rollback tắt flag/task mới, giữ history và API cũ; không xóa Mongo để rollback UI.

Theo dõi vận hành: provider success/429/latency, last-good age, lịch coverage, event mapping failures, actual delay (chỉ khi có publicationAt), số mismatch không tính surprise, reminder lag/duplicate, GET p95 và task lease contention. Log metadata không chứa token/feed credential.

Đánh giá với 5 tác vụ: tìm sự kiện High kế tiếp; đổi VN↔NY đúng giờ; phân biệt forecast/actual/revision; phân biệt VIX close với BTC volatility; mở evidence của recap. Mục tiêu >=90% hoàn thành đúng trên bộ tình huống thử đã ghi nhận; tìm event <=30s, giải thích context <=2 phút. Đây là acceptance UX đề xuất, không claim số đo đã đạt.

## 15. Files dự kiến và docs cần cập nhật khi code

- `client/src/pages/MarketHubPage.jsx`, `client/src/lib/market-hub.js`: economy tab/gate/URL; giữ legacy redirect.
- Page/components economy trong thư mục Market theo convention hiện tại: context/calendar/news/detail, presentation thuần.
- `server/src/lib/market-dash/collector/macro.js`, `store.js`, `read-api.js`: per-metric provenance và compatibility fields.
- Collector/read service economy + provider adapters/registry trong domain thị trường; route economy, model/index được đăng ký theo pattern hiện có; lifecycle startup/shutdown và lease per task.
- P1 nghiên cứu/Inbox: trace route/worker thực tế, giữ unique sourceEventId và actor ownership hiện có.
- Docs khi triển khai: index, feature-spec, flows, api-data-reference, auth-rbac endpoint table, market-hub, market.md, market-intelligence, development test map. Không đổi trạng thái P2 cũ thành shipped chỉ vì spec này tồn tại.

## 16. Nguồn và quyết định còn phải xác minh

Đã rà OpenTerminal commit `aed097c680cd8ec1c391ae06966babe7d6d91fc6`. Lấy ý tưởng UX/provider separation, không cam kết feed của họ phù hợp production web-bot.

- [OpenTerminal macro/routes](https://github.com/ErTasselli/OpenTerminal/blob/aed097c680cd8ec1c391ae06966babe7d6d91fc6/server/src/routes/market.ts).
- [Calendar provider tham khảo](https://github.com/ErTasselli/OpenTerminal/blob/aed097c680cd8ec1c391ae06966babe7d6d91fc6/server/src/providers/econcalendar.ts): cách ghép latest FRED không đủ làm release-vintage contract của spec này.
- [FRED DGS10](https://fred.stlouisfed.org/series/DGS10): percent, daily; [VIXCLS](https://fred.stlouisfed.org/series/VIXCLS): daily close.
- [FRED CPIAUCSL](https://fred.stlouisfed.org/series/CPIAUCSL): index monthly seasonally adjusted; không tự tương đương mọi CPI release/consensus.
- [CoinGecko global reference](https://docs.coingecko.com/reference/crypto-global): kiểm tra tier/key/terms phù hợp; tận dụng collector hiện có trước.

Còn phải xác minh trong P0a: nhà cung cấp schedule/consensus/actual được phép sử dụng và quota; event identity/mapping; official publication timestamps; ngày công bố dự kiến mỗi source; policy attribution và retention. P1 thêm quote proxy/RSS providers, candle 1m coverage và Inbox route integration. Những điểm này là dependency có fallback rõ ở trên, không để implementer tự đoán actual/giờ/đơn vị cho đủ UI.
