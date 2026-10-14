# Spec: Terminal Futures đa sàn — Bybit, Aster và OKX

## Mục tiêu

Terminal của `web-bot` phải quản lý futures account thuộc Binance, Bybit, Aster và OKX (key Mongo hiện dùng `okex`) với cùng mức an toàn: xem vị thế/order/TP-SL, refresh sổ sàn, mở, đóng, reverse, đặt/sửa/hủy order và TP-SL/trailing khi sàn đó hỗ trợ.

Đây không phải chỉ là cho phép chọn exchange trong form User API. Một account Bybit/Aster/OKX phải có dữ liệu live, receipt, permission, idempotency, audit và cảnh báo stale giống account Binance. Không hiển thị nút giao dịch nếu adapter không xác nhận capability đó.

Ví dụ: account `DEMO_1` có `exchange: "okex"`, instrument `BTC-USDT-SWAP`, long 3 contract. Người có quyền `positions.close` bấm đóng 50%. Web xác minh chính xác vị thế OKX, chuyển 50% sang số contract hợp lệ, gửi close reduce-only theo API OKX, ghi `trading_receipts`, sau đó reconcile sổ OKX. Không gửi endpoint/format Binance cho account này.

## Hiện trạng (implementation)

- Adapter factory: `server/src/lib/exchanges/` (`registry`, `factory`, `*-adapter`, `normalizers`, `rate-limiters`, `errors`).
- `direct-trading.js` / `position-feed.js` / `position-live.js` đi qua `getExchangeAdapter(account)` — không `switch(exchange)` ở route.
- **Phase 1 đã bật:** Binance full mutation + history; Bybit / Aster / OKX `snapshot: true`, mọi mutation capability `false`.
- Redis `wb:ex:<account>`: migration read hỗ trợ `algoOrders` → `conditionalOrders`; thiếu `exchange` chỉ mặc định binance khi account là binance/unknown; non-Binance thiếu exchange → reconcile.
- Identity merge: `account|exchange|instrumentId|side|mode|positionIdx`. Monitor không resolve được exchange → `unknown`, không merge với sàn thật.
- UI Terminal: badge exchange, filter sàn, hiển thị contracts / instrumentId.
- `binance-bot` wrapper không thay thế adapter web; không bật mutation Bybit/Aster/OKX chỉ vì bot có wrapper.

## Phạm vi

### Trong phạm vi

- USDT/USDC linear perpetual futures mà API account và adapter hỗ trợ.
- Read-only: live position, mark, uPnL, open orders, conditional/TP-SL/trailing orders, balance, refresh/reconcile, status source/staleness.
- Mutation từ Terminal: open, close market/limit, reverse, tạo/hủy/sửa regular order, set/cancel TP-SL và trailing nếu sàn hỗ trợ.
- Dùng Redis/Mongo/REST và receipt hiện có, giữ toàn bộ auth/RBAC/CSRF/audit/idempotency hiện hành.

### Ngoài phạm vi giai đoạn này

- Spot, options, inverse/coin-margined contracts, copy trading và transfer nội bộ sàn.
- Tự thêm API key từ browser, hiển thị secret, hoặc để browser gọi signed exchange API.
- Đổi logic mở lệnh, monitor SL/TP, PAPER, INVERT, sibling/leftover position của `binance-bot`.
- Khẳng định parity khi một exchange chưa có đủ API capability. UI phải báo unsupported thay vì giả thành công.

## Thuật ngữ và canonical model

| Khái niệm | Quy ước |
| --- | --- |
| `exchange` | lowercase: `binance`, `bybit`, `aster`, `okex`. UI hiển thị **OKX**, backend vẫn dùng `okex` để tương thích Mongo/wrapper cũ. |
| `account` | `user_apis.username` / `account_configs.env`; một account thuộc đúng một exchange. |
| `symbol` | canonical display symbol do adapter trả về. Không tự thêm `USDT` cho OKX. |
| `instrumentId` | định danh sàn nguyên gốc, ví dụ `BTCUSDT` hoặc `BTC-USDT-SWAP`; luôn gửi lại adapter để đặt/hủy lệnh. |
| `side` | canonical `LONG`, `SHORT`, hoặc `BOTH` (one-way). Không suy ra long/short từ dấu qty nếu API đã trả side. |
| `quantity` | canonical quantity để hiển thị; thêm `quantityUnit: base | contracts`. Không dùng qty contract OKX như base asset khi tính volume. |
| `notional` | USDT/USDC equivalent do adapter trả về hoặc `abs(baseQty) × mark`; `null` nếu thiếu conversion. |
| `orderKind` | `regular` hoặc `conditional`. Không expose `algo` như khái niệm UI toàn cục. |

Mọi position/order public có tối thiểu:

```json
{
  "account": "DEMO_1",
  "exchange": "okex",
  "symbol": "BTC-USDT-SWAP",
  "instrumentId": "BTC-USDT-SWAP",
  "side": "LONG",
  "quantity": "3",
  "quantityUnit": "contracts",
  "baseQuantity": "0.03",
  "entryPrice": "60000",
  "markPrice": "60100",
  "unrealizedPnl": "3",
  "leverage": "5",
  "marginMode": "cross"
}
```

`baseQuantity`, `notional`, TP/SL, trailing và history là nullable. Client phải hiển thị `—` và warning dữ liệu thiếu, không thay bằng `0` rồi suy ra an toàn.

## Kiến trúc adapter

Tạo interface nội bộ `ExchangeFuturesAdapter`; không để route/UI chọn endpoint exchange bằng `switch` rải rác.

```js
const adapter = await getExchangeAdapter(account);

adapter.capabilities();
adapter.getSnapshot({ liveOnly });
adapter.getHistoryDetails({ positions });
adapter.getBalance();
adapter.getMarkPrices(instruments);
adapter.getInstrument(instrumentId);
adapter.openPosition(input);
adapter.closePosition(input);
adapter.reversePosition(input);
adapter.createOrder(input);
adapter.cancelOrder(input);
adapter.replaceOrder(input);
adapter.setTpsl(input);
adapter.cancelTpsl(input);
```

Adapter chịu trách nhiệm:

1. Lấy credential chỉ từ server-side `user_apis`; không log key/secret/passphrase.
2. Ký request, clock/recv-window, timeout, error normalization và per-exchange rate limit.
3. Chuẩn hóa snapshot/order/error vào model trên.
4. Lấy instrument metadata trước mutation: tick size, lot step, min/max qty, contract value, min notional, leverage/margin/position mode capability.
5. Round **down** quantity close/open theo rule sàn; reject nếu sau round bằng 0 hoặc dưới min rule.
6. Dùng `reduceOnly`/`closeOnTrigger`/position index/margin mode đúng exchange. Không lấy logic Binance làm default.
7. Trả `exchangeRequestId`, order id(s), normalized order/position, capability/error code để receipt/audit sử dụng.

Không thêm SDK/dependency. Dùng `fetch`, `crypto` và helper HTTP hiện có; client secret không đi qua React/API response/audit log.

### Registry và capability

Registry là source of truth:

```js
{
  binance: { displayName: "Binance Futures", supports: { snapshot: true, history: true, open: true, close: true, reverse: true, regularOrder: true, conditionalOrder: true, tpsl: true, trailing: true } },
  bybit:   { displayName: "Bybit Linear", supports: { /* xác minh bằng adapter test */ } },
  aster:   { displayName: "Aster Futures", supports: { /* xác minh bằng adapter test */ } },
  okex:    { displayName: "OKX Swap", supports: { /* xác minh bằng adapter test */ } }
}
```

`capabilities()` là per-account vì hedge/one-way, unified/classic account, margin mode và account permissions có thể khác nhau. Backend bắt buộc kiểm tra capability trước action. UI chỉ dùng capability response để render control, không phải cơ chế bảo vệ.

Giai đoạn read-only được coi là xong cho mỗi exchange khi `snapshot: true`. Mutation chỉ được bật riêng sau testnet/sandbox hoặc account thử nghiệm và acceptance criteria của exchange đó pass.

## Contract read/live data

### Snapshot source và Redis

Ưu tiên theo thứ tự:

1. Snapshot normalized do `binance-bot` ghi Redis, nếu `exchange` khớp account và fresh.
2. MQTT reconcile tới bot, nếu bot process sở hữu account/exchange và reply contract mới.
3. REST adapter của web server.

Snapshot Redis `wb:ex:<account>` giữ compatibility key cũ nhưng body bắt buộc có:

```json
{
  "source": "exchange",
  "exchange": "bybit",
  "account": "DEMO_1",
  "complete": true,
  "at": "2026-10-14T00:00:00.000Z",
  "positions": [],
  "openOrders": [],
  "conditionalOrders": [],
  "balance": null,
  "version": 12
}
```

`algoOrders` cũ được đọc như alias của `conditionalOrders` trong migration; API response mới trả `conditionalOrders`. Không gộp order theo `symbol` nếu bỏ qua `exchange`, `instrumentId`, `side`, `positionIdx` hoặc `marginMode`.

Redis Lua/version fence hiện có phải tiếp tục bảo vệ REST chậm ghi đè delta mới. Redis delta/source từ bot thiếu `exchange` thì chỉ được chấp nhận cho account mà `user_apis.exchange === binance` trong migration. Với Bybit/Aster/OKX, thiếu exchange là invalid/stale, web phải REST reconcile thay vì gán nhầm dữ liệu.

### Position identity, monitor và PnL

Identity position web đổi thành `account + exchange + instrumentId + side` (thêm `positionIdx` khi adapter cần). Mọi join `positions.js`, Position Case, Redis book, alert/sort/client key và WebSocket patch phải dùng identity này.

`monitor_positions` cũ không có `exchange` đáng tin cậy. Khi hiển thị monitor, derive exchange từ account `user_apis`/futuresClient metadata; nếu không resolve được thì gắn `exchange: unknown`, không merge với exchange position. Không tự migrate/update monitor records chỉ vì mở trang.

Hai lớp qty của bot vẫn giữ nguyên: own monitor qty khác exchange qty. Với `quantityUnit: contracts`, drift/ownership chỉ so sánh cùng unit/instrument/side; dùng `baseQuantity` hoặc normalized `notional` cho UI volume. Không close/cancel/nhận leftover từ web khi identity không đủ chắc chắn.

### Price, balance, history

- Mark/price đổi từ Binance public price sang `adapter.getMarkPrices()` hoặc snapshot mark. Không gọi Binance public API cho Bybit/Aster/OKX symbols.
- Wallet/balance dùng `adapter.getBalance`; không ghi đè `wb:bal` của account bằng schema Binance-specific.
- `history/details` là optional capability. Khi chưa hỗ trợ, Position Case nói “Sàn chưa hỗ trợ lịch sử trên web”, nhưng live position/order vẫn dùng được.
- TTL/staleness/WS refresh giữ semantics hiện tại: source position stale tách khỏi timestamp mark price; REST 429 chỉ cooldown exchange+account đó, không block sàn/account khác.

## Contract mutation

Routes hiện có giữ URL và permission. Thêm `exchange` vào target/receipt public; server suy exchange từ account credential, không tin exchange browser gửi.

| Action | Quy tắc chung |
| --- | --- |
| `POSITION_OPEN` | Validate instrument metadata, side/mode, quantity unit, min/max and leverage. Không tự set hedge mode. |
| `POSITION_CLOSE` | Re-fetch position exact identity ngay trước submit; close partial/full theo exchange rounding; enforce reduce-only/close semantics. |
| `POSITION_REVERSE` | Close xác nhận thành công trước khi open opposite. Không open nếu close ambiguous/timeout. |
| `ORDER_CREATE/REPLACE` | `replace` = cancel confirmed old order rồi create new; hỗ trợ native amend chỉ khi adapter test và preserve reduce-only/trigger fields. |
| `ORDER_CANCEL` | Cancel đúng `orderKind`, instrument and exchange order id. Không fallback thử endpoint sàn khác hoặc kind khác. |
| `POSITION_SET_TPSL` | Adapter map TP/SL native position-level hay conditional close order. Response phải ghi rõ `protectionMode`. |
| `POSITION_CANCEL_TPSL` | Chỉ cancel IDs được adapter snapshot xác nhận thuộc target; không cancel-all symbol mặc định. |

Request body có thể chứa `symbol`, `side`, quantity/price/TP/SL nhưng backend canonicalize qua current snapshot + instrument metadata. Một mutation yêu cầu:

- exact account scope và permission hiện có;
- CSRF, rate limit, idempotency receipt hiện có;
- expected position/order fingerprint (`version`, exchange order id, qty/side) cho close/cancel/replace/TP-SL;
- audit chỉ metadata/redacted diff, không raw signed request/secret;
- reconcile immediately after accepted response. Nếu reconcile fail, receipt là `accepted_unreconciled`, không tự báo succeeded state từ UI.

Không dùng endpoint Binance `/fapi/*`, `algoId`, `positionSide` hoặc `workingType` làm public contract đa sàn. Những field này chỉ sống trong adapter Binance. Public contract dùng canonical `orderKind`, `side`, `trigger`, `triggerSource` (`mark | last | index`), `reduceOnly`, `closeOnTrigger`, `quantityUnit`.

## Yêu cầu từng exchange

### Bybit V5 Linear

- Scope `category=linear`; detect `UNIFIED`/account mode trước balance/position request.
- Preserve/resolve `positionIdx` cho hedge mode; reject mutation nếu position index ambiguous.
- Normalize `Buy`/`Sell` thành `LONG`/`SHORT`, `size`, `avgPrice`, `markPrice`, `unrealisedPnl`, leverage, order/stop-order IDs.
- TP/SL native position-level và conditional orders phải được phân biệt để UI không hứa cancel một order ID không tồn tại.
- Thử testnet trước live; clock/signature/recvWindow errors phải có error code sanitized.

### Aster Futures

- Không giả định Aster hoàn toàn Binance-compatible chỉ vì wrapper hiện dùng naming Binance.
- Tạo adapter riêng dựa trên API được xác minh tại thời điểm implementation; dùng contract/instrument metadata của Aster cho tick/step/margin/position mode.
- Chỉ reuse Binance signing/order mapper sau khi test chứng minh endpoint, signature, order fields, conditional order and response semantics tương thích.
- Nếu Aster chưa hỗ trợ một capability qua API, expose read-only với capability false, không fallback Binance endpoint.

### OKX Swap (`okex`)

- Scope `instType=SWAP`; giữ đầy đủ `instId`, ví dụ `BTC-USDT-SWAP`.
- Distinguish contract count `pos` from base quantity bằng `ctVal`, `ctMult`/instrument metadata. Close 50% theo contract rounded down.
- Preserve `posSide` (`long`, `short`, `net`) và `tdMode` (`cross`, `isolated`). Reject if account mode makes target ambiguous.
- Regular/conditional/TP-SL use đúng API family/order id của OKX. Không coi `ordId` là Binance `orderId` hay dùng `algoId` Binance.
- Map OKX error code/message, passphrase signing and timestamp failures to sanitized API errors.

## API response và UI

`GET /api/positions`, `/refresh`, Position Case và WebSocket snapshot thêm:

```json
{
  "exchange": "bybit",
  "exchangeDisplay": "Bybit Linear",
  "capabilities": { "close": true, "tpsl": true, "trailing": false },
  "quantityUnit": "base",
  "instrumentId": "BTCUSDT",
  "source": "redis|mqtt|rest",
  "sourceError": null
}
```

Terminal cần:

- badge exchange tại account, row, detail, order và receipt;
- filter exchange và warning source stale/unsupported capability;
- format symbol/quantity theo adapter metadata; hiển thị contracts/base theo label;
- disable action có lý do cụ thể từ backend capability; không dùng câu “Chỉ hỗ trợ Binance futures” cho account được support;
- show `protectionMode` cho TP/SL: position-level vs conditional order;
- preserve filters/selection/WS route keys khi cùng symbol trên các sàn khác nhau.

User API page vẫn chỉ trả `hasApiKey`, `hasApiSecret`, `hasPassword`; password/passphrase cần cho OKX có thể set/update nhưng không return/audit. Nhãn form theo exchange: OKX yêu cầu passphrase; Bybit/Aster không tự yêu cầu passphrase trừ registry adapter xác nhận.

## Error, rate limit và observability

- Queue/retry/cooldown theo `{ exchange, account }`; mỗi adapter định nghĩa cost/concurrency/retry-after parsing. Không dùng `enqueueBinanceRest` cho sàn khác.
- `401/403` credential permission, `429` rate limit, timeout/network, validation/instrument, insufficient margin và exchange rejection được normalize thành code public ổn định + HTTP status phù hợp.
- Không retry mutation thiếu idempotency exchange khi timeout sau submit. Mark receipt `unknown`/`accepted_unreconciled`, query order/status by client request id nếu exchange hỗ trợ, rồi mới kết luận.
- Log/audit ghi exchange, account, action, instrument, order IDs, request/receipt IDs, duration, result category. Không ghi secret, signature, passphrase, raw Authorization header hay signed payload.
- Dashboard/runtime log cần filter theo exchange để lỗi Bybit/OKX/Aster không bị gộp là Binance error.

## Migration và rollout

1. Thêm canonical model, adapter registry và fixture contract; không đổi behavior Binance.
2. Update Redis snapshot writer/reader and position identity. Migration read hỗ trợ `algoOrders` cũ và implicit Binance snapshots; write mới luôn include exchange.
3. Ship read-only Bybit → Aster → OKX, mỗi exchange dùng account test riêng. So sánh snapshot UI với exchange UI trước khi bật mutation.
4. Bật mutation từng action per exchange qua capability registry, bắt đầu close/cancel, sau đó open/regular order, TP-SL, trailing/reverse cuối cùng.
5. Chỉ bật production action sau testnet/sandbox khi có, rồi test manual account nhỏ với checklist. Có feature flag server-side per exchange/action; không được browser điều khiển flag.
6. Không migrate monitor records hàng loạt. Backfill exchange chỉ sau report read-only, có backup và dry-run.

Rollback: tắt server-side capability/action của exchange. Read-only snapshot cũ vẫn hoạt động; không xóa Redis/monitor/order records và không gửi lệnh cancel/close để rollback UI.

## Test bắt buộc

Mọi test dùng fixture giả, không dùng API key hoặc account thật.

1. Adapter contract tests cho Binance/Bybit/Aster/OKX: signing request mocked, timeout/429/error normalization, snapshot normalized, symbol/instrument, side, price/qty/contract conversion.
2. Position merge tests: cùng `BTCUSDT` trên Binance và Bybit không merge; OKX contract qty không tính như base qty; monitor unknown exchange không attach nhầm.
3. Redis protocol tests: legacy Binance snapshot đọc được; non-Binance thiếu exchange bị stale/reconcile; version fence không bị REST cũ đè.
4. Trading tests per enabled action: validation/min step, reduce-only, partial close, one-way/hedge ambiguity, cancel exact order kind, TP/SL mapping and idempotency concurrent request.
5. Authorization tests: scope/permission server-side giống Binance; client không chọn được exchange khác credential account; API/public receipt/audit không lộ secret/passphrase.
6. UI tests/build: badge/filter/capability disabled reason and receipt exchange; `npm --prefix server test` và `npm --prefix client run build` pass.

## Acceptance criteria

- Account Bybit, Aster, OKX hiển thị đúng exchange/instrument/side/qty, không bị merge với Binance position cùng symbol.
- Refresh position không gọi Binance endpoint cho non-Binance account.
- Người không có quyền không thể đọc/mutate account của sàn khác qua URL/API.
- Một partial close OKX rounds theo contract metadata and uses exact long/short target; receipt/reconcile phản ánh kết quả hoặc `accepted_unreconciled`.
- TP/SL UI chỉ bật khi adapter capability pass và nói rõ position-level/conditional order.
- Aster không gọi Binance endpoint trừ capability test đã xác minh explicitly rằng endpoint tương thích.
- Binance regression suite pass; Binance behavior/Redis compatibility and sibling/leftover semantics không đổi.

## File/đường đi dự kiến

| Layer | Điểm sửa chính |
| --- | --- |
| Adapter | `server/src/lib/exchanges/` mới; registry/factory; migrate Binance client vào adapter hoặc wrap adapter Binance hiện có |
| Live feed | `position-feed.js`, `position-live.js`, queue per exchange, `exchange-book.lua` nếu snapshot schema đổi |
| Trading | `direct-trading.js`, `trading-bridge.js`, symbol/instrument helper, receipt model/response |
| Position view | `positions.js`, `position-case.js`, order normalization, WebSocket/live cache |
| UI | `TerminalPage`, `PositionsPage`, order/TP-SL dialogs, User API credential form |
| Docs/tests | `architecture.md`, `flows.md`, `api-data-reference.md`, terminal spec, adapter/position/trading tests |

Khi triển khai, giữ patch nhỏ theo exchange/capability; không viết lại position monitor hoặc generic hóa wrapper bot đang chạy chỉ để phục vụ UI.
