# Spec Trading Terminal: Position, TP/SL và Order

Trạng thái: **proposed — chưa implement mutation giao dịch**  
Phạm vi: `web-bot` + cầu MQTT + `binance-bot` TRADER  
Cập nhật: 2026-10-11

Tài liệu này mô tả đích đến để web có trải nghiệm quản lý Futures gần Binance Web, nhưng vẫn giữ các invariant riêng của hệ thống bot. Cursor phải triển khai theo từng phase, không mở toàn bộ action cùng lúc và không dùng chuỗi command Telegram làm API giao dịch.

## 1. Mục tiêu

Người dùng có quyền và đúng scope được:

1. Xem vị thế đang mở và lịch sử vị thế như hiện tại.
2. Mở vị thế LONG/SHORT bằng Market hoặc Limit.
3. Đóng toàn bộ hoặc một phần vị thế bằng Market hoặc Limit.
4. Reverse vị thế bằng thao tác rõ ràng, không ngầm gộp vào Close.
5. Thêm, thay thế hoặc hủy TP/SL gắn với một vị thế.
6. Xem toàn bộ order đang mở: order thường và conditional/algo order.
7. Tạo, hủy và thay thế order trong phạm vi được cấp quyền.
8. Xem lịch sử order/fill đã chuẩn hóa, có phân trang và lọc phía server.
9. Theo dõi trạng thái lệnh từ lúc web gửi đến lúc sàn xác nhận.
10. Có audit đầy đủ nhưng không ghi API key, secret hoặc payload nhạy cảm.

Mục tiêu không phải sao chép mọi màn hình Binance. Phiên bản đầu chỉ hỗ trợ Binance USD-M Futures, Hedge Mode hiện tại (`positionSide=LONG|SHORT`) và những loại order được liệt kê trong spec.

## 2. Hiện trạng và khoảng trống

### 2.1 Đã có

- Position live từ Redis `wb:ex:<account>` kết hợp `monitor_positions`.
- WebSocket `/api/positions/ws`, REST fallback và reconcile với Binance.
- Lịch sử position từ `account_statics`.
- Snapshot có `openOrders`, `algoOrders`, `trades`, `positionHistory`.
- Permission `positions.view`, `positions.open`, `positions.close`.
- MQTT outbox `web_bot_commands`, ACK `command_response`, role TRADER và idempotency contract.
- `binance-bot` đã có client mở/đóng Futures, order thường, algo TP/SL và cancel order dùng bởi Telegram/runtime.

### 2.2 Chưa có hoặc chưa được phép coi là giao dịch

- `POST /api/positions/monitors` chỉ tạo Mongo monitor, không mở lệnh sàn.
- `DELETE /api/positions/monitors/:id` chỉ xóa bản ghi, không đóng vị thế.
- UI Market/Limit/Reverse hiện chỉ là draft/thông báo.
- Chưa có typed trading action qua bridge.
- Chưa có tab Orders độc lập và order history bền vững.
- Chưa có contract thay thế order an toàn.
- Chưa có xử lý rõ ràng khi nhiều monitor/config cùng sở hữu một vị thế sàn.

## 3. Nguyên tắc kiến trúc bắt buộc

### 3.1 Đường đọc và đường ghi tách riêng

```text
Đọc realtime:
Binance user stream / REST reconcile
  → binance-bot hoặc web position feed
  → Redis exchange book
  → web REST/WebSocket
  → UI

Đọc lịch sử:
Binance events / reconcile / command result
  → Mongo materialized order events
  → web REST pagination
  → UI

Ghi giao dịch:
Browser
  → web API: auth + CSRF + permission + scope + validation
  → Mongo command outbox
  → MQTT typed trading_request_v1
  → binance-bot TRADER validate lại + execute
  → Binance
  → MQTT command_response
  → outbox + Redis/Mongo refresh
  → UI
```

Browser không được kết nối MQTT, không nhận credential và không gọi Binance trực tiếp. Web server cũng không gọi Binance để mutation; mutation phải chạy tại TRADER để dùng đúng runtime client, mode và logic bảo vệ hiện có.

### 3.2 Mongo không phải nguồn xác nhận trạng thái sàn

- `web_bot_commands` là trạng thái workflow, không phải bằng chứng position/order đang tồn tại.
- Redis exchange book và response sàn là nguồn trạng thái gần realtime.
- Mongo order events/history là read model bền vững.
- Sau mutation thành công phải reconcile hoặc chờ user-stream event; không tự sửa position/order trên UI theo dự đoán rồi coi là thật.

### 3.3 Không dùng raw Telegram command

Frontend gửi action typed. Server và bot cùng validate schema. Không map payload tùy ý thành `/env/long?...` hoặc `/env/cancel?...` vì dễ injection, thiếu type safety và khó idempotency.

Topic đề xuất:

| Topic | Hướng | Nội dung |
|---|---|---|
| `trading/request/v1` | web → TRADER | Typed trading request, QoS 1 |
| `command_response` | TRADER → web | Dùng envelope ACK hiện tại, bổ sung `result` typed |
| `position/events/v1` | TRADER → web, optional | Event invalidation để reconcile nhanh |

Không đưa trading action vào `config/sync`.

## 4. Thuật ngữ và định danh

| Tên | Ý nghĩa |
|---|---|
| `username` / account | `user_accounts.username`, chọn credential sàn |
| `env` | Account config/monitor; không đồng nghĩa ví sàn |
| Exchange position | Một vị thế sàn xác định bởi `username + symbol + positionSide` |
| Monitor position | Một document `monitor_positions`; nhiều monitor có thể cùng nằm trên một exchange position |
| Regular order | Order từ Futures order API, có `orderId` |
| Algo order | Conditional order API mới, có `algoId`/`clientAlgoId` |
| Command | Workflow web → bot có `requestId` |
| Client mutation | Ý định người dùng có `idempotencyKey`, có thể tạo một command |

Khóa position chuẩn:

```text
positionKey = username|symbol|positionSide
```

Khóa order chuẩn:

```text
orderKey = username|kind(order|algo)|symbol|exchangeOrderId
```

Không dùng `monitor_positions._id` làm định danh exchange position.

## 5. Permission và scope

### 5.1 Permission hiện có được giữ

| Permission | Cho phép |
|---|---|
| `positions.view` | Xem position và open orders liên quan position |
| `positions.open` | Mở/tăng/reverse position |
| `positions.close` | Đóng/giảm position |
| `statistics.view` | Xem lịch sử position |

### 5.2 Permission mới đề xuất

| Permission | Cho phép |
|---|---|
| `positions.tpsl` | Tạo/thay/hủy TP, SL, trailing gắn với position |
| `orders.view` | Xem tab order đang mở và lịch sử order/fill |
| `orders.create` | Tạo regular/algo entry order độc lập |
| `orders.edit` | Replace một order đang mở |
| `orders.cancel` | Hủy một hoặc nhiều order |

Không dùng `config.edit` thay cho quyền giao dịch. Không dùng `bots.operate` thay cho quyền order/position.

Tất cả permission trên phải áp scope `all|own_assigned|assigned|own` theo bot username, giống `positions.view`. Server luôn kiểm tra:

1. Permission.
2. Bot username nằm trong scope actor.
3. Bot đang active.
4. Env nếu có phải thuộc bot username đó.
5. Runtime action chỉ tới process TRADER đang chạy username đó.

Client chỉ ẩn/disable nút; server và bot vẫn phải chặn độc lập.

## 6. Action catalog

### 6.1 Phase MVP

| Action | Permission | Ý nghĩa |
|---|---|---|
| `POSITION_OPEN` | `positions.open` | Mở/tăng LONG hoặc SHORT bằng Market/Limit |
| `POSITION_CLOSE` | `positions.close` | Đóng một phần/toàn bộ bằng Market/Limit, luôn reduce-only |
| `POSITION_REVERSE` | `positions.open` + `positions.close` | Đóng side cũ rồi mở side đối diện theo saga rõ ràng |
| `POSITION_SET_TPSL` | `positions.tpsl` | Tạo hoặc thay TP/SL cho position |
| `POSITION_CANCEL_TPSL` | `positions.tpsl` | Hủy TP/SL cụ thể của position |
| `ORDER_CREATE` | `orders.create` | Tạo entry/reduce-only regular hoặc algo order |
| `ORDER_CANCEL` | `orders.cancel` | Hủy đúng một order theo kind + exchange ID |
| `ORDER_CANCEL_BATCH` | `orders.cancel` | Hủy danh sách ID đã chọn, giới hạn số lượng |
| `ORDER_REPLACE` | `orders.edit` | Cancel order cũ rồi tạo order mới theo saga |

### 6.2 Không hỗ trợ trong MVP

- Cross ↔ isolated mutation.
- Đổi leverage khi đang có position/order nếu chưa có preflight an toàn.
- Multi-assets mode, portfolio margin.
- Spot/Margin/COIN-M.
- Grid/TWAP/VP/iceberg nâng cao.
- Cancel all toàn bộ account không filter.
- Copy-trade hàng loạt từ một click.
- Mutation PAPER qua cùng endpoint live; PAPER cần engine và action namespace riêng.

## 7. Contract request typed

Envelope MQTT:

```json
{
  "version": 1,
  "requestId": "uuid-v4",
  "idempotencyKey": "uuid-v4",
  "action": "POSITION_CLOSE",
  "actor": {
    "webUserId": "...",
    "username": "operator-a"
  },
  "target": {
    "username": "bot-demo",
    "env": "DEMO_1",
    "symbol": "BTCUSDT",
    "positionSide": "LONG"
  },
  "params": {},
  "expected": {
    "bookVersion": 123,
    "positionQty": "0.010"
  },
  "createdAt": 1791500000000,
  "expiresAt": 1791500030000
}
```

Quy tắc:

- `requestId`: một lần dispatch; unique.
- `idempotencyKey`: một ý định người dùng; unique theo actor + action + target trong tối thiểu 24 giờ.
- Số tiền/giá/qty truyền dạng decimal string, không truyền float nếu cần giữ precision.
- `symbol` uppercase và phải tồn tại trong `futures_symbols`/exchange info.
- `positionSide` chỉ `LONG|SHORT` trong MVP.
- `expiresAt` bắt buộc; bot từ chối request quá hạn.
- `expected` dùng optimistic concurrency. Nếu sổ sàn đã khác đáng kể, bot trả `STALE_STATE`, không đoán ý người dùng.

### 7.1 `POSITION_OPEN`

```json
{
  "orderType": "MARKET|LIMIT",
  "quantity": "0.010",
  "price": "65000.0",
  "timeInForce": "GTC",
  "reduceOnly": false,
  "attachMonitor": false,
  "clientOrderId": "wb_<short-id>"
}
```

- LIMIT bắt buộc `price`; MARKET không nhận `price`.
- `quantity > 0`, làm tròn xuống theo `stepSize` tại bot.
- Giá làm tròn đúng `tickSize`; không tự nâng quantity sau làm tròn.
- `attachMonitor=false` trong MVP mặc định: vị thế mở thủ công; monitor có thể nhận thành `NOTPSL` theo logic hiện có.
- Nếu sau này `attachMonitor=true`, phải là phase riêng gọi đúng pipeline trader/monitor, không chỉ insert Mongo document.

### 7.2 `POSITION_CLOSE`

```json
{
  "orderType": "MARKET|LIMIT",
  "quantityMode": "ALL|PERCENT|QUANTITY",
  "quantity": "0.005",
  "percent": "50",
  "price": "67000.0",
  "cancelRelatedOrders": false
}
```

- Bot đọc lại position sàn ngay trước execute.
- Quantity đóng tối đa bằng absolute exchange qty hiện tại.
- Lệnh đóng bắt buộc đúng side đối ứng và reduce-only/positionSide phù hợp.
- `ALL` đóng qty sàn hiện tại, không dùng tổng `monitor.positionAmt`.
- LIMIT tạo closing order; chưa fill thì position vẫn còn.
- `cancelRelatedOrders=false` mặc định. Nếu true, UI phải liệt kê chính xác order sẽ bị hủy trước confirm.

### 7.3 `POSITION_REVERSE`

```json
{
  "closeOrderType": "MARKET",
  "openOrderType": "MARKET",
  "newQuantity": "0.010",
  "cancelRelatedOrders": true
}
```

Reverse là saga hai bước:

1. Đóng side hiện tại và xác nhận fill/position qty về 0.
2. Chỉ sau đó mở side đối diện.

Nếu bước 1 thành công nhưng bước 2 thất bại, trả `PARTIAL_SUCCESS`, tuyệt đối không báo rollback. Audit và UI phải nói rõ account hiện đã flat.

### 7.4 `POSITION_SET_TPSL`

```json
{
  "takeProfit": {
    "enabled": true,
    "type": "TAKE_PROFIT_MARKET|TAKE_PROFIT",
    "triggerPrice": "70000",
    "limitPrice": null,
    "quantityMode": "ALL|PERCENT|QUANTITY",
    "percent": "100",
    "workingType": "MARK_PRICE|CONTRACT_PRICE",
    "priceProtect": true
  },
  "stopLoss": {
    "enabled": true,
    "type": "STOP_MARKET|STOP",
    "triggerPrice": "62000",
    "limitPrice": null,
    "quantityMode": "ALL",
    "workingType": "MARK_PRICE",
    "priceProtect": true
  },
  "replaceOrderIds": []
}
```

Validation giá:

- LONG: TP trigger thường lớn hơn mark/entry; SL trigger nhỏ hơn mark/entry.
- SHORT: TP trigger thường nhỏ hơn mark/entry; SL trigger lớn hơn mark/entry.
- Nếu giá đã vượt trigger hoặc Binance sẽ trigger ngay, trả `WOULD_TRIGGER_IMMEDIATELY`.
- `closePosition=true` chỉ dùng khi không truyền quantity và loại Binance hỗ trợ.
- Không đồng thời gửi `closePosition=true` và quantity.
- TP/SL gắn đúng `positionSide`; side order là LONG→SELL, SHORT→BUY.

Replace TP/SL phải theo thứ tự an toàn:

1. Validate order mới hoàn chỉnh.
2. Tạo order bảo vệ mới.
3. Xác nhận sàn đã nhận.
4. Hủy order cũ được chỉ định.

Riêng trường hợp Binance không cho hai `closePosition` order đồng loại tồn tại, dùng saga cancel-old/create-new nhưng response phải có cửa sổ không bảo vệ và UI cảnh báo. Không được xóa order cũ trước khi validation mới hoàn tất.

### 7.5 `ORDER_CREATE`

```json
{
  "kind": "REGULAR|ALGO",
  "intent": "ENTRY|REDUCE",
  "side": "BUY|SELL",
  "positionSide": "LONG|SHORT",
  "type": "LIMIT|MARKET|STOP_MARKET|TAKE_PROFIT_MARKET|STOP|TAKE_PROFIT|TRAILING_STOP_MARKET",
  "quantity": "0.010",
  "price": "65000",
  "triggerPrice": "64000",
  "activationPrice": null,
  "callbackRate": null,
  "timeInForce": "GTC",
  "workingType": "MARK_PRICE",
  "reduceOnly": false,
  "closePosition": false
}
```

Server/bot dùng matrix whitelist theo type. Field thừa hoặc combination mâu thuẫn trả 400/validation failed, không âm thầm bỏ qua.

### 7.6 `ORDER_CANCEL`

```json
{
  "kind": "REGULAR|ALGO",
  "orderId": "123456",
  "symbol": "BTCUSDT"
}
```

Bot lấy order hiện tại, xác minh đúng account/symbol rồi mới cancel. Không fallback từ regular ID sang algo ID một cách im lặng trong typed path; client phải gửi đúng `kind`.

### 7.7 `ORDER_REPLACE`

Binance không bảo đảm modify cho mọi loại order. MVP định nghĩa replace là saga:

1. Đọc order cũ và kiểm tra còn OPEN.
2. Validate payload mới.
3. Với entry order: cancel cũ → xác nhận cancel → create mới.
4. Với protective reduce order: ưu tiên create mới → cancel cũ như mục TP/SL.
5. Nếu cancel thành công/create thất bại: `PARTIAL_SUCCESS`, trả snapshot rõ ràng.

Không gọi replace là atomic trong UI.

## 8. Response typed

Giữ envelope `command_response` hiện có và thêm:

```json
{
  "version": 1,
  "requestId": "uuid-v4",
  "targetEnv": "DEMO_1",
  "processRole": "TRADER",
  "instanceId": "host-pid",
  "status": "succeeded",
  "terminal": true,
  "message": "Position close order accepted",
  "error": null,
  "result": {
    "action": "POSITION_CLOSE",
    "outcome": "SUCCESS|PARTIAL_SUCCESS",
    "exchangeOrder": {},
    "positionBefore": {},
    "positionAfter": {},
    "createdOrders": [],
    "cancelledOrders": [],
    "reconcileRequired": true
  },
  "timestamp": 1791500001000
}
```

Error chuẩn:

| Code | Ý nghĩa |
|---|---|
| `VALIDATION_ERROR` | Sai type/price/qty/combination |
| `PERMISSION_DENIED` | Bot-side policy từ chối |
| `TARGET_NOT_LOADED` | Username/env không nằm trên TRADER này |
| `STALE_STATE` | Expected version/qty khác trạng thái sàn |
| `NO_POSITION` | Không còn position để đóng/đặt TP-SL |
| `ORDER_NOT_OPEN` | Order đã fill/cancel/expire |
| `WOULD_TRIGGER_IMMEDIATELY` | Trigger không hợp lệ theo mark hiện tại |
| `INSUFFICIENT_MARGIN` | Sàn từ chối margin |
| `EXCHANGE_REJECTED` | Binance trả lỗi có code đã sanitize |
| `TIMEOUT_UNKNOWN` | Timeout sau khi gửi, chưa biết sàn đã nhận chưa |
| `PARTIAL_SUCCESS` | Saga hoàn thành một phần |
| `RUNTIME_ERROR` | Lỗi runtime không chứa secret |

`TIMEOUT_UNKNOWN` tuyệt đối không tự retry. Phải query theo `clientOrderId`/order ID để xác minh trước.

## 9. Idempotency và chống double execution

### 9.1 Web

- Unique index `actorUserId + idempotencyKey`.
- Double click trả lại command cũ, không tạo request mới.
- Nút submit disable khi request đang `queued|published|received|running`.
- Retry chỉ được tạo request mới khi action hỗ trợ và trạng thái cũ đã được reconcile.

### 9.2 Bot

- Không chỉ dedupe Map 10 phút cho trading mutation.
- Lưu receipt bền vững, đề xuất collection `web_trading_receipts`:

```json
{
  "requestId": "...",
  "idempotencyKey": "...",
  "action": "ORDER_CREATE",
  "target": {},
  "status": "claimed|submitted|succeeded|failed|unknown",
  "exchangeIds": [],
  "result": {},
  "expiresAt": "..."
}
```

- Claim bằng unique insert/findOneAndUpdate atomic trước side effect.
- Nhận lại cùng key: publish lại receipt/result, không gọi sàn lần hai.
- Sau restart vẫn dedupe được.

### 9.3 Client order ID

Order create dùng `newClientOrderId`/`clientAlgoId` có prefix `wb_` suy ra từ idempotency key. Khi timeout, query theo client ID trước khi quyết định thất bại.

## 10. Quy tắc sibling monitor và quantity

Đây là invariant quan trọng nhất khi làm Close/TP-SL.

- Qty monitor config: `monitor.positionAmt`.
- Qty snapshot sàn: `monitor.position.positionAmt`.
- Exchange position qty: sổ `positionRisk` theo username+symbol+side.
- Không cộng monitor qty rồi coi là qty sàn.
- Không gán own qty của một monitor bằng qty sàn.
- Không cancel-all TP/SL theo symbol nếu còn sibling monitor cùng API+symbol+side.

### 10.1 Close ở cấp exchange position

UI phải hiển thị trước confirm:

- Exchange qty hiện tại.
- Danh sách monitor liên quan và own qty từng monitor.
- Có sibling monitor hay không.
- Order reduce/TP/SL liên quan.
- Tác động dự kiến: đóng 25/50/75/100% position sàn.

Lệnh Close không được giả vờ đóng một monitor riêng nếu thực tế gửi reduce order lên vị thế sàn dùng chung.

### 10.2 Close ở cấp monitor

Chỉ làm ở phase sau khi có thuật toán allocation rõ ràng. Nếu thêm:

- Quantity tối đa bằng own qty của monitor.
- Không cancel order của sibling.
- Event CLOSE phải mang monitor ID/env để monitor manager cập nhật đúng bản ghi.
- Nếu exchange fill khác quantity do step/minQty, lưu chênh lệch và reconcile, không nuốt leftover.

MVP nên chỉ cho close exchange position và cảnh báo khi có nhiều monitor.

### 10.3 TP/SL

- TP/SL tạo từ web là exchange protective order.
- Nếu position có nhiều monitor, mặc định không ghi order đó vào một monitor cụ thể.
- Chỉ link monitor khi request chỉ rõ `monitorId` và quantity không vượt own qty.
- Không sửa `monitor.orders` trước khi sàn ACK; sau ACK/reconcile mới cập nhật reference nếu contract monitor yêu cầu.

## 11. Dữ liệu và collection

### 11.1 `web_bot_commands`

Bổ sung field:

```json
{
  "idempotencyKey": "uuid",
  "category": "trading",
  "request": {
    "action": "POSITION_CLOSE",
    "target": {},
    "params": {},
    "expected": {}
  },
  "result": {},
  "reconcileStatus": "pending|confirmed|unknown|failed",
  "retryOfRequestId": null
}
```

Payload audit phải sanitize. Không lưu credential, raw signed URL, signature hoặc listenKey.

### 11.2 `web_exchange_order_events`

Read model append/upsert cho order history:

```json
{
  "username": "bot-demo",
  "kind": "regular|algo",
  "symbol": "BTCUSDT",
  "orderId": "123",
  "clientOrderId": "wb_xxx",
  "positionSide": "LONG",
  "side": "BUY",
  "type": "LIMIT",
  "status": "NEW|PARTIALLY_FILLED|FILLED|CANCELED|EXPIRED|REJECTED",
  "price": "65000",
  "triggerPrice": null,
  "origQty": "0.010",
  "executedQty": "0.005",
  "avgPrice": "65010",
  "reduceOnly": false,
  "closePosition": false,
  "timeInForce": "GTC",
  "exchangeCreatedAt": "...",
  "exchangeUpdatedAt": "...",
  "lastEventTime": 1791500000000,
  "source": "user_stream|reconcile|web_command",
  "rawCode": null
}
```

Index:

- Unique `{username, kind, symbol, orderId}`.
- `{username, exchangeUpdatedAt:-1}`.
- `{username, symbol, status, exchangeUpdatedAt:-1}`.
- `{clientOrderId}` sparse.

Không cần lưu toàn bộ raw Binance response. Chỉ whitelist field phục vụ UI/audit.

### 11.3 `web_exchange_fills`

Fill history tách order history:

```json
{
  "username": "bot-demo",
  "symbol": "BTCUSDT",
  "tradeId": "...",
  "orderId": "...",
  "positionSide": "LONG",
  "side": "SELL",
  "price": "67000",
  "qty": "0.005",
  "quoteQty": "335",
  "realizedPnl": "10",
  "commission": "-0.13",
  "commissionAsset": "USDT",
  "time": "..."
}
```

Unique `{username, symbol, tradeId}`.

### 11.4 Nguồn cập nhật history

Ưu tiên:

1. `ORDER_TRADE_UPDATE` và `ALGO_UPDATE` từ Binance user stream.
2. Command result sau mutation.
3. Reconcile định kỳ/open page.
4. Backfill `allOrders` + `userTrades` theo symbol/time range.

Binance `allOrders` cần symbol, vì vậy lịch sử “tất cả symbol” phải query read model Mongo. Backfill chỉ chạy theo symbol được chọn hoặc symbol gần đây, có cursor/rate limit; không gọi toàn bộ symbol mỗi lần mở tab.

## 12. REST API web

### 12.1 Position mutation

| Method | Path | Permission |
|---|---|---|
| POST | `/api/trading/positions/open` | `positions.open` |
| POST | `/api/trading/positions/close` | `positions.close` |
| POST | `/api/trading/positions/reverse` | open + close |
| PUT | `/api/trading/positions/:positionKey/tpsl` | `positions.tpsl` |
| DELETE | `/api/trading/positions/:positionKey/tpsl/:kind/:orderId` | `positions.tpsl` |

Mutation trả HTTP `202`:

```json
{
  "command": {
    "requestId": "...",
    "idempotencyKey": "...",
    "status": "published",
    "terminal": false,
    "expiresAt": "..."
  }
}
```

HTTP success chỉ nghĩa là đã nhận workflow, không phải sàn đã đặt lệnh.

### 12.2 Order

| Method | Path | Permission |
|---|---|---|
| GET | `/api/orders/open` | `orders.view` |
| GET | `/api/orders/history` | `orders.view` |
| GET | `/api/orders/:kind/:symbol/:orderId` | `orders.view` |
| POST | `/api/orders` | `orders.create` |
| PUT | `/api/orders/:kind/:symbol/:orderId` | `orders.edit` |
| DELETE | `/api/orders/:kind/:symbol/:orderId` | `orders.cancel` |
| POST | `/api/orders/cancel-batch` | `orders.cancel` |
| POST | `/api/orders/history/backfill` | `orders.view`, rate limit riêng |

Query open/history:

- `username` bắt buộc khi không ở view tổng.
- `symbol`, `side`, `positionSide`, `type`, `status`, `kind`.
- `from`, `to` UTC.
- `page`, `limit` server-side; `limit <= 100`.
- `sort=updatedAt|createdAt`, `dir=asc|desc`.

### 12.3 Command status

Dùng endpoint outbox hiện có nhưng response trading phải gồm `result` và `reconcileStatus`. Có thể bổ sung SSE `/api/trading/commands/stream`; MVP được phép poll 500–1000 ms tối đa 30 giây rồi giảm tần suất.

## 13. UI/UX

### 13.1 Navigation

Trong mục Position dùng bốn tab:

1. `Đang mở`
2. `Lịch sử vị thế`
3. `Order đang mở`
4. `Lịch sử order`

Có thể đổi nhãn menu cha thành `Giao dịch` khi Phase 3 hoàn tất, nhưng route cũ `/positions` phải redirect/compatibility.

### 13.2 Tab Đang mở

Mỗi exchange position có:

- Account, symbol, side, mode.
- Qty sàn, entry, mark, liquidation, leverage.
- Unrealized PnL/ROI.
- TP/SL đang xác nhận trên sàn.
- Monitor/config liên quan và cảnh báo sibling/qty mismatch.
- Nút `Đóng`, `Reverse`, `TP/SL` theo permission.

Form Close:

- Market/Limit.
- Slider 25/50/75/100 và quantity cụ thể.
- Giá limit khi cần.
- Preview qty sau đóng.
- Danh sách order liên quan nếu chọn hủy.
- Confirm cuối hiển thị account, symbol, side, qty, loại order.

Không dùng `window.confirm` cho trading mutation. Dùng modal có summary và nút giữ/nhấn xác nhận rõ ràng. Không yêu cầu nhập lại password trong MVP; có thể bổ sung step-up auth sau.

### 13.3 Form Mở vị thế

- Account bắt buộc.
- Symbol searchable.
- LONG/SHORT.
- Market/Limit.
- Quantity; optional nhập volume USDT rồi quy đổi preview nhưng request cuối vẫn quantity.
- Giá limit.
- Estimated notional, margin theo leverage hiện tại, cảnh báo minQty/minNotional.
- Optional TP/SL tạo sau khi entry fill chỉ ở phase nâng cao. MVP không giả định market order luôn fill ngay để gắn protective order trong cùng request.

### 13.4 Modal TP/SL

- Hiển thị position qty, entry, mark, side.
- TP và SL bật độc lập.
- Trigger price, working type, quantity mode.
- Preview PnL/ROI tại trigger.
- Liệt kê protective orders cũ sẽ được thay.
- Hiển thị trạng thái saga từng order.

### 13.5 Tab Order đang mở

Bảng gồm:

- Account, symbol, regular/algo.
- Side, positionSide, intent entry/reduce.
- Type, price, trigger, qty/fill.
- Reduce-only/close-position.
- Time, status, source.
- Action `Sửa` và `Hủy` theo quyền.

Multi-select cancel chỉ hiện khi `orders.cancel`; giới hạn 20 order/request và bắt buộc cùng account trong MVP.

### 13.6 Tab Lịch sử order

- Server pagination.
- Filter account/symbol/kind/type/status/side/range.
- Default 7 ngày, lựa chọn hôm nay/7/30/90/custom.
- Click dòng mở detail và fills.
- Phân biệt Order history với Trade/Fill history.
- Nút backfill theo account + symbol + khoảng thời gian, có thời điểm sync gần nhất.

### 13.7 Trạng thái mutation

| Status | UI |
|---|---|
| queued/published | Đang gửi tới bot |
| received/running | Bot đang xử lý |
| succeeded + reconcile confirmed | Thành công |
| succeeded + reconcile pending | Sàn đã nhận, đang đồng bộ sổ |
| failed | Hiện code/message an toàn |
| expired trước received | Bot offline/chưa nhận |
| timeout unknown sau submitted | Không tự retry; yêu cầu kiểm tra trạng thái |
| partial success | Cảnh báo nổi bật, liệt kê bước thành công/thất bại |

## 14. Bot-side execution design

Tạo module mới có ranh giới rõ, ví dụ:

```text
services/web-trading/
  index.js                 subscribe typed topic
  schemas.js               validate action payload
  authorization.js         runtime target/RUN/env checks
  idempotency-store.js      durable claim/receipt
  position-actions.js
  order-actions.js
  tpsl-actions.js
  reconcile.js
```

Không viết lại `command-handler`. Được tái sử dụng futures client/helper đã chạy, nhưng typed handler phải trả object, không parse text Telegram.

Luồng một action:

1. Parse JSON và validate version/action.
2. Kiểm tra request chưa hết hạn.
3. Kiểm tra process là TRADER và đang load đúng username/env.
4. Claim idempotency atomic.
5. Publish `received`.
6. Đọc trạng thái sàn hiện tại.
7. Validate expected version/qty và precision.
8. Publish `running`.
9. Gọi đúng futures client.
10. Lưu receipt ngay sau khi có exchange ID.
11. Reconcile position/open orders.
12. Publish terminal typed result.

Nếu process nhận request nhưng không sở hữu target, không ACK terminal thay process khác. Có thể publish diagnostic non-terminal riêng nhưng web chỉ chờ owner TRADER.

## 15. Đồng bộ sau mutation

Sau success:

1. User-stream event cập nhật Redis là đường ưu tiên.
2. Nếu sau 2–3 giây chưa thấy version đổi, bot hoặc web trigger reconcile đúng account.
3. UI chỉ mark `reconcileStatus=confirmed` khi snapshot mới chứa kết quả mong đợi.
4. Không chèn order/position giả vào Redis từ request payload.

Expected confirmation:

- Open: order ID xuất hiện hoặc position qty thay đổi.
- Close Market: position qty giảm/biến mất.
- Close Limit: closing order xuất hiện; không yêu cầu position giảm ngay.
- TP/SL: algo order ID xuất hiện.
- Cancel: order không còn open và history có trạng thái cancel/terminal.

## 16. Audit và bảo mật

Audit action đề xuất:

- `position.open_requested`
- `position.close_requested`
- `position.reverse_requested`
- `position.tpsl_requested`
- `order.create_requested`
- `order.replace_requested`
- `order.cancel_requested`
- `trading.command_completed`

Audit gồm actor, username, symbol, side, type, qty, requestId, outcome và exchange IDs. Không ghi API key, secret, signed URL, signature, listenKey hoặc raw error chứa request headers.

Bảo vệ tải:

- Rate limit mutation theo IP + web user + account.
- Concurrency tối đa 1 mutation trên cùng `username|symbol|positionSide`; order khác symbol có thể song song giới hạn nhỏ.
- Global trading concurrency thấp, cấu hình được.
- Body limit hiện tại 100 KB giữ nguyên; batch tối đa 20.
- CSRF + Origin cho mọi mutation.
- MQTT broker TLS/auth/ACL: web publish request, TRADER subscribe; web subscribe response.

## 17. Validation matrix tối thiểu

### Position

- Không mở/đóng khi snapshot/sàn không đọc được.
- Không đóng quantity lớn hơn position hiện tại.
- Không cho percent ngoài `(0,100]`.
- Không cho zero/negative/NaN/infinity.
- Làm tròn theo step/tick và trả giá trị normalized trước execute.
- Không cho live action với row PAPER.
- Reverse yêu cầu cả hai permission.

### Order

- MARKET không có price.
- LIMIT bắt buộc price + quantity.
- STOP/TAKE_PROFIT limit bắt buộc trigger + limit.
- STOP_MARKET/TAKE_PROFIT_MARKET bắt buộc trigger.
- TRAILING bắt buộc callback rate trong range sàn.
- `closePosition` và quantity không cùng tồn tại.
- Reduce intent phải có position phù hợp hoặc trả lỗi.
- Cancel phải khớp username + symbol + order kind + ID.

## 18. Test bắt buộc

### 18.1 Unit web

- Permission/scope từng action.
- Decimal validation và field matrix.
- Idempotency double click.
- Không expose action ngoài allowlist.
- Retry không đổi action/payload.
- Sanitize command/audit response.

### 18.2 Unit bot

- Claim cùng idempotency key chỉ execute một lần.
- QoS duplicate chỉ re-ACK.
- Request hết hạn không execute.
- Target không thuộc RUN không execute.
- Qty/tick/step rounding.
- Close bắt buộc reduce-only đúng side.
- TP/SL không dùng quantity cùng closePosition.
- Sibling monitor không bị cancel-all.
- Timeout sau submit thành `unknown`, không retry.

### 18.3 Integration

- Web 202 → MQTT → fake exchange → terminal ACK → reconcile.
- TRADER offline → expired, không side effect.
- ACK đến trước HTTP response vẫn giữ terminal.
- Hai web instance dùng cùng outbox/idempotency.
- Hai TRADER nhận message nhưng chỉ owner execute.
- Restart TRADER giữa submitted và ACK vẫn recover receipt.
- Reverse partial success.
- Replace cancel thành công/create thất bại.
- User bị thu quyền trong lúc command queued: bot/web policy từ chối trước execute nếu chưa claimed.

### 18.4 E2E UI

- Viewer chỉ xem, không thấy mutation controls.
- Open/close user chỉ thấy đúng action.
- Confirm modal hiển thị đúng account/symbol/qty.
- Double click không tạo hai order.
- Pending → success/error/unknown hiển thị đúng.
- Order open chuyển sang history sau cancel/fill.

## 19. Observability

Metrics/log tối thiểu:

- Command count/latency theo action/status.
- MQTT publish/ACK timeout.
- Idempotency duplicate count.
- Exchange reject theo sanitized code.
- Unknown outcome count.
- Reconcile latency và mismatch count.
- User-stream freshness theo account.

Log luôn có `requestId`, `idempotencyKey` đã rút gọn, account, symbol, action, process role/instance. Không log credential.

Dashboard health thêm:

- Trading bridge connected.
- TRADER owner online theo username.
- User stream freshness.
- Command unknown/failed gần nhất.
- Order-history consumer lag.

## 20. Kế hoạch triển khai

### Phase A — Read-only Orders

1. Chuẩn hóa open regular/algo order từ Redis snapshot.
2. Thêm permission `orders.view` và scope.
3. Tab Order đang mở.
4. Collection event/history + consumer user-stream/reconcile.
5. Tab Lịch sử order + pagination/filter/backfill.

Không mutation trong phase này.

### Phase B — Cancel order

1. Durable trading receipt/idempotency.
2. Typed topic/action `ORDER_CANCEL`.
3. Cancel một order, sau đó batch cùng account.
4. Reconcile và audit.

Đây là mutation nhỏ nhất để chứng minh bridge production.

### Phase C — TP/SL

1. `POSITION_SET_TPSL` và cancel protective order.
2. Validation LONG/SHORT, quantity/closePosition.
3. Safe replace saga.
4. Hiển thị order confirmed từ exchange.

### Phase D — Close position

1. Market close 25/50/75/100.
2. Limit close.
3. Sibling impact preview và reconcile monitor.
4. Không thêm Reverse trong cùng PR.

### Phase E — Open position

1. Market/Limit manual order.
2. Precision/minNotional preview.
3. NOTPSL/manual monitoring behavior.
4. Optional attach monitor là phase con riêng.

### Phase F — Replace/Reverse và nâng cao

- ORDER_REPLACE saga.
- POSITION_REVERSE saga.
- Step-up auth, notification, saved presets nếu cần.

Mỗi phase phải có commit riêng ở cả repo liên quan, test và deploy độc lập. Không gom Read-only Orders với Open/Close trong một prompt.

## 21. Definition of done

Một phase mutation chỉ được coi hoàn thành khi:

1. UI không hiện action nếu thiếu permission.
2. API chặn permission và scope.
3. Bot validate target và payload lại.
4. Có durable idempotency, không chỉ Map RAM.
5. Có terminal result typed và trạng thái unknown/partial.
6. Có reconcile xác nhận trạng thái sàn.
7. Có audit sanitized.
8. Có unit + integration test cho duplicate/timeout/offline.
9. Không thay đổi PAPER, INVERT, sibling monitor, leftover volume ngoài scope.
10. Docs auth/RBAC, flows, API reference và feature spec được cập nhật theo implementation thật.

## 22. Prompt triển khai đề xuất cho Cursor

Không đưa toàn bộ spec vào một prompt. Dùng lần lượt:

### Prompt 1 — Read-only Orders

> Đọc `AGENTS.md`, `docs/trading-terminal-spec.md`, `docs/flows.md`, `docs/auth-rbac-spec.md` và source position hiện tại. Chỉ triển khai Phase A: tab Order đang mở và Lịch sử order read-only, permission `orders.view`, server pagination, normalized regular/algo order và Mongo read model. Không thêm mutation, không gọi Binance từ browser, không đổi position flow. Viết test, cập nhật docs, commit và push từng repo.

### Prompt 2 — Trading bridge durable

> Chỉ triển khai nền tảng mutation của Phase B: typed MQTT `trading/request/v1`, durable idempotency receipt, outbox typed result và fake-exchange integration test. Chưa bật nút cancel trên production UI. Không dùng raw Telegram command và không thêm dependency.

### Prompt 3 — Cancel order

> Triển khai `ORDER_CANCEL` theo Phase B trên nền bridge typed đã có. Bắt đầu một order, regular/algo tách rõ; kiểm tra permission/scope ở web và target ownership ở bot; reconcile sau cancel. Không implement cancel-all account, open/close position hoặc replace.

### Prompt 4 — TP/SL

> Triển khai Phase C đúng validation và safe replace saga trong spec. Không cancel-all theo symbol khi có sibling monitor. Không gửi `closePosition` cùng quantity. UI phải hiển thị order exchange-confirmed, test LONG/SHORT và duplicate request.

### Prompt 5 — Close position

> Triển khai Phase D, chỉ exchange-position close Market rồi Limit. Preview sibling monitors, dùng qty sàn, reduce-only, optimistic expected qty/version và reconcile. Không implement monitor-specific close hoặc Reverse.

### Prompt 6 — Open position

> Triển khai Phase E manual Market/Limit. Validate precision/min notional phía bot, durable idempotency và NOTPSL behavior. Không tự tạo monitor managed trừ khi có spec bổ sung.

## 23. Quyết định mặc định đã chốt

- Làm Read-only Orders trước mutation.
- Mutation chạy ở `binance-bot` TRADER qua typed MQTT.
- Mongo outbox + durable receipt, không Redis-only queue.
- Exchange position là cấp thao tác Close trong MVP.
- TP/SL là exchange protective order; không tự nhận là order của một monitor.
- Order history lưu read model Mongo từ user stream/reconcile.
- Không tự retry outcome chưa biết.
- Không dùng Telegram text contract cho trading API.

