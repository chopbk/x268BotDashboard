# Review Terminal sau triển khai

Ngày 2026-10-12. Review source và fixture trình duyệt; không thử giao dịch live, không chứng nhận toàn bộ R1 hoặc backend trading.

## Đã sửa trong lượt review

- Desktop/tablet: detail nằm dưới bảng, giữ toàn chiều ngang; bỏ grid chia 400–560px cho panel và bỏ slider độ rộng không còn tác dụng.
- Lệnh/Monitor/Timeline: bỏ effect tự mở modal; render case inline theo section. Giữ xem/thêm/sửa/hủy order hiện có, selector monitor, stats và timeline, bổ sung empty state.
- Đổi position/audience remount detail để không mang case/draft cũ sang vị thế mới; chọn hàng mặc định vào Tổng quan và reset monitor selection.
- PositionCasePanel mặc định vẫn render modal đầy đủ cho Position cũ; embedded là opt-in.
- Mobile drawer dùng nền đặc, tránh chữ của bảng phía sau xuyên qua.

Luồng và endpoint giao dịch không thay đổi trong bản sửa bố cục này.

## Gap R1 còn lại cần ưu tiên

| Mức | Vấn đề / bằng chứng source | Tiêu chí sửa |
|---|---|---|
| P1 | `TerminalPage`: Đặt lệnh chỉ chọn `rows[0]` rồi mở panel khi có `selectedRow`. Khi không có position, chỉ hiện hướng dẫn; DetailPanel mặc định `tradeMode=close`. | Ticket Mở độc lập với vị thế đang mở; mở đúng mode và account phải rõ ràng. |
| P1 | `terminal/mutation.js`: mọi response không rỗng, không duplicate đều thành accepted, không kiểm tra `command.status=failed`/`result.success=false`. Các catch dựa vào vài chuỗi timeout; chưa có flow tra receipt đầy đủ. | Phân biệt accepted/rejected/unknown/partial từ contract thật; test lỗi trong response 2xx, disconnect và duplicate của lệnh đã thất bại. |
| P1 | `DetailPanel.defaultProtect`: mặc định cả TP/SL enabled; form không có chọn working type và bật/tắt từng mức. Nút TP/SL trên row đưa thẳng sang confirm mà không qua editor. | Mở đúng editor, giữ mức không sửa, có bật/tắt và working type theo chức năng cũ; kiểm tra payload trước mọi thay đổi. |
| P1 | `terminal/protection.js`: có exchangeSl thì vẫn nhãn SL sàn khi stale; chưa xác minh coverage quantity. | Nêu dữ liệu cũ/chưa xác minh và SL bảo vệ một phần, không kết luận bảo vệ đầy đủ từ một giá trigger. |
| P2 | `TerminalPage` chỉ guard dirty ở một số thao tác; đổi filter/tab và navigation có thể bỏ draft. | Guard thống nhất; không tự reset draft khi người dùng chưa đồng ý. |
| P2 | `onSaveView` chỉ giữ symbol/side/env/warn, thiếu signal; không rename; `rowMatchesSavedView` không áp warn custom view. Sort đang lưu useState, không URL. | View lưu đủ filter có hiệu lực, rename/delete, sort/deep-link/reload nhất quán. |
| P2 | View Cần chú ý đồng thời ép URL `warn=1`, prefilter loại vị thế không có warnings nhưng `needsAttention` vẫn đúng (ví dụ mất heartbeat). | Chỉ dùng định nghĩa attention thống nhất, không lọc bỏ trước bằng warnings. |
| P2 | `summary.js` dùng `Number(row.unrealized)` nên null thành 0, không tăng missingPnl. | Giữ null/empty là thiếu dữ liệu, coverage đúng. |
| P2 | History/OpenOrders dùng lại nguyên component cũ: lịch sử vẫn modal, bộ lọc có phần lặp và một số filter header không có hiệu lực ở orders. | Adapter/view riêng phù hợp từng tab; hiển thị chi tiết lịch sử trong workspace theo spec. |
| P2 | `ConfirmDialogs` vẫn là modal riêng; không phải preview/confirm trong cùng panel như spec. | Chuyển xác nhận vào flow ticket, tránh nhiều lớp chồng nhau. |

Các mục trên là gap đã thấy, chưa phải audit exhaustive về permission, idempotency đồng thời, PAPER/One-way hoặc tính đúng backend. Cần test các invariant đó trước khi tuyên bố parity P01–P22 hoàn tất.

R2/R3 (candles, sizing theo rủi ro, fills tab, journal/CSV, multi-TP, automation BE) chưa triển khai theo roadmap; không tính là regression của lượt sửa UI này.

## Kiểm chứng bản sửa

- Build client và tests Terminal/position helpers.
- Fixture local: API bị thay bằng dữ liệu giả, mọi mutation bị chặn, WebSocket không kết nối sàn/DB.
- Bấm position → Lệnh → Monitor → Timeline: nội dung tương ứng inline, không có dialog mới.
- Desktop 1440px: bảng và detail đều rộng 1400px trong fixture padding 20px; không overflow trang, không có dialog.
- Mobile 390px: drawer toàn màn hình, nội dung timeline và selector monitor đọc được.
- Chưa kiểm chứng deployment thật hoặc đầy đủ các mutation/permission matrix.
