# Smart Money — đặc tả

Ngày: 2026-10-14. Phạm vi: web-bot. Bản đầu: thu thập → snapshot chung → UI → Terminal Dòng tiền → AI `marketContext`.

**Trạng thái:** foundation (collector + API + UI + detector warm-up). Không tuyên bố production-ready chỉ vì build pass. Không deploy / Telegram / mở lệnh tự động trong phạm vi này.

## 1. Nguyên tắc dữ liệu

- Smart Money = nhóm trader do Binance tổng hợp (bapi Smart Signal). Không có danh tính từng trader → không UI giả “cá mập A/B”.
- Phân biệt rõ: số trader vs quantity; whale vs toàn nhóm; tỷ lệ tài khoản vs tỷ lệ vị thế; Smart Money (bapi) vs top trader Futures API.
- Tăng quantity tổng hợp chỉ chứng minh exposure nhóm tăng — thành phần nhóm có thể đổi.
- Timestamp tách: `collectedAt` (lúc hệ thống lấy), `sourceUpdatedAt` (nếu nguồn có), `cohortId`/`signalDay` (mốc nhóm), `periodStart`/`periodEnd` (cửa sổ thống kê), `source`, `schemaVersion`, `quality`.
- Không dùng `signalDay` làm timestamp mọi số liệu. Cohort đổi → `comparable: false` cho delta Smart Money.
- Thiếu dữ liệu = `null` / `unavailable` — không ép 0. Phân biệt: `unsupported` | `warming` | `source_error` | `cooldown` | `stale`.

## 2. License tham chiếu

| Repo | License | Cách dùng |
|---|---|---|
| [0xBennie/binance-smart-money-oi-monitor](https://github.com/0xBennie/binance-smart-money-oi-monitor) | MIT | Tham khảo endpoint/field/semantics; **tái triển khai** trong web-bot, không `npm install` package, không chạy collector gốc |
| [andychien555/binance-smart-money-tracker](https://github.com/andychien555/binance-smart-money-tracker) | Không có LICENSE công khai | Chỉ ý tưởng (z-score, cadence, TradFi filter); **không copy code** |

Ghi nhận: endpoint bapi Smart Money là web API nội bộ Binance, không có docs chính thức; có thể thay đổi hoặc bị chặn theo IP/geo.

**Cùng URL với 0xBennie:** `www.binance.com/bapi/futures/v1/public/future/smart-money/signal/overview`.
Khác biệt vận hành: VPS hay dính 418/Retry-After dài; header browser-like + peer proxy (khi có);
cooldown bapi **không** dừng OI/funding; gap SM ≥15s. Xóa cooldown Redis (chỉ khi chắc WAF đã hết):
`DEL wb:sm:cooldown:bapi`.

## 3. Kiến trúc

```
Scheduler (lease Redis/Mongo)
  → adapters độc lập (SM / OI / funding / top-trader / taker / ticker)
  → normalize (null-safe, cohort, quality)
  → Redis snapshot mới nhất (wb:sm:*)
  → Mongo lịch sử (unique key)
  → detector + candidates (code)
  → REST /api/smart-money/*
  → UI /smart-money | Terminal Dòng tiền | AI marketContext
```

- Một collector trong process web-bot; job có distributed lease.
- Không Mongo/SQLite/R2 song song cho cùng dữ liệu.
- Browser không gọi Binance.
- Limiter/cooldown chia sẻ Redis; bucket theo host (`fapi` ≠ `bapi` ≠ `futures/data`).
- Retention raw mặc định 90 ngày (cấu hình được).

## 4. Chọn symbol

- Env `SMART_MONEY_SYMBOLS=BTCUSDT,ETHUSDT` (CSV): khóa universe đúng list đó — bỏ top-volume/sticky/open-book (dùng khi xem UI / giảm tải).
- Mặc định top N (**10**) crypto USDT perpetual theo `quoteVolume` 24h; chỉ `TRADING`; loại `TRADIFI_PERPETUAL` / non-crypto.
- Bổ sung: symbol đang có vị thế (từ Redis sổ chung, không gắn user) + watchlist hệ thống/user được phép.
- Dedup theo symbol; `SMART_MONEY_MAX_SYMBOLS`.
- Làm mới top volume mỗi 60 phút + thời gian giữ tối thiểu (sticky) tránh churn.
- Symbol rời top: giữ lịch sử; UI “Không còn theo dõi”. Không lộ nguồn (vị thế user nào).

## 5. Lịch thu thập (mặc định ban đầu — phải giảm tải theo weight thực tế)

| Nguồn | Interval | Ghi chú |
|---|---|---|
| Metadata / top volume | 60 phút | Cache dùng chung |
| OI | 5 phút | `futures/data/openInterestHist` ưu tiên |
| Funding | 5–15 phút | Phân biệt current vs last settled; không giả định mọi symbol 8h |
| Top trader / taker | theo bucket đóng | period 1h (bản đầu); `limit=1` bucket mới nhất đã đóng khi phù hợp |
| Smart Money bapi | 30–60 phút / symbol | Gap toàn adapter ~12–15s + jitter |

Bắt buộc: tôn trọng Retry-After; 418/429 → cooldown chung; không đổi proxy để vượt block; không backfill dồn sau downtime; nút Làm mới chỉ enqueue job hợp lệ (TTL/cooldown).

## 6. Quyền

| Permission | Ý nghĩa | Role mặc định |
|---|---|---|
| Đọc Smart Money | Cùng cửa vào Terminal: `positions.view` \| `orders.view` \| `statistics.view` (hoặc `smart_money.view`) | Ai vào được Terminal |
| `smart_money.view` | Alias đọc thị trường (vẫn trong catalog / viewer template) | viewer template |
| `smart_money.manage` | Enqueue refresh hệ thống | admin (+ ops) |

- Menu `/smart-money` và API đọc dùng cùng điều kiện với Terminal.
- Đọc thị trường ≠ quản lý collector.
- So sánh với vị thế cá nhân qua `positions.view` + scope bot hiện có.
- Không tin permission từ client.

## 7. API (chỉ đọc cache/Mongo; refresh qua job)

| Method | Path | Permission |
|---|---|---|
| GET | `/api/smart-money/status` | `smart_money.view` |
| GET | `/api/smart-money/symbols` | `smart_money.view` |
| GET | `/api/smart-money/symbols/:symbol` | `smart_money.view` |
| GET | `/api/smart-money/symbols/:symbol/history` | `smart_money.view` |
| GET | `/api/smart-money/events` | `smart_money.view` |
| GET | `/api/smart-money/candidates` | `smart_money.view` |
| GET/PUT | `/api/smart-money/watchlist` | `smart_money.view` (cá nhân) |
| POST | `/api/smart-money/refresh` | `smart_money.manage` (dedup/rate-limit) |
| GET | `/api/smart-money/money-flow/:symbol` | `smart_money.view` (+ optional position context cần `positions.view`) |

Validate/giới hạn mọi `symbol`/`range`/`limit`.

## 8. Contract snapshot (schemaVersion `sm-v1`)

Mỗi symbol có object chuẩn hóa (rút gọn):

```json
{
  "schemaVersion": "sm-v1",
  "symbol": "BTCUSDT",
  "tracking": { "active": true, "sources": ["top_volume"] },
  "collectedAt": "2026-10-14T12:00:00.000Z",
  "quality": { "overall": "ok", "stale": false, "missing": [] },
  "price": { "mark": null, "changePct24h": null, "quoteVolume24h": null },
  "openInterest": { "qty": null, "notional": null, "delta": {}, "periodStart": null, "periodEnd": null },
  "funding": { "currentRate": null, "intervalHours": null, "sourceUpdatedAt": null },
  "topTrader": { "accountLsr": null, "positionLsr": null, "period": "1h", "periodEnd": null },
  "taker": { "buySellRatio": null, "period": "1h", "periodEnd": null },
  "smartMoney": {
    "cohortId": null,
    "signalDay": null,
    "comparable": true,
    "traders": { "longCount": null, "shortCount": null, "longQty": null, "shortQty": null, "longAvgEntry": null, "shortAvgEntry": null, "longProfitCount": null, "shortProfitCount": null },
    "whales": { "longCount": null, "shortCount": null, "longQty": null, "shortQty": null, "longAvgEntry": null, "shortAvgEntry": null, "longProfitCount": null, "shortProfitCount": null }
  },
  "derived": { "bias": "unclear", "deltas": {}, "distanceToWhaleEntryPct": {} },
  "events": [],
  "candidateHints": []
}
```

## 9. Công thức (code)

- `deltaQty = new − old`; `deltaPct = delta/old*100` chỉ khi `old > 0`.
- Delta tỷ lệ có lãi: điểm phần trăm.
- Notional: qty × giá entry/mark đúng đơn vị; không giả định mọi qty là coin nếu nguồn nói khác.
- Khoảng cách giá tới entry: `(mark − avgEntry) / avgEntry × 100` — **không** phải ROE có leverage.
- OI tăng không xác định riêng Long/Short.
- Funding cost: notional × rate × side; nêu giả định kỳ tiếp theo; không coi annualized là lợi suất bảo đảm.

## 10. Bất thường & ứng viên

- Rolling z-score / cửa sổ cố định khi đủ mẫu hợp lệ; không dùng snapshot lỗi/stale/carry-forward làm mẫu mới; không so qua cohort reset.
- Ngưỡng biến động tối thiểu; cooldown + dedup `symbol+type+direction`.
- Warm-up: hiện tiến độ, không spam cảnh báo.
- Ứng viên: “Ứng viên cần xem xét” — Thiên Long / Thiên Short / Biến động / Mâu thuẫn. Gate chất lượng trước; điểm version hóa; thiếu data → giảm coverage hoặc loại, không inflate score.
- Điểm ≠ xác suất thắng. Danh sách có thể rỗng. Không auto signal trader.

## 11. Terminal & AI

- Terminal chi tiết vị thế: khối **Dòng tiền** từ snapshot chung (không collector riêng).
- AI: thêm `marketContext` đã tính (metrics, timestamps, cohort, coverage, events, candidates). AI chỉ diễn giải; không invent giá/trader/xác suất; thiếu data thì nói rõ.

## 12. Env

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `SMART_MONEY_ENABLED` | `true` | Bật scheduler |
| `SMART_MONEY_TOP_N` | `10` | Top volume |
| `SMART_MONEY_MAX_SYMBOLS` | `30` | Trần tổng (watchlist/vị thế bổ sung) |
| `SMART_MONEY_STICKY_MS` | `7200000` | Giữ symbol rời top tối thiểu |
| `SMART_MONEY_RETENTION_DAYS` | `90` | TTL raw history |
| `SMART_MONEY_SM_GAP_MS` | `13000` | Gap request bapi |
| `SMART_MONEY_LOW_PRIORITY` | `true` | Nhường weight cho trading |

## 13. Kiểm thử tối thiểu

Null ≠ 0; chỉ Long/chỉ Short; sample nhỏ; giá tăng qty không đổi ≠ tăng vị thế; cohort đổi; stale; funding interval khác; hai process không cùng lease; 429 cooldown; top-volume churn giữ history; không rò watchlist/vị thế; candidate thiếu data không điểm cao giả; AI không tạo request sàn.

## 14. Giai đoạn sau (không làm bản đầu)

Order book stream, large trades cửa sổ rõ, on-chain, xuất ảnh, Telegram cá nhân hóa, đánh giá sau cảnh báo.
