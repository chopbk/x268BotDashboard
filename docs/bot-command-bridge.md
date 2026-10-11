# Contract: web-bot ↔ binance-bot command bridge

Spec cầu runtime giữa dashboard và process trader. Outbox + MQTT gửi lệnh + ACK Mongo (source of truth) + MQTT `command_response` phụ + `APPLY_CONFIG` + account runtime (load/unload/rename) — đối chiếu 2026-10-11. `LOAD/UNLOAD/RENAME_ACCOUNT` chỉ tạo nội bộ sau mutation account; `POST .../commands` chỉ nhận `APPLY_CONFIG`.

## 1. Mục tiêu và ranh giới

**Trong scope milestone này**

- Áp dụng config / signal / account đã ghi Mongo lên RAM bot (hot-reload).
- Status chỉ đọc: position, balance, monitor, orders, config runtime.
- UI typed `action` → server map sang lệnh Telegram nội bộ.
- ACK bền: bot ghi kết quả vào Mongo outbox theo `requestId` (UI không phụ thuộc subscribe MQTT).

**Ngoài scope**

- Mở/đóng lệnh sàn (`OPEN`/`CLOSE`/Market/Limit/Reverse).
- Start/stop/restart PM2 từ web.
- Redis request/response (ACK không dùng Redis RPC).

**Kiến trúc đã chốt**

| Quyết định | Giá trị |
|---|---|
| Config path | Mongo-first (REST hiện có) + MQTT `config/sync` reload |
| Runtime command | MQTT `new_command` / `config/sync` → đánh thức bot |
| Reply (source of truth) | Bot ghi Mongo `web_bot_commands` theo `requestId` |
| Reply (phụ / realtime) | MQTT `command_response` — web vẫn subscribe và apply nếu outbox chưa terminal |
| Apply config | Tự động sau khi lưu; offline → “Đã lưu DB — chờ áp dụng” + nút thử lại |
| Thành công | Chỉ khi outbox **terminal succeeded** khớp `env` + `requestId` — **không** coi publish MQTT = đã áp dụng |
| UI chờ ACK | Trả `requestId` ngay; client poll `GET .../commands/:requestId` (hỗ trợ `?waitMs=` chờ ngắn phía server) |

## 2. Chuỗi tổng thể

```
UI action
  → web API (auth + permission + scope + allowlist)
  → Mongo outbox (queued)
  → MQTT publish QoS 1 (published)          ← chỉ đánh thức bot
  → binance-bot TRADER/MONITOR xử lý
  → Bot ghi ACK vào Mongo outbox             ← source of truth
  → (phụ) MQTT command_response              ← web apply nếu chưa terminal
  → UI poll/wait GET outbox theo requestId
```

Config/signal/account mutation:

```
PATCH/POST Mongo (như hiện tại)
  → outbox action APPLY_CONFIG (hoặc tương đương)
  → MQTT config/sync { source, followers: [env vừa sửa, ...follower], requestId, ts }
  → TRADER/MONITOR reloadEnvs(followers)
  → Bot writeOutboxAck (received → running → terminal) trên web_bot_commands
  → (phụ) MQTT command_response cùng schema
```

`reloadEnvs` trong binance-bot reload **mọi** env trong mảng `followers`. Khi sửa config gốc, mảng bắt buộc gồm chính env vừa sửa rồi mới tới các follower `sync_from` bị ảnh hưởng. Chỉ gửi follower → account vừa sửa có thể giữ RAM cũ.

## 3. Kênh liên lạc

| Kênh | Hướng | Vai trò |
|---|---|---|
| MQTT `new_command` | web → trader | Gửi lệnh runtime (QoS 1) |
| MQTT `config/sync` | web → trader/monitor | Hot-reload / account_runtime (QoS 1) |
| Mongo `web_bot_commands` | bot → (web đọc) | **ACK source of truth** — bot `writeOutboxAck` |
| MQTT `command_response` | trader → web | ACK phụ; web `applyResponsePayload` nếu outbox chưa terminal |
| REST `GET .../commands/:id` | UI → web → Mongo | Poll/wait trạng thái (`?waitMs=` tùy chọn, max 30s) |

Broker / credentials: web-bot đọc cùng nguồn `mqtt-config` theo env `MQTT` (hoặc biến cấu hình tương đương trong `.env.example`). Không hard-code host.

**Invariant ACK**

1. Publish MQTT thành công ≠ bot đã áp dụng.
2. Mất subscribe MQTT / web restart giữa chừng **không** làm mất ACK nếu bot đã ghi Mongo.
3. Mongo write và MQTT apply cùng monotonic / idempotent theo `requestId` + role — không regress status.
4. `lastAckChannel`: `mongo_bot` (bot ghi) hoặc `mqtt` (web apply từ broker).

## 4. Outbox Mongo (`web_bot_commands`)

Mọi lệnh runtime (kể cả apply config) ghi outbox **trước** khi publish.

### 4.1 Trạng thái

```
queued → published → received → running → succeeded
                                         → failed
                                         → expired
```

| State | Ý nghĩa |
|---|---|
| `queued` | Đã lưu Mongo, chưa publish hoặc publish lỗi sẽ retry |
| `published` | Đã MQTT publish; chưa có ACK từ bot (Mongo chưa received+) |
| `received` | Bot đã ghi ACK nhận (`status: received`) |
| `running` | Bot đang xử lý (có thể nhiều message) |
| `succeeded` | Terminal thành công |
| `failed` | Terminal lỗi |
| `expired` | Hết deadline mà không có terminal (job web `markExpired`) |

Publish MQTT thành công **không** chuyển thẳng sang `succeeded`. ACK hợp lệ là bản ghi outbox đã được bot (hoặc web qua MQTT phụ) cập nhật monotonic.

### 4.2 Document (logic)

```json
{
  "requestId": "uuid-v4",
  "username": "bot-demo",
  "targetEnv": "DEMO_1",
  "action": "GET_POSITIONS",
  "params": {},
  "mappedCommand": "DEMO_1/P",
  "status": "queued",
  "terminal": false,
  "messages": [],
  "error": null,
  "actorUserId": "...",
  "createdAt": "...",
  "updatedAt": "...",
  "publishedAt": null,
  "expiresAt": "...",
  "attempt": 1,
  "lastAckChannel": "mongo_bot",
  "messages": [
    {
      "status": "received",
      "message": "...",
      "processRole": "TRADER",
      "ackChannel": "mongo_bot",
      "timestamp": 1791500000000
    }
  ]
}
```

- Unique index trên `requestId`.
- TTL hoặc job dọn bản ghi cũ (ví dụ 7–30 ngày) — chọn khi implement.
- Retry publish chỉ khi `queued` hoặc publish lỗi; không re-publish nếu đã `received`/`running` trừ khi có chính sách explicit (mặc định: không).
- Dedup phía bot: nếu nhận lại cùng `requestId` đã xử lý → chỉ re-ACK (ghi Mongo + MQTT phụ), không chạy lại side-effect.
- Field `lastAckChannel` / `messages[].ackChannel`: `mongo_bot` | `mqtt` — chỉ để quan sát, không dùng làm quyền.

### 4.3 Deadline

- Status đọc: mặc định 30s → `expired` nếu không terminal.
- Apply/reload: mặc định 30s.
- UI: mutation trả `apply.requestId` ngay; client `waitForApply` poll outbox (lần đầu `?waitMs=3000` phía server). Hết hạn → “Đã lưu DB — chờ áp dụng” + retry.

## 5. Request: web → bot (`new_command`)

Frontend **không** gửi chuỗi lệnh thô. Frontend gửi:

```json
{
  "action": "GET_POSITIONS",
  "targetEnv": "DEMO_1",
  "params": {}
}
```

Server tạo `requestId`, map allowlist → `mappedCommand`, ghi outbox, rồi publish:

```json
{
  "command": "DEMO_1/P",
  "cmdInfo": {
    "requestId": "uuid-v4",
    "source": "web",
    "targetEnv": "DEMO_1",
    "action": "GET_POSITIONS"
  }
}
```

### 5.1 Gate trên `responseCommand` (binance-bot)

Hiện tại:

```js
if (!cmdInfo.msgId) return;
```

Phải đổi thành:

```js
if (!cmdInfo?.msgId && !cmdInfo?.requestId) return;
```

Khi `cmdInfo.source === "web"` (hoặc có `requestId` và không có `chatId` Telegram hợp lệ):

- Gọi `publishCommandResponse` → **ghi Mongo outbox trước**, rồi publish MQTT `command_response` (phụ).
- **Không** gửi Telegram.
- Mỗi lần progress → một ACK (Mongo + MQTT); chỉ event cuối có `terminal: true`.

Telegram path giữ nguyên: có `msgId` (+ `chatId`) thì reply Telegram như cũ.

## 6. Response / ACK (Mongo outbox + MQTT phụ)

### 6.1 Payload chung (schema v1)

Cùng JSON cho Mongo write và MQTT `command_response`:

```json
{
  "version": 1,
  "requestId": "uuid-v4",
  "targetEnv": "DEMO_1",
  "status": "received|running|succeeded|failed",
  "terminal": true,
  "message": "text hiển thị / log",
  "error": null,
  "timestamp": 1791500000000,
  "processRole": "TRADER|MONITOR",
  "instanceId": "host-pid",
  "applied": ["DEMO_1"],
  "skipped": [],
  "failed": []
}
```

| Field | Quy tắc |
|---|---|
| `version` | Hiện tại `1` |
| `requestId` | Bắt buộc; khớp outbox |
| `targetEnv` | Account env đã xử lý |
| `status` | `received` khi bắt đầu; `running` cho progress; `succeeded`/`failed` khi xong |
| `terminal` | `true` chỉ khi kết thúc; UI chỉ lúc đó đóng request |
| `message` | Text an toàn hiển thị; không secret |
| `error` | `null` hoặc `{ "code", "message" }` |
| `timestamp` | ms epoch |
| `processRole` | `TRADER` hoặc `MONITOR` — chỉ chốt `APPLY_CONFIG` khi đủ `requiredRoles` (mặc định `TRADER`) |
| `instanceId` | Định danh process |
| `applied` | Env thực sự reload OK; `succeeded` mà thiếu `targetEnv` → coi failed |

### 6.2 Ai ghi gì

| Bên | Module | Việc |
|---|---|---|
| binance-bot | `publishCommandResponse` → `writeOutboxAck` | Update `web_bot_commands` (`lastAckChannel: mongo_bot`) |
| binance-bot | `publishCommandResponse` → MQTT | Publish topic `command_response` (phụ) |
| web-bot | `onResponse` → `applyResponsePayload` | Apply MQTT vào outbox nếu chưa terminal (`lastAckChannel: mqtt`) |
| web-bot | `GET .../commands/:requestId` | Đọc Mongo; `?waitMs=` (0–30000) chờ ngắn đến terminal |
| client | `waitForApply` | Poll outbox; lần đầu gửi `waitMs=3000` |

Ignore ACK nếu `requestId` không có trong outbox, hoặc `targetEnv` không khớp document. Status một chiều: `queued → published → received → running → succeeded|failed|expired`. Đánh `published` trước khi MQTT publish lệnh (tránh ACK nhanh bị ghi đè về published).

Một số lệnh gửi “đang xử lý…” rồi kết quả: bot phải emit ít nhất một `running`/`received` (`terminal: false`) và một terminal.

## 7. Action allowlist (Phase status + apply)

Chỉ các `action` sau được chấp nhận ở API. Mọi giá trị khác → `400`.

| `action` | Map nội bộ | Permission | Client API |
|---|---|---|---|
| `APPLY_CONFIG` | MQTT `config/sync` reload env đã load | `config.edit` + scope | `POST .../commands` + hook sau sửa config/signal |
| `LOAD_ACCOUNT` | MQTT `config/sync` `type=account_runtime` action=load | `config.edit` | **Nội bộ** — sau thêm/copy account |
| `UNLOAD_ACCOUNT` | `account_runtime` unload | `config.edit` | **Nội bộ** — sau gỡ account; outbox bắt buộc `previousAccounts` chứa env đã gỡ |
| `RENAME_ACCOUNT` | `account_runtime` rename | `config.edit` | **Nội bộ** — sau đổi tên; `fromEnv` + `previousAccounts` từ route, không từ client tùy ý |

Mục tiêu bridge: đồng bộ config / signal / account web ↔ bot. Không dùng làm cổng lệnh status Telegram (`P`/`B`…). Retry giữ nguyên `action` + payload an toàn từ outbox cũ, gắn `retryOfRequestId`.

Ghi chú quyền:

- **Không** dùng `bots.operate` cho status chỉ đọc.
- `bots.operate` dành cho start/stop process (milestone sau).
- Mở/đóng lệnh: permission trading riêng, **không** thêm vào allowlist milestone này.
- Scope bot/env giống các route bots/positions hiện có.

`APPLY_CONFIG` params gợi ý:

```json
{
  "action": "APPLY_CONFIG",
  "targetEnv": "DEMO_1",
  "params": {
    "followers": ["DEMO_1", "DEMO_1_COPY"]
  }
}
```

Server tự tính `followers = [targetEnv, ...envs có sync_from === targetEnv]` (và chain nếu cần parity với `fanoutFromSource`). Client không được tự ý thu hẹp bỏ `targetEnv`.

**Invariant:** schema `account_configs` trên web phải khai báo `sync_from` (và field sync liên quan). Với `mongoose.set("strictQuery", true)`, query field ngoài schema bị strip → `find({ sync_from })` thành `find({})` và MQTT gửi cả database.

## 8. API bề mặt (dự kiến — implement Phase 1+)

Chi tiết path chốt khi code; skeleton:

| Method | Path | Permission | Việc |
|---|---|---|---|
| (hook) | Sau `PATCH .../configs/:env`, `POST .../signal-config`, copy/bulk/account mutate | quyền ghi tương ứng | Tạo outbox `APPLY_CONFIG`, publish `config/sync` |
| `POST` | `/api/bots/:username/accounts/:env/commands` | theo action allowlist | Tạo outbox + publish `new_command` |
| `GET` | `/api/bots/:username/commands/:requestId` | actor của lệnh hoặc admin | Đọc outbox + messages; query `waitMs` (ms, max 30000) chờ terminal ngắn |
| `POST` | `/api/bots/:username/accounts/:env/commands/:requestId/retry` | quyền ghi gốc | Chỉ khi mutation đã lưu DB mà apply `failed`/`expired` |

Response lưu config:

```json
{
  "config": { "...": "như hiện tại" },
  "apply": {
    "requestId": "uuid",
    "status": "published",
    "terminal": false
  }
}
```

UI:

- `succeeded` + terminal → “Đã áp dụng lên bot”.
- Bot offline / `expired` / `failed` sau khi Mongo đã ghi → “Đã lưu DB — chờ áp dụng” + nút Thử lại.
- Không báo “đã áp dụng” chỉ vì MQTT publish OK.

## 9. Thay đổi trên binance-bot

1. `responseCommand`: gate `msgId || requestId`; nhánh web → `publishCommandResponse`.
2. `publishCommandResponse`: **ghi Mongo outbox trước** (`command-outbox-ack.js` / `writeOutboxAck`), rồi MQTT `command_response`.
3. Helpers status monotonic khớp web (`command-outbox-status.js`).
4. Khi nhận `new_command` / `config/sync` có `requestId`: emit sớm `received`; dedupe theo `requestId` → re-ACK không side-effect.
5. Progress / success / fail map sang `status` + `terminal` + `applied`.
6. `config/sync`: giữ schema; web gửi đúng mảng env cần reload (gồm env vừa sửa).
7. Không viết lại validator kênh, PAPER/INVERT, sibling monitor, leftover, NOTPSL.
8. Test: `command-outbox-ack.test.js`, `command-response.test.js`.

## 10. Thay đổi trên web-bot

1. MQTT client (publish lệnh; subscribe `command_response` vẫn giữ làm kênh phụ).
2. Model + service outbox — **source of truth trạng thái apply**.
3. Allowlist mapper `action` → command / sync payload.
4. Hook sau mutation config/signal/account.
5. UI: trả `requestId` ngay; `waitForApply` poll Mongo (`?waitMs=`); retry khi failed/expired.
6. `GET .../commands/:requestId?waitMs=` chờ ngắn phía server (max 30s).
7. Test: quyền allow/deny; ignore response sai `requestId`; không mark applied khi chỉ `published`; status monotonic / role ACK.

## 11. Thứ tự triển khai

1. Contract này (docs).
2. Mongo command outbox + MQTT client ở web-bot.
3. MQTT response theo `requestId` ở binance-bot.
4. Config hot-reload (`APPLY_CONFIG` + UI).
5. **ACK Mongo outbox** (`writeOutboxAck`) + UI poll/`waitMs` — source of truth (done 2026-10-11).
6. Status chỉ đọc (allowlist Phase 2) — nếu cần.
7. Account/signal runtime edge cases.
8. Sau cùng mới cân nhắc lệnh giao dịch (allowlist riêng + permission riêng). Không dùng MQTT ACK làm nguồn chốt.

## 12. Rủi ro và invariant

- Ai publish được broker là có thể gửi `new_command` → chỉ process web-bot publish; hạn chế ACL broker nếu được.
- `ENV` không nằm trên process `RUN` đang sống → timeout/`expired`, không giả succeeded.
- `PUBLISH_COMMAND` Telegram + local emit có thể double-exec trên path Telegram; path web dùng `requestId` dedupe, không phụ thuộc Telegram chat.
- Không tin `action`/command từ client ngoài allowlist.
- Không trả API key, raw MQTT password, hay toàn bộ `cmdInfo` nội bộ ra browser vượt mức cần thiết (`requestId`, `status`, `message`, `error`).
