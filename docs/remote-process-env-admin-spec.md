# Spec: Quản lý Process Env & Restart (Remote Env Admin)

Trạng thái: **chưa có UI/API trong web-bot** — chỉ có backend contract ở `binance-bot`.  
Phạm vi: trang admin trên web-bot để xem tình trạng process, sửa `bot_profile`, restart/reload PM2 qua control agent.  
Cập nhật: 2026-10-13  
Nguồn đối chiếu:

- [binance-bot SPEC](../../binance-bot/docs/SPEC-REMOTE-ENV-ADMIN.md) (cùng workspace; nếu clone tách thì lấy từ repo `binance-bot`)
- [binance-bot API contract](../../binance-bot/services/bot-admin/API-CONTRACT.md)
- Auth: [auth-rbac-spec.md](auth-rbac-spec.md) — không tin role từ client

## 0. Kết luận hiện trạng

| Hạng mục | web-bot hôm nay |
|---|---|
| Trang list/edit `bot_profile` | **Không có** |
| Restart PM2 process từ web | **Không có** (command bridge hiện chỉ `APPLY_CONFIG` account config) |
| Xem heartbeat | Có một phần ở `/system` (`SystemHealthPage`, `bot_heartbeats`) — **không** gắn revision profile / desired-vs-actual env |
| Sửa env process (`TELE_CLIENT`, `RUN`, role flags…) | **Không có** — Config Lab chỉ sửa `Account_Config` theo bot username |

→ Cần trang mới + API wrap trong web-bot. Spec này mô tả sản phẩm/UI/API/RBAC trước khi implement.

---

## 1. Mục tiêu

Admin (hoặc role được cấp quyền process) trên web có thể:

1. **Xem tình trạng** từng process: online/stale, host, PID, roles, MQTT/TELE/TELE_CLIENT, revision desired vs actual, lệnh restart đang chạy.
2. **Sửa thông tin profile** (label, active) và **sửa env** trong registry allowlist — không sửa secret (`MONGODB`, `REDIS_URL`, API key…).
3. **Lưu** desired state (Mongo `bot_profile` + audit revision).
4. **Restart / reload** process trên đúng host (queue `bot_control_commands` → control agent → PM2).
5. **Rollback** env về snapshot revision cũ (tạo revision mới, không hạ số revision).

Không dùng web để SSH hoặc chạy shell tùy ý.

---

## 2. Persona và câu hỏi trong 30 giây

| Persona | Câu hỏi |
|---|---|
| Admin vận hành | Process `V12` còn sống không? Revision web và process có khớp không? |
| Admin cấu hình | Đổi `TELE_CLIENT` của listener rồi restart — đã apply chưa? |
| Auditor | Ai đổi `RUN` lúc nào? Diff ra sao? |

---

## 3. Ranh giới

### Trong phạm vi (Phase 1)

- List process/profile + status heartbeat (desired vs actual).
- Editor env theo **env-registry** (binance-bot).
- Preview diff + validate (runtime-config + reference MQTT/TELE/TELE_CLIENT).
- Save / Save + restart / Restart only / Rollback.
- Timeline revision + command status (poll).
- Chỉ role flags dạng `"true"` hoặc unset — không lưu `"false"` cho `TRADER`/`MONITOR`/`LISTENER`/…

### Ngoài phạm vi Phase 1

- Hot-reload MQTT/Telegram trong cùng Node process (luôn restart/reload).
- Sửa `Account_Config` / `/sc` (vẫn Config Lab).
- Sửa/hiển thị raw secret, Mongo URI, Redis URL, API key.
- Đổi allowlist host↔process từ UI (file local trên server; Phase 2+ nếu cần).
- Bulk restart hàng loạt mặc định (chỉ multi-select có confirm từng bước Phase 2).
- Tự đóng/mở position khi đổi config.

---

## 4. Thông tin kiến trúc (chuỗi E2E)

```text
Browser (admin)
  → web-bot Express (auth + permission + redact)
  → Mongo: bot_profile / bot_profile_revisions / bot_control_commands / bot_heartbeats
  → (restart) control agent trên host (allowlist local)
  → pm2 restart|reload <name> --update-env
  → bot bootstrap: dotenv → applyBotProfile(BOT_ENV) → heartbeat(profileRevision)
  → UI poll command + heartbeat → “applied” khi revision khớp trong ≤ 90s
```

web-bot **không** gọi SSH/PM2 trực tiếp. Không copy service layer binance-bot bằng cách `require` cross-repo trong runtime production trừ khi monorepo/deploy chủ đích; khuyến nghị:

- **Option A (ưu tiên):** web-bot tự implement thin service đọc/ghi cùng schema Mongo (duplicate logic validate tối thiểu hoặc package shared sau).
- **Option B:** web-bot gọi HTTP nội bộ nếu sau này binance-bot mở admin API — hiện **chưa** có HTTP server admin trong binance-bot.

Phase 1 chọn **Option A**: implement trong `server/src/` của web-bot, mirror contract binance-bot, dùng chung Mongo.

---

## 5. RBAC

### 5.1 Phase 1 (ship nhanh)

- Chỉ **`role === admin`** vào trang và API.
- Không mở cho `operator`/`trader` cho đến khi permission catalog sẵn sàng.
- Mọi mutation ghi `actor` từ session server (`userId`, `email`), không nhận actor từ body client.

### 5.2 Phase 2 — permission mới (bắt buộc cập nhật `access-control.js` + auth-rbac-spec cùng PR)

| Permission | Ý nghĩa | Scope cho phép |
|---|---|---|
| `processes.view` | Xem list/detail/revisions/commands/status | `all` |
| `processes.edit` | PATCH profile, rollback, đổi label/active | `all` |
| `processes.restart` | Tạo restart/reload command | `all` |

Ghi chú:

- Đây là **process fleet** (env `V12`, `SIN_22`), không map `botUsernames` — scope chỉ `all`.
- Template: `admin` có cả ba; có thể gán `auditor` chỉ `processes.view`.
- `bots.operate` hiện dành bridge/milestone khác — **không** tái dụng mơ hồ cho restart PM2; dùng `processes.restart` rõ nghĩa.
- Ẩn menu không thay cho `requirePermission` trên server.

High-risk keys (`TRADER`, `MONITOR`, `LISTENER`, `RUN`, `MQTT`, `TELE`, `TELE_CLIENT`, `SERVER`, `MAX_VOLUME`): UI bắt confirm gõ lại `profileEnv`; server vẫn validate registry + runtime-config.

---

## 6. UI / UX

### 6.1 Điều hướng

- Menu: **Process** hoặc **Runtime** — URL đề xuất `/admin/processes`.
- Gate: Phase 1 admin; Phase 2 `processes.view`.
- Không nhầm với `/system` (health tổng quát) hay `/config-lab` (account trade config).

### 6.2 Màn list `/admin/processes`

Bảng mỗi dòng = một `bot_profile` (hoặc process map nếu sau này có collection mapping):

| Cột | Nguồn |
|---|---|
| Process / Profile (`env`) | `bot_profile.env` |
| Label | `bot_profile.label` |
| Active | `bot_profile.active` |
| Roles | flags từ variables hoặc heartbeat |
| MQTT / TELE / TELE_CLIENT | variables (redact nếu secret — các key này không secret) |
| Desired rev | `bot_profile.revision` |
| Actual rev | `bot_heartbeats.profileRevision` (mới nhất theo `botEnv` / `processName`) |
| Drift | desired ≠ actual hoặc thiếu heartbeat |
| Heartbeat | `at` — online nếu &lt; 90s |
| Host / hostId / PID | heartbeat |
| Last command | status command mới nhất cho process |

Filter: online/stale/drift/active; search theo env/label/host.  
Click dòng → detail.

### 6.3 Màn detail `/admin/processes/:env`

Tabs:

1. **Tổng quan** — status desired vs actual, startedAt, lastStartupError, nút Refresh status.
2. **Env** — form theo registry (nhóm: Role, Kết nối, Signal, Listener, Exchange, Log…).  
   - Toggle role = set `"true"` / unset.  
   - Unset rõ ràng (không để chuỗi rỗng giả “tắt”).  
   - Reference select: MQTT / TELE / TELE_CLIENT load option từ `mqtt-config`, `telegram-config`, `telegram-client` (chỉ `env`, không token/session).
3. **Lịch sử** — `bot_profile_revisions` (diff đã redact).
4. **Commands** — timeline restart/reload.

Actions (toolbar):

| Nút | Quyền Phase 2 | Hành vi |
|---|---|---|
| Preview | edit | `dryRun: true` — hiện diff + lỗi validate, không ghi |
| Lưu | edit | PATCH profile + `expectedRevision` + `reason` bắt buộc |
| Lưu + Restart | edit + restart | PATCH thành công → POST command; nếu command lỗi vẫn báo “đã lưu, chưa apply” |
| Restart | restart | Command với revision hiện tại, không đổi env |
| Rollback | edit | Chọn revision cũ + reason → tạo revision mới |

Optimistic lock: nếu 409, hiện snapshot mới + diff; không ghi đè im lặng.

### 6.4 Trạng thái command (UI)

`queued → claimed → restarting → waiting_heartbeat → succeeded | failed | timed_out | cancelled`

- Poll `GET .../commands/:id` mỗi 2–3s khi đang non-terminal.
- `cancelled` + `superseded`: giải thích “đã có revision mới hơn”.
- Timeout 90s: hướng dẫn xem heartbeat / log runtime, không auto retry vô hạn từ UI.

---

## 7. API web-bot (đề xuất)

Prefix: `/api/admin/processes`  
Tất cả: `requireAuth` + permission (Phase 1: admin).

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/admin/processes` | List profile + status (redact) |
| GET | `/api/admin/processes/:env` | Detail + status |
| GET | `/api/admin/processes/:env/revisions` | Audit |
| GET | `/api/admin/processes/registry` | Allowlist key metadata cho form |
| PATCH | `/api/admin/processes/:env` | Body: `expectedRevision`, `reason`, `patch`, `unset`, `dryRun?`, `label?`, `active?` |
| POST | `/api/admin/processes/:env/rollback` | Body: `toRevision`, `expectedRevision`, `reason` |
| POST | `/api/admin/processes/:env/commands` | Body: `kind` restart\|reload, `hostId`, `processName?`, `reason` |
| GET | `/api/admin/processes/commands/:id` | Command status |

Mapping host:

- Phase 1: client/server lấy `hostId` từ heartbeat gần nhất của process; nếu thiếu → 400 “chưa có heartbeat/hostId — cấu hình BOT_CONTROL_HOST_ID trên process”.
- `processName` mặc định = profile `env` (case theo PM2 name trong allowlist server — agent so khớp `profileEnv` uppercase với allowlist `botEnv`).

Response không bao giờ chứa raw `MONGODB`, Redis URI, token, API key. Audit web (`web_audit_logs`) cũng sanitize.

---

## 8. Model dữ liệu (Mongo dùng chung bot)

| Collection | Vai trò |
|---|---|
| `bot_profile` | Desired state |
| `bot_profile_revisions` | Audit bất biến |
| `bot_control_commands` | Queue restart |
| `bot_heartbeats` | Actual state (+ `botEnv`, `profileRevision`, `hostId`, …) |

web-bot thêm Mongoose model mirror schema binance-bot (hoặc schema tối thiểu đọc được). Không migration phá dữ liệu bot.

---

## 9. Acceptance criteria

1. Admin mở `/admin/processes` thấy đủ profile đã seed; stale &gt; 90s đánh dấu rõ.
2. Đổi `TELE_CLIENT` → Preview OK → Lưu → revision +1; Save+Restart → command `succeeded` khi heartbeat cùng revision trong 90s.
3. Bỏ `LISTENER` (unset) → sau restart process không còn bật listener (env không còn truthy).
4. PATCH thiếu `RUN` khi `TRADER=true` → 400, không tạo command.
5. Hai tab cùng sửa: tab sau nhận 409.
6. Rollback revision 8 khi đang 10 → tạo 11 với snapshot 8.
7. User không phải admin (Phase 1) → 403; không thấy menu.
8. Response/UI/audit không lộ Redis/Mongo URI hay API key.
9. Không gọi được restart với `processName` tùy ý ngoài mapping/heartbeat (server kiểm soát).

---

## 10. Kế hoạch triển khai

1. Spec này + link `docs/index.md` / `feature-spec.md` (**xong khi merge spec**).
2. Server: models + routes + service validate/redact; test permission + 409 + redact.
3. Client: list + detail + env editor + command poll.
4. Cập nhật `auth-rbac-spec` khi thêm `processes.*` (Phase 2).
5. Manual E2E trên staging với 1 listener + control agent — không deploy production từ máy dev nếu chưa được yêu cầu.

---

## 11. Liên hệ tài liệu khác

| Doc | Liên hệ |
|---|---|
| [feature-spec.md](feature-spec.md) | Thêm dòng màn Process khi implement |
| [api-data-reference.md](api-data-reference.md) | Bảng endpoint khi có code |
| [bot-command-bridge.md](bot-command-bridge.md) | Khác kênh: bridge = APPLY_CONFIG account; trang này = PM2 process env |
| [auth-rbac-spec.md](auth-rbac-spec.md) | Permission `processes.*` Phase 2 |
| binance-bot SPEC / RUNBOOK | Bootstrap `BOT_ENV`, control agent, migration |

---

## 12. Rủi ro còn lại

- Process chưa set `BOT_ENV` / chưa heartbeat revision → UI báo drift nhưng restart có thể không “apply profile”.
- `.env` host chung từng sync vào nhiều profile — admin cần hiểu key listener trên trader có thể thừa; chỉnh tay trên detail.
- Allowlist control agent sai host → command `failed` allowlist_reject; UI phải hiện `statusReason`.
