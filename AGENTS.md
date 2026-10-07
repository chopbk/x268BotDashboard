# AGENTS — web-bot

Web UI cho bot, gồm client React/Vite và server Express/MongoDB.

## Quy tắc bắt buộc với auth và phân quyền

Trước khi sửa bất kỳ phần nào liên quan đăng ký, đăng nhập, cookie/JWT, user, role,
permission, username đăng nhập, field liên kết Telegram/phone hoặc giới hạn bot, phải
đọc toàn bộ:

- `docs/auth-rbac-spec.md`

Implementation hiện tại phải tuân thủ spec đó. Nếu yêu cầu mới buộc thay đổi hành vi đã
được đặc tả, cập nhật spec và regression test trong cùng thay đổi.

Không được:

- tin role/permission do client gửi lên;
- chỉ ẩn UI mà bỏ kiểm tra permission ở server;
- cấp quyền mặc định cho tài khoản tự đăng ký;
- đưa role/permission vào JWT thay cho việc đọc user mới nhất từ Mongo;
- xóa compatibility role `user` khi chưa có migration dữ liệu;
- làm mất invariant luôn còn ít nhất một admin đang hoạt động;
- trả `passwordHash`, JWT hoặc secret trong JSON/log;
- ghi password, password hash, token, API key hoặc API secret vào audit log;
- đọc hoặc commit `.env`.

Sau thay đổi auth/RBAC, tối thiểu chạy:

```sh
npm --prefix server test
npm --prefix client run build
```

## Quy tắc hoàn tất công việc

- Sau khi hoàn thành và kiểm tra xong mỗi prompt sửa lỗi hoặc phát triển tính năng, phải
  tạo một Git commit riêng trước khi bàn giao cho user.
- Commit message phải mô tả đúng thay đổi vừa làm. Không gom thay đổi không liên quan và
  không commit `.env`, secret hoặc file tạm.
- Nếu worktree có thay đổi sẵn của user hoặc tiến trình khác, phải giữ nguyên và chỉ
  commit phần thuộc prompt hiện tại; nếu không thể tách an toàn thì báo rõ trước khi commit.
