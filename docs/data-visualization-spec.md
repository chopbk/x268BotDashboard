# Spec trực quan hóa dữ liệu web-bot

Ngày: 2026-11-02. Cập nhật triển khai: **2026-11-02**.

Trạng thái: **P0 đạt, còn gap nhỏ** (bucket >90d + bench đã có; user trial formal vẫn nợ). **P1 đủ.** **P2 đã làm:** Signal thống kê, Hệ thống process/RAM, Log histogram aggregate.

## 1. Mục tiêu và phạm vi

Giúp người dùng trả lời trong khoảng 10 giây: đang lãi/lỗ ở đâu, nhóm nào đóng góp nhiều nhất, vốn đang tập trung ở đâu và phần nào cần kiểm tra. Biểu đồ phải dẫn được tới dữ liệu chi tiết để kiểm chứng.

Nâng các màn hiện có, giữ menu, bộ lọc và bảng. Không đổi công thức giao dịch, quyền truy cập, cấu hình bot, hành vi đặt/đóng lệnh. Không thêm chart cho Profile, User API, Admin Users hoặc form Config chỉ để trang trông đầy hơn. Thị trường/Smart Money/Terminal đã có chart giá: giữ lại và thống nhất cách đọc, không tạo chart giá trùng lặp.

Tham chiếu: [Tính năng](feature-spec.md), [API/dữ liệu](api-data-reference.md), [Dashboard](dashboard-overview-spec.md), [Scorecard](provider-scorecard-spec.md), [Auth/RBAC](auth-rbac-spec.md). Khi triển khai chạm scope/quyền phải đọc toàn bộ spec auth.

## 2. Nguyên tắc giao diện

### Cấu trúc một màn

1. Tiêu đề + bộ lọc hiện tại + thời điểm cập nhật.
2. 3–5 chỉ số thiết yếu; chỉ số phụ đưa vào phần mở rộng.
3. Tối đa 2 chart chính đang mở; bảng chi tiết nằm ngay sau chart.
4. Chip mô tả lựa chọn đang lọc + nút “Bỏ chọn biểu đồ”.

Không thêm hàng chart khiến bảng bị đẩy qua nhiều màn hình. Desktop chart thông thường cao 240–300px; mobile 200–240px. Bar ranking cao theo số hàng, tối đa 10 hàng trước nút xem thêm. Chart trong Terminal dùng vùng mở rộng/gập được, không chiếm chỗ thao tác lệnh.

### Cấu trúc một chart

- Tiêu đề là câu hỏi cụ thể: “Signal nào đóng góp PnL nhiều nhất?”, “Phí và funding ảnh hưởng bao nhiêu?”.
- Dòng phụ nêu kỳ, đơn vị, nguồn và cơ sở thời gian; ví dụ “30 ngày · USDT · lệnh đóng · UTC”.
- Một câu tóm tắt tính bằng code từ đúng tập dữ liệu: “SIGNAL_A đóng góp +120 USDT từ 35 lệnh”. Không dùng AI để tạo số hoặc kết luận nhân quả.
- Trục/nhãn dễ đọc, tooltip chi tiết, nút “Xem dữ liệu” cho bảng tương đương có thể dùng bàn phím.
- Bảng gốc vẫn là nơi xem đầy đủ. Chart không thay thế bảng và không tự kích hoạt mutation.

### Màu, số và trục

- Lãi: xanh, dấu `+`; lỗ: đỏ, dấu `−`; 0: xám. Cảnh báo chất lượng: vàng + nhãn chữ. Không truyền thông tin chỉ bằng màu.
- Long/Short là hai màu phân loại ổn định, không dùng màu lãi/lỗ để ngụ ý Long tốt và Short xấu. Tooltip luôn ghi nhãn.
- Money hiển thị đơn vị thực tế. Chỉ cộng tiền khác tài sản khi backend đã quy đổi cùng đơn vị và công bố nguồn quy đổi; không cộng qty BTC với qty ETH/contracts.
- Trục tiền trên cùng chart dùng chung scale; bar bắt đầu từ 0, PnL âm/dương có đường 0. Không dùng 3D, trục kép hoặc pie cho số âm.
- Rút gọn số trên trục (1.2k), tooltip giữ giá trị rõ ràng và đơn vị; định dạng nhất quán với trang, không làm tròn giá trị dùng để tính.
- Chuỗi thời gian có trục ngày/giờ, giá trị và khoảng trống khi thiếu dữ liệu. Không nối qua ngày thiếu như thể có snapshot.
- UTC là chuẩn thống kê hiện tại. Hiển thị rõ “UTC”; không âm thầm đổi ngày thống kê theo timezone trình duyệt.

### Responsive và khả năng truy cập

- >=1200px: hai chart có thể nằm cạnh nhau; 768–1199px: tùy độ dài nhãn, ưu tiên một cột; <768px: một cột.
- Không cuộn ngang toàn trang ở 360px. Bảng và lịch nhiều tuần được cuộn trong vùng riêng có nhãn.
- Tooltip mở bằng hover, focus hoặc tap; Escape đóng, điểm chọn có focus rõ; Enter/Space chọn và có nút bỏ chọn.
- Màu/chữ đạt tương phản WCAG AA; có nhãn chữ/dấu cho trạng thái. Không đọc hàng trăm điểm qua live region khi refresh.
- Tôn trọng reduced motion. Không animate chart mỗi lần giá cập nhật, không tự đổi thứ tự hàng trong lúc người dùng tương tác.

## 3. Phạm vi triển khai theo giai đoạn

| Giai đoạn | Màn | Kết quả chính | Điều kiện dữ liệu | Trạng thái |
|---|---|---|---|---|
| P0 | Hiệu quả lệnh | Bar PnL theo nhóm + lịch PnL thay phiên chart ngày | Aggregate/`series` `account-statics`; `listSignal`/`listEnv`/`listSymbol`/`listDay` chỉ lọc bảng | **Đạt, còn gap** |
| P0 | Scorecard | Bar xếp hạng mặc định, bubble so sánh tùy chọn | Cùng response; `winRate=null` khi 0 lệnh; selection đẩy history | **Đạt, còn gap** |
| P0 | Ví & dòng tiền | Nâng chart hiện có: trục, tooltip, gap, bảng dữ liệu | Không đổi định nghĩa balance/trading; chưa waterfall | **Đạt, còn gap** |
| P1 | Ví & dòng tiền | Waterfall phân rã income | Bắt buộc metadata xác nhận thành phần không trùng; legacy/mixed ẩn waterfall | **Đã làm** — `incomeBreakdown` + gate |
| P1 | Tổng quan/Thống kê | Đóng góp PnL bot/user; Long/Short | Dùng đúng nguồn từng màn | **Đã làm** |
| P1 | Terminal | Tỷ trọng notional + phân bổ symbol | Snapshot sàn đầy đủ, đơn vị đã chuẩn hóa | **Đã làm** |
| P2 | Signal thống kê | Top lỗi parse, mức sử dụng signal | Aggregate hiện có; ghi rõ kỳ/coverage | **Đã làm** |
| P2 | Hệ thống/Log | Trạng thái process, RAM, số lỗi theo thời gian | Snapshot cho status; API aggregate mới cho log | **Đã làm** |

Mỗi giai đoạn có thể bàn giao riêng; không chặn P0 vì chưa có lịch sử RAM hoặc dữ liệu waterfall chuẩn.

## 4. Chi tiết từng màn

### 4.1 Báo cáo → Hiệu quả lệnh

Nguồn: [TradePerformancePage](../client/src/pages/TradePerformancePage.jsx) → `GET /api/account-statics` → [account-statics](../server/src/lib/account-statics.js) → `account_statics`.

**Chart A — PnL theo nhóm:** thanh ngang phân kỳ quanh 0; tab Signal/Config/Symbol dùng cùng lựa chọn nhóm của bảng. Mặc định 10 nhóm có trị tuyệt đối PnL lớn nhất, sắp giảm theo trị tuyệt đối; thêm lựa chọn “Lãi nhiều nhất”/“Lỗ nhiều nhất”. Không gọi danh sách theo trị tuyệt đối là “top hiệu suất”. Tooltip: tên đầy đủ, PnL, số lệnh, win rate theo công thức của màn. Nêu “10/N nhóm”; phần còn lại có tổng lãi và tổng lỗ riêng để không che triệt tiêu.

Bấm thanh đặt filter nhóm, reset page bảng về 1; các filter khác giữ nguyên. Giữ chart nguồn khi chọn nhóm để còn so sánh và bỏ chọn được; bảng chi tiết tải theo lựa chọn. Khi đổi filter nền (kỳ/account/live-paper/side), tải lại chart và xóa lựa chọn không còn hợp lệ.

**Chart B — Theo ngày:** giữ chart PnL ngày hiện có, bổ sung nút “Biểu đồ / Lịch”. Chỉ mở một chế độ cùng lúc. Lịch mặc định khi người dùng chọn chế độ này; không tự đổi khoảng thời gian hiện tại. Dưới 7 ngày ưu tiên bar; từ 7–90 ngày lịch hữu ích; trên 90 ngày chọn tháng hoặc dùng biểu đồ tuần có ghi bucket rõ ràng.

Lịch: hàng thứ trong tuần, cột tuần, nhãn tháng; màu theo PnL có legend riêng âm/dương với tối đa 5 mức mỗi phía. Ngày không có lệnh đã xác nhận = 0; ngày thiếu coverage = gạch chéo/“Thiếu dữ liệu”. Tooltip có ngày UTC, PnL, số lệnh, thắng/thua. Bấm ngày lọc bảng; chip ngày thể hiện rõ.

PnL lũy kế bắt đầu từ 0 của tập lệnh đang xem, ghi “PnL lũy kế lệnh”, không gọi là số dư/equity tài khoản. Chart và KPI ngữ cảnh dùng filter nền; bảng chi tiết ghi rõ filter bổ sung do chart tạo. Không để KPI trông như đã lọc mà số vẫn thuộc tập nền.

### 4.2 Signal → Scorecard

Nguồn: [SignalScorecardPanel](../client/src/pages/SignalScorecardPanel.jsx) → `GET /api/provider-scorecard` → [provider-scorecard](../server/src/lib/provider-scorecard.js). Feed và trade là hai nguồn khác nhau; giữ công thức win theo status và thời gian openTime hiện tại.

Một vùng chart với hai chế độ:

- **Xếp hạng** (mặc định): bar ngang PnL top 10, cho thấy nhanh channel lời/lỗ; tooltip kèm số lệnh.
- **So sánh**: X = win rate 0–100%, Y = profit (USDT), diện tích bong bóng tỷ lệ số lệnh (không phải bán kính). Đường ngang PnL=0; không kẻ ngưỡng 50% thành ranh giới tốt/xấu.

Nhãn chỉ hiện cho điểm đang focus/chọn và một số điểm nổi bật; danh sách bên cạnh hoặc “Xem dữ liệu” giúp chọn điểm chồng nhau. Trên mobile mặc định bar, bubble vẫn là tùy chọn có bảng tương đương.

Mẫu dưới 20 lệnh có nhãn “Ít dữ liệu”; đây là ngưỡng hiển thị UX, không phải chứng nhận thống kê. Channel chưa có lệnh ở mục riêng, không gán win rate=0 rồi đặt vào bubble. Không diễn giải win rate cao là chắc chắn có lãi.

Bấm channel chọn/highlight và mở chi tiết hiện có; không đổi dữ liệu xếp hạng nền. Không vẽ funnel Feed → Trade: một signal có thể được nhiều account giao dịch, hai tổng không phải tỷ lệ chuyển đổi một-một.

### 4.3 Báo cáo → Ví & dòng tiền

Nguồn: [AccountLedgerPage](../client/src/pages/AccountLedgerPage.jsx) → `GET /api/account-ledger` → [account-ledger](../server/src/lib/account-ledger.js) → `futures_profits`; attribution riêng từ `account_statics` qua [LedgerAttribution](../client/src/components/LedgerAttribution.jsx).

**P0:** nâng hai chart hiện tại với trục, tooltip, legend, trạng thái thiếu điểm và bảng dữ liệu. Đường số dư ghi rõ snapshot cuối ngày hay cập nhật trong ngày. Trading/dòng tiền phải dùng chung scale. Attribution giữ nhãn “PnL lũy kế lệnh từ 0”, phân biệt với số dư ví; không suy ra drawdown tài khoản từ equity lệnh.

**P1 — Waterfall income:** ưu tiên phân rã realized trading + commission + funding + rebate + loại income khác đã xác định → net trading income. Phí/funding dùng dấu từ nguồn, không tự ép âm vì funding có thể dương. Tách nạp/rút/chuyển thành chế độ “Dòng tiền”, không trộn với hiệu quả giao dịch.

Điều kiện bắt buộc trước waterfall:

- `dayRow` hiện fallback `trading = doc.profit` khi thiếu `incomeByType`; profit có thể đã gồm phí/funding. Không lấy trading fallback rồi cộng phí lần nữa.
- Backend phải công bố coverage và các thành phần loại trừ lẫn nhau; với kỳ trộn dữ liệu typed/legacy, ẩn waterfall và ghi “Chưa đủ dữ liệu tách phí/funding cho toàn kỳ”. Bảng và tổng cũ vẫn xem được.
- Cash in/out có thể chứa transfer; không cộng cả tổng và thành phần con. Chỉ dùng một phân rã đã đối chiếu.
- Mặc định không vẽ “balance đầu → balance cuối”. Chỉ bổ sung khi có snapshot hai đầu, cùng tập ví và đối soát đầy đủ; phần không khớp ghi “Chưa đối soát”, không gán là lợi nhuận.
- Không trộn uPnL vào wallet income. Khi tổng hợp nhiều ví, ghi số ví có dữ liệu/tổng ví; thiếu ví không coi là 0.

Tooltip mỗi cột: tên, số tiền có dấu, nguồn và ngày. Bấm cột mở phần chi tiết tương ứng nếu có; không tạo cảm giác click được khi API chưa hỗ trợ.

### 4.4 Tổng quan và Thống kê tổng hợp

Nguồn: [DashboardPage](../client/src/pages/DashboardPage.jsx) → `/api/dashboard`; [SummaryPage](../client/src/pages/SummaryPage.jsx) → `/api/summary` → [system-summary](../server/src/lib/system-summary.js).

Tổng quan giữ spark 7 ngày, thêm một chart “Bot nào đóng góp PnL đã chốt?” top 5 lãi và top 5 lỗ. uPnL là chế độ riêng có nhãn “Chưa chốt · snapshot ...”, không cộng vào profit đã chốt. Bấm bot dẫn đến Báo cáo giữ account/kỳ tương ứng khi được phép. Không vẽ lịch sử uPnL từ snapshot hiện tại.

Thống kê tổng hợp: bar user theo `userRanks.profit` và hai cột Long/Short dùng `longProfit/shortProfit`. Ghi nguồn cạnh từng chart: xếp hạng user dùng income ví, Long/Short dùng Account Static. Không ghép hai nguồn vào chung tổng. Không dựng top 10 signal/symbol từ response chỉ có best/worst; muốn mở rộng phải bổ sung aggregate backend.

### 4.5 Terminal → Rủi ro

Nguồn: [RiskCockpit](../client/src/components/terminal/RiskCockpit.jsx) → `/api/risk/portfolio` và snapshot Position hiện có. Các module risk đang có thay đổi ngoài phạm vi spec này; khi triển khai phải đối chiếu contract tại thời điểm đó.

Một panel gập được, mặc định compact:

- Thanh Long/Short: longNotional / (longNotional + shortNotional), ghi cả % và USDT. Tổng bằng 0 → “Không có vị thế”. Net = Long − Short hiển thị riêng; hedge cân bằng vẫn có gross lớn.
- Bar top 5 symbol theo gross notional, phần “Khác” giữ tổng còn lại. Không cộng trùng position sàn và monitor ownership.
- Mức sử dụng margin chỉ hiện khi có cùng snapshot và mẫu số dương được backend xác nhận; nhãn rõ công thức. Thiếu contract thì hoãn, không dùng leverage thay margin.

Exposure không phải mức lỗ tối đa. Không dùng tổng raw unprotectedQty của nhiều symbol làm phần trăm rủi ro. Quy đổi contracts theo adapter; thiếu quy đổi loại khỏi tổng và ghi coverage. Reserved/pending hiển thị riêng với vị thế đã khớp.

Bấm symbol lọc bảng; không thay ticket đang nhập, không chọn side lệnh hoặc gửi lệnh. Đổi account hủy request cũ, xóa selection; snapshot stale giữ nhãn cảnh báo, không diễn giải “an toàn”.

### 4.6 Signal → Thống kê

Nguồn: [SignalStatsPanel](../client/src/pages/SignalStatsPanel.jsx) → `/api/signal-config`.

Hai bar ngang: top 10 signal theo số lỗi parse; top 10 signal theo số config đang bật, kèm tổng config. Tiêu đề phải nêu kỳ thực sự của aggregate; nếu không có filter thời gian thì ghi “Theo dữ liệu hiện có”, không tự gắn 24h. Không hiển thị tỷ lệ lỗi nếu thiếu mẫu số message cùng nguồn/kỳ. Bấm signal mở bảng tương ứng.

### 4.7 Hệ thống và Log

Nguồn: [SystemHealthPage](../client/src/pages/SystemHealthPage.jsx) → `/api/system-health` → [system-health](../server/src/lib/system-health.js); [AuditLogsPage](../client/src/pages/AuditLogsPage.jsx) → `/api/runtime-logs` → [runtime-logs](../server/src/lib/runtime-logs.js).

Hệ thống: nhóm process theo host, mỗi process một ô có tên/role/trạng thái/tuổi heartbeat; bấm lọc hoặc focus dòng process. Giữ ngưỡng stale hiện tại của backend (tài liệu hiện tại: 90 giây), không tạo ngưỡng khác ở chart. Bar RAM là giá trị hiện tại theo process, không phải lịch sử hay % RAM host khi không có total host memory.

Log runtime: cột chồng error/warn/info theo thời gian. Mặc định dùng kỳ đang chọn; nếu chưa có kỳ, chọn 24 giờ và hiện filter. <=48 giờ bucket 1 giờ; dài hơn bucket ngày, giới hạn 90 ngày. Bấm bucket/mức lỗi lọc bảng và reset page. Cùng nguyên tắc giữ chart nền như Báo cáo.

API hiện tại trả log phân trang, nên cần aggregate server trước phân trang, tái sử dụng scope/filter hiện có. Không dựng histogram từ 50 log của trang đang mở. Chỉ gọi “Số log đã ghi nhận”, không suy ra số sự cố độc lập hoặc uptime. Lịch sử RAM/uptime/latency dài hạn là phần sau, chỉ triển khai khi có time-series thật và retention rõ ràng.

## 5. Contract dữ liệu và tương tác chung

### Luồng

Page → bộ lọc nền → API hiện có + kiểm tra quyền/scope → aggregate toàn tập phù hợp → chart + bảng. Chart selection là bộ lọc chi tiết hoặc điều hướng đọc-only. Không gọi sàn thêm chỉ để vẽ chart; dùng response/snapshot đang có.

Tách `baseFilters` và `chartSelection`: chart nhận tập nền, bảng nhận nền + selection; nhãn chỉ số nói rõ tập nào. Tận dụng query parameter hiện có; mọi parameter mới phải được ghi vào docs API/flow khi triển khai. Back/Forward khôi phục selection. Không gửi parameter mới chưa được server hỗ trợ rồi giả rằng bảng đã lọc.

### Metadata đề xuất cho phần aggregate mới

Đây là contract đề xuất, không khẳng định API hiện có đã trả các field sau. Chỉ bổ sung backward-compatible khi cần; giữ nguyên response legacy.

| Field | Ý nghĩa |
|---|---|
| `source`, `metric`, `unit` | Nguồn/công thức/đơn vị, phân biệt static và income |
| `from`, `to`, `timezone`, `timeField`, `bucket` | Kỳ, UTC, openTime/closeTime và độ hạt |
| `generatedAt`, `stale`, `quality` | Thời điểm và chất lượng: complete/partial/unavailable |
| `coverage` | Số tài khoản/ngày/bản ghi hợp lệ, thiếu hoặc bị loại |
| `truncated`, `totalGroups` | Aggregate có bị giới hạn không; top N không tự nhận là toàn bộ |
| `points` hoặc `groups` | Giá trị numeric hoặc null; không thay null bằng 0 |

Chốt schema chi tiết theo endpoint và tests trước code UI. Log aggregation là phần mới dự kiến mở rộng `/api/runtime-logs`; không tạo route đoán tên trong client. Chọn giới hạn query/cache/index sau khi kiểm tra query plan trên dữ liệu fixture đại diện.

### Tính đúng và hiệu năng

- Quyền/scope áp dụng trước aggregate; tổng/chart/tooltip không lộ nhóm ngoài quyền. Không mở quyền mới cho chart.
- Không aggregate từ trang bảng hoặc tập top-N đã bị cắt mà gắn nhãn toàn bộ. Nếu response chưa đầy đủ, bổ sung server aggregate hoặc gắn nhãn partial.
- Query ngày backend quy về khoảng nửa mở [from, toExclusive) tương ứng bộ lọc UTC; không đổi ngầm semantics endpoint cũ.
- Cache phải chứa actor/scope và toàn bộ filter có ảnh hưởng. Khi filter đổi hủy request cũ, không để response cũ thay chart mới.
- P0 tái sử dụng response hiện có, không thêm request theo từng hàng/chart. Aggregate mới chỉ tải khi panel mở; không polling độc lập với page.
- Tối đa 90 ô ngày hoặc khoảng 400 điểm time-series mỗi chart; dài hơn aggregate có nhãn bucket. Không cắt chuỗi âm thầm.
- Dùng SVG/HTML cho bar/calendar/waterfall và thư viện chart hiện có khi phù hợp. Không thêm dependency trong phạm vi này; tạo component trình bày dùng chung, giữ công thức nghiệp vụ ngoài component.

## 6. Trạng thái dữ liệu

| Trạng thái | Hiển thị |
|---|---|
| Đang tải lần đầu | Skeleton đúng chiều cao, không hiển thị số 0 giả |
| Đang refresh | Giữ dữ liệu trước + nhãn đang cập nhật, chỉ khi cùng filter |
| Không có giao dịch | Empty state và kỳ đang xem; gợi ý đổi kỳ, không tự đổi |
| Chỉ một điểm | Điểm/cột đơn kèm giá trị; không vẽ đường xu hướng giả |
| Null/thiếu coverage | “Thiếu dữ liệu”, gap; không tô thành hòa vốn |
| Lỗi request | Lỗi trong panel + thử lại; bảng/phần khác tiếp tục dùng được |
| Stale | Thời điểm cập nhật + cảnh báo; không đổi thành số 0 |
| Thiếu quyền | Theo gate trang hiện có, không rò dữ liệu qua tooltip/tổng |
| Có outlier | Giữ điểm và scale thật; tooltip chi tiết, không cắt mất điểm |

## 7. Bố cục mẫu P0

```text
HIỆU QUẢ LỆNH                     [Account] [Kỳ] [Live/Paper]
Lệnh đóng · UTC · cập nhật ...
[PnL]      [Số lệnh]      [Win rate]      [Profit factor]

[Signal nào đóng góp PnL nhiều nhất?] [PnL thay đổi theo ngày ra sao?]
[Signal | Config | Symbol]           [Biểu đồ | Lịch]
[bar âm ← 0 → bar dương]             [chuỗi ngày hoặc lịch]
[Top 10/N · Xem dữ liệu]             [chú giải · Xem dữ liệu]

Chi tiết: [SIGNAL_A ×] [Ngày ... ×] [Bỏ chọn biểu đồ]
[Bảng lệnh theo lựa chọn — giữ thao tác và phân trang hiện tại]
```

Mobile xếp hai vùng chart theo chiều dọc; chart nhóm gập được. Không hiển thị đồng thời lịch và đường PnL thành ba chart.

## 8. Tiêu chí nghiệm thu

### Đúng dữ liệu

- Tổng series khớp aggregate cùng filter; tổng nhóm đầy đủ khớp KPI cùng nguồn; chênh do làm tròn chỉ ở mức hiển thị cuối cùng.
- Calendar và chart ngày cùng bucket trả cùng PnL; chọn ngày lấy đúng lệnh theo UTC và timeField của màn.
- Static/income/uPnL không bị gộp; live/paper, scope và account giữ nguyên xuyên chart → bảng.
- Waterfall typed đối soát bằng tổng thành phần; legacy/mixed không double-count phí; transfer không cộng trùng cash totals.
- Terminal hai monitor chung vị thế vẫn chỉ tính một exposure sàn; hợp đồng khác đơn vị có coverage hoặc quy đổi hợp lệ.
- Runtime histogram toàn query, không phụ thuộc page/limit; role hẹp không thấy tổng của hệ thống.

### Dễ đọc và thao tác

- Thử với người dùng: chỉ nhìn chart xác định được nhóm lãi/lỗ lớn nhất, ngày lỗ lớn nhất và đơn vị/kỳ trong khoảng 10 giây. Không đạt thì giảm thông tin trước khi thêm trang trí.
- Tooltip và bảng dữ liệu có đủ nhãn, đơn vị và số lệnh; tên dài đọc được đầy đủ bằng focus/tap.
- Chọn/bỏ chọn/back/forward hoạt động; filter nền không mất; không làm thay đổi ticket hoặc chạy mutation.
- Kiểm tra 360px, 768px, 1440px; không tràn trang, nhãn không đè nhau, thao tác cảm ứng/bàn phím dùng được.
- Empty/zero/null/negative-only/mixed/outlier/one-point/stale/error đều có trạng thái rõ.

### Kiểm thử khi triển khai

- Unit test transformation với dữ liệu cố định cho bucket UTC, nhóm top-N + phần còn lại, null/zero, waterfall và dedup exposure.
- Backend regression cho aggregate/scope/filter và request bị giới hạn; fixtures không kết nối Mongo/sàn production.
- Frontend build; kiểm tra trực quan bằng fixture/screenshot ở ba kích thước trên. Có scenario chọn chart → bảng → bỏ chọn.
- Đo với 90 ngày, 100 nhóm và 1.000 dòng fixture: thao tác chọn local mục tiêu phản hồi <100ms trên máy kiểm tra; ghi cấu hình đo. Chart không tải cả lịch sử lệnh về trình duyệt để tổng hợp.
- Chạy tests phù hợp module sửa và cập nhật feature/API/flow docs để phân biệt phần đã làm với phần còn đề xuất.

## 9. Checklist giao việc

Mỗi PR triển khai phải ghi: màn/chart nào, câu hỏi chart trả lời, nguồn/công thức, filter nền/selection, dữ liệu thiếu xử lý ra sao, ảnh desktop/mobile và kiểm chứng tổng số. P0 hoàn thành trước khi bắt đầu mở rộng time-series vận hành.

### P0 đã giao — trạng thái nghiệm thu: **đạt, còn gap** (không gọi là hoàn tất §8)

| Màn | Chart | Nguồn | Filter nền / selection |
|---|---|---|---|
| Báo cáo → Hiệu quả lệnh | Bar ngang nhóm Signal/Config/Symbol (+ user/side); Biểu đồ ngày / Lịch PnL (một chế độ) | `GET /api/account-statics` → `stats.by*` + `series` (có `wins`/`losses` theo ngày) | Nền: kỳ/account/book/side/…; selection URL `listSignal`/`listEnv`/`listSymbol`/`listDay` chỉ lọc bảng lệnh |
| Signal → Scorecard | Xếp hạng bar (mặc định); bubble win rate × profit × diện tích lệnh | `GET /api/provider-scorecard` | `scoreSelect`/`scoreChart` đẩy history (Back/Forward); filter form `replace` |
| Báo cáo → Ví & dòng tiền | Đường số dư + Trading/dòng tiền cộng dồn (trục, tooltip, gap, Xem dữ liệu) | `GET /api/account-ledger` → `series` | Giữ filter user/days; null balance = gap |

**Coverage ngày (Hiệu quả lệnh):** ngày không có bản ghi trong tập đang lọc = **0 lệnh** (aggregate xác nhận). **Chưa xác minh** tín hiệu “thiếu snapshot/coverage” riêng từ backend — UI **không** tô “Thiếu dữ liệu” giả khi chỉ vắng hàng ngày.

**Nợ kỹ thuật P0 còn lại:**

- User trial formal “10 giây đọc được lãi/lỗ lớn nhất”
- Lỗi request tách panel đầy đủ (một số màn đã tách chartError; TradePerformance vẫn chung một GET)

**P0 đã vá thêm:** bucket tuần/tháng khi series >90 ngày (`bucketSeries`); bench transform local trong `client/src/components/charts/bench.test.js` (mục tiêu <100ms, ngưỡng CI mềm 250ms).

### P1 đã giao

| Màn | Chart | Nguồn | Ghi chú |
|---|---|---|---|
| Tổng quan | Bot đóng góp PnL đã chốt (top 5 lãi + top 5 lỗ); chế độ uPnL snapshot riêng | `/api/dashboard` → `mine.profitToday` / `mine.unrealized` | Không cộng uPnL vào đã chốt; bấm bot → Báo cáo hôm nay khi có quyền |
| Thống kê tổng hợp | Bar user theo `userRanks.profit`; hai cột Long/Short | `/api/summary` | Nhãn nguồn: user = income ví; Long/Short = Account Static — không gộp |
| Terminal → Risk | Thanh Long/Short notional; top 5 symbol + Khác | `/api/risk/portfolio` → `longNotional`/`shortNotional`/`bySymbol` | Màu phân loại (không dùng màu lãi/lỗ); bấm symbol → filter bảng; stale giữ cảnh báo; margin usage hoãn (chưa contract) |
| Báo cáo → Ví | Waterfall Trading (realized/fee/funding/rebate) + chế độ Dòng tiền | `/api/account-ledger` → `incomeBreakdown` | Chỉ `waterfallEligible` khi typed đủ + đối soát; mixed/legacy ẩn + ghi chú |

### P2 đã giao

| Màn | Chart | Nguồn | Ghi chú |
|---|---|---|---|
| Signal → Thống kê | Top 10 lỗi parse (7 ngày); top 10 config đang bật | `/api/signal-config` → `parseErrors` / `usage` | Kỳ ghi rõ; không tự gắn tỷ lệ lỗi; bấm signal → `signals` filter bảng |
| Hệ thống | Process theo host; bar RAM MB hiện tại | `/api/system-health` | Stale 90s backend; không % host; bấm ô/process → `?process=` |
| Log runtime | Histogram chồng error/warn/info | `/api/runtime-logs` → `histogram` | Aggregate trước phân trang; mặc định 24h; ≤48h bucket giờ; selection `bucketFrom`/`level` lọc bảng |

Component dùng chung: `client/src/components/charts/*` (SVG/HTML, không thêm dependency). Fixture trực quan: `scripts/chart-p0-fixture.html`.

Ảnh fixture P0 (không phải dữ liệu production):

- Desktop 1440: [assets/p0-charts-1440.png](assets/p0-charts-1440.png)
- Tablet 768: [assets/p0-charts-768.png](assets/p0-charts-768.png)
- Mobile 360: [assets/p0-charts-360.png](assets/p0-charts-360.png)
