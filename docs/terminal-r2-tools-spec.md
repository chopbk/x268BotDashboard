# Terminal R2 tools — % sizing, CLI, journal/AI

Ngày: 2026-10-13. Phạm vi: menu `/terminal` trong web-bot. Không thêm dependency. Không MQTT lệnh Telegram thật — CLI chỉ điều khiển UI/confirm hiện có.

## 1. Đặt lệnh theo %

Ticket **Mở** (panel Giao dịch) và **OrderTicket** nâng cao có bốn mode:

| Mode | Ý nghĩa | Công thức ước lượng |
|---|---|---|
| Qty | Số lượng contract | Gửi thẳng |
| % ví | % `availableBalance` làm **margin** | `notional ≈ available × % × leverage` → `qty = notional / price` |
| USDT | Notional USDT (không phải margin) | `qty = usdt / price` |
| Rủi ro $ | Ngân sách lỗ tới SL | `qty = B / (\|E−S\| + E·f1 + S·f2)` (fee mặc định 0) |

- Đóng vị thế vẫn dùng preset % của **qty vị thế** (đã có).
- Hiển thị rõ notional ≠ margin. Làm tròn xuống step client; sàn/server vẫn validate.
- Số dư: `GET /api/orders/balance?account=&env=` đọc Redis `wb:bal:<ENV>`. Thiếu Redis → không tính % ví.

## 1b. Đóng toàn bộ (bộ lọc)

Nút **Đóng toàn bộ** (và CLI `/clall [%]`) mở dialog giống đóng đơn: chọn % (10/25/50/75/100), bảng từng vị thế live trong bộ lọc hiện tại với qty đóng và PnL≈, tổng ước tính. Chọn 50% → mỗi vị thế đóng 50% size của nó (không chia đều một pool). Bỏ paper/pending. Gửi lần lượt `POST /api/trading/positions/close` MARKET · `PERCENT`/`ALL`; dừng khi một lệnh lỗi. Không phải “đóng mọi account hệ thống” — chỉ hàng đang hiện sau filter/view.

## 2. CLI lệnh nhanh

Thanh `TerminalCli` dưới workspace. Cú pháp gần Telegram (`/cl`, `/o`, `/sl`…).

- Gợi ý khi gõ `/` (Tab / ↑↓ chọn).
- Chỉ tạo **preview/confirm** — giữ permission `positions.*` / `orders.*`.
- Không gửi MQTT `/env/sc` hay lệnh config bot.

Lệnh chính: `/help`, `/p`, `/b`, `/cl`, `/o` (`/long` `/short`), `/sl`, `/tp`, `/rev`, `/j`, `/ai`.

## 3. Journal + phân tích kỹ thuật + AI

- **Tổng quan**: Journal nhúng trong tab; nút **AI phân tích** mở popup (decision-support Phase 1). Monitor gộp timeline.
- Journal: ghi chú cá nhân (`web_trade_journal`), tối đa 2000 ký tự, 10 tags.
- Chỉ actor tạo mới xem/sửa/xoá; cần `positions.view` + scope bot.
- **Phân tích kỹ thuật** (`ai=false`): klines public Binance Futures 15m+1h → EMA20/50, ATR14, swing HH/HL, hỗ trợ/kháng cự, alignment với side; gợi ý mức SL/TP (ATR / swing) kèm nút **Áp SL/TP** mở confirm bảo vệ hiện có (không tự gửi sàn).
- **Gợi ý AI**: cùng factors + market; JSON có `kind` và `action.{type,price}`; rate limit 15s/user. Chưa cấu hình AI → vẫn trả rule + kỹ thuật.
- Cache klines ~60s trong process. Không thêm dependency chart.

## 4. API

| Method | Path | Permission |
|---|---|---|
| GET | `/api/orders/balance` | `orders.view` hoặc `positions.view` |
| GET/POST/PATCH/DELETE | `/api/terminal/journal` | `positions.view` |
| POST | `/api/terminal/decision/position` | `positions.view` — Phase 1 AI hỗ trợ quyết định |
| POST | `/api/terminal/decision/account` | `positions.view` |
| POST | `/api/terminal/coach` | Wrapper → decision (giữ tương thích) |

Xem thêm [ai-decision-support-spec](ai-decision-support-spec.md). Phase 1 **không** có nút Áp SL/TP từ AI.

## 5. Kiểm tra

```sh
npm --prefix server test -- --test-name-pattern='trade-factors|collectFactors|ruleSuggestions|analyzeLocal|parseSuggestions|tradeKey'
node --test client/src/components/terminal/sizing.test.js client/src/components/terminal/cli.test.js
npm --prefix client run build
```

Không gửi lệnh live làm test.
