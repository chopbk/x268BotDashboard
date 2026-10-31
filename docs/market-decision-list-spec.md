# Thị trường — danh sách quyết định (Location P1)

Ngày: 2026-10-31. Trạng thái: **đã triển khai (P1a list)** — `context.decision`, preset quyết định, cột bảng Location, tests `market-decision-list`.
Phạm vi: tab Kỹ thuật → view `location`. Không đổi market-v1 score, zone/setup lifecycle, quyền RBAC hay engine đặt lệnh.

Bổ sung cột và preset để nhìn danh sách là biết **theo dõi / chờ / trong vùng / bỏ**, kèm entry–invalidation–RR tham khảo, mâu thuẫn ngắn, nhãn Giá×OI (khi có flow), badge “vừa đổi”, và deep-link Terminal/Dòng tiền.

Authority liên quan: [Location & Setup](market-position-setup-spec.md), [Market Intelligence](market-intelligence-spec.md) §6–7 (P1), [Market hub](market-hub-spec.md), [auth/RBAC](auth-rbac-spec.md). Khi xung đột hành vi runtime Location v1, giữ contract Location cho đến khi migration riêng.

## 1. Mục tiêu

Trong ≤30 giây trên bảng Location, người dùng:

1. Lọc đúng tập “đáng xem hôm nay” bằng preset quyết định.
2. Đọc cột **Hành động** + Entry/Inv/RR mà không mở panel.
3. Thấy lý do **không vào** (mâu thuẫn) ngay trên dòng.
4. (Nếu có quyền flow) thấy nhãn Giá×OI để lọc bounce rỗng / conviction.
5. Ưu tiên dòng **vừa đổi**; mở Terminal hoặc Dòng tiền một click.

Không tuyên bố xác suất thắng. RR chưa gồm phí/slippage/funding. `in_entry` ≠ fill lệnh. Invalidation cấu trúc ≠ stop order đã đặt. Giá×OI là quan sát leverage cùng chiều/ngược, không phải nhận diện cá voi.

## 2. Phạm vi P1a (làm trong đợt này)

| Có | Không (để sau) |
|---|---|
| `context.decision` trên mỗi row location | Relative return 7d / scatter / percentile ATR |
| Preset mới + sort `priority` | Liquidation stream/heatmap, CVD chart |
| Cột UI: Hành động, Entry·Inv·RR, Mâu thuẫn, OI×Giá, badge mới | Research “Theo dõi kịch bản” (inbox P0 riêng) |
| Deep-link Terminal + Dòng tiền (đã có quyền) | Notification Telegram/email |
| Giá×OI khi `includeFlow=1` và snapshot SM có `oi.deltaPct` | Footprint / DOM / order-book heatmap |

## 3. Contract `context.decision`

Additive trên `buildRowContext` → field `decision`. Version riêng `market-decision-v1` (không ghi đè `market-context-v1`).

```text
decision: {
  version: "market-decision-v1",
  action: "watch" | "wait_confirm" | "in_zone" | "skip",
  actionLabel: string,           // tiếng Việt ngắn
  actionReason: string | null,   // một câu vì sao
  side: "long" | "short" | null,
  setupType: string | null,
  entryState: string | null,
  entryLow, entryHigh,           // number | null
  invalidationLevel,             // number | null
  targetLevel,                   // biên gần vùng đối diện còn hiệu lực
  targetRole: "resistance" | "support" | null,
  rr: number | null,             // làm tròn 2 chữ số; null nếu thiếu/sai hướng
  rrNote: "chưa gồm phí/slippage/funding; RR tại entry bất lợi trong band",
  conflictsShort: string[],      // ≤3 nhãn ngắn (vd. "HTF ngược", "Flow ngược")
  oiRegime: "new_long" | "covering" | "new_short" | "flush" | null,
  oiRegimeLabel: string | null,  // "Long mới" | "Covering" | …
  oiRegimeReason: string | null, // thiếu data / stale
  priceChangePct: number | null, // cửa sổ dùng cho regime (ưu tiên 24h ticker)
  oiDeltaPct: number | null,     // từ SM openInterest.deltaPct khi có
  changed: {
    kind: "setup_new" | "retest" | "in_entry" | null,
    label: string | null,        // "Mới 12p"
    at: ISO | null,
    ageMs: number | null
  },
  relativeVsBtc24h: number | null, // changePct24h_coin − changePct24h_BTC; null nếu thiếu
  links: { terminal: true, flow: boolean }  // chỉ cờ; URL do client ghép theo quyền
}
```

Thiếu setup active: `action` vẫn có thể `watch` (gần vùng) hoặc `skip` (xa / unknown); `rr`/`entry*` null.

## 4. Quy tắc derive

### 4.1 Hành động (`action`)

Ưu tiên từ cứng → mềm (khớp một cái thì dừng):

1. **`skip`** nếu:
   - `priceFresh === false`, hoặc
   - `location.quality` ∈ {`stale`,`error`,`missing`} và không có setup active, hoặc
   - setup active nhưng HTF **ngược hẳn** hướng setup (`oppositeStructure`), hoặc
   - không có setup active **và** không near/in support|resistance.
2. **`in_zone`** nếu setup `lifecycle=active`, `entryState=in_entry`, `priceFresh`, quality ∈ {`ready`,`partial`}.
3. **`wait_confirm`** nếu setup active và (`entryState=awaiting_entry` hoặc thiếu `touchEvidence` khi đã in_entry không đạt (2)).
4. **`watch`** nếu near/in vùng hoặc setup active còn lại.

Nhãn UI: `Theo dõi` / `Chờ xác nhận` / `Trong vùng` / `Bỏ qua`.

### 4.2 RR tham khảo

Chỉ tính khi có setup active với `entryLow/High`, `invalidationLevel`, và vùng đối diện:

- Long: target = `resistance.low` (biên gần phía trên); Short: target = `support.high`.
- Entry bất lợi: Long dùng `entryHigh`, Short dùng `entryLow`.
- Long yêu cầu `S < E < T`; Short `T < E < S`. Sai hướng hoặc `|E−S|=0` → `rr=null`.
- `rr = |T−E| / |E−S|`, làm tròn 2 chữ số.

Không invent target để đạt RR đẹp. Không dùng giá live ngoài band làm E.

### 4.3 `conflictsShort`

Rút từ `obstacles` / conflicts đã có trong context P0, map id → nhãn ≤18 ký tự:

| id nguồn | nhãn |
|---|---|
| `htf_conflict`, `setup_htf`, `htf_vs_structure` | HTF ngược |
| `flow_vs_setup` | Flow ngược |
| `score_conflict`, `composite_conflict` | Điểm conflict |
| `near_resistance` (setup long) | KC gần |
| `near_support` (setup short) | HT gần |
| `price_stale`, `price_not_fresh` | Giá cũ |
| `data_stale`, `frame_quality` | Data cũ |
| `flow_stale` | Flow cũ |
| `zone_conflict`, `sr_squeeze` | Kẹp S/R |

Tối đa 3; thứ tự ưu tiên: HTF → Flow ngược → Giá/Data cũ → còn lại.

### 4.4 Giá × OI (`oiRegime`)

Chỉ khi flow không stale và `oiDeltaPct` hữu hạn; `priceChangePct` từ ticker 24h của row (cùng response). Ngưỡng chết: `|Δ| < 0.15` coi như 0 (tránh nhiễu).

| Giá | OI | regime | nhãn |
|---|---|---|---|
| ↑ | ↑ | `new_long` | Long mới |
| ↑ | ↓ | `covering` | Covering |
| ↓ | ↑ | `new_short` | Short mới |
| ↓ | ↓ | `flush` | Flush |

Thiếu flow / stale / thiếu OI → `oiRegime=null`, `oiRegimeReason` rõ. Không suy “cá voi mua”.

### 4.5 Badge `changed`

Cửa sổ **2 giờ** từ `now` (read-time):

1. `setup_new` nếu `primarySetup.createdAt` trong cửa sổ.
2. Else `retest` nếu `recentEvents` có `type=retest` với thời gian trong cửa sổ (nếu event có `at`/`time`; không có thì bỏ).
3. Else `in_entry` nếu `firstTouchedAt` trong cửa sổ.
4. Else `changed.kind=null`.

`label`: `Mới {N}p` / `{N}h` theo `ageMs`.

### 4.6 Relative vs BTC 24h

Trong một lần list: lấy `changePct24h` của `BTCUSDT` trong cùng batch (hoặc universe meta).  
`relativeVsBtc24h = coin − btc` (điểm phần trăm). Thiếu BTC hoặc thiếu coin → null. **Không** gọi alpha đã điều chỉnh beta. Preset “Mạnh hơn BTC” chỉ dùng metric này.

## 5. Preset / screen mới

Giữ screen cũ. Thêm (normalize fail → `all`):

| screen | Điều kiện |
|---|---|
| `trend_retest` | `primarySetup.type=breakout_retest`, `lifecycle=active`, không `oppositeStructure` HTF |
| `in_entry_fresh` | active + `in_entry` + `priceFresh` + quality ready\|partial |
| `has_conflict` | có setup active **và** (`conflictsShort.length>0` hoặc obstacle HTF/flow) |
| `stronger_btc` | `relativeVsBtc24h > 0` (chỉ 24h; nhãn UI ghi rõ) |
| `decision_ready` | `action ∈ {in_zone, wait_confirm}` |

Preset cũ `buy_zone` / `sell_zone` / `flow_aligned` / … giữ nguyên nghĩa.

URL: `/market?tab=technical&view=location&screen=decision_ready&analysisTf=1h&top=10`.

Khi `canFlow`, client location **luôn** gửi `includeFlow=1` (không chỉ `flow_aligned`) để có OI regime / conflict flow. Không có quyền flow: không gọi SM; `oiRegime` null, preset `flow_aligned` ẩn như hiện tại.

## 6. Sort `priority`

`sort=priority` (mặc định location khi client không gửi sort, **hoặc** alias của `default` nâng cấp — chọn: **nâng `default`** theo bậc dưới để không đổi URL cũ):

1. `action`: in_zone → wait_confirm → watch → skip  
2. Trong nhóm: `distanceAtr` gần nhất (support|resistance) tăng  
3. `changed.kind != null` trước  
4. `volumeRank` tăng  
5. `symbol` A→Z  

`sort=rr` (desc mặc định phía client): null last. `sort=action` theo bậc action.

## 7. UI bảng Location

### 7.1 Cột (desktop)

| Cột | Nội dung |
|---|---|
| Coin | Symbol + link Dòng tiền (quyền) + badge `changed.label` |
| Giá / Δ | Như cũ |
| Cấu trúc | Như cũ |
| Hành động | `actionLabel` + màu: in_zone xanh, wait_confirm ấm, skip muted, watch trung tính; tooltip `actionReason` |
| Entry · Inv · RR | `entryLow–entryHigh · inv · RR x.xx` hoặc `—`; tooltip `rrNote` |
| Vị trí | Giữ sub S/R ngắn như hiện tại (có thể thu gọn) |
| Setup / Trigger | Như cũ |
| Mâu thuẫn | `conflictsShort.join(" · ")` hoặc `—` |
| OI×Giá | `oiRegimeLabel` hoặc `—`; ẩn cột nếu toàn batch không có flow (optional: luôn hiện `—`) |
| Cần chờ / Cản trở | Giữ; mobile có thể ẩn OI×Giá + Entry |

Mobile: ưu tiên Coin (kèm action + badge), Giá, Hành động, Setup; Entry/RR và Mâu thuẫn trong sub-line.

### 7.2 Bộ lọc

Select “Màn hình” thêm nhóm quyết định:

- Sẵn sàng quyết định (`decision_ready`)
- Thuận xu hướng, chờ retest (`trend_retest`)
- Trong vùng, còn hiệu lực (`in_entry_fresh`)
- Có mâu thuẫn (`has_conflict`)
- Mạnh hơn BTC 24h (`stronger_btc`)

Giữ các option cũ phía dưới.

### 7.3 Deep-link

- Terminal: `/terminal?symbol=…` khi `canTerminal` (đã có pattern).
- Dòng tiền: như nút hiện có.
- Không thêm nút “Theo dõi” cho đến khi research inbox ship; không tạo stub gây hiểu nhầm đã lưu.

## 8. API / file đụng

| Thành phần | Thay đổi |
|---|---|
| `server/src/lib/market/decision-list.js` | **Mới** — pure helpers: RR, action, oiRegime, changed, relative, conflictsShort, `buildDecision` |
| `market-context.js` | `buildRowContext` gọi `buildDecision`; export version |
| `location-read.js` | SCREENS mới; `matchScreen`; sort priority/rr/action; gắn `relativeVsBtc24h` sau khi biết BTC |
| `read-api.js` | `mapFlowSnapshot` thêm `deltaPct`; sau loop gắn relative vs BTC; mặc định sort |
| `MarketLocationTable.jsx` / `MarketPage.jsx` | Cột + preset + `includeFlow` |
| `market.css` | Badge / action tone |
| Tests | `server/test/market-decision-list.test.js` (+ mở rộng location/context nếu cần) |

Read-api **không** POST collector. Poll client giữ 30s. Payload tăng nhẹ (~200B/row); cắt `conflictsShort` và không dump raw SM.

## 9. Quyền và an toàn

- Gate list location không đổi.
- `includeFlow` chỉ hữu ích khi actor đọc được SM snapshot (cùng helper hiện có); thiếu quyền → không ép lỗi, field null.
- Không đưa account/env/position vào `decision`.
- Không tin `action`/`rr` từ client; mọi derive server-side.

## 10. Kiểm thử nghiệm thu

| ID | Chứng minh |
|---|---|
| D1 | Fixture setup long in_entry + resistance → `action=in_zone`, `rr` hữu hạn, hướng đúng |
| D2 | HTF ngược setup → `action=skip`, `conflictsShort` có HTF ngược |
| D3 | Giá↑ OI↑ → `new_long`; Giá↑ OI↓ → `covering`; thiếu OI → null + reason |
| D4 | `screen=decision_ready` chỉ còn in_zone \| wait_confirm |
| D5 | `stronger_btc` lọc đúng khi BTC và coin có changePct24h |
| D6 | Setup tạo trong 2h → badge `Mới …`; ngoài cửa sổ → không badge |
| D7 | Không `includeFlow` → oiRegime null, list vẫn 200 |
| D8 | market-v1 scores / setup lifecycle fixtures cũ không đổi |
| D9 | Client build; server test liên quan pass |
| D10 | UI: preset mới trên URL; cột RR/`—`; Terminal link theo quyền |

## 11. Roadmap tiếp

- P1b: timeline event store + relative 7d/scatter (Intelligence §9).
- P1c: research inbox “Theo dõi” gắn `setupId` ([research-tracking-inbox-spec](research-tracking-inbox-spec.md)).
- P2: liquidation / CVD trên panel, không nhồi list.
