# AI hỗ trợ quyết định — Giai đoạn 1

Ngày: 2026-10-13. Phạm vi: web-bot Terminal + Lãi lỗ. Code tính số; AI giải thích theo schema. Không tự đặt lệnh/TP-SL.

## Nguyên tắc

- Chỉ báo, exposure, PnL tới SL, R:R còn lại do **backend**.
- AI nhận snapshot đã tính, trả JSON schema cố định; backend validate.
- Chưa có hồ sơ rủi ro → vẫn phân tích, ghi `missingData: ["risk_profile"]` và “Chưa có ngân sách rủi ro cá nhân”.
- Phase 1 **chỉ đọc** — không nút áp dụng TP/SL.
- `marketContext` (Smart Money / OI / funding / taker / events / candidates) lấy từ snapshot collector dùng chung; AI chỉ diễn giải, không gọi sàn, không bịa trader/xác suất. Spec: [smart-money-spec](smart-money-spec.md). `promptVersion` ≥ `decision-v1.4`.

## UI

- Terminal **Tổng quan**: nút AI mở popup quyết định (không phải báo cáo dài). Bố cục: kết luận + KPI + bảng so sánh phương án trước; bối cảnh TF dạng bảng; bằng chứng mặc định thu gọn; cảnh báo `warn`/`critical` hiện trên. Modal ~1000px desktop, 2 cột khi đủ chỗ.
- Một nút **Phân tích** (AI); quy tắc thuần là lựa chọn phụ. Hồ sơ rủi ro qua nút ⚙. Mở lại hiện báo cáo gần nhất + banner khi fingerprint vị thế/SL-TP đổi.
- `/reports?tab=ledger` (Ví & dòng tiền) khối **AI đánh giá rủi ro**.
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

Văn phong (`promptVersion` ≥ `decision-v1.3`): tiếng Việt gọn, dễ hiểu; `priorities[0]` = khuyến nghị chính (hiện đầu popup); `summary` bối cảnh (không lặp lại trên UI nếu đã có `why`). Báo cáo position có phân tích kỹ thuật; UI so sánh phương án theo bảng (SL/TP/qty/rủi ro USDT toàn vị thế/điều kiện). `meta.positionFingerprint` dùng phát hiện báo cáo cũ.

## Phase 2 (chưa làm)

Stress test đầy đủ, bản nháp TP/SL, tương quan sâu, theo dõi đề xuất theo thời gian.
