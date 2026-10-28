# Thị trường — bảng Vị trí & Setup

Ngày: 2026-10-22. Trạng thái: **đã triển khai (v1)** — engine zone/setup + view location + R1 phụ thuộc.
Phạm vi: tab Kỹ thuật trong hub Thị trường của `web-bot`.

## 1. Mục tiêu và quyết định UX

Người dùng nhìn danh sách để tìm coin gần hỗ trợ/kháng cự, trong vùng mua/bán tiềm năng hoặc còn gần entry signal mới; mở panel để kiểm tra bằng chứng trước khi chuyển Terminal.

Tab Kỹ thuật có hai chế độ:

- **Vị trí & Setup**: mặc định mới; ưu tiên vị trí giá, vùng, setup và signal.
- **Điểm đa khung**: giữ ma trận market-v1, composite, filter và breakdown hiện có.

Cả hai dùng universe kỹ thuật hiện có, Top 10/25/50 mặc định 10 theo [Market hub R1](market-hub-spec.md#11-r1--truy-cập-dòng-tiền-từng-dòng-và-smart-money-top-50). Dòng tiền vẫn là tab riêng; nút cạnh symbol mở đúng panel flow. Không cộng flow, score và signal thành một điểm chung.

Phạm vi hoàn thành gồm bảng, vùng hỗ trợ/kháng cự, setup kỹ thuật có trạng thái, entry signal theo dữ liệu thật, filter/sort, panel giải thích, chất lượng dữ liệu và kiểm thử replay. Biểu đồ nến tương tác, vẽ tay, cảnh báo gửi ra ngoài và đặt lệnh tự động không thuộc bản này.

## 2. Hiện trạng và chuỗi dữ liệu

Đối chiếu source ngày viết:

| Hiện có | Tái sử dụng / phần còn thiếu |
|---|---|
| `market/candles.js`, `indicators.js`, `score-symbol.js` | Nến đóng, ATR14, chỉ báo và scheduler; không fetch lại nến cho mỗi lượt mở bảng |
| `market/smc-structure.js` | Pivot 2 trái/2 phải, cấu trúc, BOS/sweep và evidence OB/FVG; chưa phải danh mục vùng bền có ID/lifecycle |
| `market/score-frame.js` | Breakdown, structureBias, indicator; không lấy chuỗi explanation rồi parse thành tọa độ vùng |
| `market/store.js` và model latest/history/event | Lưu snapshot/cache hiện có; mở rộng additive, giữ market-v1 không đổi |
| `signal-history.js:listRecentSignalsBySymbols` | Đọc theo symbol, 72h mặc định; projection hiện không có giá entry; global fetch cap có thể làm thiếu signal của symbol ít tin |
| Schema bot `signal-info` | Có `prices`, `infos` dạng object; cần trace writer/normalizer trước khi xác nhận mapping entry/SL, không suy schema từ tên field |
| `MarketPage.jsx` | Ma trận, panel, signal gần đây; chưa có chế độ bảng mô tả ở đây |

Chuỗi mới: scheduler → nến đóng đã tải → indicator/pivot → vùng và setup → snapshot/latest/history → read-api ghép giá mới + signal đã normalize → filter/sort/limit → bảng/panel.

Chuỗi signal: writer bot → `signal_infos.prices`/metadata → read adapter allowlist → entry reference → so vị trí với giá hiện tại. Không sửa parser/writer bot nếu chưa chứng minh thiếu dữ liệu; không lấy giá fill của tài khoản để giả làm entry signal.

## 3. Bảng và panel

| Cột | Nội dung |
|---|---|
| Coin | Symbol, nút Xem dòng tiền, dấu watchlist nếu đã hỗ trợ đúng quyền |
| Giá | Giá tham chiếu, %24h, thời gian giá; nguồn giá thống nhất cho mọi khoảng cách trong response |
| Cấu trúc | Tăng / Giảm / Co hẹp / Mở rộng / Hỗn hợp / Chưa rõ; nhãn khung lớn riêng |
| Hỗ trợ | `[low–high]`, cách vùng bao nhiêu %, nguồn pivot và khung |
| Kháng cự | Như hỗ trợ |
| Vị trí | Trong/gần hỗ trợ, trong/gần kháng cự, breakout, retest, giữa vùng, xung đột hoặc chưa rõ |
| Setup kỹ thuật | Long/Short, loại setup, tuổi, vùng entry và trạng thái |
| Entry signal | Long/Short, nguồn, tuổi, vùng/giá entry, vị trí giá hiện tại; không trộn với setup |
| Xác nhận | Tối đa 3 badge ưu tiên: cấu trúc khung lớn, volume, divergence; chi tiết xem panel |
| Độ mới | Chất lượng giá/khung phân tích; stale/missing không dùng màu như dữ liệu đủ |

Desktop giữ symbol và vị trí dễ nhìn; mobile ưu tiên Coin/Giá/Vị trí/Setup, cột còn lại trong panel hoặc cuộn ngang. Không nhét toàn bộ indicators thành hàng chục cột.

Bấm dòng mở panel cùng symbol và khung, gồm:

1. Giá, hỗ trợ/kháng cự, thước giá đơn giản cho biết giá nằm đâu trong các vùng (không phải chart nến).
2. Nguồn vùng, thời điểm xác nhận, khoảng cách %, ATR, thời điểm hết hạn/vô hiệu.
3. Setup: điều kiện đạt/chưa đạt, entry, ngưỡng vô hiệu cấu trúc, trạng thái và lịch sử chuyển trạng thái.
4. Entry signal tách riêng theo nguồn/hướng; không che signal trái chiều bằng một nhãn tổng hợp.
5. Chỉ báo kỹ thuật, score đa khung và link flow/Terminal theo quyền hiện có.

## 4. Khung phân tích, giá và chất lượng

- Chọn `15m / 1h / 4h / 1d`, mặc định `1h`. Đây là khung xác định vùng/setup, độc lập `style` composite và `tf` panel ma trận.
- Khung lớn: 15m→1h, 1h→4h, 4h→1d; 1d không có khung lớn trong pipeline hiện tại, hiển thị N/A. Không fetch thêm 1w.
- Vùng/setup xác nhận chỉ từ nến đóng. Giá hiện tại chỉ cập nhật khoảng cách/vị trí và cảnh báo vượt ngưỡng tạm thời, không sửa lịch sử vùng.
- Mỗi response ghi `priceAsOf`, `priceSource`, `candleCloseTime`, `calculatedAt`, `zoneVersion`, `setupVersion` và `quality` theo nguồn.
- Giá quá 60 giây: vị trí hiện tại = `unknown` với last-known values màu muted. Khung phân tích/khung lớn dùng stale policy hiện có theo timeframe; không áp TTL 60 giây cho nến 1d.
- Chưa đủ nến/ATR, nến gap hoặc dữ liệu không hợp lệ: chưa phân loại setup; giữ row, báo warming/partial. Không ép null thành 0 hoặc dùng giá candle cũ giả làm live price.
- Nếu nguồn giá chỉ cập nhật cùng lần scoring, phải bổ sung timestamp và tái dùng feed giá public/cache hiện có; không thể nghiệm thu live distance chỉ bằng poll snapshot cũ.

## 5. Vùng hỗ trợ/kháng cự v1

Các tham số dưới đây là **quy tắc sản phẩm phiên bản đầu**, không tuyên bố đã được backtest hay tối ưu hiệu quả giao dịch. Lưu version để sau này đổi công thức không ghi lại lịch sử cũ.

### 5.1 Nguồn vùng bắt buộc

Bản đầu dùng swing pivot xác nhận: 2 nến trái, 2 nến phải, tái sử dụng `findSwings` và kiểm tra strict comparison/tie của helper bằng fixture. `confirmedAt` là closeTime của nến bên phải thứ hai, không phải openTime/pivot time. Chỉ tính khi nến đó đã đóng.

- Pivot low tạo support, pivot high tạo resistance.
- ATR14 tại nến xác nhận; band `[pivotPrice − 0.15 × ATR, pivotPrice + 0.15 × ATR]`, làm tròn hiển thị theo tickSize từ Mongo `futures_symbols` (`symbolInfo` trên list/detail API), tính toán engine giữ precision.
- ATR và band cố định khi tạo; không nới vùng theo ATR mới.
- ID ổn định từ symbol + timeframe + loại pivot + pivot time + zoneVersion.
- Hết hạn sau 50 nến khung phân tích kể từ xác nhận. Không tạo ID mới/đặt lại tuổi ở mỗi lần scan.
- Chưa gộp zone bằng thuật toán clustering. Vùng overlap được giữ riêng, panel nêu các nguồn; tie-break xác định như bên dưới.

OB/FVG hiện có chỉ là badge evidence của market-v1. **Không gọi là vùng mua/bán mới** nếu chưa có tọa độ, source candle, confirmedAt và lifecycle đầy đủ. Nâng OB/FVG thành zone có thể làm ở phase sau; không phải điều kiện hoàn thành swing-zone v1.

### 5.2 Vô hiệu, phá vỡ và retest

- Support bị phá khi một nến đóng dưới `low − 0.15 × ATR_at_confirmation`; resistance khi đóng trên `high + 0.15 × ATR_at_confirmation`.
- Wick xuyên vùng hoặc giá live vượt ngưỡng chưa đủ xác nhận: hiện “đang xuyên vùng — chờ đóng nến”.
- Chỉ ghi breakout một lần tại lần đầu vượt ngưỡng; không ghi lại BOS mỗi nến còn nằm ngoài vùng.
- Zone gốc thành `broken`; tạo vai trò đảo chiều liên kết `parentZoneId`, cùng band, `confirmedAt=breakout closeTime`, tuổi tối đa 50 nến mới. Mỗi zone gốc chỉ flip một lần; vùng flip bị phá tiếp thì vô hiệu, không flip qua lại vô hạn.
- Retest phải ở nến đóng sau breakout: nến giao band và đóng về phía thuận của band (Long: close > high; Short: close < low). Nến breakout không đồng thời được tính retest.
- Với flip Long, đóng dưới low−buffer làm vô hiệu; Short đối xứng. Thời điểm hết hạn/vô hiệu có hiệu lực vĩnh viễn cho ID đó.

### 5.3 Chọn vùng và tính khoảng cách

Với band `[L,H]` và giá P>0, khoảng cách tuyệt đối đến band `d=max(L−P,0,P−H)`; `distancePct=100*d/P`, `distanceAtr=d/ATR_current`. Hiển thị hướng trên/dưới vùng riêng, không dùng dấu phần trăm để suy direction trade.

- `inside`: L≤P≤H; `near`: d>0 và d≤0.5×ATR_current, còn lại far. Thiếu ATR chỉ tính %; near không được suy đoán.
- Hỗ trợ gần nhất: support/flip-support active chứa P hoặc nằm dưới P. Kháng cự đối xứng. Vùng vừa bị live xuyên được ghi riêng `pendingBreak`, không biến mất âm thầm vì không còn ở phía mong đợi.
- Chọn d nhỏ nhất; bằng nhau ưu tiên confirmedAt mới hơn, rồi zoneId để ổn định.
- Hai phía đồng thời inside/near: hiện hai badge + `conflict`; không tự chọn hướng mua/bán.
- `breakout/retest` là event có timestamp; badge “gần đây” chỉ trong 3 nến từ event. Không thay thế thuộc tính vị trí hiện tại.

## 6. Setup kỹ thuật v1

Hai loại: **bật lại vùng swing** và **breakout–retest**. Đây là setup để xem xét, không lệnh bot và không xác suất thắng.

### 6.1 Điều kiện tạo

- Dữ liệu khung phân tích và indicator cần thiết ready; zone active ở thời điểm trigger.
- Long bounce: nến giao support band, đóng trên H và close>open. Short: giao resistance, đóng dưới L và close<open.
- Retest: thỏa mục 5.2 trên vùng flip; Long yêu cầu close>open, Short close<open.
- Cấu trúc khung phân tích phải `bullish` cho Long, `bearish` cho Short. Khung lớn nếu có phải ready và không ngược hướng; 1d dùng N/A. Các trường hợp khác hiện “vùng quan sát/chờ xác nhận”, không gắn nhãn vùng mua/bán đủ điều kiện.
- RSI, volume, divergence và flow là evidence bổ sung; không âm thầm trở thành điều kiện bắt buộc hoặc sửa market-v1.
- `createdAt` là closeTime nến trigger, entry band = band zone, vô hiệu = L−buffer cho Long / H+buffer cho Short. Đây là **ngưỡng vô hiệu cấu trúc**, không phải lệnh stop-loss trên sàn.
- Một setup cho mỗi zoneId + hướng + loại + setupVersion; không tạo lại mỗi lần retest/scan. Setup ngược hướng có ID riêng và phải hiện xung đột.
- Hết hạn sau 12 nến kể từ tạo hoặc zone hết hạn/vô hiệu, tùy điều kiện đến trước. Không hồi sinh setup cũ khi giá quay lại.

### 6.2 Trạng thái không nhập nhằng

Tách hai field:

| Field | Giá trị |
|---|---|
| `lifecycle` | `active`, `invalidated`, `expired` |
| `entryState` | `awaiting_entry`, `in_entry`, `left_entry`, `unknown` |

- `in_entry`: giá mới hiện tại trong entry band, lifecycle active.
- `awaiting_entry`: chưa có chứng cứ chạm band sau thời điểm tạo và giá hiện ở ngoài band.
- `left_entry`: đã thấy giá hoặc nến sau tạo giao band rồi hiện ở ngoài band. Chỉ nghĩa đã rời vùng, không khẳng định đã có fill hay có lợi nhuận.
- Giá stale/missing → unknown. Chạm ngưỡng live chỉ cảnh báo; lifecycle invalidated theo nến đóng. Ưu tiên invalidated trước expired nếu cùng một nến chạm cả hai điều kiện.
- Không dùng nến trigger để coi entry đã khớp trước khi setup tồn tại. Ghi `firstTouchedAt` và `touchEvidence=closed_candle|price_observation`; quan sát giá không đủ để kết luận chưa từng chạm trong khoảng mất dữ liệu.
- Có gap quan sát/nến chưa được xử lý: trạng thái lịch sử không xác định phải unknown, không kết luận awaiting/left. Replay bổ sung nến đóng có thể khôi phục bằng chứng.
- Bảng chọn setup active trước, rồi createdAt mới nhất; panel giữ cả hai hướng và lịch sử terminal states. Bộ lọc hướng chọn đúng setup tương ứng, không chỉ lọc setup đã chọn đại diện.

## 7. Entry signal gần đây — nguồn riêng

Mặc định cửa sổ 72h; chọn 24h/72h/7d. Mỗi signal có ID, source, side, openTime, sourceStatus và `entryReference` nullable.

- Trace writer của `signal_infos.prices`/`infos`; chỉ allowlist field đã xác minh để normalize về `entryLow`, `entryHigh`, `stop`, `expiresAt`, `sourceField`, `referenceKind=range|point`. Không serialize nguyên object hoặc parse lại text bằng AI.
- Giá đơn giữ `low=high`, nhãn “giá entry tham chiếu”. Không tự nới thành vùng mua; có thể lọc “gần entry” bằng khoảng cách ATR, còn `in_entry` yêu cầu band thật hoặc bằng giá trong tick tolerance.
- Không có entry đáng tin: “Có signal Long — thiếu giá entry”; loại khỏi filter còn entry, vẫn nằm trong signal history. Không lấy giá hiện tại hay giá fill thay vào.
- Source `CLOSE` hiện “nguồn đã đóng”; không suy đây là TP, SL hay vô hiệu kỹ thuật. Source `OPEN` cũng không chứng minh entry còn hiệu lực.
- Với signal, tách `priceRelation=in_range|near|above|below|unknown` và `validity=source_closed|expired|unknown|active`. Chỉ active khi có contract nguồn về hiệu lực và đủ dữ liệu; thiếu SL/expiry/lifecycle → unknown. UI có thể nói “giá trong entry signal, hiệu lực chưa xác minh”.
- “Còn entry signal Long/Short” nghĩa nguồn chưa CLOSE, nằm trong cửa sổ tuổi, giá mới trong band; luôn kèm trạng thái validity, không đổi thành “setup hợp lệ”.
- Giữ nhiều nguồn/trái hướng, không gộp vùng entry giữa các kênh. Danh sách mỗi symbol/hướng cần giới hạn độc lập; tránh global cap khiến coin ít signal bị mất entry mới nhất. Trả `truncated` nếu không bảo đảm đủ.
- Test bằng fixture đã sanitize, không đọc secret hoặc đưa tên kênh/tài khoản thật vào docs.

## 8. Bộ lọc, sắp xếp và URL

URL mới: `/market?tab=technical&view=location&analysisTf=1h&top=10`.

- `view=location|scores`, mặc định location; `analysisTf=15m|1h|4h|1d`, mặc định 1h. `tf` cũ vẫn chỉ khung panel ma trận, không ghi đè analysisTf.
- `screen=all|near_support|near_resistance|buy_zone|sell_zone|entry_long|entry_short|retest|flow_aligned`; `entrySource=technical|signal`, mặc định technical. Nhãn preset entry phải thể hiện nguồn đang chọn.
- Near support/resistance gồm inside và near. Buy/sell zone = setup active tương ứng với giá in_entry và quality đủ. Near zone đơn thuần không được coi buy/sell.
- `recentHours=24|72|168`, mặc định 72 cho signal. Setup kỹ thuật theo tuổi 12 nến, không dùng recentHours để kéo dài hạn.
- `q`, `top`, `symbol` chia sẻ như hub; filter của hai view được giữ trên URL nhưng chỉ áp dụng ở view tương ứng. Filter scores hiện có không âm thầm lọc view location. URL sai normalize bằng replace; chọn filter/view dùng push, gõ q dùng replace.
- Flow aligned chỉ dùng flow snapshot được phép xem, fresh theo nguồn SM và bias cùng hướng setup kỹ thuật active; neutral/missing/stale không tính đồng thuận. Nếu thiếu quyền flow, ẩn preset và không fetch SM; không làm mất bảng kỹ thuật.
- Server áp filter trên toàn tập đang theo dõi → sort → limit N. Default sort: setup active in_entry → retest gần đây → inside zone → near zone → còn lại; mỗi nhóm distanceAtr tăng dần (null cuối), volumeRank rồi symbol. Không xếp dữ liệu thiếu lên đầu vì null bị ép 0.
- Sort bổ sung: khoảng cách support, resistance, entry, tuổi setup, volume. Response có totalMatched và coverage; panel symbol ngoài filter/top vẫn mở được.
- Chọn khung/view không đổi collector universe. Nút flow giữ top/q/filter và mở đúng symbol như hub R1.

## 9. Contract API và lưu trữ đề xuất

Mở rộng additive API hiện có, không tạo pipeline phân tích thứ hai:

- `GET /api/market/symbols?view=location&analysisTf=...&screen=...&entrySource=...&top=...`: route/read-api validate query; response rows có `location`, `setups`, `signalEntries` theo quyền và summary. Request không có view giữ contract cũ; UI truyền view rõ ràng.
- `GET /api/market/symbols/:symbol?view=location&analysisTf=...`: trả zone/setup evidence và trạng thái, tối đa 50 zone + 20 setup gần nhất của khung; `truncated` nếu cắt. Giữ fields cũ phục vụ scores view.
- `/recent-signals` tiếp tục là nguồn normalize signal; tái sử dụng hàm đọc nội bộ để filter entry trước limit, không gọi HTTP vòng về chính server. Fields mới additive; giới hạn per symbol, hướng và thời gian phải được validate.

Hình dạng tối thiểu (tên field là contract đề xuất):

```text
location: { timeframe, price, priceAsOf, priceSource, quality,
  support, resistance, positionTags[], recentEvents[], confirmations[] }
zone: { id, parentZoneId, source, role, low, high, pivotAt, confirmedAt,
  atrAtConfirmation, invalidationLevel, expiresAt, status, brokenAt,
  distancePct, distanceAtr, relation, version }
setup: { id, zoneId, side, type, createdAt, expiresAt, entryLow, entryHigh,
  invalidationLevel, lifecycle, entryState, firstTouchedAt, touchEvidence,
  reasons[], invalidatedAt, version }
signalEntry: { id, source, side, openTime, sourceStatus, entryReference,
  priceRelation, validity, quality }
```

Gắn `locationByTimeframe`/setup state vào snapshot đang lưu ở market latest/history; read-api chỉ enrich khoảng cách bằng giá mới. Snapshot cũ thiếu field = warming, không crash hoặc giả dữ liệu. Duy trì setup terminal state và ID qua restart; event chuyển trạng thái dùng kho event hiện có với dedupe ID+state+eventTime. Không xóa/đổi lịch sử score cũ.

Scheduler xử lý tuần tự các nến chưa xử lý từ `lastProcessedCloseTime` để không bỏ qua invalidation rồi vô tình hồi sinh setup. Bootstrap replay chỉ từ nến sẵn có, không tạo event/notification hiện tại cho sự kiện quá khứ; thiếu cửa sổ cần thiết thì warming/unknown. Không backfill gọi sàn không giới hạn.

Nếu model/schema hiện có không giữ được các field additive, cập nhật đúng model/store/cache reader trong cùng thay đổi; không tạo collection mới chỉ vì tiện. Đánh giá payload history và giới hạn vùng hết hạn, bảo đảm TTL hiện có không bị thay ngầm.

## 10. Refresh, phân quyền và sửa lỗi nền

- Bảng/panel active refresh GET cache mỗi 30 giây, không đợi bootstrap hoàn tất. Không chồng request; hủy/bỏ response cũ khi đổi symbol/filter/khung.
- Tab browser hidden ngừng poll, khi visible tải một lần rồi tiếp tục. 401/403 dừng và đi theo session handler; 429/503 tôn trọng Retry-After, nếu không có backoff 30→60→120 giây. Unmount dọn timer.
- Poll không POST collector refresh/AI/watchlist và không fetch nến trực tiếp. Tái sử dụng price feed/cache; API đọc không tạo burst sàn khi 50 dòng.
- Giữ permission theo [auth/RBAC](auth-rbac-spec.md) và hub. Không thay role/template hay mở rộng dữ liệu riêng. Source status market recent-signals hiện theo quyền Market; link lịch sử đầy đủ theo quyền trang đích. Khi thay response signal phải đọc lại auth spec và allowlist fields.
- Trước nghiệm thu: sửa mapping flow được audit (bias từ `derived.bias`, OI `qty`, funding `currentRate`, đúng đơn vị), chất lượng flow; sửa watchlist filter-before-limit nếu dùng; hoàn thiện R1 selector/nút flow/top50 hoặc ghi rõ dependency chưa xong. Không đánh dấu cả tính năng hoàn thành khi thiếu các yêu cầu đã chốt này.

## 11. Triển khai và phạm vi

1. **Data contract:** normalize vùng/entry, fixture và replay; chưa đổi score hoặc UI mặc định.
2. **Engine và store:** swing zones, flip/retest, hai setup, lifecycle bền; read-api/filter/sort/limit.
3. **UI:** location view, panel, presets, query và refresh; giữ scores view.
4. **Regression/rollout:** test toàn chuỗi, hoàn thiện dependency R1, cập nhật docs rồi mới ghi trạng thái triển khai.

Không thêm dependency. Tận dụng helper hiện có; nếu sửa helper ảnh hưởng market-v1 phải bảo đảm output scoring cũ không đổi qua regression. Logic vùng mới có version độc lập với formula market-v1. Không biến event lean_long thành setup nếu chưa có entry/zone/trigger.

File trọng tâm: `MarketPage.jsx`, hub/query helper/CSS; `market/score-symbol.js`, `score-frame.js`, `smc-structure.js`, `store.js`, `read-api.js`, scheduler; `signal-history.js`, model signal và market; routes và tests liên quan. Chỉ sửa phần cần thiết trong chuỗi, không viết lại module.

## 12. Nghiệm thu

| ID | Điều phải chứng minh |
|---|---|
| S1 | Mặc định location, chuyển scores giữ đủ tính năng cũ; Top10/25/50 và flow shortcut hoạt động |
| S2 | Pivot chưa đủ hai nến phải không xuất hiện; confirmedAt đúng closeTime; replay không look-ahead |
| S3 | Zone band/ATR cố định, ID ổn định; rounding/tie/overlap xử lý xác định; giá bằng biên là inside |
| S4 | Wick không thành breakout; break chỉ một lần; retest sau breakout; flip bị phá không hồi sinh |
| S5 | Bounce/retest chỉ tạo đúng điều kiện cấu trúc/quality; chạm support đơn thuần không thành buy zone |
| S6 | Setup giữ entry/tuổi qua scan và restart; invalidated/expired không quay lại active; nến trigger không coi fill |
| S7 | In-entry/left/awaiting/unknown đúng với live stale, gap, replay và hai hướng xung đột |
| S8 | Entry signal range/point/missing/đảo thứ tự/giá không hợp lệ được normalize rõ; CLOSE không suy TP/SL |
| S9 | Nhiều kênh/hướng, coin ít tin không bị global cap che mất; validity unknown không thành valid |
| S10 | Tất cả preset/sort áp trước limit; null cuối; URL Back/Forward/legacy và symbol ngoài Top đúng |
| S11 | Poll tiếp tục sau bootstrap, pause hidden, không overlap, không POST/AI hoặc tăng call sàn theo số dòng |
| S12 | Quyền Market/SM/signal/Terminal đúng; thiếu flow không chặn kỹ thuật, không lộ object thô |
| S13 | Snapshot cũ, collector lỗi, thiếu ATR/nến, rate limit và restart giữ UI usable, timestamp/coverage thật |
| S14 | Mobile/bàn phím đọc được vùng và trạng thái; panel giải thích đủ số liệu tái tính khoảng cách |
| S15 | Market-v1 scores không đổi trên fixtures trước/sau; server tests và client build đạt |

Unit: toán khoảng cách, zone/setup transitions, signal normalization. Replay: tăng từng nến, boundary/tie/gap, đổi trend và restart từ state lưu. Integration: read-api → filter/sort/limit → response theo quyền, legacy snapshot. UI/network: chuyển view/khung/symbol nhanh, timer, mobile, nguồn lỗi. Test mock không được ghi là đã xác nhận coverage production hoặc hiệu quả giao dịch.

### Kết quả kiểm tra triển khai (2026-10-22)

| ID | Cách kiểm | Kết quả |
|---|---|---|
| S1 | UI view + Top + nút flow; unit hub top | Code + unit; browser chưa chạy |
| S2–S7 | `server/test/market-location.test.js` | Pass unit/replay fixtures |
| S8–S9 | signal-entry + recent-by-symbol test | Pass |
| S10 | filter/sort/top unit | Pass |
| S11 | Poll 30s + visibility trong MarketPage | Theo code; chưa network UI |
| S12–S13 | Quyền market read; warming snapshot cũ | Theo code |
| S14 | CSS mobile cột ẩn | Chưa kiểm browser |
| S15 | Suite server 300 + client build; không đổi formula market-v1 | Pass |

Location chỉ hiện đủ sau khi collector chấm lại symbol (gắn `locationByTimeframe` vào snapshot). Snapshot cũ thiếu field → warming, không crash.
