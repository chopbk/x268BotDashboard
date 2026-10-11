# Spec: Tổng quan (Dashboard Overview)

Trạng thái: **Phase 1 + Phase 2 đã triển khai** — 2026-10-12.  
Phạm vi: nâng trang chủ `/` (`DashboardPage`) để operator nắm hiện trạng nhiều bot trong một nhìn; không thay Position / Tổng kết / Hệ thống. Phần nặng (đồng bộ sàn, timeline dài, equity) deep-link sang tab tương ứng.

Cache: server memory theo actor (`DASHBOARD_CACHE_MS`, mặc định 30s); F5/sessionStorage client 60s paint nhanh; `?refresh=1` hoặc nút Làm mới bỏ cache.

## 1. Bối cảnh và mục tiêu

### Ai dùng trang này

| Persona | Câu hỏi trong 10 giây |
|---|---|
| Chủ bot / operator 1–vài account | Hôm nay lãi hay lỗ? Có vị thế đang rủi ro không? Bot có đang “sống” không? Việc gì cần xử lý? |
| Quản lý nhiều user / nhiều bot | Ai đang lỗ nặng? Ai offline / thiếu key / config bật mà không có signal? Rủi ro mở (uPnL) tập trung ở đâu? |

### Mục tiêu

1. **Một màn hình = hiện trạng vận hành hôm nay**, không phải báo cáo dài hạn (đó là Tổng kết / Scorecard / Ledger).
2. Tách rõ **đã chốt** vs **chưa chốt** vs **ví (income)** — không gộp thành một số “lãi”.
3. Đưa **rủi ro đang mở** và **sức khỏe runtime** lên trên cùng — hai thứ Cryptohopper / VolatiCloud / NexusFi coi là bắt buộc, hiện web-bot chưa có ở Tổng quan.
4. Giữ **hàng đợi việc cần xử lý** (và AI rewrite) — đây là điểm mạnh riêng so với dashboard bot đơn lẻ.
5. Không nhân bản toàn bộ Position / System Health / Summary; chỉ **tóm tắt + deep-link**.

### Ngoài phạm vi (cố ý)

- Panic flatten / đóng hàng loạt từ Tổng quan (Cryptohopper có; web-bot giữ trên Position / trading API).
- Equity curve dài hạn, Sharpe, Max DD lịch sử (thuộc Tổng kết / Ledger; có thể sparkline 7 ngày ở phase sau).
- Soạn lệnh tay / sync position từ Tổng quan.
- Đổi RBAC model; vẫn đọc quyền từ user Mongo, không tin client.

---

## 2. Hiện trạng web-bot (baseline)

Nguồn: [`DashboardPage.jsx`](../client/src/pages/DashboardPage.jsx), [`dashboard.js`](../server/src/lib/dashboard.js), [`auth-rbac-spec`](auth-rbac-spec.md) § dashboard.

| Khối | Có gì |
|---|---|
| KPI strip | Bot active/total · Config ON/total · Profit hôm nay (lệnh đóng live, closeTime UTC) · Income ví hôm nay (`futures_profits`) |
| Việc cần xử lý | Account lỗ ví · signal lỗ · config ON không signal · thiếu API key · signal bị chặn · signal bị gỡ; tối đa 12; AI rewrite tùy chọn |
| Bot của tôi | Tối đa 5 dòng: active, ON/configs, profit hôm nay → Config Lab |
| Quyền | Chỉ bot sở hữu/được gán; field null khi thiếu `config.view` / `statistics.view` / … |

### Gap chính (so với nhu cầu operator)

1. Không thấy **vị thế mở / uPnL / notional** → không biết rủi ro đang mang.
2. Không thấy **bot/process có heartbeat hay stale** → “active” trên UI chỉ là cờ hiển thị, không phải process sống.
3. Không có **win/loss hôm nay**, số lệnh đóng, hoặc so sánh nhẹ với hôm qua.
4. Attention không có **mức ưu tiên / severity** rõ (lỗ lớn vs thiếu signal).
5. Bảng bot thiếu **uPnL, số vị thế, health** — quản lý nhiều bot phải mở từng trang.
6. Không có **activity gần đây** (đóng lệnh / lỗi runtime) ngay trên tổng quan.

---

## 3. Khảo sát sản phẩm ngoài (rút ý hay)

Nguồn tham chiếu (2026): [Cryptohopper Dashboard](https://docs.cryptohopper.com/docs/trading-bot/dashboard), [3Commas Grid Stats](https://help.3commas.io/en/articles/11388471-grid-bot-statistics-page), [Bitsgap Bot Analytics](https://bitsgap.com/helpdesk/article/16398758821148-Getting-Started-with-Bot-s-Analytics), [VOIDX Portfolio](https://docs.quantumvoid.org/features/portfolio), [VolatiCloud Monitoring](https://docs.volaticloud.com/docs/bots/monitoring), tổng hợp KPI P&L / monitoring (Cryptohopper.AI, NexusFi).

| Ý tưởng | Ở đâu hay | Phù hợp web-bot? | Ghi chú |
|---|---|---|---|
| Tách **realized / unrealized / holdings** | 3Commas, Cryptohopper, VOIDX | **Bắt buộc** | Đã có realized + income; thiếu uPnL + số vị thế |
| Open positions / reserved funds trên overview | Cryptohopper | **Tóm tắt** | Bảng rút gọn top lỗ/lãi mở + link `/positions` |
| Bot status: running / unhealthy / error / stopped | VolatiCloud | **Bắt buộc** | Map từ heartbeat + cờ `active` + lỗi runtime gần đây |
| Activity feed + Output/errors | Cryptohopper | **Nên có** | 5–10 sự kiện gần (đóng lệnh / blocked / removed) |
| Equity / PnL theo kỳ + fees + volume | 3Commas, Bitsgap | Phase 2 | Sparkline 7 ngày từ dữ liệu đã có; fees nếu có trong income |
| Win rate, profit factor, max DD, Sharpe | Blog KPI chung | Một phần | Win rate **hôm nay** đủ; Sharpe/DD để Tổng kết |
| Filter theo bot type / exchange | Bitsgap | Thấp | Một sàn + copy-trade; filter theo bot/user là đủ |
| Panic button / kill switch | Cryptohopper, NexusFi | Không trên overview | Giữ trên Position; có thể badge “loss limit” sau |
| 5 câu hỏi monitoring: trade được? data fresh? position đúng? P&L? degraded? | NexusFi | **Khung thiết kế** | Dùng làm hierarchy UI (§4) |
| AI rewrite attention từ facts | web-bot sẵn có | **Giữ & mở rộng facts** | Điểm khác biệt; bổ sung risk/health vào package AI |

### Điểm hay nhất nên lấy (ưu tiên)

1. **Hierarchy NexusFi** — trả lời “có giao dịch được không / rủi ro bao nhiêu / hôm nay thế nào / việc gì cần làm” trước khi vào chi tiết.
2. **Tách realized vs unrealized** (3Commas / Cryptohopper) — tránh ảo giác lãi khi đang mang lỗ mở.
3. **Health traffic-light theo bot** (VolatiCloud) — quan trọng hơn với quản lý nhiều process PM2.
4. **Top open risk + activity** (Cryptohopper / VOIDX) — nắm bắt nhanh, deep-link.
5. **Attention có severity** — nâng hàng đợi việc sẵn có thành triage chuyên nghiệp.
6. **Giữ AI attention** — mở rộng facts (uPnL, stale bots), không thay bằng chat chung chung.

---

## 4. Information architecture đề xuất

Thứ tự đọc trên viewport (desktop một cột; mobile xếp cùng thứ tự):

```
A. Trạng thái hệ thống trong phạm vi tôi   ← “trade được không?”
B. KPI hôm nay (UTC)                        ← “hôm nay thế nào?”
C. Rủi ro đang mở (tóm tắt)                 ← “đang mang bao nhiêu?”
D. Việc cần xử lý (severity + AI)               ← “làm gì tiếp?”
E. Bảng bot của tôi (mở rộng cột)           ← drill-down
F. Hoạt động gần đây                        ← ngữ cảnh
```

### A. Strip sức khỏe (health)

Chỉ bot trong scope actor. Nguồn: `bot_heartbeats` / process heartbeat đã dùng ở System Health + Position case; **không** bắt buộc `logs.view` scope `all` (trang Hệ thống vẫn dành cho admin hạ tầng).

| Chip / số | Ý nghĩa |
|---|---|
| `ok` | Heartbeat trong ngưỡng (cùng 90s như Position / System) |
| `stale` | Có bot active nhưng heartbeat quá hạn hoặc thiếu |
| `off` | `active === false` (cờ hiển thị) |
| `degraded` | Có runtime error/signal blocked gần đây (nếu có `logs.view`) |

Click chip → `/system` nếu có quyền; không thì `/logs?kind=runtime` hoặc tooltip giải thích.

**Quan trọng UX:** Không gọi label “Đang chạy” cho `active` nữa trên bảng bot; đổi thành **Hiển thị: Bật/Tắt** và cột **Process: OK / Stale / Không rõ** để hết nhầm với process sống.

### B. KPI hôm nay (UTC)

Giữ 4 ô hiện có; bổ sung / sắp lại:

| KPI | Nguồn | Permission |
|---|---|---|
| Bot (active flag / total) | `user_accounts` | `bots.view` |
| Config ON / total | `account_configs` | `config.view` |
| Đã chốt hôm nay | `account_statics` live, closeTime∈ngày UTC | `statistics.view` |
| Ví (income) hôm nay | `futures_profits` | `statistics.view` |
| **Chưa chốt (uPnL)** | Redis `wb:ex` / sổ position đã có; không REST nặng mặc định | `positions.view` |
| **Vị thế mở** | Đếm parent position qty≠0 trong scope | `positions.view` |
| **Lệnh đóng hôm nay** + win rate ngày | `account_statics` (WIN vs LOSS/LOSE) | `statistics.view` |

Công thức ngày UTC **không đổi** so với ledger/dashboard hiện tại. Tooltip mỗi ô ghi nguồn (đã chốt ≠ income ≠ uPnL) — tái dùng nguyên tắc [feature-spec § số liệu](feature-spec.md).

Tuỳ chọn phase 2: delta vs hôm qua UTC (`profitToday - profitYesterday`) chỉ khi query thêm rẻ.

### C. Rủi ro đang mở

Khối tóm tắt (không phải full Position):

- Tổng uPnL, tổng notional ước tính (qty × mark) nếu có mark.
- Top N (mặc định 5) vị thế theo |uPnL| giảm dần: bot · env · symbol · side · uPnL · link `/positions?...`.
- Cảnh báo gộp: “X vị thế không có monitor”, “Y monitor stale” — chỉ đếm, deep-link; chi tiết vẫn ở Position.

`mode=fast` (Mongo+Redis). Nếu Redis trống: hiện “Chưa có sổ live — mở Position để đồng bộ”, không gọi Binance hàng loạt từ dashboard (tránh rate limit; đã có queue REST riêng).

### D. Việc cần xử lý

Chỉ tóm tắt vấn đề **tài khoản / trading** đáng xem — không dump log thô.

| Nguồn | Cách xử lý |
|---|---|
| Lỗ ví hôm nay | Chỉ khi ≤ −5$; critical nếu ≤ −50$ |
| uPnL mở | Critical nếu một vị thế ≤ −100$ |
| Lỗi sàn / API key runtime | `category=exchange` (credential, margin…) → critical |
| Heartbeat stale/degraded | medium |
| Signal lỗ hôm nay | Chỉ khi ≤ −5$ |
| Signal bị gỡ (autoremove) | medium, dedupe |
| NOT OPEN “Position is open” / config off / COPY off | **Bỏ** (hành vi bình thường) |
| NOT OPEN blacklist / max pos / risk… | Gom 1 dòng/filter, severity low |
| Config ON không signal, thiếu API key | low |
| AI rewrite | Chỉ viết lại từ facts; bỏ noise; nút “Hiện danh sách gốc” |

Không tự đóng lệnh / sửa config từ attention.

### E. Bảng bot của tôi

Mở rộng cột (null khi thiếu quyền):

| Cột | Ghi chú |
|---|---|
| Bot | username |
| Hiển thị | active flag |
| Process | ok / stale / unknown |
| Config ON | on/total |
| Đã chốt hôm nay | như cũ |
| uPnL | tổng mở của bot |
| Vị thế | số position mở |
| Actions | Config · Position · Ledger (theo quyền) |

`mine`: tăng trần từ 5 → **10** (hoặc `limit` query 5–20, mặc định 10). Sort mặc định: severity health trước, rồi |uPnL| hoặc lỗ hôm nay.

### F. Hoạt động gần đây

5–8 dòng, merge có quyền:

- Lệnh đóng gần nhất (`account_statics`, `statistics.view`)
- Runtime signal blocked/removed (`logs.view`) — trùng nguồn attention nhưng dạng timeline

Mỗi dòng: thời gian · bot/env · tóm tắt · link.

---

## 5. API

Vẫn **`GET /api/dashboard`** — mở rộng response; không tách endpoint trừ khi payload > ~100KB hoặc latency xấu.

### Response bổ sung (đề xuất)

```json
{
  "asOf": "2026-10-12T00:00:00.000Z",
  "day": "UTC",
  "bots": { "active": 3, "total": 4 },
  "configs": { "on": 12, "total": 15 },
  "profitToday": 12.5,
  "incomeToday": 10.1,
  "closedToday": { "trades": 20, "wins": 12, "losses": 8, "winRate": 60 },
  "openRisk": {
    "available": true,
    "positions": 7,
    "unrealized": -34.2,
    "notional": 12000,
    "staleBook": false,
    "top": [
      {
        "username": "bot-demo",
        "env": "DEMO_1",
        "symbol": "BTCUSDT",
        "side": "LONG",
        "unrealized": -20.1,
        "href": "/positions?account=bot-demo"
      }
    ]
  },
  "health": {
    "ok": 2,
    "stale": 1,
    "off": 1,
    "thresholdMs": 90000,
    "bots": [
      { "username": "bot-demo", "displayActive": true, "process": "ok", "lastBeatAt": "..." }
    ]
  },
  "attention": [
    { "type": "account", "severity": "critical", "title": "...", "href": "..." }
  ],
  "mine": [ ],
  "activity": [ ],
  "ai": { }
}
```

### Quy tắc quyền (không nới)

| Field | Điều kiện |
|---|---|
| `bots`, `mine` (cơ bản) | `bots.view` + ownership/assign như hiện tại |
| `configs` | `config.view` |
| `profitToday`, `incomeToday`, `closedToday`, activity đóng lệnh | `statistics.view` |
| `openRisk` | `positions.view`; thiếu quyền → `null` |
| `health` tóm tắt trong scope bot của mình | `bots.view` (heartbeat theo username/env đã gắn); không mở heartbeat toàn hệ thống |
| attention thiếu key | `credentials.view` |
| attention blocked | `logs.view` |
| `ai` | như hiện tại; không chứa secret |

Admin cũng chỉ thấy bot sở hữu/được gán trên dashboard (giữ invariant hiện tại). Muốn xem hệ thống rộng → `/system`, `/summary`.

### Hiệu năng

- Song song aggregate như hiện tại; thêm đọc Redis book **read-only**, không enqueue refresh.
- Timeout/fallback: `openRisk.available=false` nếu Redis lỗi — dashboard vẫn trả KPI khác.
- Không N+1 REST Binance từ GET dashboard.
- Cache ngắn (vd. 15–30s in-memory theo actor id) chỉ khi đo thấy cần; phase 1 có thể bỏ.

### `POST /api/dashboard/attention`

Không đổi contract ngoài việc facts giàu hơn (`openRisk`, `health`). Rate limit 15s/user giữ nguyên.

---

## 6. UI / UX

- Giữ ngôn ngữ và card hiện có; thêm block, không redesign toàn app.
- Màu: lãi/lỗ theo class PnL sẵn có; health dùng muted / warning / danger (không phụ thuộc emoji bắt buộc; có thể dùng chấm trạng thái).
- Mọi số tiền format `vi-VN` như hiện tại; tooltip nguồn số liệu.
- Empty states rõ: “Chưa gán bot”, “Không có vị thế mở”, “Chưa có heartbeat — bot chưa ghi hoặc DB khác”.
- Mobile: KPI 2 cột; bảng bot scroll ngang; top risk dạng list.

### Copy bắt buộc (tránh hiểu nhầm)

- “Đã chốt hôm nay” ≠ “Lãi lỗ ví” ≠ “Chưa chốt”.
- “Hiển thị bật” ≠ “Process đang chạy”.
- Ngày luôn ghi **UTC** cạnh tiêu đề KPI.

---

## 7. Phased delivery

### Phase 1 — Hiện trạng vận hành (ưu tiên cao)

1. Health strip + cột process trên bảng bot; sửa nhãn “Đang chạy”.
2. KPI: uPnL + số vị thế mở (+ closedToday/winRate nếu rẻ).
3. Khối open risk top N + deep-link Position.
4. Severity trên attention; mở rộng AI facts.
5. `mine` limit 10 + link Position/Ledger.
6. Docs: cập nhật feature-spec, flows, api-data-reference, auth-rbac dòng dashboard; test `dashboard.test.js`.

**Done khi:** operator mở `/` biết được (a) process có stale không, (b) đang mang bao nhiêu uPnL, (c) đã chốt/ví hôm nay, (d) việc ưu tiên — không cần mở 4 trang khác cho câu hỏi đó.

### Phase 2 — Timeline & so sánh nhẹ ✅

1. Activity feed (đóng lệnh gần đây + lỗi sàn / signal gỡ).
2. `compare` vs hôm qua UTC + `series` sparkline 7 ngày (profit/`account_statics` + income/`futures_profits`).
3. Ngưỡng env: `DASHBOARD_WALLET_ATTENTION_MIN`, `DASHBOARD_WALLET_CRITICAL`, `DASHBOARD_SIGNAL_ATTENTION_MIN`, `DASHBOARD_UPNL_CRITICAL`, `DASHBOARD_CACHE_MS`.

### Phase 3 — Manager rollup (chỉ khi có nhu cầu thật)

1. Audience `assigned` vs nhóm bot; filter nhanh theo bot.
2. Badge loss-limit / exposure cap (nếu product định nghĩa sau).
3. Không làm panic button trên overview trừ khi user yêu cầu rõ.

---

## 8. Kiểm thử

Tối thiểu (cùng thay đổi code):

```sh
npm --prefix server test
npm --prefix client run build
```

Case regression:

- Actor không `bots.view` → payload rỗng như cũ.
- Có `bots.view` không `positions.view` → `openRisk: null`, KPI khác vẫn hiện.
- Redis trống → dashboard 200, `openRisk.available=false`.
- Không lộ API key / secret trong JSON dashboard hay AI package.
- Attention severity sort ổn định; AI parse vẫn nhận items hợp lệ.
- Nhãn active vs process không còn gọi “Đang chạy” cho cờ hiển thị.

---

## 9. Tài liệu liên quan khi implement

| File | Việc |
|---|---|
| [feature-spec.md](feature-spec.md) | Mô tả khối mới trang chủ |
| [flows.md](flows.md) | Luồng GET dashboard mở rộng |
| [api-data-reference.md](api-data-reference.md) | Field response |
| [auth-rbac-spec.md](auth-rbac-spec.md) | Dòng `GET /api/dashboard` |
| [development.md](development.md) | Hàng AI/dashboard nếu đổi map |

---

## 10. Quyết định cần chốt trước khi code Phase 1

1. **Ngưỡng critical lỗ ví / |uPnL|:** đề xuất mặc định −50$ (ví) và |uPnL| ≥ 100$ cho một vị thế trong top risk → highlight; chỉnh số trước implement nếu muốn.
2. **Health gắn theo username bot hay theo từng process/env?** Đề xuất: heartbeat theo process đã có trên System Health, map về bot username; một bot nhiều process thì `stale` nếu bất kỳ process bắt buộc nào stale (ghi rõ trong tooltip).
3. **Có hiện open orders count trên overview không?** Đề xuất Phase 1: **không** (tránh nhiễu; đã có tab Order). Chỉ positions + uPnL.

Các quyết định trên mặc định theo đề xuất nếu không phản hồi ngược trước khi implement.
