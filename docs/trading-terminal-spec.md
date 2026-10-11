# Spec Trading Terminal: Position, TP/SL và Order

Trạng thái: **đang vận hành (web-bot gọi Binance API trực tiếp)**  
Phạm vi: `web-bot` (UI + REST) + Redis sổ sàn từ `binance-bot` WS  
Cập nhật: 2026-10-11

Tài liệu mô tả đích đến và trạng thái hiện tại của trading terminal trên web. Mutation giao dịch **không** đi MQTT chờ ACK; web-bot gọi Binance Futures REST trực tiếp (rate limit + receipt idempotency). `binance-bot` giữ vai trò stream → Redis để UI đọc realtime.

## 1. Mục tiêu

Người dùng có quyền và đúng scope được:

1. Xem vị thế đang mở và lịch sử vị thế.
2. Mở vị thế LONG/SHORT bằng Market hoặc Limit.
3. Đóng toàn bộ hoặc một phần vị thế bằng Market hoặc Limit (% / volume).
4. Reverse vị thế bằng thao tác rõ ràng (đóng rồi mở phía đối ứng).
5. Thêm, thay thế hoặc hủy TP/SL và Trailing Stop gắn với vị thế (Algo Order API).
6. Xem open order (thường + algo) và order history.
7. Thấy rõ qty config (monitor), qty sàn, sibling monitors.
8. Preview trước Confirm: qty, PnL ước tính, phí ước tính, sibling bị ảnh hưởng.
9. Idempotency (`TradingReceipt`) và audit log cho mutation.

MVP chỉ Binance USD-M Futures. Hỗ trợ cả Hedge (`LONG|SHORT`) và One-way (`BOTH`).

## 2. Hiện trạng

### 2.1 Đã có

| Hạng mục | Chi tiết |
|---|---|
| Position realtime | WS `/api/positions/ws`, Redis `wb:ex:` / `wb:ord:`, poll Redis 30s, mark 15s, exchange refresh 5′ |
| Đóng Market/Limit | UI + `POST /api/trading/positions/close`; % 10/25/50/75/100; qty làm tròn stepSize |
| Mở Market/Limit | UI “Mở position” + `POST /api/trading/positions/open` |
| Reverse | UI + `POST /api/trading/positions/reverse` (đóng ALL rồi mở đối ứng) |
| TP/SL | Modal Position TP/SL; Algo `TAKE_PROFIT_MARKET` / `STOP_MARKET` + `closePosition` |
| Trailing | Tab Trailing Stop; Algo `TRAILING_STOP_MARKET` + `callbackRate` / `activationPrice`; hủy được |
| Hiển thị TP/SL/Trail sàn | Từ openOrders + openAlgoOrders gắn vào row (`exchangeTp/Sl/Trailing*`) |
| Qty config vs sàn | Monitor `ownQty` + `exchangeQty`; cảnh báo `qty-mismatch` |
| Sibling | Liệt kê multi-monitor trên row / preview |
| Preview Confirm | Qty, PnL ước tính, phí taker ước tính 0.04%, sibling |
| Chi tiết case | Symbol / Chi tiết → order mở (huỷ/sửa/thêm nhanh), ownership chỉ monitor còn qty, lịch sử order, monitor ENV khi có data, cảnh báo lệch cuối panel |
| Open / order history | Tab Order đang mở, Lịch sử order |
| Đặt lệnh (ticket) | Tab Order: khung Buy/Sell Market·Limit·Stop·Stop Limit + reduce-only; `POST /api/trading/orders` |
| Huỷ order / algo | Nút Huỷ từng dòng + huỷ hàng loạt; `POST .../cancel` và `.../cancel-batch` (Algo API đúng endpoint) |
| Idempotency | `TradingReceipt` theo actor + idempotencyKey |
| Audit | `position.close_requested`, `open_requested`, `reverse_requested`, `tpsl_requested`, `order.cancel_requested`, `order.create_requested`, … |
| Rate limit trading | 10 req / 10s / account trong `direct-trading.js` |

### 2.2 Còn hạn chế

- Phí preview là **ước tính taker mặc định**, không đọc VIP fee tier thật.
- Reverse là saga hai lệnh; nếu bước mở fail sau đóng → có thể flat (UI cảnh báo).
- Order replace / amend chi tiết chưa có UI riêng (hủy + tạo mới cho TP/SL/trailing).
- Ticket chưa có Trailing / TP Market riêng (dùng modal TP/SL trên Positions).
- Trade history fill chưa có tab độc lập (đã có recorded PnL / order history).
- Spec MQTT mutation cũ **không còn là đường chính**.

## 3. Kiến trúc

### 3.1 Đường đọc và đường ghi

```text
Đọc realtime:
Binance user stream
  → binance-bot sync Redis (wb:ex / wb:ord)
  → web-bot REST/WebSocket
  → UI
(+ web-bot REST reconcile thưa khi cần)

Ghi giao dịch:
Browser
  → web API: auth + CSRF + permission + scope + validation
  → trading-bridge (idempotency TradingReceipt)
  → direct-trading → Binance Futures REST / Algo Order API
  → audit log
  → UI (receipt + refresh sổ)
```

Browser không gọi Binance, không nhận API key. Web server dùng credential trong Mongo `user-api` theo username/account.

### 3.2 Conditional orders = Algo Order API

Từ ~2025-12 Binance trả `-4120` nếu đặt STOP/TP/Trailing qua `/fapi/v1/order`.

Dùng:

- `POST /fapi/v1/algoOrder` (`algoType=CONDITIONAL`, `triggerPrice` hoặc `callbackRate`)
- `DELETE /fapi/v1/algoOrder` (`algoId`)
- `GET /fapi/v1/openAlgoOrders`

`closePosition=true` cho Position TP/SL/Trailing đóng toàn bộ; không gửi `reduceOnly` trên Algo API khi không cần.

### 3.3 Mongo không phải nguồn xác nhận trạng thái sàn

Sàn thắng. Redis/Mongo chỉ cache và audit. Sau mutation, UI dựa WS/Redis hoặc nút Cập nhật.

## 4. Permission

| Permission | Dùng cho |
|---|---|
| `positions.view` | Xem sổ |
| `positions.close` | Đóng, một phần reverse |
| `positions.open` | Mở, reverse |
| `positions.tpsl` | TP/SL/Trailing |
| `orders.view` | Open/history orders |
| `orders.cancel` / `orders.create` / `orders.edit` | Order mutations |

Scope bot theo RBAC hiện có; không tin permission từ client.

## 5. API chính

| Method | Path | Permission |
|---|---|---|
| POST | `/api/trading/positions/close` | `positions.close` |
| POST | `/api/trading/positions/open` | `positions.open` |
| POST | `/api/trading/positions/reverse` | open + close |
| PUT | `/api/trading/positions/:positionKey/tpsl` | `positions.tpsl` |
| DELETE | `/api/trading/positions/:positionKey/tpsl/:kind/:orderId` | `positions.tpsl` |
| POST | `/api/trading/orders/cancel` | `orders.cancel` |
| POST | `/api/trading/orders/cancel-batch` | `orders.cancel` |
| POST | `/api/trading/orders` | `orders.create` |
| GET | `/api/orders/mark` | `orders.view` (mark price public feed) |
| GET | `/api/trading/commands/:requestId` | theo quyền xem |

`positionKey` = `username|SYMBOL|LONG|SHORT`.

### 5.1 POSITION_SET_TPSL body

```json
{
  "takeProfit": { "enabled": true, "type": "TAKE_PROFIT_MARKET", "triggerPrice": "70000", "workingType": "CONTRACT_PRICE" },
  "stopLoss": { "enabled": true, "type": "STOP_MARKET", "triggerPrice": "62000", "workingType": "MARK_PRICE" },
  "trailing": { "enabled": true, "callbackRate": "1.0", "activationPrice": null, "workingType": "CONTRACT_PRICE" }
}
```

Hủy trailing: `{ "trailing": { "enabled": false, "cancel": true } }`.

### 5.2 Close body

```json
{
  "username": "B5",
  "symbol": "BTCUSDT",
  "positionSide": "LONG",
  "orderType": "MARKET|LIMIT",
  "quantityMode": "ALL|PERCENT|QUANTITY",
  "percent": "50",
  "quantity": "0.01",
  "price": "65000"
}
```

## 6. UI

- Hai dòng mỗi vị thế: số liệu + actions (`Market | Limit` + giá + Amount/%, Reverse, TP/SL link, monitors).
- Modal Confirm bắt buộc cho close / reverse / open / tpsl — không dùng `window.confirm` cho trading mutation (trừ xóa monitor Mongo).
- Preview hiển thị qty, PnL/phí ước tính, sibling.
- Modal TP/SL có tab **Position TP/SL** và **Trailing Stop**.

## 7. Invariant

- Qty monitor (`ownQty`) ≠ qty sàn (`exchangeQty`); không gán nhầm.
- Sibling: không cancel-all TP/SL theo symbol nếu còn sibling (bot monitor); web chỉ hủy đúng loại protective của positionSide đang sửa.
- Không commit `.env` / API key.
- Rate limit và error cache tránh spam Binance.

## 8. Kiểm thử tối thiểu

- Close Market 50% + preview sibling.
- Limit close có tick/step hợp lệ.
- Set TP+SL Algo; thấy trên row sau refresh.
- Set / xóa Trailing.
- Open MARKET/LIMIT.
- Reverse LONG→SHORT.
- Permission thiếu → 403.
- IdempotencyKey trùng → 200 duplicate.
