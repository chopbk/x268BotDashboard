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

## 3. Journal + phân tích + AI

- Tab panel **Journal**: ghi chú cá nhân (`web_trade_journal`), tối đa 2000 ký tự, 10 tags.
- Chỉ actor tạo mới xem/sửa/xoá; cần `positions.view` + scope bot.
- **Phân tích nhanh**: rule-based từ factors (uPnL, ROI margin≈, khoảng SL/TP/liq, lev, ownership, paper).
- **Gợi ý AI**: `POST /api/terminal/coach` dùng cùng provider dashboard (`AI_PROVIDER` + key). Rate limit 15s/user. Chưa cấu hình → fallback rules.

## 4. API

| Method | Path | Permission |
|---|---|---|
| GET | `/api/orders/balance` | `orders.view` hoặc `positions.view` |
| GET/POST/PATCH/DELETE | `/api/terminal/journal` | `positions.view` |
| POST | `/api/terminal/coach` | `positions.view` |

## 5. Kiểm tra

```sh
npm --prefix server test -- --test-name-pattern='trade-factors|collectFactors|ruleSuggestions|analyzeLocal|parseSuggestions|tradeKey'
node --test client/src/components/terminal/sizing.test.js client/src/components/terminal/cli.test.js
npm --prefix client run build
```

Không gửi lệnh live làm test.
