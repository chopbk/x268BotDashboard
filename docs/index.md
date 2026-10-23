# Tài liệu web-bot

Bộ tài liệu mô tả implementation được đối chiếu ngày **2026-10-09**. Đây là bản đồ để vận hành và phát triển dashboard, không phải cam kết mọi tính năng đã được kiểm thử trên production.

## Đọc theo nhu cầu

| Cần làm gì | Đọc |
|---|---|
| Hiểu project và ranh giới với bot giao dịch | [Kiến trúc](architecture.md) |
| Biết màn hình làm gì, dữ liệu từ đâu | [Đặc tả tính năng](feature-spec.md) (Báo cáo = `/reports`; Tổng quan gộp Thống kê) |
| Lần theo một thao tác từ UI đến database | [Luồng xử lý](flows.md) |
| Tra endpoint, model, collection và thuật ngữ | [API và dữ liệu](api-data-reference.md) |
| Cầu runtime web → binance-bot (MQTT gửi, ACK Mongo outbox, allowlist) | [Command bridge](bot-command-bridge.md) |
| Roadmap Position/TP-SL/Order gần Binance Web | [Trading Terminal spec](trading-terminal-spec.md) |
| Menu Terminal mới, giữ nguyên Position: parity, UX và roadmap R1–R3 | [Terminal workspace spec](terminal-workspace-spec.md) |
| Hoàn thiện 5 gap Terminal R1: ticket, receipt, TP/SL, SL và view/nháp | [Terminal R1 gaps spec](terminal-r1-gaps-spec.md) |
| Terminal R2 tools: sizing %/USDT/risk, CLI gợi ý, journal + AI coach | [Terminal R2 tools](terminal-r2-tools-spec.md) |
| AI hỗ trợ quyết định Phase 1 (metrics code + schema, Terminal/Ledger) | [AI decision support](ai-decision-support-spec.md) |
| Config Lab (thay UI config cũ) | [Spec Config](config-lab-spec.md) |
| Xếp hạng channel theo feed + PnL thật | [Provider Scorecard](provider-scorecard-spec.md) |
| Nâng trang Tổng quan (health, uPnL, triage) | [Dashboard overview spec](dashboard-overview-spec.md) |
| Process env / restart trên tab Hệ thống | [Remote process env admin](remote-process-env-admin-spec.md) — Phase 1 trên `/system` (admin panel) |
| Terminal Futures cho Bybit, Aster và OKX | [Multi-exchange Futures](multi-exchange-futures-spec.md) |
| Smart Money / dòng tiền thị trường (collector dùng chung) | [Smart Money](smart-money-spec.md), [UI infographic](smart-money-ui-research.md) |
| Hub Thị trường — P0 đã triển khai; R1 nút flow + Top 10/25/50 + collector SM top50 được đặc tả | [Market hub](market-hub-spec.md) |
| Thị trường Intelligence: P0 đã triển khai (context/brief/panel); P1/P2 còn đề xuất | [Market Intelligence spec](market-intelligence-spec.md) |
| Bảng Vị trí & Setup (hỗ trợ/kháng cự, setup, entry signal) | [Vị trí & Setup](market-position-setup-spec.md) |
| Scoring kỹ thuật top 50 đa khung (market-v1) | [Market scoring spec](market-scoring-spec.md), [Formula market-v1](market-formula-v1.md) |
| Sửa code, kiểm tra và chẩn đoán lỗi | [Hướng dẫn phát triển](development.md) |
| Đăng ký, đăng nhập, quyền và scope | [Spec auth/RBAC](auth-rbac-spec.md) |
| Cài Debian, Nginx, HTTPS, cập nhật server | [Deploy Debian](deploy-debian.md) |

## Thứ tự đọc cho người mới

1. [README](../readme.md): cài và chạy local.
2. Kiến trúc → tính năng → luồng xử lý.
3. Chọn module cần sửa trong bảng API/dữ liệu và mở source được liên kết.
4. Đọc spec auth trước mọi thay đổi liên quan tài khoản hoặc quyền.
5. Dùng hướng dẫn phát triển để chọn test và tài liệu phải cập nhật.

## Nguồn chuẩn và cách giữ tài liệu đúng

- `auth-rbac-spec.md` là spec authoritative về auth/RBAC; không tạo role map thứ hai trong tài liệu mới.
- Các tài liệu mới ghi hành vi hiện tại và liên kết implementation. Khi code/spec không khớp, ghi rõ chênh lệch và xử lý có chủ đích; không tự suy ra quyền mới từ menu.
- Thêm/sửa tính năng phải cập nhật mục tính năng, luồng và bảng API/dữ liệu có liên quan trong cùng thay đổi.
- Ví dụ dùng `bot-demo`, `DEMO_1`, `SIGNAL_A`; không đưa tài khoản, signal riêng, IP production, token hoặc bản sao dữ liệu thật vào docs.
- Bộ tài liệu này không thay đổi runtime. Những khoảng trống phát hiện khi đọc code được ghi trong [giới hạn hiện tại](architecture.md#giới-hạn-hiện-tại).
