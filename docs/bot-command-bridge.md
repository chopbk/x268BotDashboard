# Contract: web-bot ↔ binance-bot command bridge

Spec cầu runtime giữa dashboard và process trader. Phase 1 (outbox + MQTT `command_response` + `APPLY_CONFIG`) đã có implementation — đối chiếu ngày 2026-10-10. Status action allowlist đã map sẵn; endpoint command đã mở, UI status Phase 2 chưa làm.

## 1. Mục tiêu và ranh giới

**Trong scope milestone này**

- Áp dụng config / signal / account đã ghi Mongo lên RAM bot (hot-reload).
- Status chỉ đọc: position, balance, monitor, orders, config runtime.
- UI typed `action` → server map sang lệnh Telegram nội bộ.

**Ngoài scope**

- Mở/đóng lệnh sàn (`OPEN`/`CLOSE`/Market/Limit/Reverse).
- Start/stop/restart PM2 từ web.
- Redis request/response.

**Kiến trúc đã chốt**

| Quyết định | Giá trị |
|---|---|
| Config path | Mongo-first (REST hiện có) + MQTT `config/sync` reload |
| Runtime command | MQTT `new_command` → TRADER `command/{ENV}` |
| Reply | MQTT topic `command_response` (không Redis RPC) |
| Apply config | Tự động sau khi lưu; offline → “Đã lưu DB — chờ áp dụng” + nút thử lại |
| Thành công | Chỉ khi ACK terminal từ đúng `env` + `requestId` — **không** coi publish MQTT = đã áp dụng |

## 2. Chuỗi tổng thể

```
UI action
  → web API (auth + permission + scope + allowlist)
  → Mongo outbox (queued)
  → MQTT publish QoS 1 (published)
  → binance-bot TRADER
  → MQTT command_response (received|running|succeeded|failed)
  → web cập nhật outbox
  → UI poll/WS theo requestId
```

Config/signal/account mutation:

```
PATCH/POST Mongo (như hiện tại)
  → outbox action APPLY_CONFIG (hoặc tương đương)
  → MQTT config/sync { source, followers: [env vừa sửa, ...follower], ts }
  → TRADER/MONITOR reloadEnvs(followers)
  → command_response terminal (hoặc ACK riêng cùng schema)
```

`reloadEnvs` trong binance-bot reload **mọi** env trong mảng `followers`. Khi sửa config gốc, mảng bắt buộc gồm chính env vừa sửa rồi mới tới các follower `sync_from` bị ảnh hưởng. Chỉ gửi follower → account vừa sửa có thể giữ RAM cũ.

## 3. MQTT topics

| Topic | Hướng | QoS | Ghi chú |
|---|---|---|---|
| `new_command` | web → trader | 1 | Payload JSON; trader đã subscribe |
| `config/sync` | web → trader/monitor | 1 | Payload hiện có `{ source, followers, ts }` |
| `command_response` | trader → web | 1 | Topic mới; web subscribe |

Broker / credentials: web-bot đọc cùng nguồn `mqtt-config` theo env `MQTT` (hoặc biến cấu hình tương đương trong `.env.example`). Không hard-code host.

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
| `published` | Đã MQTT publish; chưa có ACK từ bot |
| `received` | Bot báo đã nhận (`status: received`) |
| `running` | Bot đang xử lý (có thể nhiều message) |
| `succeeded` | Terminal thành công |
| `failed` | Terminal lỗi |
| `expired` | Hết deadline mà không có terminal |

Publish MQTT thành công **không** chuyển thẳng sang `succeeded`.

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
  "attempt": 1
}
```

- Unique index trên `requestId`.
- TTL hoặc job dọn bản ghi cũ (ví dụ 7–30 ngày) — chọn khi implement.
- Retry publish chỉ khi `queued` hoặc publish lỗi; không re-publish nếu đã `received`/`running` trừ khi có chính sách explicit (mặc định: không).
- Dedup phía bot: nếu nhận lại cùng `requestId` đã xử lý → chỉ re-ACK, không chạy lại side-effect.

### 4.3 Deadline

- Status đọc: mặc định 30s → `expired` nếu không terminal.
- Apply/reload: mặc định 30s.
- UI: trong lúc chờ hiện trạng thái outbox; hết hạn → “Đã lưu DB — chờ áp dụng” (với mutation) hoặc lỗi timeout (với status).

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

- Publish MQTT `command_response` theo schema mục 6.
- **Không** gửi Telegram.
- Mỗi lần handler gọi `responseCommand` / progress message → một event MQTT; chỉ event cuối có `terminal: true` (hoặc đánh dấu rõ message trung gian `terminal: false`).

Telegram path giữ nguyên: có `msgId` (+ `chatId`) thì reply Telegram như cũ.

## 6. Response: bot → web (`command_response`)

```json
{
  "version": 1,
  "requestId": "uuid-v4",
  "targetEnv": "DEMO_1",
  "status": "received|running|succeeded|failed",
  "terminal": true,
  "message": "text hiển thị / log",
  "error": null,
  "timestamp": 1791500000000
}
```

| Field | Quy tắc |
|---|---|
| `version` | Hiện tại `1` |
| `requestId` | Bắt buộc; khớp outbox |
| `targetEnv` | Account env đã xử lý |
| `status` | `received` khi bắt đầu; `running` cho progress; `succeeded`/`failed` khi xong |
| `terminal` | `true` chỉ khi kết thúc; web chỉ lúc đó đóng request |
| `message` | Text an toàn hiển thị; không secret |
| `error` | `null` hoặc `{ "code", "message" }` |
| `timestamp` | ms epoch |

Web ignore response nếu `requestId` không có trong outbox, hoặc `targetEnv` không khớp document.

Một số lệnh Telegram gửi “đang xử lý…” rồi kết quả: bot phải emit ít nhất một `running`/`received` (`terminal: false`) và một terminal.

## 7. Action allowlist (Phase status + apply)

Chỉ các `action` sau được chấp nhận ở API. Mọi giá trị khác → `400`.

| `action` | Map nội bộ | Permission | Phase |
|---|---|---|---|
| `APPLY_CONFIG` | MQTT `config/sync` (không qua `/SC` trừ khi cần) | `config.edit` + scope | 1 |
| `GET_RUNTIME_CONFIG` | `{ENV}/C` hoặc tương đương đọc config RAM | `config.view` + scope | 2 |
| `GET_POSITIONS` | `{ENV}/P` | `positions.view` + scope | 2 |
| `GET_BALANCE` | `{ENV}/B` | `statistics.view` + scope | 2 |
| `GET_MONITORS` | `{ENV}/M` | `positions.view` + scope | 2 |
| `GET_ORDERS` | `{ENV}/OD` | `positions.view` + scope | 2 |

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

## 8. API bề mặt (dự kiến — implement Phase 1+)

Chi tiết path chốt khi code; skeleton:

| Method | Path | Permission | Việc |
|---|---|---|---|
| (hook) | Sau `PATCH .../configs/:env`, `POST .../signal-config`, copy/bulk/account mutate | quyền ghi tương ứng | Tạo outbox `APPLY_CONFIG`, publish `config/sync` |
| `POST` | `/api/bots/:username/accounts/:env/commands` | theo action allowlist | Tạo outbox + publish `new_command` |
| `GET` | `/api/bots/:username/commands/:requestId` | actor của lệnh hoặc admin | Đọc outbox + messages |
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

## 9. Thay đổi tối thiểu trên binance-bot

1. `responseCommand`: gate `msgId || requestId`; nhánh web → MQTT `command_response`.
2. Khi nhận `new_command` có `requestId`: emit sớm `status: received` (optional nhưng nên có); dedupe theo `requestId`.
3. Progress / success / fail map sang `status` + `terminal`.
4. `config/sync`: giữ schema; đảm bảo web gửi đúng mảng env cần reload (gồm env vừa sửa).
5. Không viết lại validator kênh, PAPER/INVERT, sibling monitor, leftover, NOTPSL.

## 10. Thay tự tối thiểu trên web-bot

1. MQTT client (publish `new_command` / `config/sync`, subscribe `command_response`).
2. Model + service outbox.
3. Allowlist mapper `action` → command / sync payload.
4. Hook sau mutation config/signal/account.
5. UI trạng thái apply + retry.
6. Test: quyền allow/deny theo action; ignore response sai `requestId`; không mark applied khi chỉ `published`.

## 11. Thứ tự triển khai

1. Contract này (done khi merge docs).
2. Mongo command outbox + MQTT client ở web-bot.
3. MQTT response theo `requestId` ở binance-bot.
4. Config hot-reload (`APPLY_CONFIG` + UI).
5. Status chỉ đọc (allowlist Phase 2).
6. Account/signal runtime edge cases.
7. Sau cùng mới cân nhắc lệnh giao dịch (allowlist riêng + permission riêng).

## 12. Rủi ro và invariant

- Ai publish được broker là có thể gửi `new_command` → chỉ process web-bot publish; hạn chế ACL broker nếu được.
- `ENV` không nằm trên process `RUN` đang sống → timeout/`expired`, không giả succeeded.
- `PUBLISH_COMMAND` Telegram + local emit có thể double-exec trên path Telegram; path web dùng `requestId` dedupe, không phụ thuộc Telegram chat.
- Không tin `action`/command từ client ngoài allowlist.
- Không trả API key, raw MQTT password, hay toàn bộ `cmdInfo` nội bộ ra browser vượt mức cần thiết (`requestId`, `status`, `message`, `error`).
