# Thị trường & Kỹ thuật — workspace hỗ trợ quyết định

Ngày: 2026-10-23. Trạng thái: **Đề xuất sản phẩm và kỹ thuật, chưa triển khai**.
Phạm vi: web-bot. Bản này định hướng nâng cấp hub hiện có; không thay công thức market-v1, lifecycle setup, quyền hay engine giao dịch. Những ngưỡng mới bên dưới là giả thuyết thiết kế cần kiểm định, không phải xác suất thắng đã được chứng minh.

## 1. Tầm nhìn

Trong 30 giây, người dùng biết thị trường đang ở trạng thái nào, coin nào đáng xem và vì sao. Trong 2 phút, họ kiểm tra được một kịch bản với vùng giá, điều kiện xác nhận, điều kiện vô hiệu và lý do nên đứng ngoài.

Trang phải trả lời theo thứ tự:

1. **Bối cảnh:** thị trường đang đi theo xu hướng, dao động hay biến động bất thường?
2. **Lựa chọn:** coin nào mạnh/yếu tương đối, đang tới vùng có ý nghĩa?
3. **Thời điểm:** mới gần vùng, đã có setup, hay đã quá xa entry?
4. **Phản biện:** bằng chứng nào mâu thuẫn với kịch bản?
5. **Hành động:** tiếp tục theo dõi, chờ xác nhận, bỏ qua, hoặc mở Terminal để tự đánh giá tiếp?

Giá trị khác biệt là ghép bằng chứng có thể kiểm tra thành một quy trình; không tăng số indicator để tạo cảm giác chắc chắn. Không dùng điểm 82/100 như “82% thắng”. Không nhận diện cá voi chỉ từ funding/OI hoặc gắn nhãn “tiền thông minh đang mua” khi nguồn chỉ có thống kê tài khoản.

## 2. Tinh lọc từ các sản phẩm tham khảo

| Nguồn | Điều đáng học | Áp dụng có chọn lọc |
|---|---|---|
| [TradingView Screener](https://www.tradingview.com/support/solutions/43000718742-crypto-coins-screener-discover-hidden-gems/) | Lọc, watchlist, cột tùy chỉnh để thu hẹp tập tài sản | Preset theo câu hỏi thực tế; bảng là trung tâm |
| [TradingView Technical Ratings](https://www.tradingview.com/support/solutions/43000614331-technical-ratings/) | Tóm tắt nhiều indicator và nhiều khung | Giữ ma trận hiện có và breakdown; không sao chép điểm hoặc coi các indicator tương quan là bằng chứng độc lập |
| [CoinGlass](https://www.coinglass.com/) | Đặt biến động OI, funding, liquidation cạnh biến động giá | Đọc phối hợp phái sinh với cấu trúc giá; ghi rõ sàn, cửa sổ và nguồn |
| [Glassnode MVRV](https://docs.glassnode.com/further-information/metric-guides/mvrv/mvrv-ratio.md) | Bối cảnh giá so với cost basis on-chain | Chỉ mở rộng cho góc nhìn chu kỳ; không dùng MVRV làm trigger vào lệnh intraday |
| [DefiLlama](https://defillama.com/) | Phân nhóm chain/protocol, TVL, stablecoin, fees | Roadmap nghiên cứu luân chuyển vốn; không đồng nhất tăng TVL tính USD với tiền mới vào |
| [Binance Market Data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) | Nguồn gốc cho nến, ticker, funding, OI và taker | Ưu tiên collector/cache hiện có; xác minh endpoint, giới hạn và đơn vị trước mở rộng |

Các ý tưởng thiết kế dưới đây là tổng hợp riêng cho web-bot, không phải các nguồn trên xác nhận hiệu quả chiến lược. Chưa xác minh hợp đồng API thương mại, quyền tái phân phối hay giá dịch vụ; P0 không phụ thuộc nguồn trả phí.

## 3. Nền hiện có và ranh giới

Đã đối chiếu `MarketHubPage.jsx`, route Market, danh sách module market và các spec nội bộ. Chưa kiểm tra giao diện production bằng trình duyệt trong lần viết này.

| Nền có sẵn | Cách kế thừa |
|---|---|
| Hub Kỹ thuật / Dòng tiền, URL và gate theo quyền | Giữ hai tab chính, không tạo menu thứ ba |
| Location / Scores, vùng và lifecycle setup | Location vẫn mặc định; bổ sung ngữ cảnh và cách giải thích |
| market-v1, điểm Long/Short, nhiều timeframe | Giữ nguyên công thức và history; không cộng thêm flow vào score |
| Market latest/history/events, collector, cache | Mở rộng additive, không tạo collector phân tích song song |
| Smart Money và watchlist cá nhân | Dùng contract hiện có; watchlist phải lọc trước limit khi mở rộng |
| Signal gần đây | Tách nguồn technical và signal; trạng thái signal không chứng minh setup còn hiệu lực |

Authority: [Market hub](market-hub-spec.md), [Location & Setup](market-position-setup-spec.md), [Formula](market-formula-v1.md), [RBAC](auth-rbac-spec.md). Nếu khác nhau, các contract đang chạy được giữ cho đến khi có migration riêng. Ngưỡng vùng, pivot, setup và trạng thái terminal kế thừa Location & Setup, không định nghĩa bản thứ hai ở đây.

Chuỗi triển khai: collector hiện có → nến đóng/snapshot → engine market + store → read-api theo quyền → MarketPage/bảng/panel. Flow đi qua read model được phép hiện có; giao diện không gọi sàn trực tiếp. Trang thị trường không ghi MQTT signal, không mở lệnh, không sửa cấu hình bot.

## 4. Bố cục đề xuất

```text
THỊ TRƯỜNG                         Nguồn · Phạm vi · Cập nhật · Chất lượng
[Kỹ thuật] [Dòng tiền]

BỐI CẢNH: BTC 4h | Độ rộng 1h | Biến động | Số setup còn hiệu lực
Tóm tắt 2 câu: điều đang xảy ra + điều cần chờ

[Vị trí & Setup] [Ma trận điểm]
Tìm coin | Khung phân tích | Top 10/25/50 | Preset | Bộ lọc

Coin | Giá / Δ | Cấu trúc | Vị trí | Setup / Trigger | Cản trở
BTC  ...
ETH  ...                            [Panel coin bên phải khi được chọn]

Điều gì vừa thay đổi? — các sự kiện mới có ý nghĩa
```

Desktop ≥1280px: bảng và panel cạnh nhau; panel khoảng 420–520px, bảng giữ cột coin. Tablet: panel dạng drawer. Mobile: hàng tóm tắt coin/giá/vị trí/trạng thái, chạm mở chi tiết toàn màn hình; không ép 12 cột vào màn hình nhỏ.

Mỗi vùng có một nhiệm vụ. Mặc định không bật đồng thời heatmap, nhiều biểu đồ và danh sách tin tức. Chart chi tiết chỉ mở khi cần; overlay mặc định tối đa hỗ trợ, kháng cự, vùng entry. Các lớp khác bật chủ động.

Màu xanh/đỏ biểu thị hướng giá, không biểu thị “an toàn/nguy hiểm”. Trạng thái luôn có chữ/icon; stale dùng màu trung tính và timestamp. Không nhấp nháy toàn dòng theo tick. Tooltip có thể mở bằng bàn phím/chạm. Đóng panel trả focus về dòng đang chọn.

## 5. Bối cảnh thị trường

Bốn thẻ nhỏ, mỗi thẻ có bằng chứng và timestamp riêng:

- **BTC 4h:** regime/cấu trúc lấy từ engine hiện hành; tách khỏi khung phân tích của bảng. Không đổi nhãn BTC chỉ vì user chuyển bảng sang 15m.
- **Độ rộng:** dùng định nghĩa breadth hiện có, hiển thị rõ timeframe, mẫu số universe và số coin có dữ liệu. Ví dụ minh họa: “31/50 nghiêng Long; 8/50 thiếu dữ liệu”, không biến thành 31/42 và che 8 coin thiếu.
- **Biến động:** phân vị ATR% của BTC theo lịch sử đủ dài ở P1; P0 có thể chỉ hiện ATR% hiện có, không gắn nhãn cực đoan khi thiếu baseline.
- **Setup:** đếm active/in-entry theo khung đang chọn trên toàn universe được phép, trước filter Top; nhãn phải ghi phạm vi.

Brief ban đầu tạo bằng template code, ví dụ giả lập: “BTC 4h nghiêng tăng; độ rộng 1h chưa đồng thuận. Có 3 setup đang trong vùng, 2 setup bị cản gần.” Mỗi mệnh đề bấm được để thấy dữ liệu tương ứng. Thiếu input thì bỏ mệnh đề, không tự diễn giải thành trung lập.

Không ép mọi bối cảnh vào một nhãn risk-on/risk-off. BTC tăng nhưng alt yếu phải được trình bày là sự phân hóa.

## 6. Bảng phục vụ chọn cơ hội

### Cột mặc định

| Cột | Nội dung và tác dụng |
|---|---|
| Coin | Symbol, watchlist nếu có quyền, nguồn/sàn trong chi tiết |
| Giá | Giá mới và tuổi dữ liệu; Δ24h không nhầm với Δ khung phân tích |
| Cấu trúc | Hướng khung đang chọn + khung lớn hơn; mâu thuẫn hiển thị trực tiếp |
| Vị trí | Gần/trong hỗ trợ hoặc kháng cự; khoảng cách % và ATR |
| Setup | Loại, hướng, lifecycle, trạng thái entry; phân biệt technical/signal |
| Cần chờ | Trigger đã xác nhận hoặc điều kiện còn thiếu từ engine |
| Cản trở | Kháng cự gần, dữ liệu cũ, khung lớn ngược, entry đã rời vùng |

OI/funding/relative strength là cột tùy chọn sau khi có đủ dữ liệu, không nhồi vào P0. Ô null hiện “—” kèm lý do; sort null về cuối. Điểm đầy đủ ở view Scores.

### Preset

Kế thừa preset Location đang có trước; bổ sung riêng ở P1:

- **Thuận xu hướng, chờ retest:** setup retest active, cùng hướng khung lớn hơn, chưa invalidated.
- **Trong vùng, còn hiệu lực:** active + in-entry + input fresh; không gọi là “vào ngay”.
- **Mạnh hơn BTC:** relative return dương trên 24h và 7d, dữ liệu đồng bộ; đây là bộ lọc sức mạnh, chưa phải setup.
- **Có mâu thuẫn:** setup active nhưng khung lớn ngược hoặc flow fresh ngược hướng.
- **Biến động nén:** chỉ bật khi có baseline percentile đủ; chờ phá vỡ, chưa gán hướng.

P0 giữ sort hiện có để tránh đổi hành vi. P1 thêm tùy chọn “Ưu tiên xem” với thứ tự xác định: dữ liệu đủ → setup active in-entry → active chờ retest → gần vùng → còn lại; trong nhóm theo distanceAtr tăng, volumeRank, symbol. Có nhãn giải thích thứ tự, không dùng điểm tổng hợp bí mật.

## 7. Panel coin: một luận điểm và phần phản biện

Thứ tự nội dung:

1. **Định vị:** giá, nguồn, tuổi dữ liệu, khung phân tích và khung lớn.
2. **Biểu đồ:** nến đóng/forming khác nhau; vùng confirmed từ engine, không vẽ pivot trước confirmedAt.
3. **Kịch bản:** hướng, entry band, trigger, invalidation, expiry và trạng thái hiện tại.
4. **Bằng chứng:** tối đa ba ý chính, gắn số liệu và thời điểm.
5. **Phản biện:** tối đa ba điều làm suy yếu kịch bản; không giấu tín hiệu ngược để làm đẹp giao diện.
6. **Phái sinh:** OI, funding, taker theo khả dụng và quyền, giải thích mức độ quan sát.
7. **Timeline:** tạo vùng → breakout → retest → invalidation/expiry; lưu thời điểm thật.
8. **Thao tác:** mở Dòng tiền, theo dõi coin khi được phép, mở Terminal theo quyền hiện hành.

Nếu có cả Long và Short, hiển thị hai kịch bản độc lập. Không lấy trung bình entry hoặc chọn bên có điểm cao rồi giấu bên kia. “Chưa có setup” là kết quả hợp lệ.

### R:R và khoảng trống tới vùng đối diện — P1

Chỉ tính khi có entry E, invalidation S, target T hợp lệ cùng hướng; Long cần S<E<T, Short cần T<E<S. `RR = abs(T-E)/abs(E-S)`; S=E hoặc thiếu target → null. Target tham khảo là biên gần của vùng đối diện còn hiệu lực, không tự đặt một mốc để đạt RR mong muốn.

Entry band hiển thị RR bảo thủ tại giá entry bất lợi hơn nếu toàn band hợp lệ. Nêu rõ chưa tính phí/slippage/funding; không gọi RR gộp là lợi nhuận kỳ vọng. Không lấy giá live ngoài band để giả làm entry. Invalidation cấu trúc không mặc nhiên là một stop order đã được đặt.

## 8. Định nghĩa các metric mới — P1

Mọi ngưỡng mới dùng version `market-context-v1`, tách `market-v1`; không ghi đè score lịch sử.

| Metric | Định nghĩa đề xuất | Thiếu dữ liệu / giới hạn |
|---|---|---|
| Relative return | `100*((Pcoin(t)/Pcoin(t-H))/(Pbtc(t)/Pbtc(t-H))-1)`; H=24h,7d, cùng mốc nến đóng 1h | Thiếu mốc hoặc lệch timestamp → null; không gọi alpha đã điều chỉnh beta |
| ATR% | `100*ATR14/close` khung đang chọn, dùng helper hiện có | ATR/close không hợp lệ → null |
| Phân vị biến động | Đếm tỷ lệ ATR% lịch sử ≤ giá trị hiện tại trên 180 nến đóng trước đó, không gồm hiện tại | Phải đủ 180 giá trị hợp lệ; ≤20 nén, ≥90 cao; ngưỡng thử nghiệm |
| OI Δ | `(OI_now/OI_then-1)*100`, cùng venue/contract và đơn vị quantity; cửa sổ 1h/4h | Thiếu baseline → null; OI USD hiển thị riêng vì ảnh hưởng giá |
| Funding | Rate gốc + kỳ settlement + thời điểm áp dụng; phân biệt current/estimated/settled | Không so raw rate giữa kỳ 1h và 8h; thiếu interval không chuẩn hóa |
| Funding tương đương 8h | `rate * 8 / intervalHours`, nhãn “quy đổi tuyến tính” | Chỉ để so sánh, không dự báo khoản thanh toán tiếp theo |
| RVOL | Volume nến đóng / mean 20 nến trước, theo market-v1 | Không so volume nến đang chạy với nến hoàn tất |

Funding/OI không xác định ai đang mở Long hoặc Short. Giá tăng + OI tăng chỉ cho thấy giá và lượng hợp đồng mở cùng tăng; giả thuyết leverage build-up cần ghi là suy luận. Funding cao là dấu hiệu chi phí/crowding, không đủ để kết luận sắp đảo chiều. Taker buy/sell là flow chủ động tại venue/cửa sổ cụ thể, không phải toàn bộ vốn vào thị trường.

## 9. Những tính năng đáng đầu tư sau nền cơ bản

### P1: “Điều gì đã thay đổi?”

Timeline ưu tiên chuyển trạng thái: setup mới, vào/rời entry, mất hiệu lực, đổi regime, thiếu nguồn dữ liệu. Tái sử dụng event store; eventId xác định theo symbol + timeframe + setupId + transition + eventTime. Không tạo event mỗi lần poll. Replay lịch sử không phát như sự kiện mới.

Trong UI có “mới từ lần mở trang này”, dùng snapshot/version làm mốc; không suy ra một lần tăng điểm là signal mới. Notification ngoài ứng dụng là scope riêng, chưa tự gửi Telegram/email.

### P1: Bản đồ sức mạnh tương đối

Scatter plot tùy chọn: trục X relative return 24h, Y relative return 7d; kích thước theo quote volume và màu theo trạng thái setup. Bốn góc giúp tìm coin vừa tăng tốc hoặc mất sức. Tooltip có số gốc, thiếu 7d thì loại khỏi plot và báo coverage. Không gọi góc trên phải là “coin chắc thắng”. Bảng luôn là cách truy cập tương đương.

### P2: Luân chuyển vốn và chu kỳ

Sector heatmap cần taxonomy có version và quy tắc coin thuộc nhiều nhóm; công bố equal-weight hay cap-weight, số thành viên và coverage. Stablecoin supply, TVL, fees, ETF flows, MVRV và lịch unlock/macro nằm trong panel bối cảnh riêng với tần suất nguồn thật. ETF ngày giao dịch không gắn nhãn realtime cuối tuần. Không dùng TVL tăng để khẳng định net inflow nếu chưa loại ảnh hưởng giá.

Liquidation heatmap chỉ thêm khi có nguồn/mô hình được xác minh; ghi rõ là mức ước tính, không là order book hoặc điểm giá bắt buộc bị quét. Liquidation events quan sát được phải nêu coverage stream, không hứa tổng đầy đủ nếu feed bị sampling.

### P2: Replay và học từ quyết định

Chọn thời điểm quá khứ, xem đúng thông tin đã biết lúc đó, kể cả universe và confirmedAt. Đánh giá riêng setup theo regime, timeframe, hướng; đo MAE/MFE và invalidation. Nếu mô phỏng nến chạm cả SL và TP mà không biết thứ tự, đánh dấu ambiguous hoặc dùng giả định bảo thủ công khai. Walk-forward, phí, slippage và survivorship bias phải được xử lý trước mọi tuyên bố hiệu quả.

## 10. Contract dữ liệu và vận hành

Mở rộng các endpoint đang có theo additive; tên fields sau là đề xuất, chưa có trong runtime:

- `GET /api/market/overview`: thêm `context` gồm regime, breadth, volatility, setupCounts, universeId, asOf, quality, version.
- `GET /api/market/symbols`: thêm tóm tắt `context` cho từng row; filters mới phải validate và filter trước Top/limit.
- `GET /api/market/symbols/:symbol`: thêm `decisionContext` chứa evidence[], conflicts[], scenarios[], metric provenance; không serialize raw provider payload.
- `GET /api/market/events`: dùng cho timeline có cursor/limit theo contract hiện hành; nếu cần đổi pagination phải bổ sung tương thích.

Envelope của metric mới: `{ value, unit, source, venue, window, asOf, collectedAt, quality, reason, version }`. Quality: fresh/stale/missing/warming/error; mapping từ domain hiện hành phải rõ, không sửa enum cũ ngầm. Thời gian API UTC; UI timezone người dùng, hiển thị timezone khi mở chi tiết.

Read-api ghép snapshot bằng khóa symbol/venue/instrument; không join chỉ bằng ticker khi có nhiều loại hợp đồng. Context kỹ thuật dùng nến đóng chung mốc; giá live riêng timestamp. Flow quá ngưỡng freshness domain hiện hành không dùng làm nhãn đồng thuận. Không sửa cadence/TTL/rate limit trong P0. New metric chỉ lên P1 sau khi đo đủ lịch sử và payload budget.

Poll đọc 30s theo lifecycle Location hiện có: pause hidden, không overlap, bỏ response cũ; 401/403 dừng; 429/503 backoff theo contract. UI giữ snapshot cũ kèm stale trong lỗi tạm thời. GET không gây refresh collector, AI hay mutation watchlist. Mở thêm client không nhân request sàn.

Giữ query hiện hành: tab/view/analysisTf/tf/top/symbol và các filter đúng domain. Preset mới không tái dùng enum cũ với nghĩa khác; thêm vào validator và URL helper cùng regression. Back/Forward khôi phục đúng trạng thái. Không mở thêm quyền vì panel gộp; auth spec vẫn là authority. Trước triển khai nhánh có thay đổi payload quyền phải đọc toàn bộ auth spec.

## 11. Roadmap khả thi

| Đợt | Kết quả | Dependency / điều kiện ra mắt |
|---|---|---|
| P0 — Làm rõ cái đã có | Header chất lượng, context từ dữ liệu sẵn, bảng gọn, panel evidence/phản biện, giữ Location/Scores | Xác minh fields nguồn; thiếu metric thì bỏ; không thay score/setup engine |
| P1a — Tìm cơ hội tốt hơn | Relative return, volatility percentile, preset, sort tùy chọn, RR tham khảo | Đủ history, metric version, fixture và replay; không thêm dependency |
| P1b — Theo dõi thay đổi | Event timeline, sức mạnh tương đối, watchlist đủ membership | Dedupe/restart, quyền, filter-before-limit, retention hiện hành được đánh giá |
| P2 — Nghiên cứu chuyên sâu | Sector, macro/on-chain, heatmap ước tính, replay | Chọn provider, quyền dùng dữ liệu, ngân sách và chất lượng lịch sử; spec triển khai riêng |

Không đưa chart library mới vào P0. Kiểm tra công cụ chart đang có trước; nếu không đủ, phần chart nâng cao để đợt riêng. Không có ước lượng ngày công cứng trước khi audit nguồn và khả năng render thực tế.

## 12. Tiêu chí nghiệm thu

| ID | Bắt buộc chứng minh |
|---|---|
| M1 | Người dùng đọc được bối cảnh, coin đáng xem và điều kiện bỏ qua mà không phải mở breakdown của mọi indicator |
| M2 | Snapshot/fixture cũ cho cùng market-v1 scores và lifecycle setup trước/sau |
| M3 | Thiếu/stale/error hiển thị riêng; null không thành 0; coverage công khai và mẫu số breadth không đổi ngầm |
| M4 | Không look-ahead: pivot chỉ hiện sau confirmedAt; forming candle không thay kết luận đã xác nhận |
| M5 | Không hồi sinh setup invalidated/expired sau scan hoặc restart; không coi in-entry là fill |
| M6 | Relative return dùng cùng timestamp; percentile đủ mẫu; funding đúng kỳ/đơn vị; OI quantity khác USD |
| M7 | Bằng chứng và phản biện trỏ được về input/time/version; AI nếu thêm chỉ diễn giải facts đã validate |
| M8 | URL cũ, Back/Forward, chuyển tab nhanh và symbol ngoài Top tiếp tục hoạt động |
| M9 | Quyền Market/Flow/Terminal độc lập theo contract; không leak dữ liệu tài khoản vào context thị trường |
| M10 | Không request sàn theo từng hàng/người dùng; không POST ngầm khi mount/poll; timer được dọn |
| M11 | Mobile đọc được trạng thái, bàn phím mở/đóng panel; màu không là tín hiệu duy nhất |
| M12 | Event không lặp khi poll/restart; replay không phát cảnh báo mới |
| M13 | RR xử lý missing, S=E, sai hướng, band không hợp lệ; thể hiện chi phí chưa tính |
| M14 | Kiểm thử server liên quan + client build pass; browser/network QA riêng, không coi build là QA giao diện |

Mục tiêu hiệu năng đề xuất: API đọc cache p95 <700ms với 50 symbols trong load test được mô tả; tương tác sort/filter local <100ms trên thiết bị thử nghiệm đã ghi nhận. Đây là mục tiêu cần đo, chưa là số liệu hệ thống hiện tại.

Đánh giá sản phẩm bằng bài thực hành: tìm một setup còn hiệu lực, giải thích trigger và một lý do bỏ qua trong 2 phút. Đo thời gian, tỷ lệ đọc sai stale/entry, số lần phải chuyển màn hình. Không tối ưu số lượt mở lệnh như KPI thành công.

## 13. Phạm vi bàn giao bản spec này

Chỉ thêm tài liệu và liên kết vào mục lục. Không triển khai UI/API, không đổi bot hay gọi dữ liệu tài khoản. Các nguồn ngoài được tham khảo ngày 2026-10-23; các feature nhà cung cấp và API phải được kiểm tra lại khi bắt đầu implementation.
