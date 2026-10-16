# Thị trường — Multi-timeframe scoring top 50

Ngày: 2026-10-16. Trạng thái: **đã triển khai bản đầu (market-v1)** — ma trận 50×5, breakdown, lịch sử, API đọc cache; entry/SL/TP chưa làm. Tham số chốt: [market-formula-v1.md](market-formula-v1.md).

## 1. Mục tiêu và nguồn tham khảo

Xây menu **Thị trường**, route `/market`, để so sánh xu hướng và điểm Long/Short của top 50 crypto USDT perpetual theo nhiều khung thời gian. Người dùng phải hiểu vì sao có điểm đó, thấy sự đồng thuận/mâu thuẫn và mở được Smart Money, Terminal hoặc AI của symbol.

Tham khảo [auto-trade-v2](https://github.com/oka-labs1742/auto-trade-v2), đặc biệt [source Python](https://github.com/oka-labs1742/auto-trade-v2/blob/main/auto_trade_v2.py). Đối chiếu source và license trước khi tái sử dụng; không coi README là contract chính xác hoặc bằng chứng hiệu quả giao dịch.

Source đã đọc dùng 4h cho xu hướng, 1h cho regime, 15m cho timing; cộng điểm thành phần tối đa 15 rồi chặn ở 10. Luồng phân tích không thể hiện bước loại nến chưa đóng. Nhánh ATR SL dùng max rồi min nên SL vẫn ở mức mặc định. Spec này đề xuất công thức riêng, không port nguyên các hành vi đó.

- Bản đầu chỉ phân tích, không tự mở/đóng lệnh, phát MQTT signal hoặc sửa trader đang chạy.
- **Thị trường**: kỹ thuật, cấu trúc giá, scoring đa khung.
- **Smart Money**: vị thế tổng hợp trader/whale, OI, funding, taker.
- **Terminal**: vị thế và thao tác người dùng.
- SMC (Order Block, FVG, sweep, BOS/CHoCH) là mẫu hình giá; không phải bằng chứng danh tính/tác động của tổ chức thật.

## 2. Universe top 50

- Top 50 theo `quoteVolume` 24h, không theo vốn hóa; chỉ crypto USDT perpetual đang TRADING.
- Dùng exchange metadata để loại Spot, delivery, TradFi và hợp đồng ngoài phạm vi.
- Cập nhật mỗi 60 phút; lưu `universeVersion`, timestamp và `volumeRank`. Giữ membership/rank ổn định giữa hai phiên bản universe.
- Có thể phân tích symbol ngoài top từ watchlist/Terminal theo quyền và giới hạn tải; gắn nhãn ngoài top, không tính vào breadth top 50.
- Symbol rời top vẫn giữ lịch sử. Coin mới thiếu nến vẫn hiện với trạng thái warming, không giảm mẫu số để tính điểm.
- Không lộ tài khoản/vị thế riêng khiến một symbol được thêm vào collector.

## 3. Khung thời gian

Khung độc lập: **5m, 15m, 1h, 4h, 1d**. Mỗi khung có Long score, Short score, regime, breakdown và data quality.

| Phong cách | Khung nhỏ / giữa / lớn |
|---|---|
| Ngắn hạn | 5m / 15m / 1h |
| Trong ngày — mặc định | 15m / 1h / 4h |
| Swing | 1h / 4h / 1d |

Khung nhỏ phục vụ timing, giữa đánh giá setup, lớn là bối cảnh.

## 4. Contract nến và chất lượng

- Chỉ nến đã đóng được tính vào score xác nhận. Giá live hiển thị riêng, không làm score chốt thay đổi mỗi tick.
- Lưu `candleCloseTime`, `calculatedAt`, `dataVersion`, `formulaVersion`.
- Kiểm tra sort, duplicate, gap, dữ liệu OHLCV sai. Không thay open bằng close trước đó.
- Bootstrap tối thiểu 250 nến/khung; tăng warm-up nếu kiểm thử indicator cho thấy chưa ổn định.
- Swing chỉ được dùng sau đủ nến xác nhận. Vùng có `detectedAt`, `confirmedAt`, trạng thái và thời điểm vô hiệu để replay không look-ahead.
- `missing`, `warming`, `partial`, `stale` khác `ready`; dữ liệu thiếu không phải số 0.
- Stale theo lịch nến/độ trễ từng timeframe, không áp một TTL ngắn cho cả nến 5m và 1d.

## 5. Scoring độc lập — market-v1

Tính Long và Short độc lập. Không chọn direction trước rồi chỉ chấm một bên.

| Nhóm | Điểm tối đa |
|---|---:|
| Regime alignment | 2 |
| RSI | 1.5 |
| MACD | 1.5 |
| Supertrend | 1.5 |
| Vị trí Bollinger Bands | 1 |
| Breakout sau squeeze | 1 |
| RSI divergence | 1.5 |
| SMC / cấu trúc | 2 |
| Volume xác nhận | 1 |
| **Tổng** | **13** |

`score = round(clamp(rawPoints / 13 * 100, 0, 100), 1)`.

- Mẫu số cố định; thiếu input bắt buộc → score null, vẫn trả breakdown phần có dữ liệu.
- Công khai cả điểm cộng/trừ. Điểm là mức đáp ứng quy tắc, không phải xác suất thắng.
- Funding/whale không cộng technical score v1. HTF không cộng điểm từng khung để tránh đếm lại khi tổng hợp.
- Các điều kiện dưới đây là chính sách ban đầu chưa được chứng minh bằng backtest; version hóa tham số, không chỉnh ngầm.

### Regime

- ADX14 >=25: trending; hướng EMA20/EMA50. ADX <=18: ranging; còn lại transitional/choppy.
- Trending cùng side +2, ngược side -1; ranging +1; transitional 0.
- Vẫn hiển thị và tính các nhóm khác khi transitional, không xóa symbol.
- EMA bằng nhau không mặc định Short; thiếu dữ liệu không coi neutral hợp lệ.

### RSI14

- Long: RSI <45 +1.5; 45–<55 +0.5; >70 -1; còn lại 0.
- Short: RSI >55 +1.5; >45–55 +0.5; <30 -1; còn lại 0.
- Nhãn “RSI theo quy tắc”; không gọi RSI45 là quá bán chuẩn. Đây là chính sách thiên pullback cần replay đánh giá.

### MACD và Supertrend

- MACD12/26/9: histogram >0 → Long +1.5; <0 → Short +1.5. Signal line tính từ chuỗi MACD đầy đủ.
- Supertrend ATR10 multiplier3: Up → Long +1.5; Down → Short +1.5.
- Dùng định nghĩa indicator nhất quán, có fixture độc lập; không suy ra giá trị mặc định khi thiếu mẫu.

### Bollinger và squeeze

- SMA20, độ lệch chuẩn2; ghi rõ quy ước tính standard deviation trong formula docs.
- Close <= lower band → Long +1; >= upper band → Short +1. Ở giữa không cộng cả hai side.
- Squeeze: bandwidth <0.6 lần trung bình 20 bandwidth trước đó. Squeeze riêng chưa có hướng.
- Trong ba nến đóng sau squeeze: close vượt upper band → Long +1; dưới lower band → Short +1. Ghi nhận thời điểm xác nhận và hết hạn.

### Divergence và SMC

- Divergence dùng hai pivot đã xác nhận cùng loại và RSI đúng tại pivot: giá lower low + RSI higher low → bullish; giá higher high + RSI lower high → bearish; đúng side +1.5.
- Chốt pivot trái/phải, khoảng cách pivot và tuổi tối đa trong tài liệu formula trước khi code; không so hai close tùy ý rồi gọi divergence.
- Sweep đúng chiều +2; BOS xác nhận +1.5; retest OB còn hiệu lực +1; retest FVG chưa vô hiệu +0.5.
- Chỉ chọn bằng chứng mạnh nhất trong nhóm SMC, không cộng quá 2.
- Near/retest OB/FVG phải có direction. CHoCH hiển thị đổi cấu trúc, chưa cộng điểm nếu chưa có định nghĩa kiểm chứng.
- Chốt bằng công thức rõ: breakout cần close vượt swing nào, sweep cần wick/close thế nào, retest khi nào, khoảng buffer theo ATR/tick, vùng hết hạn ra sao.
- Theo dõi touched/mitigated/invalidated và tuổi; không tiếp tục chấm vùng đã bị vô hiệu.

### Volume

- Relative volume = volume nến đánh giá / trung bình 20 nến đóng trước đó, không gồm chính nó.
- >2 +1; >1.3 +0.5; <0.5 -0.5; còn lại 0.
- Điểm dương chỉ khi nến/sự kiện xác nhận cùng chiều; chốt điều kiện đó trong formula config. Volume tăng không tự là bullish.

Mỗi rule trả: `id, side, value, condition, points, maxPoints, evidenceTime, explanation`.

## 6. Tổng hợp đa khung

- Trọng số khung nhỏ/giữa/lớn: **20% / 35% / 45%**.
- Tính riêng `compositeLong`, `compositeShort`; không trộn thành một số thiếu direction.
- Thiên Long: Long >=65 và Long−Short >=15; Thiên Short đối xứng. Còn lại Chờ/chưa rõ.
- Khung giữa và lớn ngược hướng: nhãn “Mâu thuẫn đa khung”. Dùng định nghĩa hướng/thế hòa nhất quán, không ép một side khi điểm sát nhau.
- Ứng viên cần đủ dữ liệu mới, các khung bắt buộc đủ score, khung giữa không transitional và không mâu thuẫn mạnh với khung lớn.
- Thiếu khung bắt buộc → composite null; không tái phân bổ trọng số. Các khung đã có vẫn xem được.
- Formula version gồm cả trọng số, ngưỡng và quy tắc eligibility.

## 7. Giao diện /market

Header: “Thị trường · Top 50 Futures theo volume24h”, mốc universe, scoring và nguồn.

Tóm tắt gọn: số thiên Long/Short, trending/ranging/transitional, ứng viên đủ điều kiện, coverage `46/50` (ví dụ giả). Breadth dùng mẫu số các symbol đủ dữ liệu và timeframe/phong cách rõ ràng; thiếu data không tính neutral.

Bộ lọc: symbol, phong cách, side, regime, điểm tối thiểu, đồng thuận đa khung, watchlist, dữ liệu mới.

Bảng:

`Symbol | Giá/%24h | Volume24h | 5m | 15m | 1h | 4h | 1d | Tổng hợp | Δ điểm | Trạng thái`

- Ô khung hiện hướng và điểm dẫn đầu (ví dụ L72, S68, Chờ); tooltip có cả Long/Short và lý do ngắn.
- Bấm ô mở chi tiết đúng symbol/timeframe. Sort theo điểm tổng hợp, điểm khung, delta hoặc volume.
- Filter/sort/symbol/timeframe trong URL; Back khôi phục context và scroll.
- Mobile ưu tiên khung đang chọn + composite, mở rộng xem đủ; bảng cuộn riêng.
- Đồng bộ theme shadcn-style hiện có, số căn phải/tabular-nums, màu kèm nhãn/dấu, không nhồi card nhỏ.
- Có skeleton, lỗi/thử lại, empty và warming. Refresh giữ dữ liệu cũ có nhãn.

## 8. Chi tiết symbol

Đầu trang/panel: kết luận rule ngắn, Long/Short score, regime, freshness/formula version, bằng chứng mạnh nhất và mâu thuẫn lớn nhất.

Các phần:
1. Ma trận đa khung.
2. Breakdown `Nhóm | Giá trị | Điều kiện | Điểm Long | Điểm Short`.
3. Biểu đồ nến và vùng cấu trúc, dùng component có sẵn khi phù hợp.
4. Lịch sử score.
5. Dòng tiền từ Smart Money snapshot hiện có.

Người dùng phải cộng được breakdown ra điểm cuối, không giấu điểm trừ. Link mở Smart Money, Terminal đúng symbol; AI giải thích chỉ gọi theo yêu cầu.

## 9. Lịch sử và cảnh báo

Lưu theo nến đóng: score vượt ngưỡng, thay đổi điểm mạnh, hết mâu thuẫn đa khung, regime đổi, setup hết hiệu lực.

- Delta so cùng timeframe/phong cách/formulaVersion và khoảng thời gian rõ; không so snapshot tùy ý.
- Cooldown, dedup, hysteresis; không lặp khi score còn trên ngưỡng.
- Data phục hồi sau lỗi không tự thành tín hiệu mới.
- Bản đầu cảnh báo trên web, không tự gửi Telegram hoặc MQTT mở lệnh.

## 10. Kịch bản entry/SL/TP tham khảo

Không cần tạo SL/TP cho mọi dòng ở bản đầu. Trong chi tiết ứng viên có thể thêm sau:

- Giá tham chiếu, invalidation, TP, R:R tính bằng code từ cấu trúc/ATR.
- Không kéo TP xa để ép R:R2; cản gần khiến R:R không đạt → “Chưa có setup phù hợp”.
- Score cao không tự chứng minh vào ngay. Không nhập leverage, % vốn, trailing/time exit của repo mẫu vào bot.

## 11. Dùng chung pipeline và AI

Kiểm tra source hiện tại trước khi tái sử dụng:
- `server/src/lib/smart-money/symbol-universe.js` và adapter ticker/exchange metadata.
- `server/src/lib/decision-support/market-snapshot.js`.
- `server/src/lib/market-structure.js`.
- Request queue, rate limiter và candle cache hiện có.

Không giả định các helper hiện có tính đúng/chưa trùng; kiểm tra semantics và regression khi dùng chung.

Technical score và flow score giữ riêng, không cộng hai thang điểm khác nghĩa. Flow ghi đồng thuận/mâu thuẫn/thiếu, timestamp và cửa sổ riêng.

AI nhận indicator, breakdown, regime/cấu trúc/timeframe, flow snapshot, stale/missing và version. AI chỉ giải thích, không sửa điểm. Không gọi AI cho 50 symbol mỗi chu kỳ.

## 12. Scheduler, lưu trữ, hiệu năng

50 × 5 = 250 chuỗi nến:
- Bootstrap REST qua queue, giới hạn concurrency, dùng chung limiter; không burst 250 calls.
- Sau bootstrap ưu tiên WebSocket nến đóng, REST bù gap/đối chiếu có giãn lịch.
- Chỉ tính lại khung có nến đóng và composite bị ảnh hưởng; không tải lại 1d mỗi 5 phút.
- Reconnect dedup, backfill phần thiếu. Khung lớn dùng latest closed candle có mốc <= thời điểm đánh giá.
- Publish snapshot nguyên tử theo symbol; ghi rõ mốc từng timeframe, không giả tất cả đóng cùng lúc.
- Distributed lease, job tách HTTP; refresh không vượt cooldown/tạo full scan mới.

Redis latest candle/indicator/score; Mongo universe versions, score latest/history và events. Unique score key `symbol + timeframe + candleCloseTime + formulaVersion`; composite dùng khóa có style/mốc đánh giá phù hợp. Không lưu toàn bộ nến lặp trong mỗi report. Retention/index theo query thực tế.

## 13. API và quyền (đề xuất)

- `GET /api/market/overview`
- `GET /api/market/symbols`
- `GET /api/market/symbols/:symbol`
- `GET /api/market/symbols/:symbol/scores`
- `GET /api/market/events`

Read chỉ cache/Mongo. Validate symbol/timeframe/range/limit bằng allowlist. Theo auth/scope hiện có; nếu thêm `market.view`, cập nhật catalog/role/spec/tests, không chỉ ẩn UI. Quản lý collector/formula có quyền riêng. Không lộ nguồn symbol từ vị thế riêng.

## 14. Kiểm thử và nghiệm thu

Unit: fixture độc lập cho RSI/MACD/ATR/ADX/BB/Supertrend; boundary ADX18/25, RSI, volume; Long/Short theo đúng rule; breakdown khớp normalized score; nến forming không sửa score; pivot đúng confirmedAt; vùng vô hiệu không cộng điểm; missing không thành 0 hoặc giảm mẫu số.

Integration: multi-worker không collect trùng; backfill không duplicate; stale response không ghi đè mới; universe đủ 50 hợp đồng khi nguồn đủ; page load không burst Binance; filter URL/Back/mobile/keyboard; API deny ngoài quyền.

Replay: từng mốc chỉ dùng dữ liệu đã biết lúc đó; đánh giá forward outcomes ở horizon cố định với giả định phí/trượt giá. Tách thời kỳ chọn ngưỡng và ngoài mẫu. Không gọi score là xác suất thắng; đổi formula phải đổi version, không ghi đè lịch sử.

Thành công khi: bảng 50×5 dễ so sánh; điểm tái lập và giải thích được; data thiếu/cũ rõ; không ảnh hưởng trading latency; không tạo luồng giao dịch tự động.

## 15. Hướng dẫn triển khai cho Cursor

1. Đọc AGENTS và docs index/architecture/flows/API/development; auth spec đầy đủ trước khi sửa quyền.
2. Kiểm tra worktree, giữ thay đổi có sẵn; nêu chuỗi collector → indicators → scores → API → UI.
3. Chốt các tham số còn cần định nghĩa trong formula market-v1 và fixture trước khi code; ghi rõ lựa chọn và lý do, không âm thầm thay trọng số đã thống nhất.
4. Làm collector/cache → indicator → score từng khung → composite/history/API → UI.
5. Kết nối Smart Money/Terminal/AI, rồi cảnh báo/replay.
6. Test/build và kiểm tra giao diện desktop/mobile; cập nhật tài liệu implementation khác với spec đề xuất.
7. Commit/push theo AGENTS, chỉ thay đổi thuộc nhiệm vụ. Không tự deploy, gửi Telegram, đặt lệnh hay sửa runtime trader.
8. Bàn giao phần hoàn thành, warm-up, giới hạn dữ liệu và các ngưỡng chưa kiểm chứng; không gọi production-ready chỉ vì build pass.

Ưu tiên bản đầu: **ma trận 50 coin × 5 khung + breakdown + lịch sử**. Kịch bản entry/SL/TP là phần mở rộng sau khi scoring ổn định.
