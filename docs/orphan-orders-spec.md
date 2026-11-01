# Orphan orders — lệnh mồ côi trên sổ sàn

Ngày: 2026-11-01. Trạng thái: **Đề xuất triển khai; chưa có runtime/API/UI mới**.
Phạm vi: web-bot (+ phối hợp nhẹ binance-bot nếu cần nhận diện `clientOrderId`). Phiên bản thiết kế: orphan-v1.

Tham chiếu ý tưởng: orphan orders trong chrisleekr/binance-trading-bot (Spot profile). Spec này **không** copy Spot/adopt-into-profile; map sang mô hình Futures + monitor + sibling + lệnh web/bot của hệ thống hiện tại.

## 1. Mục tiêu và quyết định sản phẩm

**Orphan** = lệnh đang mở trên sổ sàn (regular hoặc algo) mà **không có chủ sở hữu nội bộ** trong phạm vi tài khoản đang xem: không thuộc monitor đang mở, không thuộc ticket/receipt web còn theo dõi, không khớp quy tắc nhận diện bot đã chốt.

Mục tiêu:

- Người vận hành thấy lệnh “lạc” trước khi chúng khóa margin / chặn TP-SL / chồng sibling.
- Có hành động an toàn: **Hủy** (có quyền) hoặc **Giữ** (có ý thức). Không tự hủy.
- Không suy đoán gán nhầm monitor — gán sai tệ hơn để nguyên.

Không nằm trong v1:

- Tự adopt vào monitor như Spot profile của bot kia (chỉ có **Link gợi ý** khi chứng minh được ownership).
- Tự hủy orphan khi xóa config / tắt bot (trừ khi có playbook riêng sau này).
- Paper book (orphan chỉ tính sổ Live / lệnh sàn thật).
- Thông báo Telegram/Slack đẩy (v1 chỉ badge + list; hai-tick chỉ cho toast trong app nếu làm).

## 2. Nền hiện có và chuỗi dữ liệu

Đã đối chiếu:

- Terminal tab **Lệnh chờ**: `GET /api/orders/open` từ Redis snapshot (`wb:ex`); hủy qua `POST /api/trading/orders/cancel` (+ batch).
- Position case: order dự kiến của monitor vs order sàn (`position-case.js`).
- Monitor Mongo `monitor_positions` (qty own vs sàn, sibling, NOTPSL).
- Lịch sử lệnh web: `web_exchange_order_events` (+ `clientOrderId`).
- Quyền: `orders.view` / `orders.cancel` + scope bot — [auth-rbac-spec](auth-rbac-spec.md).
- Multi-exchange: [multi-exchange-futures-spec](multi-exchange-futures-spec.md) — orphan phải mang `exchange` + identity lệnh đúng sàn.

```text
Redis openOrders + openAlgoOrders (đã lọc account/scope)
  ∪ REST refresh khi user bấm Đồng bộ / mở tab Orphan
  − claimed_set (monitor kỳ vọng + receipt web + clientOrderId bot nhận diện)
  → orphan_candidates[]
UI Terminal tab "Lệnh mồ côi" / badge trên Lệnh chờ
  → Cancel (orders.cancel) hoặc Leave
```

Claimed set (v1):

| Nguồn | Cách claim |
|---|---|
| Monitor mở (`closed: false`) | Cùng account + symbol (+ side/positionSide khi hedge); orderId/algoId nằm trong snapshot case / open orders gắn monitor; hoặc TP/SL/entry mà case panel đã map |
| Web trading receipt / order event gần đây | `orderId`/`algoId`/`clientOrderId` trong `web_exchange_order_events` hoặc receipt còn `open`/`new`/`partially_filled` |
| Bot fingerprint (optional P1) | `clientOrderId` khớp schema deterministic mà binance-bot dùng khi đặt (nếu có và document được) — **đúng một** claimant |

Không claim chỉ vì cùng symbol với một monitor — phải có identity lệnh hoặc fingerprint.

## 3. Định nghĩa và phân loại

| Nhãn UI | Điều kiện | Hành động gợi ý |
|---|---|---|
| `untracked` | Có trên sổ, không claim | Hủy hoặc giữ (thủ công) |
| `stale_monitor` | Monitor đóng/`isClosed` nhưng lệnh còn trên sàn | Hủy thường đúng; không “hồi sinh” monitor từ orphan |
| `web_ticket_gap` | Receipt web lỗi giữa chừng, lệnh vẫn resting | Hủy hoặc đối chiếu Chi tiết |
| `ambiguous` | ≥2 monitor/config có thể nhận | Không Link; chỉ Hủy/Giữ |
| `recognized` (P1) | Đúng 1 fingerprint bot | Nút **Gắn monitor** nếu còn monitor khớp; không thì Hủy/Giữ |

Orphan **không vô hại**: lệnh reduce-only / SL / TP resting có thể khóa hoặc chồng bảo vệ; sibling monitor không được cancel-all symbol khi còn orphan lạ — giữ luật sibling hiện có.

## 4. UI

### 4.1 Chỗ đặt

- Tab mới trong Terminal: **Lệnh mồ côi**, cạnh Lệnh chờ.
- Badge số orphan trên tab Lệnh chờ và (tuỳ chọn) strip Tổng quan Terminal khi `count > 0`.
- Deep-link: `/terminal?tab=orphans&account=ENV`.

Không thêm menu top-level riêng ở v1.

### 4.2 Bảng

Cột tối thiểu: Exchange, Tài khoản (env), Symbol, Side / Position side, Loại (LIMIT/STOP/… + regular|algo), Giá / trigger, Qty, `orderId`/`algoId`, Nhãn phân loại, Lần thấy gần nhất, Nguồn phát hiện (`redis` | `rest`).

Bộ lọc: account (scope), symbol, exchange, kind, nhãn. Sort mặc định: thời điểm phát hiện mới → cũ.

Empty state: “Không có lệnh mồ côi — mọi lệnh mở đang được monitor hoặc web theo dõi.”

### 4.3 Hành động

| Nút | Permission | Hành vi |
|---|---|---|
| **Hủy** | `orders.cancel` | Cùng bridge cancel hiện có; confirm modal: symbol, id, side, qty, cảnh báo “không thuộc monitor” |
| **Hủy hàng loạt** | `orders.cancel` | ≤20; chỉ các dòng user chọn; báo `updated`/`failed` từng dòng |
| **Giữ** | chỉ UI | Đánh dấu session/local “đã xem — cố ý giữ” (không ghi exchange); vẫn hiện trong list với nhãn `left_on_purpose` nếu persist P1 |
| **Gắn monitor** (P1) | `positions.view` + có thể `orders.edit` | Chỉ khi `recognized` và đúng 1 monitor; không picker tự do |

Không có “Adopt vào config bất kỳ”.

### 4.4 Quét

- Lúc mở tab: dùng snapshot Redis như Lệnh chờ; nếu thiếu/stale → cùng đường `POST /api/positions/refresh` (live orders) rồi tính diff.
- Không cron mới phía web ở v1 (tránh REST sàn nền). Badge = tính từ snapshot đã có khi user đang xem Terminal / sau refresh.
- (Tuỳ chọn P1) Bot cron phát hiện orphan → ghi Mongo `orphan_order_sightings` → web chỉ đọc.

Hai-tick: chỉ cho **toast** “orphan mới bền” (thấy 2 lần refresh cách nhau); list vẫn hiện từ tick đầu.

## 5. API đề xuất

Không tin client gửi danh sách orphan đã tự lọc. Server tính diff sau khi đã auth + scope.

| Method | Path | Permission | Ghi chú |
|---|---|---|---|
| `GET` | `/api/orders/orphans` | `orders.view` + scope | Query: `account`, `audience`, `exchange`, `symbol`. Response: `{ asOf, source, items[], counts }` |
| `POST` | `/api/trading/orders/cancel` | đã có | Dùng lại; UI orphan không invent cancel path |
| `POST` | `/api/orders/orphans/link` | P1 | Body: account, order identity, monitorId; 409 nếu không chứng minh được |

Shape item (ví dụ an toàn, không secret):

```json
{
  "exchange": "binance",
  "account": "DEMO_1",
  "symbol": "BTCUSDT",
  "side": "SELL",
  "positionSide": "LONG",
  "kind": "algo",
  "type": "STOP_MARKET",
  "orderId": null,
  "algoId": "123",
  "clientOrderId": null,
  "price": null,
  "stopPrice": "60000",
  "quantity": "0.01",
  "label": "untracked",
  "claimHints": [],
  "firstSeenAt": "2026-11-01T12:00:00.000Z",
  "lastSeenAt": "2026-11-01T12:05:00.000Z"
}
```

## 6. Ranh giới an toàn (bắt buộc)

- Không `cancel-all` theo symbol từ màn orphan.
- Không hủy khi thiếu `orders.cancel` hoặc ngoài scope account.
- Không đổi `positionAmt` / leftover / sibling khi xử lý orphan.
- PAPER: không liệt kê như orphan sàn.
- Mutation ghi audit web (sanitize): account, symbol, orderId/algoId, action cancel/link.
- Ví dụ docs dùng `bot-demo` / `DEMO_1` — không đưa account/signal thật.

## 7. Pha triển khai

| Pha | Nội dung | Nghiệm thu |
|---|---|---|
| **P0** | Diff Redis/REST → tab UI + badge + hủy đơn/batch | Mọi lệnh claimed không hiện; lệnh tay/`NOTPSL` thừa hiện; hủy cập nhật sổ |
| **P1** | Fingerprint `clientOrderId` bot + Link monitor + sighting bền (Mongo) | 0 hoặc >1 claimant → 409; đúng 1 → gắn được |
| **P2** | Cảnh báo Account health / Dashboard khi orphan chặn SL | Deep-link vào tab orphans |

## 8. Test tối thiểu

- Unit: claimed set với monitor + order event + ambiguous hai monitor.
- Integration: mock Redis open orders + Mongo monitors → `GET /orphans` đúng count.
- Permission: user ngoài scope 403; cancel không quyền 403.
- Regression Terminal Lệnh chờ / sibling / PAPER không đổi hành vi.

## 9. Tài liệu phải cập nhật khi làm

- [feature-spec.md](feature-spec.md) (Terminal)
- [terminal-workspace-spec.md](terminal-workspace-spec.md)
- [api-data-reference.md](api-data-reference.md)
- [auth-rbac-spec.md](auth-rbac-spec.md) nếu thêm route
- [flows.md](flows.md) luồng đọc/ghi orphan

## 10. Ngoài phạm vi / không làm nhầm

- Coi mọi lệnh không có monitor là bug của bot copy (có thể là lệnh tay có chủ đích).
- Port nguyên trang Spot “Adopt” của binance-trading-bot.
- Đọc/commit `.env` hoặc trả raw exchange error chứa secret.
