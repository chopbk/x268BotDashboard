# Spec menu Terminal — workspace giao dịch mới

Ngày: 2026-10-12. Trạng thái: **R1 đã có implementation, còn gap nghiệm thu** (`/terminal`, `TerminalPage` + `components/terminal/`). R2/R3 chưa làm. Menu `/positions` giữ nguyên. Xem [review implementation](terminal-review.md).

Điều chỉnh UX theo phản hồi người dùng: từ 768px, chi tiết nằm dưới bảng và dùng toàn chiều ngang, thay cho panel cạnh phải tại mục 3.1; dưới 768px giữ drawer toàn màn hình. Lệnh/Monitor/Timeline hiển thị inline, không tự mở case modal. Tùy chọn đổi độ rộng panel không còn áp dụng. Những yêu cầu khác vẫn giữ.

## 1. Mục tiêu và phạm vi

Tạo menu **Terminal**, route `/terminal`, nằm cạnh menu Position. Người dùng theo dõi vị thế, đặt/quản lý lệnh và xem lịch sử trong cùng một workspace. Giữ nguyên route, chức năng và giao diện `/positions`; không redirect hoặc thay thế menu cũ.

Đây là spec riêng của menu mới. `trading-terminal-spec.md` mô tả nền giao dịch hiện tại; không được coi các tính năng đề xuất dưới đây là đã có API. Khi tài liệu cũ mâu thuẫn với source, phải kiểm tra route → service → nguồn dữ liệu và ghi chênh lệch trước khi triển khai. Auth/RBAC tuân thủ `auth-rbac-spec.md` và catalog server; spec này không cấp thêm quyền.

Đối tượng chính: người vận hành nhiều tài khoản/config, có nhiều monitor dùng chung vị thế sàn. Phạm vi nền: Binance USD-M Futures, live/paper theo khả năng hiện có; Hedge và One-way theo backend hiện hành. Không tự mở rộng Spot, COIN-M hay sàn khác.

Ba cấp triển khai:

- **R1 — bắt buộc:** đầy đủ chức năng cũ trong menu mới, bố cục gọn, panel chi tiết, lọc/lưu view, trạng thái dữ liệu và xử lý mutation chính xác.
- **R2 — bổ sung:** sizing Qty/% ví/USDT/rủi ro + CLI gợi ý + journal/AI coach đã có phần đầu ([terminal-r2-tools-spec](terminal-r2-tools-spec.md)). Còn biểu đồ giá chỉ đọc, lịch sử fills, analytics/CSV.
- **R3 — nâng cao:** sửa lệnh trên chart, chia TP nhiều mức, dời SL hòa vốn và tự động hóa có trạng thái bền vững. Không được ghép vài request phía browser rồi gọi đó là automation hoàn chỉnh.

R1 có thể bàn giao riêng; phải ghi rõ R2/R3 chưa làm. Nếu yêu cầu triển khai toàn bộ spec thì cả ba cấp đều thuộc phạm vi, không dừng ở mockup.

## 2. Bản đồ code và luồng hiện hành

Đọc trước: `AGENTS.md`, `docs/index.md`, `architecture.md`, `flows.md`, `api-data-reference.md`, `development.md`, `auth-rbac-spec.md`, `trading-terminal-spec.md`.

| Chức năng | Source cần đối chiếu |
|---|---|
| Menu, route, gate UI | `client/src/App.jsx` |
| Vị thế, lọc, WS/fallback, mở/đóng/reverse/TP-SL, monitor | `client/src/pages/PositionsPage.jsx` |
| Case: sàn, ownership, orders, timeline, thống kê monitor | `client/src/components/PositionCasePanel.jsx` |
| Lịch sử vị thế | `client/src/pages/PositionHistory.jsx` |
| Open orders, batch cancel | `client/src/components/OpenOrdersTab.jsx` |
| Ticket và lịch sử orders | `client/src/components/OrderTicket.jsx`, `OrderHistoryTab.jsx` |
| Preview, sort, notifications | `client/src/trade-preview.js`, `position-sort.js`, `position-alerts.js` |
| REST | `server/src/routes/positions.js`, `orders.js`, `trading.js` |
| Read models | `server/src/lib/positions.js`, `position-live.js`, `position-ws.js`, `position-case.js`, `position-history.js` |
| Giao dịch | `server/src/lib/trading-bridge.js`, `direct-trading.js`; model `trading-receipt.js` |

Luồng đọc: bot stream sàn → Redis → web REST/WS → bảng và panel; reconcile qua server khi cần. Monitor/lịch sử đọc từ nguồn hiện hành, không giả định snapshot Redis chứa tất cả dữ liệu.

Luồng ghi giao dịch: Browser → web REST → auth/CSRF/permission/scope/validation → trading bridge/receipt → direct-trading → Binance → kết quả + đối chiếu sổ. **Mutation trading hiện gọi sàn trực tiếp từ web server**, không chuyển sang MQTT vì comment cũ trong code. Browser không nhận credentials hoặc gọi signed API.

Thêm/xóa monitor là mutation dữ liệu monitor, không đồng nghĩa mở/đóng vị thế sàn. Đổi cách hiển thị không được đổi logic bot, qty, sibling, PAPER, INVERT, NOTPSL, leftover.

## 3. Bố cục giao diện

### 3.1 Desktop

```text
Terminal     [Phạm vi] [Tài khoản] [Live/Paper]       [Trạng thái] [Đồng bộ]
PnL đang mở | Giá trị vị thế | Vị thế đang mở | Cần chú ý
[Vị thế] [Lệnh chờ] [Lịch sử vị thế] [Lịch sử lệnh] [Khớp lệnh R2]
[Tìm coin] [View đã lưu] [Bộ lọc thêm (n)] [Cột] [Mật độ]    [Đặt lệnh]
┌──────────────────────────────────────────┬─────────────────────────────┐
│ Bảng theo tab                            │ Panel theo mục đang chọn    │
│ 1 hàng chính / vị thế                    │ Tổng quan / Lệnh / Monitor  │
│ click hàng → mở panel                    │ / Timeline / Giao dịch     │
│ scroll riêng, header cố định             │ Form + preview + xác nhận  │
└──────────────────────────────────────────┴─────────────────────────────┘
```

- Từ 1024 px trở lên (desktop): bảng vị thế và panel cạnh nhau; panel mặc định 360 px, kéo được trong khoảng 360–560 px; bảng lấy phần còn lại. Đóng panel để xem full-width.
- 1024–1439 px hẹp: có thể dùng drawer overlay rộng tối đa ~440 px nếu cần, không ép bảng quá nhỏ.
- 768–1023 px: drawer tối đa 80% viewport; bộ lọc nâng cao nằm trong popover/drawer.
- Dưới 768 px: vị thế dùng list card, panel toàn màn hình; tab cuộn ngang. Nút hành động chính cố định phía dưới panel, không che nội dung.
- Mở panel không mất filter, sort, vị trí scroll. Back đóng panel trước khi rời trang. Có cảnh báo form chưa lưu khi đổi vị thế/account/tab.

### 3.2 Hệ thống hiển thị

- Kế thừa theme của app; CSS của Terminal có namespace riêng, không sửa global table/modal làm ảnh hưởng Position.
- Cỡ chữ bảng 12–13 px (gọn mặc định); số canh phải và dùng tabular numerals; header thấp, nền trung tính, border nhẹ. Mật độ mặc định `compact`: hàng thấp, padding nhỏ; không tách hàng riêng cho “Chưa có monitor”.
- Xanh/đỏ dành cho lời/lỗ và Long/Short; warning dùng amber kèm chữ nhỏ trong cột Tài khoản. Không tô nền đỏ/xanh toàn bộ hàng giao dịch bình thường.
- Symbol và PnL là điểm nhấn. Cột Tài khoản hiện account + nhãn Monitor + config (env) đang chạy; không có monitor thì dòng chữ nhỏ “Chưa monitor”. Nhãn Side luôn có chữ, không chỉ dựa màu.
- Thuật ngữ thống nhất: Vị thế, Lệnh chờ, Lịch sử vị thế, Lịch sử lệnh, Khớp lệnh, Tài khoản, Config, Giá vào, Giá mark, Giá thanh lý, Giá trị vị thế, PnL đã ghi nhận.
- Không đặt công thức, Redis, cache, version hoặc tên collection trong mô tả đầu trang. Thông tin kỹ thuật nằm trong “Chi tiết dữ liệu”.
- Skeleton khi tải lần đầu; refresh giữ dữ liệu cũ kèm trạng thái. Không thay cả bảng bằng spinner mỗi chu kỳ.
- Keyboard: Tab/focus rõ, Escape đóng lớp trên cùng, trả focus về hàng đã chọn. Enter trong ô nhập không tự gửi giao dịch; xác nhận có nút riêng.

## 4. Điều hướng, bộ lọc và trạng thái lưu

Context toàn workspace: `audience`, `account`, `book`. Bộ lọc từng tab được giữ độc lập. Không hiển thị bộ lọc không có tác dụng với tab hiện tại.

URL đề xuất: `/terminal?tab=positions&account=bot-demo&book=live&symbol=BTCUSDT&selected=<opaque-key>&panel=overview`. Adapter đổi `book=live` sang contract hiện có; không tự gửi giá trị mới cho API cũ. Encode khóa, không tự parse bằng ký tự có thể xuất hiện trong ID.

- Tab hợp lệ: `positions`, `open-orders`, `position-history`, `order-history`, `fills` (R2).
- Filter/sort/selection/range/page nằm trong URL để reload và chia sẻ deep link.
- Cột, mật độ, độ rộng panel và view đã lưu nằm trong localStorage có version + user ID, riêng namespace Terminal. Không lưu credentials, snapshot tài khoản, receipt hay lịch sử giao dịch vào preferences.
- Không tự khôi phục form giao dịch, không tự chọn tài khoản đầu tiên khi scope thay đổi. Ticket phải có tài khoản cụ thể và đã được xác nhận bằng ngữ cảnh UI.
- View mặc định: Tất cả, Đang lời, Đang lỗ, Cần chú ý. Cho tạo/đổi tên/xóa view cá nhân từ bộ lọc hiện tại. View không thay đổi quyền và không tự gửi lệnh.
- Bộ lọc nâng cao Positions: config, signal, LONG/SHORT, cảnh báo, NOTPSL, pending. Live/Paper vẫn hiện rõ; nếu xem kết hợp thì tổng hợp tách hai nhóm.
- Thông báo trình duyệt giữ opt-in như hiện có; chuyển vào menu tùy chọn. Chống trùng thông báo khi reconnect; không lặp toast liên tục cho cùng cảnh báo.

## 5. Ma trận giữ nguyên chức năng — nghiệm thu R1

“Giữ” nghĩa là truy cập được trong menu mới theo cùng permission/scope và kết quả nghiệp vụ; không chỉ đặt một link quay về Position.

| ID | Khả năng hiện có phải giữ | Vị trí mới |
|---|---|---|
| P01 | Xem nhiều tài khoản, mine/all trong scope; lọc account/config/symbol/signal/side | Header + bộ lọc |
| P02 | Live, Paper, kết hợp, pending, NOTPSL, cảnh báo | Chọn sổ + bộ lọc nâng cao |
| P03 | WS, fallback, refresh sàn, timestamp/stale/error từng nguồn | Badge dữ liệu + Đồng bộ |
| P04 | Size, entry, mark, PnL, ROI, recorded net, liquidation, notional; sort | Bảng + tùy chọn cột |
| P05 | Close Market/Limit; quantity và 10/25/50/75/100%; preview phí/PnL/sibling | Panel Giao dịch → Đóng |
| P06 | Open LONG/SHORT Market/Limit | Đặt lệnh → Mở vị thế |
| P07 | Reverse, hai bước đóng rồi mở, preview | Menu … → Đảo chiều |
| P08 | Position TP/SL, working type, tạo/thay/hủy theo hỗ trợ hiện có | Panel Bảo vệ |
| P09 | Trailing callback/activation và hủy trailing | Panel Bảo vệ → Trailing |
| P10 | Expand monitors, qty riêng, snapshot qty, TP/SL dự kiến, HP, timestamps/heartbeat | Expand ngắn + tab Monitor |
| P11 | Thêm monitor từ trang/từ vị thế, xóa monitor không đóng sàn | Menu … → Quản lý monitor |
| P12 | Case reconcile, nguồn dữ liệu, ownership/share/leftover, cảnh báo lệch | Panel Tổng quan + Monitor |
| P13 | Case orders thường/algo: xem, thêm nhanh, sửa, hủy | Panel Lệnh liên quan |
| P14 | Timeline quyết định, expected orders, MAE/MFE và stats monitor có dữ liệu | Panel Timeline + Monitor |
| P15 | Open orders, lọc, chọn và hủy từng lệnh/hàng loạt | Tab Lệnh chờ |
| P16 | Ticket Buy/Sell Market/Limit/Stop Market/Stop Limit; reduce-only đúng mode | Panel Đặt lệnh → Lệnh nâng cao |
| P17 | Order history, lọc thời gian/type/status/kind/side, phân trang, chi tiết | Tab Lịch sử lệnh |
| P18 | Position history live từ Binance `/fapi/v1/positionHistory`; gắn config env/signal; range, profit, reason, copy, signal, sort/page | Tab Lịch sử vị thế |
| P19 | History summary: lời/lỗ/hòa, win rate, PF, avg win/loss/hold, missing PnL | Summary của tab lịch sử |
| P20 | Trade detail: narrative, source/missing, fees/funding, ROE/R, observed extremes, snapshot/logs, link config khi có quyền | Panel chi tiết lịch sử |
| P21 | Toast và opt-in browser notification mở/đóng vị thế | Trung tâm thông báo nhỏ |
| P22 | Permission, scope, audit, idempotency, server validation/rate limits | Giữ tại backend + UI phản ánh |

Phải đối chiếu source khi bắt đầu code: nếu có chức năng mới hơn bảng này thì thêm vào parity checklist; không xóa vì spec chưa liệt kê.

## 6. Tab Vị thế và panel chi tiết

### 6.1 Bảng

Mặc định: Symbol/Side/đòn bẩy; Tài khoản; Size; Entry/Mark (hai giá trong một ô); PnL/ROI; Bảo vệ; Thao tác. Một hàng chính cho mỗi khóa vị thế hiện hành; giữ khóa gốc của nguồn dữ liệu, không gộp khác account, book hoặc positionSide.

Cột tùy chọn: config/signal, realized/recorded net, liquidation, khoảng cách thanh lý, notional, thời gian giữ nếu có nguồn, tuổi dữ liệu. Không nhân đôi PnL sàn theo số monitor. Giữ sort hiện có; sort giá trị null xuống cuối, tie-break ổn định; refresh không tự đưa hàng được chọn sang vị thế khác.

Nút trên hàng: “Đóng”, “TP/SL”, “…”. Các nút mở form/preview, không lập tức giao dịch. “…” chứa Reverse, thêm/xóa monitor và mở chi tiết theo quyền. Expand chỉ hiện monitor summary; form đóng không lặp dưới mọi hàng.

Summary phía trên áp dụng **toàn bộ kết quả khớp filter**, không chỉ trang hiện tại: tổng unrealized PnL, tổng absolute notional, số vị thế, số vị thế cần chú ý. Hiện phạm vi đang tổng hợp; có thiếu dữ liệu thì hiện coverage. Chỉ tổng các giá trị cùng đơn vị; Live/Paper tách riêng, không cộng ROI phần trăm.

### 6.2 Trạng thái bảo vệ

Hiển thị riêng SL và TP, có nguồn và độ mới. SL có thể là:

- “SL sàn”: tìm thấy protective order đang hoạt động đúng account/symbol/positionSide; nếu bảo vệ một phần phải ghi tỷ lệ/qty, không ghi toàn bộ.
- “Bot theo dõi”: chỉ có điều kiện monitor; thể hiện heartbeat riêng, không coi tương đương lệnh SL trên sàn.
- “Chưa có SL sàn”: sổ lệnh đã đối chiếu đầy đủ và mới, không tìm thấy SL thích hợp. Monitor vẫn có thể có SL riêng.
- “Chưa xác minh”: stale, thiếu nguồn, reconcile lỗi hoặc chưa tải đủ orders.

SL/TP ảo của từng config không chuyển thành mức giá chung khi không đủ thông tin. Nhiều TP hiện “3 mức” và mở chi tiết. Trailing cho biết callback + activation + trạng thái từ nguồn, không suy đoán đã kích hoạt chỉ dựa mark hiện tại.

### 6.3 Panel

- **Tổng quan:** dữ liệu sàn, PnL mở và đã ghi nhận tách biệt, trạng thái SL/TP, cảnh báo và cập nhật gần nhất.
- **Lệnh:** regular/algo đang liên quan, trạng thái/filled, thêm/sửa/hủy theo quyền; reconcile tại đây.
- **Monitor:** bảng env/signal/ownQty/share/entry/TP-SL dự kiến/heartbeat; chọn monitor để xem stats/expected orders.
- **Timeline:** sự kiện có nguồn và thời gian; giữ timeline monitor hiện có. Không gọi danh sách 7 ngày là toàn bộ lịch sử đời vị thế.
- **Giao dịch:** các mode Mở, Đóng, Bảo vệ; Reverse chỉ vào qua hành động rõ ràng. Không đè draft khi mark cập nhật.

Ownership hiển thị `exchangeQty`, tổng `ownQty` còn mở và phần chênh lệch. Nếu tổng ownQty lớn hơn qty sàn, hiện “Lệch phân bổ”, không clamp thành 0 rồi coi hợp lệ. Phần qty chưa có monitor không tự gán cho config. Lọc config chỉ chọn vị thế chứa config đó; PnL cấp sàn vẫn phải có nhãn “toàn vị thế”, không giả là PnL riêng config.

## 7. Đặt lệnh và vòng đời mutation

### 7.1 Ticket R1

Mở vị thế dùng permission `positions.open` và endpoint positions/open. Ticket lệnh nâng cao dùng `orders.create` và endpoint orders. Không đổi endpoint để né quyền. Account/symbol/side luôn hiện tại phần preview; lúc header đang “Tất cả”, ticket bắt buộc chọn một account.

Các trường cơ bản: account, symbol, positionSide phù hợp mode, order type, quantity; price/trigger/working type/time-in-force/reduce-only theo contract thực tế. Chỉ hiện tổ hợp được backend hỗ trợ. Phân biệt hướng vị thế LONG/SHORT với BUY/SELL của order.

Đóng: chọn Market/Limit, quantity hoặc %; preset 10/25/50/75/100. Preview qty sau làm tròn, giá tham chiếu/limit, notional, PnL ước tính, phí đóng ước tính và danh sách sibling bị tác động. Mặc định là đóng vị thế sàn; không gắn nhãn “chỉ config này” nếu backend chưa hỗ trợ và kiểm tra ownership.

Thêm/xóa monitor có form riêng. Xóa ghi rõ “Xóa monitor, không đóng vị thế sàn”. Không đặt cạnh nút Đóng với cùng màu/nhãn.

### 7.2 Xác nhận và trạng thái

Luồng UI: `draft → preview → submitting → accepted / rejected / unknown`. Sau `accepted`, theo dõi riêng trạng thái sàn `NEW / PARTIALLY_FILLED / FILLED / CANCELED / EXPIRED...` từ nguồn. Thành công request không đồng nghĩa đã khớp hoặc đã đóng hết.

- Preview và Confirm trong cùng panel, không chồng nhiều modal. Confirm ghi động từ + symbol + qty + account.
- Mỗi ý định gửi dùng một idempotency key ổn định qua retry; sửa nội dung thành ý định mới thì key mới. Double-click không gửi hai mutation.
- Timeout/disconnect sau gửi là **chưa xác định**, không tự báo thất bại và không tự retry bằng key mới. Giữ requestId nếu có, tra receipt và reconcile; nếu backend chưa hỗ trợ phục hồi đủ thì hiển thị hạn chế, không hứa exactly-once.
- Server kiểm tra lại quyền/scope, position mode, qty/precision và trạng thái trước khi gửi sàn. Trường `expected` có mặt ở route không chứng minh đã enforce optimistic concurrency; phải kiểm tra service.
- Qty hoặc ownership đổi trong lúc preview: yêu cầu tính lại trước confirm. Giá market có thể thay đổi; hiển thị tuổi quote và ước tính, không khóa vĩnh viễn mỗi tick.
- Idempotency phải được kiểm tra cả hai request đồng thời và crash/timeout sau exchange acceptance; nếu nền hiện tại có khoảng trống phải bổ sung tối thiểu và test, không chỉ disable button.
- Refresh dữ liệu đúng account sau kết quả; giữ draft khi bị validation reject. Không optimistic-remove hàng vị thế trước khi có dữ liệu xác nhận.
- Reverse hiển thị hai bước: đóng cũ → mở đối ứng. Bước mở lỗi sau khi đóng phải báo rõ trạng thái hiện tại; không tự mở lại phía cũ. Backend phải xác nhận bước đóng phù hợp trước khi mở, không suy từ HTTP 200.
- Batch cancel báo kết quả từng order và tổng thành công/thất bại/chưa xác định. Không coi thiếu `results` là tất cả thành công.
- Replace/cancel-create có thể thành công một phần: hiện order cũ đã hủy, order mới chưa tạo; không tự rollback bằng giao dịch mới.

## 8. R2 — tính năng mới có giá trị sử dụng

### 8.1 Sizing theo USDT và rủi ro

Ticket thêm ba mode: Qty, Giá trị USDT, Rủi ro USDT. Mode USDT tính từ entry limit hoặc quote market, làm tròn xuống step; hiển thị lại giá trị thực sau làm tròn. Không nhầm notional với margin.

Risk sizing chỉ áp dụng tuyến tính USD-M có đủ price/SL/fee estimate. Với risk budget B, entry E, stop S, phí vào f1 và phí ra f2:

`qtyRaw = B / (abs(E - S) + E*f1 + S*f2)`

SL phải nằm phía lỗ đối với entry; B > 0, giá > 0, mẫu số > 0. Làm tròn xuống step và kiểm tra minQty/minNotional theo backend. Hiển thị đây là ước tính, chưa bao gồm gap/slippage/funding tương lai. Không cho dùng kết quả nếu thiếu filters hoặc quote không hợp lệ.

Ví dụ fixture, không phải giá thị trường: E=100, S=98, B=10, phí tạm 0, step=0.1 → qty=5, notional=500; leverage=10 thì margin tuyến tính sơ bộ=50. Phí thực tế làm qty nhỏ hơn.

Cho preview risk sizing trong R2, nhưng không gọi đó là “mở lệnh đã được bảo vệ” nếu entry và SL chưa được backend quản lý như một kế hoạch có trạng thái. Gửi entry vẫn cần cho biết SL đã đặt hay chỉ là mức dùng để tính size.

### 8.2 Chart chỉ đọc

Panel có chart nến của symbol đang chọn, timeframe 1m/5m/15m/1h/4h/1d; marker Entry/Mark và protective orders xác minh được. Chọn marker mở chi tiết order. Khi xem lịch sử chỉ vẽ markers có thời gian/giá thực, không dựng dữ liệu khớp giả.

Cần nguồn OHLCV riêng qua server/cache, phân biệt mark và contract candle. Chưa xác minh API chart tồn tại. R1 dùng price-level strip bằng SVG/CSS với Entry/Mark/SL/TP nếu đủ dữ liệu; không giả làm candlestick chart. R2 triển khai chart adapter; repo client hiện không có thư viện chart. Không thêm dependency hoặc dùng TradingView widget rồi giả định có thể sửa lệnh riêng; lựa chọn thư viện/license cần ghi trong quyết định triển khai. Có thể dùng canvas/SVG với phạm vi zoom/pan tối thiểu.

### 8.3 Khớp lệnh và nhật ký

Thêm tab Khớp lệnh từ fill read model: thời gian, account, symbol, BUY/SELL, positionSide, price, qty, quote amount, commission + asset, realized PnL, orderId/tradeId. Dedupe theo khóa nguồn, không biến mỗi order thành một fill.

Chi tiết lịch sử có timeline kết hợp fills/order events/monitor events khi liên kết chắc chắn. Chỉ gộp cùng trade cycle có identifier hoặc ranh giới open/close xác minh được; không gộp hai lần giao dịch BTC khác nhau chỉ vì cùng symbol/side. Không thể xác định → ghi “Chưa liên kết”, giữ record nguồn.

R2 thêm note/tags cá nhân gắn stable trade ID; không ghi vào stats gốc. Ghi chú tách quyền riêng tư người viết, không giả note là sự kiện bot. Cho sửa/xóa note của mình, tối đa 2.000 ký tự/note và 10 tags, mỗi tag 30 ký tự; render text, không HTML.

### 8.4 Lịch sử và phân tích

Giữ filters/summary/detail cũ. Thêm cumulative net PnL theo thời điểm đóng, phân nhóm signal/config/symbol/side, lịch ngày và CSV theo filter. Không gọi cumulative closed PnL là account equity hoặc tính account drawdown từ dữ liệu thiếu cashflow/open PnL.

- Mọi summary tính trên toàn bộ tập khớp filter từ server, không trên page hiện tại. Cho biết số record đủ/thiếu dữ liệu.
- Net = realized - commissionCost + signedFunding khi có nguồn đầy đủ và đã chuẩn hóa dấu. PnL đã lưu không bị trừ phí lần hai. Phí asset khác USDT không cộng trực tiếp nếu thiếu tỷ giá.
- Win rate = wins/(wins+losses+flats) theo định nghĩa nhất quán với history hiện hành; loại record thiếu profit khỏi mẫu số và nêu số lượng thiếu.
- Profit factor = tổng profit dương / abs(tổng profit âm). Không có lệnh lỗ thì hiện ∞ khi có lời, hoặc — khi không có dữ liệu phù hợp.
- MAE/MFE, R-multiple chỉ hiển thị khi có dữ liệu và basis; không suy R từ SL hiện tại nếu không có initial risk. Ghi rõ ROE và biến động giá là hai đại lượng khác nhau.
- CSV do server kiểm tra scope + cùng filters, timestamps ISO UTC, có source/unit/coverage khi cần; chống công thức spreadsheet ở các trường text bắt đầu bằng ký tự công thức. Tải có giới hạn công bố và báo nếu vượt, không xuất thiếu âm thầm.
- UI hiển thị timezone rõ, mặc định Asia/Ho_Chi_Minh; range “Hôm nay” chuyển đúng sang UTC `[from,to)`. Endpoint cũ dùng ngày UTC phải ghi rõ hoặc được adapter xử lý, không chỉ đổi nhãn.

## 9. R3 — chart giao dịch và kế hoạch thoát

### 9.1 Sửa trên chart

Kéo SL/TP/limit chỉ tạo draft; hiện giá cũ/mới, qty, PnL/risk dự kiến, nhấn Confirm mới gửi endpoint hiện có. Escape trả lại. Thiếu quyền vẫn xem marker nhưng không kéo. Nhiều order cùng giá cần chọn order cụ thể; không sửa tất cả theo symbol.

### 9.2 Multi-TP

Cho 2–5 mức, mỗi mức giá + % hoặc qty; tổng allocation không vượt qty khả dụng, hiện phần chưa phân bổ. Rounding theo step, residual có giải thích; kiểm tra các pending exits đang tồn tại để tránh đặt trùng. Tách kế hoạch toàn vị thế sàn khỏi monitor sibling.

Server quản lý plan và child orders bền vững: từng child có ID/trạng thái, số đã khớp, số còn lại; retry không tạo thêm TP. Nếu một child thất bại, hiển thị partial và cách tiếp tục, không báo kế hoạch hoàn tất. Entry fill một phần, DCA, đóng tay hoặc thay qty đều phải reconcile lại; không tự hủy protective order của config khác.

### 9.3 Hòa vốn và tự động dời SL

Hai tính năng riêng:

- “Dời SL về entry” thủ công: preview mức entry; ghi rõ chưa bù phí/funding.
- “Hòa vốn ước tính sau chi phí”: chỉ khi đủ entry/exit fee và funding đã phân bổ; ghi giả định. Không coi entry là hòa vốn net.

Automation “TP1 khớp → dời SL” chạy ở backend/bot với plan lưu bền vững, hoạt động khi đóng trình duyệt, chống xử lý lặp và phục hồi sau restart. Trạng thái plan tối thiểu: draft/armed/active/partially_completed/completed/paused/failed/canceled; child execution có trạng thái độc lập. Một position/config chỉ có một chủ thể điều khiển SL cho cùng phạm vi; phát hiện xung đột với monitor thì chặn kích hoạt và giải thích. Không tự viết đè TP/SL monitor.

Không đưa vào R1/R2: auto-reverse, chase, TWAP, iceberg, đổi leverage/margin mode. **Đóng toàn bộ theo bộ lọc** (cùng % mỗi vị thế live đang hiện) đã có trên Terminal — không phải đóng mọi account hệ thống ngoài filter; xem [terminal-r2-tools-spec](terminal-r2-tools-spec.md).

## 10. Dữ liệu, tính toán và độ mới

- Tiền/price/qty truyền dạng decimal string khi mutation; backend là nơi quyết định tick/step/min filters. Không dùng số hiển thị đã làm tròn để gửi sàn. Không giới hạn mọi coin vào 4 chữ số thập phân.
- PnL tuyến tính ước tính: LONG `abs(qty)*(mark-entry)`, SHORT `abs(qty)*(entry-mark)`. One-way dùng direction và qty sign đã chuẩn hóa, không mặc định BOTH là LONG.
- ROI/ROE theo basis hiện có; tooltip nêu mẫu số. Thiếu margin/basis → —, không chia cho notional rồi gắn nhãn ROI đòn bẩy.
- Khoảng cách SL/thanh lý hiển thị phần trăm biến động giá từ mark theo hướng bất lợi, không phải ROI. Giá thiếu/0/không hợp lệ → —; mức đã bị vượt → trạng thái cảnh báo, không lấy absolute rồi hiện an toàn.
- Mỗi nguồn có `source`, `updatedAt`, trạng thái verified/stale/unknown/error và coverage nếu cần. Đây là view-model đề xuất; adapter từ payload hiện tại, không coi các field đã tồn tại ở mọi endpoint.
- Độ mới mark, positions, orders và monitor độc lập. Mark mới không chứng minh SL hay qty đã đối chiếu mới.
- R1 kế thừa cadence/stale policy WS/fallback hiện có, không tăng polling để làm UI có vẻ live. Subscribe một nguồn dùng chung cho bảng và panel, abort request cũ khi đổi context, bỏ response sai context/version.
- Empty verified: “Không có vị thế trong bộ lọc”. Empty unverified: “Chưa có dữ liệu xác minh”. Account lỗi không được làm cả workspace trông như không còn vị thế.
- Nếu nguồn không đủ xác minh điều kiện hành động, ticket yêu cầu đối chiếu; không cấm toàn trang chỉ vì một account khác lỗi. Server quyết định thực thi cuối cùng.

## 11. API và phần phải bổ sung

### 11.1 Tái sử dụng API đã tìm thấy trong route

| Nhóm | API |
|---|---|
| Position list/live | `GET /api/positions`, WS `/api/positions/ws`, `POST /api/positions/refresh` |
| Case/detail | `GET /api/positions/detail`, `GET /api/positions/case`, `POST /api/positions/case/reconcile` |
| Monitor | `POST /api/positions/monitors`, `DELETE /api/positions/monitors/:id` |
| Position history | `GET /api/positions/history`, `GET /api/positions/history/:id` |
| Orders | `GET /api/orders/open`, `/api/orders/history`, `/api/orders/mark`, `/api/orders/:kind/:symbol/:orderId` |
| Open/close/reverse | `POST /api/trading/positions/open`, `/close`, `/reverse` |
| Protection | `PUT /api/trading/positions/:positionKey/tpsl`, `DELETE /api/trading/positions/:positionKey/tpsl/:kind/:orderId` |
| Create/replace | `POST /api/trading/orders`, `PUT /api/trading/orders/:kind/:symbol/:orderId` |
| Cancel | `POST /api/trading/orders/cancel`, `/api/trading/orders/cancel-batch` |
| Receipt | `GET /api/trading/commands/:requestId` |

`positionKey` route hiện tách **ba phần** `username|symbol|positionSide`, ví dụ `bot-demo|BTCUSDT|LONG`, encode khi vào path. Không dùng chuỗi bốn phần `username|SYMBOL|LONG|SHORT` trong tài liệu cũ làm payload. Order ID giữ string. Map `regular`/`algo` theo contract, không nhầm label UI với field API.

### 11.2 Hợp đồng bổ sung đề xuất — chưa xác minh có implementation

Trước R2/R3 tạo endpoint-contract cụ thể trong PR: query/body, response, permission/scope, null/error, pagination, cache/rate limit, audit và tests. Ưu tiên mở rộng read model hiện hành tương thích ngược; không dựng backend trading thứ hai.

| Nhu cầu | Contract tối thiểu cần có |
|---|---|
| Symbol capabilities | tick/step/min filters, supported type/mode, quote timestamp; phục vụ sizing, server vẫn validate |
| Candles | symbol, interval, from/to/limit, candle source; trả OHLCV/time và coverage, cache public data |
| Fills | account/symbol/side/range/cursor; trả fill ID/order ID, price/qty, fee asset/cost, realized, source |
| Analytics/export | cùng scope/filter lịch sử; full-dataset summary, coverage/timezone, export có giới hạn |
| Note/tags | stable trade reference + actor-owned note/tags; create/read/update/delete, xác minh quyền xem trade gốc |
| Exit plan | versioned plan/children, owner scope, lifecycle, idempotent create/update/cancel/reconcile và optimistic concurrency |
| Unknown receipt recovery | tra trạng thái theo request/idempotency key trong phạm vi actor, không lộ receipt người khác |

Nếu cần schema mới, namespace `web_terminal_*` là đề xuất, phải kiểm tra conventions/model và lập migration/index; không đổi dữ liệu bot gốc để phục vụ trình bày. Preferences R1 không cần collection mới.

## 12. Quyền và invariant

- Menu cho user có ít nhất một quyền xem Positions/Orders/History (`positions.view`, `orders.view`, `statistics.view`); tab mặc định là tab đầu tiên họ được xem. Không gọi API tab bị cấm. Gate route mới độc lập, không sửa gate Position cũ.
- Mở: `positions.open`; đóng: `positions.close`; reverse: cả hai; TP/SL/trailing: `positions.tpsl`; orders: quyền view/create/edit/cancel tương ứng. Monitor add/delete giữ quyền route hiện tại; không suy ra từ quyền view.
- Account options cho mutation phải phản ánh scope của chính mutation; scope view rộng không cho phép trade toàn bộ. Server kiểm tra lại mỗi request, kể cả đọc receipt, export và WebSocket.
- R2 fills dùng `orders.view`; analytics/history dùng `statistics.view`. Note cá nhân yêu cầu quyền xem trade + note thuộc actor; nếu thêm permission thì cập nhật catalog và auth spec, không hardcode role ở JSX. R3 plan phải có contract quyền rõ cho mọi child action trước triển khai.
- Endpoint tổng hợp/case không được rò fields từ domain user không có quyền. Nếu payload cũ chưa tách được, cần sanitize/gate backend và regression test.
- Paper không gọi live mutation endpoint. R1 giữ khả năng thao tác paper đúng hiện trạng; tính năng paper mới chưa có backend phải disabled với lý do.
- Không gán qty monitor = qty sàn; không dùng `closePosition=true` cùng quantity; không cancel-all theo symbol để sửa một SL; preserve positionSide và sibling.
- Không đọc/commit `.env`, API keys hoặc dữ liệu thật vào fixtures/docs. Không thêm dependency hoặc sửa runtime binance-bot chỉ để đổi UI.

## 13. Kiến trúc client đề xuất

Tạo `pages/TerminalPage.jsx`, components dưới `components/terminal/`, CSS riêng. Phân tách Shell/Header, Summary, FilterBar, PositionTable, OrderTable, HistoryView, DetailPanel, TradeTicket, ProtectionEditor, MutationStatus.

Tách data adapter/hook khỏi presentation cho Terminal; dùng API client/auth/navigation/formatter hiện có khi đúng ngữ nghĩa. Không copy nguyên PositionsPage rồi tiếp tục phình một file, cũng không refactor hàng loạt module cũ. Nếu extract shared logic phải giữ contract và thêm regression phù hợp cho cả hai menu.

URL state, preferences và draft state độc lập. Selection dùng stable identity. WS/store chỉ dùng trong phạm vi session/scope hiện tại; logout hoặc mất quyền phải loại dữ liệu đã cache khỏi view.

## 14. Checklist nghiệm thu

### 14.1 R1 bắt buộc

1. `/terminal` xuất hiện đúng quyền; `/positions` giữ route và toàn bộ hành vi cũ. Không có CSS bleed.
2. Mỗi P01–P22 có bằng chứng: màn hình, API/source tái sử dụng và case kiểm tra; không bỏ nút khó rồi coi là parity.
3. Viewport 1440×900, 1024×768, 390×844: không tràn toàn trang; bảng được cuộn trong container; panel/form đầy đủ, focus/keyboard hoạt động.
4. 100 vị thế mock nhiều account/config: chọn dòng không nhầm, refresh không mất draft/scroll; mở panel không tạo một subscription cho mỗi hàng. Không dùng dữ liệu thật làm fixture.
5. LONG/SHORT cùng symbol; One-way BOTH short; nhiều account cùng symbol; Live/Paper; sibling; ownQty vượt/thiếu qty sàn đều hiển thị đúng, không double-count.
6. Thiếu SL, SL một phần, chỉ monitor SL, heartbeat mất, Redis stale, order source lỗi: nhãn bảo vệ đúng; không có “an toàn” từ dữ liệu chưa xác minh.
7. Close 10/25/50/75/100%, custom qty, Market/Limit; open; reverse; TP/SL/trailing create/update/cancel; monitor add/delete; orders create/edit/cancel/batch đều giữ chức năng và quyền.
8. Permission allow/deny và khác scope view/mutation; thiếu orders.view không lộ orders qua case; missing/invalid CSRF bị chặn; receipt không đọc chéo actor.
9. Double-click, retry, concurrent same-key, timeout-after-accept, partial fills, partial batch failure, reverse-open failure, replace-create failure được test bằng mock/stub. Không gửi lệnh live để thử UI.
10. 401/403/429/network error có thông báo đúng và không retry storm; nguồn một account lỗi không xóa dữ liệu account còn lại.
11. History filters, source/missing, phí/funding, ROE basis, sort/page và deep-link/back hoạt động. Không đổi số liệu để làm giao diện đẹp hơn.
12. Có empty/loading/error/stale/permission-denied/unknown-mutation states thật, không chỉ happy path screenshot.

### 14.2 R2/R3 bổ sung

- Risk sizing test LONG/SHORT, fee, rounding/min constraints, thiếu quote, SL sai phía; R1 không bị regression.
- Fills dedupe; trade-cycle linking không gộp các lần mở lại; history totals vượt một page; timezone boundary; fee asset khác đơn vị; CSV injection và scope.
- Chart timeframe/source đúng, marker đúng account/side, thiếu candles không crash.
- Notes riêng từng actor, text escaped, ID nguồn còn tồn tại và scope được kiểm tra.
- R3 thử restart worker, duplicate event, partial fill, DCA/đóng tay, child failure, monitor conflict và cancel plan; tắt browser không làm automation dừng.

Chạy build client và test server theo hướng dẫn repo; thêm test logic trọng yếu, không tạo snapshot test chỉ phản chiếu markup. Bàn giao ghi rõ command đã chạy, case manual và phần chưa kiểm chứng. Thay đổi shared backend/auth phải chạy regression tương ứng.

## 15. Thứ tự thực hiện và bàn giao cho AI triển khai

1. Đọc source, lập parity checklist P01–P22, xác minh contracts và trạng thái worktree. Ghi các mismatch với docs cũ.
2. Dựng menu/route/shell/CSS mới bằng dữ liệu giả lập không có giao dịch, kiểm tra desktop/mobile.
3. Nối reads/WS/filters/summary/panel/history; giữ source và permission đúng.
4. Nối mutations qua backend hiện có, hoàn thiện preview/receipt/partial-failure states và tests.
5. Hoàn tất R1 parity, review Position cũ, chụp ảnh bằng fixtures. Không tuyên bố R1 xong nếu thiếu một nhóm chức năng đã có.
6. R2: chốt API còn thiếu → sizing/chart/fills/notes/analytics/export → test.
7. R3: thiết kế persisted plans/worker/conflict policy → triển khai backend → UI chart/TP/BE → test phục hồi.
8. Cập nhật docs API/flows/feature spec nếu thay đổi implementation; commit/push theo AGENTS. Không deploy hoặc gửi giao dịch thật chỉ để nghiệm thu.

Prompt có thể giao cho AI khác:

> Triển khai menu Terminal mới tại `/terminal` trong web-bot theo `docs/terminal-workspace-spec.md`. Bắt đầu với toàn bộ R1, giữ nguyên menu `/positions` và logic trading/bot. Đọc AGENTS và source trước khi sửa, lập checklist P01–P22, dùng lại backend hiện có; không giả định field/API đề xuất đã tồn tại. Làm đầy đủ UI desktop/mobile, permission/scope, loading/error/stale và mutation failure states, kiểm tra parity và tests/build. Không dùng lệnh giao dịch live làm test. Bàn giao rõ chức năng hoàn thành, gap và phần R2/R3 chưa triển khai. Không thêm dependency hoặc viết lại module bot đang chạy.

## 16. Tham khảo thiết kế

- [Altrady widgets](https://help.altrady.com/en/layouts-widgets/widgets-explained): cách chia workspace và quản lý vị thế.
- [TradingView brackets](https://www.tradingview.com/support/solutions/43000659802-i-want-to-use-brackets-on-the-chart/): tương tác mức TP/SL trên chart; không đồng nghĩa widget nhúng hỗ trợ backend riêng.
- [3Commas SmartTrade](https://3commas.io/smart-trade): form kế hoạch thoát và trailing.
- [Tiger Trader's journal](https://broker-docs.tiger.com/english-2/interface/traders-journal): lịch sử và phân tích giao dịch.

Các nguồn là tham khảo UX, không phải cam kết API, licensing hay khả năng của implementation này.
