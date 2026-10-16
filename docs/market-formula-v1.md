# Market formula market-v1 — tham số đã chốt

Ngày: 2026-10-16. Version: **`market-v1`**.  
Đây là chính sách ban đầu theo [market-scoring-spec](market-scoring-spec.md); **chưa có backtest chứng minh**. Đổi ngưỡng phải tăng version, không ghi đè lịch sử.

## 1. Chuẩn hóa điểm

- Tổng raw tối đa mỗi side: **13**.
- `score = round(clamp(raw / 13 * 100, 0, 100), 1)`.
- Thiếu input bắt buộc (không đủ nến đóng tối thiểu) → `score = null`, `quality = warming|missing`; breakdown phần có dữ liệu vẫn trả.
- Thiếu dữ liệu **không** thành số 0 và **không** giảm mẫu số khi tính breadth.

## 1b. Hiển thị dần (progressive)

- **Ngay (~vài giây):** ticker24h → giá, %24h, volume24h, rank top 50 (`phase=price`, `quality=pending`).
- **Dần (~3–6 phút lần đầu):** mỗi symbol 5 khung klines qua limiter fapi (~400ms/gap, concurrency 2) → score. UI poll ~12s, ô khung hiện `…` rồi L/S.
- Ước lượng: 50×5 = 250 request; tối ưu ~1–2 phút fetch thuần; thực tế thường **3–6 phút** vì batch/tick và chia sẻ limiter với Smart Money.
- Sau warm-up: chỉ rescore khung có nến đóng mới — gần như realtime theo chu kỳ nến.

## 2. Nến và warm-up

| Tham số | Giá trị | Lý do |
|---|---|---|
| Chỉ nến đóng | Có | Score không nhảy mỗi tick forming |
| Bootstrap tối thiểu | **250** nến đóng / khung | Spec; đủ cho EMA50 + ADX + Supertrend ổn định ban đầu |
| Limit REST | 300 (clip theo sàn) | Dư buffer so với 250 |
| Sort / dedupe | Theo `openTime` tăng dần, bỏ trùng `openTime` | Tránh gap giả |
| Không thay open bằng close trước | Có | Giữ OHLCV gốc |

Stale (sau `candleCloseTime` của nến đánh giá):

| TF | Hệ số × interval | Ví dụ |
|---|---:|---|
| 5m | 3 | 15 phút |
| 15m | 3 | 45 phút |
| 1h | 2 | 2 giờ |
| 4h | 2 | 8 giờ |
| 1d | 1.5 | 36 giờ |

## 3. Indicator

| Indicator | Định nghĩa chốt |
|---|---|
| EMA | SMA seed `period` nến đầu, rồi EMA chuẩn `k=2/(period+1)` — cùng `market-structure.ema` |
| ATR | Wilder (RMA) period tương ứng |
| RSI14 | Wilder avgGain/avgLoss |
| MACD | EMA12 − EMA26; signal = EMA9 trên chuỗi MACD đầy đủ; histogram = MACD − signal |
| ADX14 | Wilder +DI/−DI/DX/ADX chuẩn |
| Bollinger | SMA20 ± **2 × σ population** (`sqrt(Σ(x−μ)² / n)`, n=20) |
| Supertrend | ATR**10**, multiplier **3**; hướng theo close vs band |

## 4. Pivot / divergence / SMC

| Tham số | Giá trị |
|---|---|
| Pivot trái / phải | **2 / 2** (khớp `findSwings` hiện có) |
| Khoảng cách tối thiểu giữa 2 pivot cùng loại | **5** nến |
| Tuổi tối đa pivot dùng divergence/SMC | **40** nến (tính từ nến đánh giá) |
| Divergence | Hai pivot confirmed cùng loại; giá LL + RSI HL → bullish; HH + RSI LH → bearish; đúng side **+1.5** |
| Sweep | Wick vượt swing confirmed nhưng **close** quay lại trong swing; đúng chiều **+2** |
| BOS | Close đóng **ngoài** swing high (bull) / swing low (bear) gần nhất còn hiệu lực; **+1.5** |
| Order Block retest | OB = thân nến ngược chiều ngay trước BOS; retest khi low/high chạm vùng ± **0.15×ATR14**; OB còn hiệu lực nếu chưa close xuyên ngược; **+1** |
| FVG retest | Gap 3 nến (bull: low[i] > high[i−2]); retest chưa mitigated; **+0.5** |
| Vùng hết hạn | **50** nến sau `detectedAt` nếu chưa invalidated |
| CHoCH | Chỉ hiển thị, **không cộng điểm** v1 |
| Nhóm SMC | Chỉ lấy bằng chứng mạnh nhất, trần **2** điểm |

## 5. Volume

- `relVol = volume(nến đánh giá) / mean(volume 20 nến đóng trước đó)` — không gồm chính nó.
- Điểm: `>2 → +1`; `>1.3 → +0.5`; `<0.5 → −0.5`; còn lại 0.
- **Điểm dương** chỉ khi thân nến xác nhận cùng chiều: Long cần `close > open`; Short cần `close < open`. Điểm âm (volume thấp) áp dụng cả hai side.

## 6. Squeeze / breakout BB

- Bandwidth = `(upper − lower) / middle`.
- Squeeze khi bandwidth < **0.6 ×** trung bình 20 bandwidth **trước** nến hiện tại.
- Trong **3** nến đóng sau khi thoát squeeze: close ≥ upper → Long +1; close ≤ lower → Short +1.
- Vị trí BB: close ≤ lower → Long +1; ≥ upper → Short +1 (không cộng cả hai).

## 7. Regime / RSI / MACD / Supertrend

Giữ đúng bảng trong spec (ADX≥25 trending, ≤18 ranging; RSI thresholds; MACD hist; Supertrend hướng).

## 8. Composite theo phong cách

| Style | TF nhỏ / giữa / lớn | Trọng số |
|---|---|---|
| `scalp` | 5m / 15m / 1h | 20% / 35% / 45% |
| `intraday` (mặc định) | 15m / 1h / 4h | 20% / 35% / 45% |
| `swing` | 1h / 4h / 1d | 20% / 35% / 45% |

- Thiên Long: `compositeLong ≥ 65` và `Long − Short ≥ 15` (Short đối xứng).
- Hướng ô khung (L/S/Chờ): điểm dẫn ≥ đối thủ + **5**; nếu sát → Chờ.
- Mâu thuẫn đa khung: khung giữa và lớn có hướng ngược (L vs S theo quy tắc trên).
- Eligibility ứng viên: đủ 3 khung bắt buộc có score; khung giữa không transitional; không mâu thuẫn mạnh với khung lớn.
- Thiếu khung bắt buộc → `composite* = null`; **không** tái phân bổ trọng số.

## 9. Sự kiện lịch sử (bản đầu, web only)

Ghi khi (cùng `formulaVersion` + style/TF):

- Score vượt ngưỡng thiên hướng (65 / delta 15).
- `|Δscore| ≥ 8` so với điểm cùng key trước đó.
- Hết mâu thuẫn đa khung / regime đổi.

Cooldown mặc định **60 phút** / (symbol, eventType, style|tf). Không gửi Telegram/MQTT lệnh.
