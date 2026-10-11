# Config · Giao diện chính

Trạng thái: thay thế UI config cũ, 2026-10-11.

## Vai trò màn hình

| Màn hình | Việc làm |
|---|---|
| **Danh sách** `/bots` | Active, phạm vi (public/private), chủ sở hữu; peek Static / Config / lãi lỗ tất cả |
| **Config** `/config-lab` | Tạo account/config, copyFrom, lọc, bulk Config nhanh, xoá hàng loạt, mở chi tiết |
| **Chi tiết** `/config-lab/:user/:env` | Form sửa ngay; có thay đổi thì hiện diff + Lưu; copy/đổi tên/xoá; APPLY/ACK; journey |

Route cũ `/bots/:username` và `/bots/:username/accounts/:env` **redirect** sang Config Lab.
Không còn menu “Config mới · Thử nghiệm”.

## Đủ để dùng liên tục

Đã có (parity với BotDetail + AccountConfig cũ):

- Tạo config (uppercase + `copyFrom` từ config được xem)
- Đổi tên / xoá một config; bulk xoá nhiều env cùng user
- Config nhanh bulk: On/Long/Short/Paper/Monitor, mode, cost, leverage, signals
- Sửa đầy đủ 6 nhóm + signal thẻ + sync picker + copy new/replace/sync
- Live-edit: không cần bấm Sửa; dirty → diff + Lưu / Hoàn tác
- APPLY_CONFIG / ACK / thử lại trên savebar
- Deep-link Position, Account Static, lịch sử signal, lý do bỏ qua
- Lọc theo user / signal text / On / Live·Paper; URL giữ ngữ cảnh

## Còn ngoài Config (cố ý)

- Đổi **username bot**, Active/phạm vi/chủ → Danh sách
- Credential API → User API
- Thêm/gỡ signal hàng loạt nhiều user → tab Signal · Cấu hình Signal
- Clone theo hiệu suất → tab Signal · Tìm Signal (sau đó mở Config)
- Preset mẫu / wizard API+Telegram — chưa làm

## Kiểm chứng

Build client; redirect route cũ; link Dashboard/Static/Signal trỏ `/config-lab`.
Commit + push theo AGENTS. Deploy khi được yêu cầu / theo quy trình repo.
