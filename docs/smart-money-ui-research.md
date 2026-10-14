# Smart Money UI — nghiên cứu infographic / biểu đồ

Ngày: 2026-10-15. Tham chiếu ý tưởng (không copy code andychien555 — không LICENSE).

## 0xBennie (MIT)

| Thành phần | Cách làm | Bài học cho web-bot |
|---|---|---|
| **Panel card** (`render_panel`) | HTML tối tối + thanh L/S notional, 2 thẻ Long/Short (traders/whales, entry, PNL ước tính, % lãi), footer OI/taker/LSR | Infographic chính trong panel chi tiết symbol |
| **Chart** (`render_chart`) | **Inline SVG**, 3 panel: long qty / short qty / whale avg vs mark — **không** thư viện chart | Dùng history Mongo → SVG trong React |
| Dashboard | Bảng sortable + trang history | Đã có bảng; bổ sung mini bar L/S |

Màu Binance-like: long `#2ebd85`, short `#f6465d`, nền `#151a21`.

## andychien555 (ý tưởng only)

| Thành phần | Cách làm |
|---|---|
| SPA static | `lightweight-charts` (TradingView) cho time-series |
| Layout | Dark charcoal, symbol bar, series nhiều lớp |

**Không** thêm `lightweight-charts` trừ khi user yêu cầu dependency mới. Phase 1: SVG như 0xBennie là đủ và khớp rule “không tự thêm dep”.

## Kiến trúc web-bot (đã chọn)

```
Snapshot latest (Mongo) + history
  → SmOverviewPanel (card L/S + split bar + KPI)
  → SmHistoryCharts (SVG 3 panel từ GET .../history)
  → MarketTable mini L/S bar
```

- Không gọi Binance từ browser.
- null ≠ 0; thiếu điểm → ẩn series / hiện “chưa đủ lịch sử”.
- Không copy branding 0xBennie/andychien vào UI production.

## Phase sau (tùy chọn)

- Thêm `lightweight-charts` nếu cần zoom/crosshair chuyên sâu.
- Export PNG panel (html2canvas) — chỉ khi được yêu cầu.
