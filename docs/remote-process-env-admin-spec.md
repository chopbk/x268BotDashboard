# Spec: Quản lý Process Env & Restart (trên trang Hệ thống)

Trạng thái: **Phase 1 đã implement** (2026-10-13) — `/system` bảng Process + panel admin env/restart.  
Phạm vi: **mở rộng tab Hệ thống** (`SystemHealthPage`) để admin xem tình trạng, sửa `bot_profile`, restart/reload PM2. **Không** tạo menu/trang `/admin/processes` riêng.  
Cập nhật: 2026-10-13  
Nguồn đối chiếu:

- Implementation: [`SystemHealthPage.jsx`](../client/src/pages/SystemHealthPage.jsx), [`GET /api/system-health`](../server/src/routes/system-health.js), [`process-admin.js`](../server/src/lib/process-admin.js), [`admin-processes.js`](../server/src/routes/admin-processes.js)
- Backend bot: [binance-bot SPEC](../../binance-bot/docs/SPEC-REMOTE-ENV-ADMIN.md), [API contract](../../binance-bot/services/bot-admin/API-CONTRACT.md)
- Auth: [auth-rbac-spec.md](auth-rbac-spec.md)

## 0. Kết luận hiện trạng

| Hạng mục | web-bot |
|---|---|
| Menu **Hệ thống** `/system` | Service cards + bảng Process (kèm Rev/Drift/Host/Command) + panel Peer proxy (pool tinyproxy → `BINANCE_PEER_*`) |
| Quyền vào `/system` | `logs.view` scope `all` |
| Sửa `bot_profile` / env process | Admin — panel `?process=` + `/api/admin/processes*` |
| Restart PM2 từ web | Admin — `bot_control_commands` (không qua APPLY_CONFIG) |
| Revision desired vs actual | Có trên bảng Process |

→ Admin ghép **cùng trang `/system`**; mutation chỉ qua `/api/admin/processes*` (không nhét vào `GET /api/system-health`).

---

## 1. Mục tiêu

Trên **Hệ thống**, admin có thể:

1. **Xem tình trạng** process (giữ bảng hiện có) + cột mới: profile revision, drift, hostId, lệnh gần nhất.
2. **Mở chi tiết một process** (drawer / panel / hash route trên cùng trang) để sửa label/active/env registry.
3. **Lưu** desired state → `bot_profile` + audit revision.
4. **Restart / reload** qua `bot_control_commands` → control agent → PM2.
5. **Rollback** snapshot revision cũ (tạo revision mới).

Không SSH/shell từ web. Không trang menu mới.

---

## 2. Persona

| Persona | Câu hỏi trên `/system` |
|---|---|
| Admin vận hành | Process nào stale? Drift revision? Restart xong chưa? |
| Admin cấu hình | Đổi `TELE_CLIENT` / `RUN` ngay từ dòng process đang xem |
| Người có `logs.view` all nhưng không admin | Vẫn xem health như nay; **không** thấy nút Sửa/Restart |

---

## 3. Ranh giới

### Trong phạm vi (Phase 1)

- Mở rộng UI `/system` (không đổi URL menu).
- Join heartbeat ↔ `bot_profile` theo `processName` / `botEnv` / `NODE_ENV`.
- Editor env registry; Preview / Lưu / Lưu+Restart / Restart / Rollback.
- Poll command status trong panel.
- Role flags: `"true"` hoặc unset — không lưu `"false"` cho TRADER/MONITOR/LISTENER/…

### Ngoài phạm vi Phase 1

- Menu/route độc lập `/admin/processes`.
- Hot-reload MQTT/Telegram không restart.
- Sửa `Account_Config` (Config Lab).
- Hiển thị/sửa secret (`MONGODB`, `REDIS_URL`, API key…).
- Đổi allowlist host↔PM2 từ UI.
- Bulk restart mặc định.

---

## 4. Kiến trúc E2E

```text
/system (SystemHealthPage)
  GET /api/system-health          → alerts + services + processes (đọc, mở rộng field)
  click process → panel chi tiết
  GET/PATCH /api/admin/processes… → profile / revisions / commands (mutation)
       ↓
  Mongo bot_profile + revisions + bot_control_commands + bot_heartbeats
       ↓
  control agent (host) → pm2 restart|reload --update-env
       ↓
  bot: BOT_ENV profile → heartbeat profileRevision
```

web-bot implement thin service mirror contract binance-bot trên Mongo chung (**Option A**). Không `require` cross-repo runtime.

---

## 5. RBAC

### Xem `/system` (giữ nguyên)

- `logs.view` + scope `all` — như hiện tại ([auth-rbac-spec](auth-rbac-spec.md) § system-health).
- Response health **không** trả secret; có thể kèm `desiredRevision` / `drift` (metadata công khai vận hành).

### Sửa env / restart

| Permission | Dùng cho |
|---|---|
| `processes.view` | Mở panel / đọc profile, revisions, commands |
| `processes.edit` | PATCH / rollback |
| `processes.restart` | POST command restart/reload |

Scope chỉ `all` (fleet process, không map `botUsernames`).  
Role template **`ops`**: operator (bot được gán) + `logs.view=all` + ba quyền process.  
Admin luôn có đủ. User chỉ `logs.view` vẫn xem bảng health, không thao tác env.  
Ẩn nút ≠ bỏ check server.

High-risk keys (`TRADER`, `MONITOR`, `LISTENER`, `RUN`, `MQTT`, `TELE`, `TELE_CLIENT`, `SERVER`, `MAX_VOLUME`): confirm gõ lại tên process/profile trước Save+Restart.

---

## 6. UI / UX — gắn vào Hệ thống

### 6.1 Bố cục trang `/system` (giữ + mở rộng)

Thứ tự khối **không đảo** trải nghiệm hiện tại:

1. Header “Hệ thống” + mô tả (bổ sung một câu: admin có thể mở process để sửa env / restart).
2. Alerts + **service cards** (Mongo/Redis/MQTT/…) — giữ nguyên.
3. **Bảng Process** — mở rộng cột và hành động (trọng tâm spec này).
4. **Panel chi tiết process** — mở khi chọn một dòng (drawer phải trên desktop, full-sheet mobile; hoặc query `?process=V12` / hash `#process=V12` để deep-link/F5 giữ panel).

Không thêm tab menu ngang mới trừ khi bảng quá tải — ưu tiên **một bảng + panel**.

### 6.2 Bảng Process (mở rộng)

Cột hiện có giữ: PM2, Role, RUN, NODE_ENV, MQTT, TELE_CLIENT, RAM, CPU, Restart, Heartbeat.

Thêm cột (có thể ẩn bớt trên mobile):

| Cột mới | Nguồn |
|---|---|
| Profile | `bot_profile.env` khớp được / “—” nếu chưa seed |
| Rev | `desiredRevision` → `actualRevision` (vd `2→2` hoặc `3→2` đỏ khi drift) |
| Drift | badge: khớp / lệch / chưa profile / stale |
| Host | `host` / `hostId` từ heartbeat |
| Command | status lệnh non-terminal gần nhất (nếu có) |

Hành động trên dòng (chỉ admin Phase 1):

- **Chi tiết / Sửa** — mở panel.
- **Restart** — confirm nhanh + reason bắt buộc (optional shortcut; đủ lý do thì chỉ trong panel cũng được).

Click cả hàng (trừ nút) cũng mở panel.  
Filter nhanh phía trên bảng: Tất cả | Online | Stale | Drift | Đang restart (optional Phase 1.1).

Join rule heartbeat → profile:

1. `botEnv` heartbeat (uppercase) = `bot_profile.env`, else
2. `processName` uppercase = `bot_profile.env`, else
3. `nodeEnv` uppercase = `bot_profile.env`, else không gắn profile (vẫn hiện heartbeat; panel báo “chưa có bot_profile”).

### 6.3 Panel chi tiết process

Header: `processName` · roles · online/stale · hostId/PID · desired/actual rev.

Tabs trong panel:

1. **Tổng quan** — startedAt, lastStartupError, MQTT connected, diff ngắn desired vs actual keys chính (`TELE_CLIENT`, `RUN`, roles…).
2. **Env** — form theo registry (nhóm Role / Kết nối / Signal / Listener / Exchange / Log).  
   Toggle role = `"true"` / unset. Reference select MQTT·TELE·TELE_CLIENT từ config collections (chỉ field `env`).
3. **Lịch sử** — `bot_profile_revisions` (diff redact).
4. **Commands** — timeline + poll khi đang chạy.

Toolbar panel:

| Nút | Ai thấy (Phase 1) | Hành vi |
|---|---|---|
| Preview | admin | `dryRun: true` |
| Lưu | admin | PATCH + `expectedRevision` + `reason` |
| Lưu + Restart | admin | PATCH rồi POST command; lỗi command → “đã lưu, chưa apply” |
| Restart | admin | command, không đổi env |
| Rollback | admin | chọn revision + reason |
| Đóng | mọi user mở được panel xem | đóng panel |

Optimistic lock 409 → hiện revision mới, không ghi đè.

### 6.4 Command status trong panel / badge bảng

`queued → claimed → restarting → waiting_heartbeat → succeeded | failed | timed_out | cancelled`

- Poll 2–3s khi non-terminal.
- `superseded`: “đã có revision mới hơn”.
- Timeout 90s: hướng dẫn xem heartbeat; không auto-retry vô hạn từ UI.
- Sau succeeded: refresh `GET /api/system-health` (hoặc chỉ patch dòng process) để Rev/Drift cập nhật.

---

## 7. API

### 7.1 Mở rộng đọc health (không phá client cũ)

`GET /api/system-health` (vẫn `logs.view` scope `all`):

Mỗi phần tử `processes[]` **thêm field optional** (backward compatible):

```json
{
  "key": "V12:3",
  "processName": "V12",
  "botEnv": "V12",
  "profileEnv": "V12",
  "desiredRevision": 3,
  "actualRevision": 2,
  "drift": true,
  "hostId": "sgp-1",
  "profileActive": true,
  "lastCommand": { "id": "...", "status": "waiting_heartbeat", "kind": "restart" }
}
```

Không trả `variables` đầy đủ trên list health (tránh payload lớn / lộ config). Detail env chỉ qua API admin bên dưới.

### 7.2 API admin process (mutation + detail)

Prefix: `/api/admin/processes`  
Phase 1: `requireAuth` + **admin only**.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/admin/processes/:env` | Detail profile + status + variables redact |
| GET | `/api/admin/processes/:env/revisions` | Audit |
| GET | `/api/admin/processes/registry` | Metadata key cho form Env |
| PATCH | `/api/admin/processes/:env` | `expectedRevision`, `reason`, `patch`, `unset`, `dryRun?`, `label?`, `active?` |
| POST | `/api/admin/processes/:env/rollback` | `toRevision`, `expectedRevision`, `reason` |
| POST | `/api/admin/processes/:env/commands` | `kind`, `hostId` (từ heartbeat nếu omit), `reason` |
| GET | `/api/admin/processes/commands/:id` | Poll status |

`hostId`: ưu tiên body → heartbeat `hostId` của process; thiếu → 400 hướng dẫn set `BOT_CONTROL_HOST_ID` trên bot.  
`processName`: mặc định tên PM2 từ heartbeat / profile label; server không nhận argv PM2 tùy ý ngoài allowlist phía agent.

Redact secret trên mọi response + `web_audit_logs`.

---

## 8. Model Mongo (chung với bot)

| Collection | Vai trò |
|---|---|
| `bot_heartbeats` | Đã dùng bởi system-health |
| `bot_profile` | Desired state |
| `bot_profile_revisions` | Audit |
| `bot_control_commands` | Queue restart |

Thêm Mongoose model mirror schema bot. Không phá dữ liệu hiện có.

---

## 9. Acceptance criteria

1. User `logs.view` all mở `/system` vẫn thấy service cards + bảng Process như cũ; có thêm cột Rev/Drift khi server đã deploy field mới.
2. Admin click process → panel Env; Preview/Lưu/`TELE_CLIENT` → revision +1.
3. Lưu+Restart → command `succeeded` khi heartbeat cùng revision ≤ 90s; bảng Process cập nhật Rev khớp.
4. Unset `LISTENER` + restart → process không còn bật listener.
5. `TRADER` không `RUN` → 400, không tạo command.
6. Conflict revision → 409 trên UI.
7. Non-admin không thấy nút Sửa/Restart; gọi PATCH → 403.
8. Không lộ Redis/Mongo URI / API key trên health hay panel.
9. Không có route menu mới bắt buộc; deep-link `?process=` hoạt động trên `/system`.

---

## 10. Kế hoạch triển khai

1. ~~Sửa spec + feature-spec / index~~ — xong.
2. ~~Server: join profile + models + `/api/admin/processes*` + unit test~~ — xong.
3. ~~Client: cột + panel + poll trên `SystemHealthPage`~~ — xong.
4. ~~Phase 2: `processes.*` + role `ops`~~ — xong.
5. E2E staging: 1 listener + control agent.

---

## 11. Liên hệ tài liệu

| Doc | Liên hệ |
|---|---|
| [feature-spec.md](feature-spec.md) | Dòng Hệ thống — ghi mở rộng process admin |
| [api-data-reference.md](api-data-reference.md) | system-health fields + admin processes khi code |
| [bot-command-bridge.md](bot-command-bridge.md) | Khác kênh: APPLY_CONFIG ≠ PM2 restart |
| [auth-rbac-spec.md](auth-rbac-spec.md) | Giữ `logs.view` cho xem; mutation admin / `processes.*` |
| binance-bot SPEC / RUNBOOK | Bootstrap `BOT_ENV`, control agent |

---

## 12. Rủi ro

- Process chưa `BOT_ENV` / chưa ghi `profileRevision` → Drift “chưa profile” hoặc actual null; restart chưa chắc apply profile.
- Heartbeat không có `hostId` → Restart bị chặn đến khi cấu hình bootstrap host.
- Allowlist agent reject → hiện `statusReason` trên panel Commands.
- Bảng Process thêm cột dễ chật — ưu tiên Rev/Drift/Host; RAM/CPU có thể nhóm “…” trên mobile.
