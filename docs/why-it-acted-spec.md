# Why it acted — vì sao bot mở / bỏ qua / đóng

Ngày: 2026-11-01. Trạng thái: **Đề xuất triển khai; chưa có runtime/API/UI mới**.
Phạm vi: web-bot (đọc + hợp nhất) và tuỳ chọn producer bền trên binance-bot. Phiên bản thiết kế: why-v1.

Tham chiếu ý tưởng: action log / “Logs — why it acted” trong chrisleekr/binance-trading-bot. Spec này **không** giả định tick strategy Spot; map sang chuỗi copy-trade + monitor + filter mở lệnh của `binance-bot`.

## 1. Mục tiêu và quyết định sản phẩm

Người vận hành hỏi được, trên một symbol/account cụ thể:

1. **Vì sao mở** (signal nào, account nào nhận, bước nào pass)?
2. **Vì sao không mở** (blacklist, đã có position, filter, paper, invert, thiếu balance…)?
3. **Vì sao đóng / dời SL / DCA** (closeReason, timeline monitor)?

Thành công = **timeline có bằng chứng**, không phải lời AI bịa. AI decision support hiện có ([ai-decision-support-spec](ai-decision-support-spec.md)) vẫn là tư vấn rủi ro; why-v1 là **nhật ký sự kiện hệ thống**.

Không nằm trong v1:

- Capture every tick strategy như Spot trailing (không có tick engine tương đương trên mọi nhánh).
- Tự sửa config / đặt lệnh từ màn why.
- Thay journal cá nhân Terminal (journal vẫn là ghi chú người).
- Expose raw MQTT body / API key / toàn bộ console log PM2.

## 2. Nền hiện có (đối chiếu)

| Nguồn | Đã có gì | Hạn chế |
|---|---|---|
| `signal_infos` / Signal Search | Signal vào, symbol, side, channel | Ít bước “vì sao bỏ qua từng account” |
| `signal-trace` (binance-bot) | ALS steps: parse, duplicate, fanout, check, open… khi `SIGNAL_TRACE=true` | Chủ yếu log console; **chưa** là collection web đọc được |
| Monitor timeline (`position-case` logs) | DCA, partial close, SL move, đóng | Gắn monitor đã mở; không giải thích skip trước khi mở |
| `closeReason` (`monitor_positions`, `account_statics`) | Lý do đóng đã chuẩn hoá một phần | Không cover skip-open |
| `bot_runtime_logs` | Lỗi/cảnh báo theo category | Không phải decision log có cấu trúc |
| Trading receipt (web) | Lệnh tay từ Terminal | Tách khỏi signal path |
| AI decision reports | Khuyến nghị | Không phải audit hành động bot |

Chuỗi mục tiêu why-v1:

```text
Sự kiện bot (signal / filter / open / monitor / close)
  → ghi DecisionEvent bền (Mongo)   [P1 producer]
  hoặc web hợp nhất đọc đa nguồn     [P0 assembler]
  → GET timeline theo account+symbol(+signalId)
  → UI tab "Vì sao" trong Terminal case / panel symbol
```

## 3. Mô hình sự kiện (DecisionEvent)

Mỗi sự kiện bất biến sau khi ghi:

| Field | Ý nghĩa |
|---|---|
| `at` | Thời điểm sự kiện (ISO) |
| `phase` | `signal` \| `gate` \| `open` \| `monitor` \| `close` \| `manual` \| `system` |
| `action` | `received` \| `skipped` \| `opened` \| `adjusted` \| `closed` \| `error` \| … |
| `reasonCode` | Taxonomy ổn định (bảng dưới) |
| `reasonText` | Chuỗi ngắn tiếng Việt hoặc label đã map (không raw stack) |
| `username` | Bot user |
| `account` / `env` | Account config |
| `symbol` | Chuẩn hoá như Terminal |
| `side` / `positionSide` | Khi có |
| `signal` / `signalEventId` / `messId` | Liên kết channel/message khi có |
| `monitorId` | Khi đã có monitor |
| `orderRefs[]` | orderId/algoId/clientOrderId nếu có |
| `evidence` | Object nhỏ đã sanitize (threshold, prices, flag…) |
| `source` | `signal_infos` \| `monitor_log` \| `account_static` \| `runtime_log` \| `trading_receipt` \| `signal_trace` \| `decision_events` |
| `correlationId` | Gom một lần xử lý signal / một vòng monitor |

### 3.1 Taxonomy `reasonCode` (v1 tối thiểu)

| Code | Phase | Ví dụ |
|---|---|---|
| `signal_received` | signal | Tin hợp lệ vào handler |
| `signal_duplicate` | gate | Trùng `messId` / đã xử lý |
| `signal_parse_invalid` | gate | Không parse được symbol/side |
| `account_disabled` | gate | `ON=false` / MONITOR off |
| `symbol_blacklisted` | gate | Blacklist |
| `existing_position` | gate | Đã có vị thế / open filter |
| `risk_rejected` | gate | Max loss / margin / cost |
| `exchange_rejected` | open | Sàn từ chối (mã lỗi sàn đã map) |
| `opened` | open | Mở thành công (live/paper) |
| `monitor_started` | monitor | Gắn monitor |
| `sl_moved` | monitor | Dời SL |
| `partial_close` | monitor | Đóng một phần |
| `closed` | close | Đóng — kèm `closeReason` gốc trong evidence |
| `skipped_unknown` | gate | Có skip nhưng chưa map code |
| `manual_web_order` | manual | Ticket Terminal |
| `data_unavailable` | system | Thiếu nguồn để giải thích |

Giữ `closeReason` bot hiện có trong `evidence.closeReason`; UI ưu tiên label đã có từ `TradeLog.formatCloseReason` nếu web đã map — không tạo công thức đóng thứ hai.

## 4. UI

### 4.1 Chỗ đặt

- Trong Terminal panel / Position case: tab **Vì sao** (cạnh Tổng quan / Lệnh / Monitor / Timeline).
- Entry từ hàng vị thế, từ Signal Search (deep-link `monitorId` / `signal`+`env`+`symbol`), từ Account Static chi tiết.
- URL gợi ý: `/terminal?tab=positions&case=…&panel=why` hoặc query `why=1`.

### 4.2 Hiển thị

- Timeline thời gian mới → cũ (hoặc cũ → mới có toggle).
- Mỗi dòng: thời điểm · phase badge · action · reasonText · source nhỏ.
- Expand: evidence (JSON/table đã lọc), link Signal / Static / order.
- Banner trên cùng: **Kết luận ngắn** do server ghép rule (không AI): ví dụ “Mở từ SIGNAL_A · đóng SL · 3 bước gate pass”.
- Khi thiếu dữ liệu: `missingSources[]` rõ ràng (“Chưa có decision_events — đang ghép monitor + signal_infos”).

Không thay Timeline monitor; Timeline giữ sự kiện vận hành monitor, tab Vì sao là lớp diễn giải + skip-open.

### 4.3 Bộ lọc

Theo phase, action, khoảng thời gian (mặc định 7 ngày), chỉ `skipped` / chỉ `closed`.

## 5. API đề xuất

| Method | Path | Permission | Ghi chú |
|---|---|---|---|
| `GET` | `/api/terminal/why` | `positions.view` **hoặc** `orders.view` **hoặc** `logs.view` + scope | Query bắt buộc: `username`, `account` hoặc `env`, `symbol`. Optional: `signal`, `monitorId`, `from`, `to`, `phase` |
| `GET` | `/api/terminal/why/summary` | cùng | Banner kết luận + counts theo action |

Response:

```json
{
  "asOf": "2026-11-01T15:00:00.000Z",
  "mode": "assembled",
  "missingSources": ["decision_events"],
  "summary": {
    "headline": "Đã mở rồi đóng bởi SL",
    "openedAt": "...",
    "closedAt": "...",
    "closeReason": "SL",
    "skipCount": 0
  },
  "events": [ ]
}
```

`mode`:

- `assembled` — P0: server đọc đa collection hiện có, chuẩn hoá thành DecisionEvent.
- `native` — P1: phần lớn từ `bot_decision_events` (tên collection đề xuất).

Không nhận events do client tự dựng rồi POST như sự thật.

## 6. Pha triển khai

### P0 — Assembler chỉ đọc (web-bot)

Hợp nhất theo thứ tự ưu tiên cho một `(username, env, symbol)`:

1. Monitor detail timeline + `closeReason`
2. `account_statics` liên quan symbol/signal/env trong cửa sổ thời gian
3. `signal_infos` gần nhất cùng symbol/signal
4. `web_exchange_order_events` / receipt cùng symbol
5. `bot_runtime_logs` category `open`/`monitor`/`tpsl`/`signal` cùng env+symbol (nếu scope `logs.view`)

Map best-effort sang `reasonCode`; không bịa nếu thiếu → `skipped_unknown` / `data_unavailable`.

Nghiệm thu: mở case một vị thế đã đóng có Static → tab Vì sao có ít nhất chuỗi mở→đóng với closeReason; vị thế bị blacklist/skip nếu chỉ có runtime log thì hiện missingSources trung thực.

### P1 — Producer bền (binance-bot)

- Khi xử lý signal / open filter / open result / monitor adjust / close: ghi `bot_decision_events` (TTL/retention cấu hình, ví dụ 14–30 ngày).
- Bật độc lập với `SIGNAL_TRACE` console; trace có thể đồng thời ghi cùng `correlationId`.
- Không đổi PAPER / sibling / leftover / INVERT — chỉ emit thêm event.

Web ưu tiên `native` khi có events; fallback assemble cho dữ liệu cũ.

### P2 — Deep-link & Signal Search

- Cột/shortcut “Vì sao” từ Signal Search và scorecard trade.
- Optional: nhúng 3–5 event vào AI decision snapshot như **evidence hệ thống** (không thay metrics code).

## 7. Ranh giới an toàn

- Sanitize `evidence`: không API key, không raw headers, không toàn bộ message Telegram gốc nếu chứa PII ngoài symbol/side đã lưu.
- Scope: chỉ bot actor sở hữu/được gán; admin không vượt catalog permission.
- Không dùng why-timeline để suy ra qty sibling hay tự reconcile sàn.
- Retention: P0 phụ thuộc retention nguồn gốc; P1 phải có TTL index + ghi trong env-ops docs khi làm.

## 8. Test tối thiểu

- Unit mapper: closeReason / runtime category → reasonCode.
- Integration: fixture monitor+static+signal → timeline thứ tự ổn định.
- Permission: thiếu scope → 403; thiếu `logs.view` → vẫn trả events không-runtime, `missingSources` có thể gồm runtime.
- Regression: case panel Timeline/Monitor không đổi contract cũ.

## 9. Tài liệu cập nhật khi làm

- [feature-spec.md](feature-spec.md)
- [terminal-workspace-spec.md](terminal-workspace-spec.md)
- [api-data-reference.md](api-data-reference.md)
- [ai-decision-support-spec.md](ai-decision-support-spec.md) (ranh giới AI vs why)
- [flows.md](flows.md)
- binance-bot: ghi chú producer trong AGENTS/runtime-log nếu P1

## 10. Không làm nhầm

- Coi AI popup Terminal là đã có “why it acted”.
- Port nguyên bảng `action_logs` Spot tick-by-tick.
- Bật `SIGNAL_TRACE=true` production rồi bảo “đã xong” mà không có API web đọc.
