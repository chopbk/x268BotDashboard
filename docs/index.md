# Tài liệu web-bot

Bộ tài liệu mô tả implementation được đối chiếu ngày **2026-10-09**. Đây là bản đồ để vận hành và phát triển dashboard, không phải cam kết mọi tính năng đã được kiểm thử trên production.

## Đọc theo nhu cầu

| Cần làm gì | Đọc |
|---|---|
| Hiểu project và ranh giới với bot giao dịch | [Kiến trúc](architecture.md) |
| Biết màn hình làm gì, dữ liệu từ đâu | [Đặc tả tính năng](feature-spec.md) |
| Lần theo một thao tác từ UI đến database | [Luồng xử lý](flows.md) |
| Tra endpoint, model, collection và thuật ngữ | [API và dữ liệu](api-data-reference.md) |
| Cầu runtime web → binance-bot (MQTT, outbox, allowlist) | [Command bridge](bot-command-bridge.md) |
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
