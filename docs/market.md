Spec: Crypto Market & Technical Dashboard
v1 — dành cho web-bot. Mục tiêu: nhìn 5 giây biết thị trường đang ở trạng thái nào, nhìn 30 giây ra được danh sách kèo đáng xem.

> Triển khai MVP (2026-10): tab `/market?tab=dashboard`, module `server/src/lib/market-dash/`, API `/api/market/dash/*`. Stack thực tế: Express + React/Vite + Mongo + Redis (không Postgres/Tailwind). Chỉ báo tự viết; chart = `lightweight-charts`. Flow/ETF/Options stub đến V2.

1. Nguyên tắc thiết kế
   • Top-down: Regime thị trường → Dòng tiền & vị thế → Breadth/Rotation → Scanner kèo → Chi tiết coin. Không nhảy thẳng vào chart từng coin.
   • Một con số tóm tắt + lý do: mọi module đều có 1 điểm/nhãn (Bullish / Neutral / Bearish) kèm 1 dòng giải thích vì sao.
   • Percentile thay ngưỡng cứng: funding, OI, volume, ATR đều so với lịch sử 90 ngày của chính nó, không dùng số tuyệt đối.
   • Chỉ tín hiệu trên nến đã đóng: tránh repaint / lookahead. Nến đang chạy chỉ dùng để hiển thị.
   • Mọi thứ click được: từ heatmap, bảng scanner → mở chi tiết coin.
   • Có timestamp + cảnh báo stale data trên từng module.
2. Layout tổng
   ┌──────────────────────────────────────────────────────────────┐
   │ TOP BAR: BTC | ETH | Total MC | BTC.D | F&G | Giờ UTC+7 │
   ├──────────────────────────────────────────────────────────────┤
   │ [A] MARKET PULSE (0-100) + Regime + Brief 3 dòng │
   ├───────────────────────────┬──────────────────────────────────┤
   │ [B] Derivatives Dashboard │ [C] Breadth & Rotation │
   ├───────────────────────────┴──────────────────────────────────┤
   │ [D] Heatmap (top 100 perp) | [E] Liquidation & Flow │
   ├──────────────────────────────────────────────────────────────┤
   │ [F] SIGNAL SCANNER (bảng lọc được, sort theo Score) │
   ├──────────────────────────────────────────────────────────────┤
   │ [G] Coin Detail (drawer): chart + checklist + levels │
   ├──────────────────────────────────────────────────────────────┤
   │ [H] Macro & Calendar | [I] Alert Log │
   └──────────────────────────────────────────────────────────────┘
3. Các module
   A. Market Pulse (module quan trọng nhất)
   Market Pulse Score 0–100 = trung bình có trọng số của 5 nhóm:
   Nhóm
   Trọng số
   Đo cái gì
   Trend BTC/ETH
   25%
   EMA stack 1D/4H, giá vs EMA50/200, ADX
   Breadth
   20%
   % coin trên EMA50 D, % làm đỉnh 20 ngày
   Derivatives
   20%
   Funding, OI, basis, L/S
   Flow
   20%
   Stablecoin supply, taker CVD, ETF flow
   Volatility/Risk
   15%
   Realized vol, DVOL, drawdown từ đỉnh
   Nhãn: 0–25 Risk-off mạnh · 25–45 Yếu · 45–55 Trung tính · 55–75 Tích cực · 75–100 Hưng phấn (cảnh báo quá nóng).
   Regime classifier (cho BTC, tính trên 4H và 1D):
   Regime
   Điều kiện
   Trend Up
   EMA20 > EMA50 > EMA200, ADX > 22, giá > EMA50
   Trend Down
   EMA20 < EMA50 < EMA200, ADX > 22, giá < EMA50
   Squeeze
   BB width (20) ≤ percentile 20 của 120 nến, ADX < 18
   Range
   ADX < 20, giá dao động trong ±1.5×ATR quanh EMA50, BB width bình thường
   Expansion
   BB width tăng > 30% trong 5 nến + volume > 1.5× trung bình
   Brief tự động (3 dòng): regime, điểm bất thường lớn nhất (vd funding cực đoan, OI tăng đột biến), 1–2 mức giá cần canh của BTC.
   B. Derivatives Dashboard
   Metric
   Công thức / nguồn
   Cách đọc
   Funding (OI-weighted avg, top 20)
   premiumIndex
   Percentile > 90 = long quá đông; < 10 = short quá đông
   Open Interest + % thay đổi 1h/4h/24h
   openInterest, openInterestHist
   Dùng ma trận bên dưới
   Basis futures quý
   (Futures − Spot)/Spot, annualized
   > 15% = nóng, < 3% hoặc âm = sợ hãi
   > Global L/S ratio vs Top Trader L/S
   > globalLongShortAccountRatio, topLongShortPositionRatio
   > Phân kỳ giữa 2 chỉ số = tín hiệu hay
   > Taker Buy/Sell ratio
   > takerlongshortRatio
   > 1.1 lực mua chủ động
   > Options (BTC/ETH): DVOL, Put/Call, Max Pain
   > Deribit public API
   > DVOL cao + giá đi ngang = chờ bùng nổ
   > Ma trận Giá × OI (hiển thị thành nhãn cho từng coin và cho BTC):
   > Giá
   > OI
   > Nhãn
   > Ý nghĩa
   > ↑
   > ↑
   > Long mới vào
   > Trend khỏe
   > ↑
   > ↓
   > Short squeeze
   > Đà yếu, dễ hụt hơi
   > ↓
   > ↑
   > Short mới vào
   > Trend giảm khỏe
   > ↓
   > ↓
   > Long capitulation
   > Gần đáy ngắn hạn
   > C. Breadth & Rotation
   > • % coin (top 100) trên EMA50 / EMA200 khung D — đường thời gian 90 ngày.
   > • % coin làm đỉnh/đáy 20 ngày; Advance/Decline 24h.
   > • BTC.D, ETH/BTC, USDT.D, Total3 — mini chart + mũi tên xu hướng. Bảng đọc nhanh: BTC.D↓ + ETH/BTC↑ + Total3↑ = alt season bắt đầu.
   > • Altseason Index: % top 50 coin outperform BTC trong 30 ngày (> 75% = alt season).
   > • Sector rotation: nhóm coin (L1, L2, AI, DeFi, Meme, RWA, Gaming…) với hiệu suất 24h/7d/30d và RS so với BTC. Hiển thị bar chart xếp hạng.
   > • Relative Strength (RS): coin return / BTC return trên 7d và 30d, xếp hạng percentile.
   > D. Heatmap
   > • Treemap top 100 USDT-perp, kích thước = volume 24h (hoặc market cap, có toggle), màu = % thay đổi theo khung chọn (1h / 4h / 24h / 7d).
   > • Toggle chế độ màu: Price % · Funding percentile · OI change · RS vs BTC · Volume spike.
   > • Hover: giá, %, volume, funding, OI, Score scanner. Click: mở Coin Detail.
   > E. Liquidation & Flow
   > • Liquidation: tổng long/short bị thanh lý 1h/4h/24h (stream forceOrder), cluster theo mức giá cho BTC/ETH. Spike > 3× trung bình = sự kiện flush.
   > • CVD (Cumulative Volume Delta) BTC/ETH khung 1H/4H, so sánh với giá để bắt phân kỳ.
   > • Stablecoin supply (USDT+USDC) thay đổi 7d/30d — DefiLlama.
   > • ETF flow BTC/ETH theo ngày (không có API chính thức miễn phí → scrape Farside hoặc nhập tay, đánh dấu nguồn).
   > • Whale/large trades: lệnh aggTrade > ngưỡng USD, gom theo mua/bán ròng 1h.
   > F. Signal Scanner (bảng chính)
   > Universe: top 100–150 USDT-perp theo volume 24h, loại coin volume < 20M USD/ngày.
   > Các setup (mỗi setup là 1 tag, 1 coin có thể có nhiều tag):
   > Setup
   > Điều kiện (nến đóng)
   > Squeeze Breakout
   > BB width ≤ p20 trong ≥ 12 nến → đóng nến trên đỉnh range/BB trên, volume ≥ 1.5× MA20
   > Range Breakout
   > Giá đóng vượt đỉnh/đáy 20 nến (Donchian), volume ≥ 1.5×, ATR đang mở rộng
   > Breakout Retest
   > Đã breakout trong 3–10 nến, giá hồi về vùng breakout, nến từ chối (râu dưới dài / engulfing)
   > Trend Pullback
   > EMA20>50>200, giá chạm EMA20–50, RSI(14) 40–55 quay đầu
   > RS Leader
   > RS 7d và 30d đều top 10%, giá > EMA50, chưa quá xa EMA20 (< 2.5 ATR)
   > Positioning Squeeze
   > Funding percentile > 90 (hoặc < 10) + OI tăng mạnh + giá mất mốc gần nhất → kèo ngược chiều đám đông
   > Liquidity Sweep Reversal
   > Quét qua đỉnh/đáy 20 nến bằng râu, đóng lại bên trong range, volume spike
   > Divergence
   > RSI/CVD phân kỳ với giá ở đỉnh/đáy swing (pivot 5-5)
   > Signal Score 0–100:
   > Thành phần
   > Điểm tối đa
   > Cấu trúc xu hướng (EMA stack, khung lớn đồng thuận)
   > 25
   > Momentum & RS vs BTC
   > 20
   > Volume / Flow (vol spike, taker ratio, CVD)
   > 20
   > Positioning (funding, OI, L/S) thuận lợi
   > 20
   > Setup vol (squeeze, ATR, khoảng cách tới SL hợp lý)
   > 15
   > Regime filter: điểm bị nhân 0.8 khi kèo ngược regime BTC 1D (vd long khi BTC Trend Down). Hiển thị cả điểm gốc và điểm sau lọc.
   > Cột bảng: Coin · Giá · % 24h · Setup tags · Score · Khung · Hướng · Funding % · OI Δ · RS 7d · Vol spike · Entry zone · SL gợi ý (ATR-based) · R:R tới mốc gần nhất · Tuổi tín hiệu.
   > Bộ lọc: hướng (Long/Short), khung (1H/4H/1D), setup, Score tối thiểu, volume tối thiểu, sector, "chỉ coin có funding hợp lý".
   > G. Coin Detail (drawer)
   > • Chart (TradingView Lightweight Charts): nến, EMA20/50/200, volume, BB, các mức Donchian, vùng entry/SL/TP vẽ lên chart.
   > • Checklist đạt/không đạt cho từng điều kiện của setup (✔/✘) — để người dùng hiểu vì sao có tín hiệu.
   > • Key levels tự động: đỉnh/đáy swing, POC/VAH/VAL của volume profile 7d/30d, PDH/PDL, mức thanh lý dày.
   > • Multi-timeframe strip: 15m / 1H / 4H / 1D — mỗi khung 1 nhãn trend + RSI + vị trí so với EMA.
   > • Mini panel: funding history, OI history, L/S ratio, tin liên quan (nếu có).
   > H. Macro & Calendar
   > • DXY, US10Y, S&P500/Nasdaq, Vàng: giá + % thay đổi + tương quan 30d với BTC.
   > • Lịch sự kiện 7 ngày tới: CPI, FOMC, NFP, token unlock lớn, options expiry (Deribit Friday 08:00 UTC), funding settlement (00/08/16 UTC).
   > • Cảnh báo "vùng nhạy cảm": trước sự kiện lớn 2 giờ → banner nhắc giảm size / tránh vào kèo breakout.
   > I. Alert Log & Thông báo
   > • Kênh: Telegram / Zalo / web push.
   > • Loại alert: Score ≥ ngưỡng · setup mới xuất hiện · đổi regime BTC · funding/OI cực đoan · liquidation spike · giá chạm mức người dùng đặt.
   > • Cooldown: mỗi coin + setup tối đa 1 alert/4h; gom nhóm nếu > 5 alert/phút.
   > • Mỗi alert gồm: coin, setup, khung, entry/SL/TP gợi ý, Score, link tới Coin Detail.
4. Nguồn dữ liệu
   Dữ liệu
   Nguồn
   Ghi chú
   Giá, kline, ticker
   Binance Futures REST /fapi/v1/klines, /fapi/v1/ticker/24hr; WS !ticker@arr, <symbol>@kline\_<tf>
   Ưu tiên WS để tiết kiệm rate limit
   Funding, mark price
   /fapi/v1/premiumIndex; WS !markPrice@arr

OI, L/S, taker ratio
/fapi/v1/openInterest, /futures/data/openInterestHist, globalLongShortAccountRatio, topLongShortPositionRatio, takerlongshortRatio
Lịch sử tối đa ~30 ngày → tự lưu DB để có percentile 90d
Liquidation
WS !forceOrder@arr
Chỉ có snapshot mới nhất mỗi giây, tự cộng dồn
Dominance, global MC
CoinGecko /global
Tự tính Total3 từ top coin
Fear & Greed
alternative.me /fng/

Stablecoin supply
DefiLlama stablecoins API

Options
Deribit public API (DVOL, book summary)
Max pain tự tính
Macro
Yahoo Finance / FRED
Delay chấp nhận được
ETF flows
Farside (scrape) hoặc nhập tay
Đánh dấu nguồn + độ trễ 5. Kiến trúc đề xuất
• Backend: Node.js (TypeScript). Hai tiến trình tách biệt: collector (WS + REST poller, ghi DB/Redis) và analyzer (worker tính chỉ báo, regime, setup, score khi nến đóng).
• Lưu trữ: Redis cho snapshot realtime; Postgres/TimescaleDB cho kline, funding, OI, signal history (để backtest và thống kê hit-rate sau này).
• Realtime tới frontend: WebSocket/SSE, đẩy theo diff. Snapshot refresh: ticker 1–2s, derivatives 30–60s, breadth/rotation 1–5 phút, macro 5–15 phút.
• Frontend: React/Next.js + Tailwind, Lightweight Charts cho nến, ECharts/D3 cho heatmap và treemap. Dark theme mặc định, hiển thị giờ UTC+7, tiếng Việt.
• Chỉ báo: dùng thư viện technicalindicators hoặc tự viết EMA/RSI/ATR/BB/ADX/Donchian; unit-test đối chiếu với TradingView.
• Rate limit: gom request theo batch, cache kline đã đóng, backoff khi 429; theo dõi weight đã dùng. 6. Lộ trình
MVP (làm trước): Top bar · Market Pulse + Regime · Heatmap · Funding/OI/Giá×OI matrix · Scanner với 3 setup (Squeeze Breakout, Range Breakout, Trend Pullback) · Coin Detail cơ bản · alert Telegram.
V2: Breadth/Rotation đầy đủ · sector · liquidation & CVD · RS Leader · Positioning Squeeze · Sweep Reversal · macro & calendar.
V3: Options/DVOL · ETF flow · volume profile · lưu signal history + thống kê hit-rate / R multiple theo từng setup (để loại setup không có edge) · cấu hình ngưỡng theo user · backtest nhanh từ signal history. 7. Lưu ý quan trọng
• Không repaint: mọi signal tạo ra khi nến đóng; lưu signal_time, candle_close_time.
• Dedup: 1 setup/coin/khung chỉ tạo 1 tín hiệu cho đến khi điều kiện reset.
• Chống rác: loại coin mới list < 30 ngày, volume mỏng, spread lớn; không để meme thanh khoản thấp đứng top Score.
• Cảnh báo quá nóng: khi Pulse > 80 và funding percentile > 90 → banner "thị trường hưng phấn, rủi ro đảo chiều".
• Tự đo chất lượng: mỗi signal ghi lại kết quả sau 1h/4h/24h (MFE/MAE, chạm SL hay TP trước). Sau 2–4 tuần dùng số liệu này tinh chỉnh trọng số Score thay vì cảm tính.
• Hiển thị trung thực: gắn nhãn "gợi ý tham khảo, không phải khuyến nghị đầu tư" ở footer.
