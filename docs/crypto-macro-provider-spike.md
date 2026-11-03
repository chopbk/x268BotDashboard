# Provider spike — Market Economy P0a (2026-11-03)

## FRED yields / VIX

| Item | Kết quả |
|---|---|
| Series | DGS3MO, DGS2, DGS5, DGS10, DGS30, VIXCLS |
| Unit | Percent (yields); index daily close (VIXCLS) |
| Frequency | Business daily |
| Endpoint CSV | `https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES&cosd=&coed=` — spike OK, không cần key |
| Endpoint API | `api.stlouisfed.org/fred/series/observations` khi có `FRED_API_KEY` |
| Missing | `.` trong CSV → bỏ qua |
| Attribution | Bắt buộc notice FRED® API (xem UI context) |
| Terms | Operator phải chấp nhận [FRED terms](https://fred.stlouisfed.org/legal/terms/); API ToS hạn chế cache/redistribute — ghi nhận rủi ro; không strip notice |
| Fallback | Giữ last-good per metric; không đổi observedAt khi fetch lỗi |

## Calendar schedule

| Item | Kết quả |
|---|---|
| Candidate | `https://nfs.faireconomy.media/ff_calendar_thisweek.json` (FF-shaped) |
| Schema | `title, country, date, impact, forecast, previous` — **không có actual**, không có stable provider id |
| Coverage | Chỉ tuần hiện tại; `ff_calendar_nextweek.json` → **404** |
| Timezone | `date` có offset (vd `-05:00`); lưu UTC; UI mặc định `Asia/Ho_Chi_Minh` |
| Identity | Hash `title\|country\|date\|impact` → `sourceEventId` / `eventId` |
| Actual | **Schedule-only** — không map FRED/CPI series làm actual; không surprise |
| Terms | Redistributor không chính thức; **gate terms còn mở** — bật production chỉ khi operator xác nhận quyền dùng |
| Gate | Kỹ thuật parse/coverage OK cho “this week”; **không** tuyên bố calendar P0 hoàn chỉnh về terms + next-week + actual |

## Quyết định triển khai

- Core macro US (yields/VIX) + provenance crypto + UI Bối cảnh/Lịch: **shipped** sau flag.
- Actual/consensus release mapping: **chưa** (registry `RELEASE_ACTUAL_MAPPING` rỗng).
- News / reaction / reminder / EU: **P1+**, flag riêng default false.
