# Spec: Timeline giao dịch và donut phân bổ vị thế trên Tổng quan

Ngày: **2026-11-03**. Trạng thái: **Đề xuất — chưa triển khai**.
Phạm vi yêu cầu hiện tại: viết spec trước; chưa sửa runtime hoặc triển khai UI.

Tham chiếu: ảnh user cung cấp và [SH-Stark/trading-dashboard](https://github.com/SH-Stark/trading-dashboard), đặc biệt [LastOrders](https://github.com/SH-Stark/trading-dashboard/blob/master/src/components/_dashboard/app/LastOrders.js) và [PositionsRepartition](https://github.com/SH-Stark/trading-dashboard/blob/master/src/components/_dashboard/app/PositionsRepartition.js).

## 1. Kết quả mong muốn

Mở Tổng quan biết ngay: bot vừa giao dịch gì, vốn vị thế đang tập trung vào coin nào và nghiêng Long hay Short. Lấy cách trình bày timeline dọc có chấm/đường nối và chart tròn từ ảnh; giữ theme, KPI và điều hướng web-bot.

Chốt thiết kế mặc định:

- Một card **Giao dịch gần đây**: timeline dọc, mới nhất ở trên, mặc định 8 sự kiện trong 7 ngày UTC; chọn Tất cả / Mở / Đóng.
- Một card **Phân bổ vị thế**: donut với tab **Theo coin / Long–Short**, mặc định Theo coin; chỉ một donut hiển thị tại một thời điểm.
- Cơ sở tỷ trọng là **gross notional**, đơn vị USDT đã chuẩn hóa. Ghi rõ “giá trị vị thế”, không gọi là tiền ký quỹ hay vốn ví.
- Dữ liệu trong phạm vi bot sở hữu/được gán như dashboard hiện tại, sổ Live. Paper chưa thuộc phiên bản này.
- Không thêm dependency. SVG/CSS và React hiện có đủ cho donut và timeline.

## 2. Hiện trạng và chuỗi dữ liệu

`DashboardPage.jsx` → `GET /api/dashboard` → `routes/dashboard.js` → `lib/dashboard.js` → Mongo + sổ Redis → response theo actor → UI.

Đã đối chiếu source:

| Hiện tại | Hệ quả khi bổ sung |
|---|---|
| `activity` chứa tối đa 8 dòng, trộn đóng lệnh, lỗi sàn, signal bị gỡ; close query lấy tối đa 6 lệnh trong 2 ngày | Giữ activity vận hành, thêm `recentTrades` riêng; không dùng lỗi runtime làm sự kiện giao dịch |
| `buildOpenRisk` duyệt sổ sàn và chỉ trả top 5 theo trị tuyệt đối uPnL | Phân bổ phải aggregate toàn bộ vị thế hợp lệ trước khi cắt top; không lấy `openRisk.top` làm mẫu số |
| Tổng quan có sparkline 7 ngày, PnL theo bot, bảng rủi ro, việc cần xử lý | Giữ các khối này; không bổ sung lại Top Performers/chart số dư trong scope này |
| Terminal `RiskCockpit.jsx` có Long/Short và top symbol dạng thanh, dùng `rankNotional.js` | Tái sử dụng format/grouping phù hợp, không mount toàn RiskCockpit vì component có API riêng và thao tác pause/resume |
| Dashboard đang tính notional bằng `abs(positionAmt) × markPrice` | Chỉ áp dụng trực tiếp với quantity base asset; không nhân contracts thô của OKX rồi cộng vào USDT |

Không đổi producer bot, MQTT, SL/TP, own qty, sibling monitor hoặc collection hiện tại. Không tạo collection timeline mới.

## 3. Layout

Desktop >=1200px, một hàng hai card sau khối 7 ngày/PnL bot và trước bảng rủi ro:

```text
[KPI + Process hiện tại]
[7 ngày + đóng góp PnL bot hiện tại]
[Phân bổ vị thế                | Giao dịch gần đây            ]
[Theo coin | Long–Short        | Tất cả | Mở | Đóng            ]
[      donut + tổng USDT       | ● Đóng SHORT BTCUSDT +12 USDT]
[legend: coin / USDT / %       | │ bot-demo · DEMO_1 · giờ UTC]
[Xem dữ liệu · Mở Terminal    | ● Mở LONG ETHUSDT            ]
[Bảng rủi ro đang mở hiện tại]
[Việc cần xử lý + Hoạt động vận hành + Bot của tôi]
```

Dưới 1200px xếp một cột. Donut khoảng 220–260px; timeline giới hạn chiều cao khoảng 360px, cuộn nội bộ có nhãn nếu cần. Màn 360px không tràn ngang. Không sao chép sidebar, màu nền hoặc bộ KPI trong ảnh.

Khối Hoạt động gần đây cũ chuyển tên **Hoạt động vận hành**, chỉ giữ lỗi sàn/signal gỡ khi timeline đã có; không hiển thị lặp các dòng đóng lệnh. Giữ field `activity` backend tương thích với reader khác, UI lọc các kind giao dịch. Link log chỉ hiện khi có quyền xem log.

## 4. Timeline giao dịch

### Nội dung và tương tác

Mỗi node có chấm + đường dọc, nhãn **Mở/Đóng**, **LONG/SHORT**, symbol, bot/env, thời điểm UTC chính xác; signal nếu có. Đóng có profit đã ghi nhận (null hiển thị “Chưa có PnL”); mở không gán PnL=0. Màu Mở/Đóng là màu phân loại; dấu/màu PnL độc lập.

Ví dụ giả: `Đóng SHORT BTCUSDT · +12,30 USDT`; dòng phụ `bot-demo · DEMO_1 · 03/11/2026 10:32:05 UTC`.

- Tab Tất cả/Mở/Đóng tải đúng 8 sự kiện mới nhất của loại đó, không lọc từ 8 item Tất cả vì sẽ bỏ sót sự kiện.
- Sắp theo thời điểm giảm dần; khi bằng giờ dùng event ID ổn định để tránh nhảy thứ tự.
- Mỗi node dẫn tới báo cáo lệnh tương ứng bằng ID nếu màn đích hỗ trợ; nếu chưa hỗ trợ, dùng bộ lọc bot/env/symbol/ngày phù hợp, không hứa mở đúng chi tiết khi route chưa có.
- Nút Xem lịch sử dẫn Báo cáo → Hiệu quả lệnh, sổ Live. Bấm node/chart chỉ điều hướng hoặc xem dữ liệu.
- Poll theo nhịp dashboard hiện tại; không thêm socket/poll mỗi giây. Refresh giữ tab và vị trí cuộn, không giật nội dung khi người dùng đang focus.

### Nguồn và ý nghĩa sự kiện

Nguồn phiên bản đầu là **bản ghi giao dịch bot**, không phải toàn bộ fill của tài khoản sàn. UI ghi rõ “Lệnh bot · 7 ngày UTC”; không gọi là lịch sử tất cả giao dịch sàn, không suy diễn lệnh tay.

- Đóng: `account_statics`, dùng cùng predicate Live/đã đóng của dashboard; event time bắt buộc `closeTime` hợp lệ, trong cửa sổ yêu cầu.
- Mở: kiểm tra producer và schema thực tế của `monitor_positions` cùng `account_statics` trước triển khai. Chỉ dùng bản ghi được tạo sau mở thành công; `openTime` phải là thời gian thực hiện đã xác minh, không dùng giờ nhận signal hay order chờ. Nếu closed record có openTime đúng nghĩa thì có thể tạo cả open và close event từ một vòng đời.
- Ghép monitor + static bằng identity liên kết có sẵn đã được xác minh. Không dùng riêng symbol+side làm khóa vì nhiều config/vòng đời cùng symbol. Không dedupe bằng cửa sổ thời gian gần đúng.
- Event ID gồm identity vòng đời và kind; close của một trade không xóa open của nó. Nhiều config giao dịch cùng vị thế được hiển thị theo lệnh bot riêng, đúng nguồn dữ liệu.
- Không suy BUY=mở LONG / SELL=đóng LONG; side lấy field LONG/SHORT đã chuẩn hóa. Thiếu side thì ghi “Chưa rõ side”, không đoán từ BUY/SELL.
- Partial close/DCA chỉ hiển thị khi nguồn có event ID, thời gian và loại riêng đáng tin cậy; không tự tạo từ snapshot qty thay đổi.
- Nếu chưa chứng minh được nguồn open và khóa ghép: bàn giao phần Đóng với nhãn đúng và `openSupported=false`; không gọi timeline Mở/Đóng hoàn chỉnh. Đây là gate triển khai cần giải quyết, không giả định dữ liệu đã đủ.

## 5. Donut phân bổ

### Theo coin

Tính trên parent position sàn duy nhất theo account + exchange + instrumentId + side (+ positionIdx); không cộng lại theo từng monitor/config. Hedge cùng coin: Long và Short đều cộng vào gross, không triệt tiêu.

Mỗi vị thế dùng notional USDT được adapter chuẩn hóa hoặc quantity base × mark hợp lệ. Contracts cần contract size/multiplier và quy đổi đúng. Không có metadata thì loại khỏi số tiền và báo coverage thiếu; không coi là 0. Phiên bản này không tự quy đổi tài sản ký quỹ khác sang USDT.

`gross = tổng notional hợp lệ >= 0`; `share = notional nhóm / gross × 100`. Tổng hợp cùng coin khi cùng định danh tài sản đã chuẩn hóa; instrument không chuẩn hóa được giữ nhãn exchange/instrument riêng, không cắt chuỗi để đoán coin.

- Top 5 coin theo notional + Khác (số coin), tối đa 6 lát.
- Giữa donut: gross USDT; dưới là số vị thế được tính và thời điểm dữ liệu.
- Legend có tên, giá trị, tỷ lệ; màu ổn định theo nhóm giữa các lần refresh.
- Tooltip hover/focus/tap; lát nhỏ vẫn tiếp cận qua legend.
- Click lát/legend mở bảng dữ liệu tương ứng trong card; không áp filter vào KPI khác. Bảng gồm account, exchange, instrument, side, notional, tỷ trọng và link Terminal từng account. Khác mở danh sách các nhóm còn lại.

### Long–Short

Cùng tập vị thế, gross và coverage với tab Theo coin; tổng `longNotional + shortNotional = gross`. Hai lát Long/Short, không dùng net làm mẫu số. Thiếu side thì vị thế chưa đủ điều kiện cho cả hai tab; báo thiếu dữ liệu thay vì mặc định Long.

Không dùng pie cho PnL âm/dương. Không thêm chế độ margin trong phiên bản đầu vì coverage margin chưa được xác minh.

### Chất lượng dữ liệu

- `complete`: đủ sổ cho mọi account trong scope và đủ field/đơn vị cho mọi vị thế mở.
- `partial`: thiếu sổ hoặc có vị thế bị loại; ghi “Tỷ trọng trong dữ liệu đã có”, hiển thị số account/vị thế bị thiếu. Không ngụ ý đây là toàn portfolio.
- `unavailable`: không có baseline; hiện “Chưa có dữ liệu vị thế” + link Terminal, không vẽ vòng 100% giả.
- Sổ đủ và positions rỗng: “Không có vị thế mở”. gross=0 không chia cho 0.
- Stale là cờ độc lập với coverage; dùng reconciliation timestamp/nguỡng freshness hiện hành, không dùng giá mark mới để làm sổ cũ thành mới. Nêu account stale và thời điểm đối chiếu cũ nhất trong tập.
- Thiếu mark/null/chuỗi rỗng/NaN/Infinity/giá <=0 không biến thành 0. Tính bằng precision gốc, chỉ làm tròn khi hiển thị.

## 6. API đề xuất — chưa tồn tại

Mở rộng `GET /api/dashboard`, giữ field cũ. Query mới allowlist `tradeKind=all|open|close` (default all), fixed lookback 7 ngày, fixed limit 8. Cache actor hiện tại phải thêm tradeKind vào key; client session cache cũng vậy. Hủy/bỏ response cũ khi chuyển tab nhanh. Không query lại REST sàn hoặc gọi risk endpoint theo từng bot.

```json
{
  "recentTrades": {
    "kind": "all",
    "lookbackDays": 7,
    "limit": 8,
    "source": "bot_records",
    "openSupported": false,
    "items": [],
    "asOf": "2026-11-03T03:00:00.000Z"
  },
  "allocation": {
    "basis": "gross_notional",
    "unit": "USDT",
    "quality": "partial",
    "stale": false,
    "asOf": "2026-11-03T02:59:45.000Z",
    "coverage": {
      "accountsExpected": 2,
      "accountsAvailable": 1,
      "positionsSeen": 3,
      "positionsIncluded": 2,
      "positionsExcluded": 1
    },
    "gross": 1000,
    "bySymbol": [{ "key": "BTCUSDT", "label": "BTCUSDT", "value": 1000 }],
    "bySide": [{ "key": "LONG", "value": 1000 }, { "key": "SHORT", "value": 0 }]
  }
}
```

Event shape: `{id, kind, at, username, env, exchange, instrumentId, symbol, side, signal, profit, href}`. `at` ISO UTC; profit nullable và chỉ có ý nghĩa ở close. Không trả secret hay raw source document.

`allocation.bySymbol` là đầy đủ aggregate nhóm trong scope; client dùng top 5 + Khác. Bảng chi tiết chỉ lấy field position cần thiết, không lộ config/credential. Khi triển khai chọn field `rows` tối thiểu trong response hoặc tận dụng endpoint Position đã lọc quyền; không dùng top 5 uPnL để dựng bảng.

Quyền giữ nguyên theo [auth-rbac-spec](auth-rbac-spec.md): `recentTrades=null` khi thiếu `statistics.view`; `allocation=null` khi thiếu `positions.view`. Scope bot phải được áp server-side trước query/grouping, kể cả cache/refresh và admin. Không tạo quyền mới. Trước khi sửa code kiểm tra quyền phải đọc toàn bộ spec authoritative.

## 7. Kế hoạch triển khai và kiểm chứng

1. Xác minh producer open/close, lifecycle identity, normalized notional và reconciliation metadata; ghi bằng chứng source vào spec. Chốt gate open ở §4 trước khi nhận hoàn thành đầy đủ.
2. Mở rộng aggregate dashboard: recentTrades độc lập activity, allocation từ toàn sổ; giữ KPI/attention/AI hiện tại. Không truyền dữ liệu mới sang AI nếu chưa có nhu cầu.
3. Thêm Timeline + Donut component hiển thị thuần; tích hợp Dashboard, bảng dữ liệu và responsive. Không thêm control giao dịch.
4. Cập nhật dashboard-overview, feature-spec, flows, api-data-reference và tài liệu visualization khi đã triển khai; không ghi proposal thành tính năng đang chạy.

Acceptance bắt buộc:

- Long/Short, mở/đóng đúng; close/open cùng lifecycle không nhân đôi khi nguồn giao nhau; cùng timestamp ổn định; boundary 7 ngày UTC, filter trước limit.
- Sổ 2 config chung parent chỉ tính một lần; hedge không triệt tiêu; top 5 + Khác bảo toàn gross; contracts không bị nhân sai đơn vị.
- Thiếu sổ/mark/side, sổ stale, zero position, một lát 100%, nhiều coin nhỏ và rounding đều có trạng thái rõ.
- Quyền/scope ở server, cache tách actor và tradeKind, session cache không giữ dữ liệu actor cũ; reader response cũ vẫn hoạt động.
- Desktop/mobile 360px; bàn phím, touch, Escape tooltip, reduced motion; có bảng thay thế biểu đồ.
- Dashboard không phát sinh Binance REST, mutation hay refresh loop mới; failure một nguồn không làm mất KPI khác.

Khi code: `npm --prefix server test`, `npm --prefix client run build`, chart logic tests thích hợp và `git diff --check`; kiểm tra trực quan bằng fixture tổng hợp, không dùng lệnh thật để thử UI. Với lượt chỉ spec: kiểm tra link Markdown, consistency và diff; không cần chạy runtime test/build.

## 8. Ngoài phạm vi

Chart số dư mới, Top Performers mới, tree phân cấp vị thế, lịch sử fill toàn sàn, backfill lịch sử, collector/event store mới, paper timeline, margin allocation, redesign Terminal và thay đổi chiến lược giao dịch. Timeline dọc trong ảnh là trục thời gian, không phải cây parent/child.
