# AI hỗ trợ quyết định — Giai đoạn 1

Ngày: 2026-10-13. Phạm vi: web-bot Terminal + Lãi lỗ. Code tính số; AI giải thích theo schema. Không tự đặt lệnh/TP-SL.

## Nguyên tắc

- Chỉ báo, exposure, PnL tới SL, R:R còn lại do **backend**.
- AI nhận snapshot đã tính, trả JSON schema cố định; backend validate.
- Chưa có hồ sơ rủi ro → vẫn phân tích, ghi `missingData: ["risk_profile"]` và “Chưa có ngân sách rủi ro cá nhân”.
- Phase 1 **chỉ đọc** — không nút áp dụng TP/SL.

## UI

- Terminal panel tab **AI phân tích** (Journal chỉ ghi chú).
- `/ledger` khối **AI đánh giá rủi ro**.
- Dashboard: link/badge khi báo cáo account gần nhất `riskLevel` ∈ attention|high.

## Hồ sơ rủi ro

`GET/PUT /api/auth/me/risk-profile` — field `web_users.riskProfile`.

## API quyết định

| Method | Path | Permission |
|---|---|---|
| POST | `/api/terminal/decision/position` | `positions.view` + scope |
| POST | `/api/terminal/decision/account` | `positions.view` hoặc `statistics.view` + scope |
| GET | `/api/terminal/decision/reports` | actor sở hữu report |

Collection: `web_ai_decision_reports`.

## Schema báo cáo

`summary`, `riskLevel` (`normal|attention|high|insufficient_data`), `findings[]`, `scenarios[]` (≤3), `priorities[]`, `missingData[]`, `invalidationConditions[]`, `snapshotId`, `asOf`, `meta`.

Văn phong (`promptVersion` ≥ `decision-v1.1`): tiếng Việt gọn, dễ hiểu, chuyên nghiệp; tránh jargon hệ thống; `summary` 1–2 câu nêu tình trạng + việc ưu tiên.

## Phase 2 (chưa làm)

Stress test đầy đủ, bản nháp TP/SL, tương quan sâu, theo dõi đề xuất theo thời gian.
