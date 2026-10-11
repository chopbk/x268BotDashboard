# Config mới · Thử nghiệm

Trạng thái: spec triển khai + vòng đời, 2026-10-11.

## Mục tiêu

Thêm menu riêng `/config-lab` để thử giao diện theo phong cách shadcn: màu trung tính,
viền mảnh, chữ rõ (cỡ đọc được), khung gọn, form theo nhóm nghiệp vụ giao dịch.
Tab Danh sách `/bots` dùng chung skin lab (heading, stats, filter, bảng). Giữ nguyên route config cũ.
Không thêm framework/dependency. Hai giao diện dùng chung editor, field semantics, API và
quyền. Thử nghiệm chỉ là giao diện: lưu sẽ sửa config thật, Live/Paper giữ đúng giá trị.

Config Lab phải đủ để người dùng bot đi xuyên suốt: tạo config → chọn signal/sync → sửa theo
nhóm → lưu và thấy đồng bộ bot → nhảy sang Position / Static / lịch sử — không bắt buộc quay
lại màn Bot cũ cho các thao tác thường ngày.

## Màn hình

- Danh sách `/config-lab`: dùng GET `/api/bots/assigned-configs`, phạm vi mine/all theo
  contract có sẵn; tìm config/user/signal, trạng thái và Live/Paper. URL lưu bộ lọc để
  quay lại giữ ngữ cảnh. Loading, lỗi có retry, không có config và không có kết quả riêng.
- Chi tiết `/config-lab/:username/:env`: dùng GET/PATCH config hiện có. Menu nhóm bên trái,
  nội dung ở giữa, tóm tắt theo draft bên phải. Header có user/config, Live/Paper, trạng thái
  nhận signal, nhãn thử nghiệm, link cùng config ở giao diện cũ.
- Mobile: nhóm cuộn ngang, form một cột, tóm tắt thu gọn, thanh thao tác không tràn màn hình.

## Vòng đời trên danh sách

1. **Tạo config**: form trên danh sách — chọn user bot được `config.edit`, tên env uppercase,
   tùy chọn `copyFrom` (gõ hoặc chọn từ config actor được `config.view`). API
   `POST /api/bots/:username/accounts` (+ `copyFrom`). Sau khi tạo, mở chi tiết lab của env mới
   và theo dõi APPLY/`LOAD_ACCOUNT` như Bot detail.
2. **Trống / first-run**: khi phạm vi không có config, hiện CTA tạo + gợi ý kiểm tra user bot
   được gán và API key (không tự tạo credential).
3. **Deep-link card**: mỗi card có lối tắt Position (`/positions?account=&env=`), Account Static
   (`/signals?view=statics&username=&env=`), và mở chi tiết lab.
4. **Bulk nhanh** (cùng một user): chọn nhiều card → bật/tắt On hoặc Live/Paper qua
   `POST .../configs/bulk`. Khác user thì không cho bulk. Báo APPLY từng env / tóm tắt.

Đổi tên / xoá account: trên chi tiết lab (cùng API PATCH/DELETE accounts). Bulk đổi tên không làm.

## Nhóm nghiệp vụ

1. Vận hành & Signal: On, Live/Paper, Long/Short, Invert, Monitor, signal và cờ vận hành.
2. Vốn & Khối lượng: mode, trường quyết định size, leverage; trường không quyết định size
   được thu gọn, không mất giá trị khi chuyển mode.
3. Vào lệnh: loại lệnh, spread/wait, max position, risk, mark theo nghĩa đang có.
4. Thoát lệnh: toàn bộ SL, TP, trailing, HP; giữ gợi ý theo type và cảnh báo điều kiện.
5. Bộ lọc: whitelist mode/blacklist, symbol types, filters và tham số; field bot không dùng
   phải giữ nhãn hiện có, không biến thành tính năng đang hoạt động.
6. Copy & Sync: nguồn copy, rate/cap, config nguồn sync, ngoại lệ và scale; giải thích đây
   là liên kết nguồn, không khẳng định runtime đã áp dụng hoặc khóa field chỉ vì có nguồn.

## UX và trạng thái

- Mở ở chế độ xem, config.edit mới có Sửa. Lưu/Hủy cố định, đếm trường thay đổi thực tế.
- Xem thay đổi có bảng trường/trước/sau; nhãn dễ đọc. Chỉ gửi các trường thay đổi trong
  giao diện mới qua PATCH. Không đổi đơn vị/công thức hay reset field đang ẩn.
- Tóm tắt: hướng nhận lệnh, signal, mode/size có điều kiện, vào lệnh, SL/TP/trailing, nguồn
  sync và ngoại lệ. Không tự ước tính rủi ro nếu thiếu giá, ví hoặc dữ liệu signal.
- Signal: thẻ có xóa, ô nhập nhận nhiều tên ngăn bằng phẩy/khoảng trắng, tránh trùng;
  có tìm trong danh sách đã chọn. Gợi ý từ GET `/api/signal-config` (`usage` / channel) khi
  có quyền xem; vẫn cho gõ tên mới. Giữ nguyên chữ hoa/thường theo dữ liệu bot.
- Sync from: gõ hoặc chọn từ config được xem (assigned-configs), giống `copyFrom` khi thêm
  account. Không khóa field chỉ vì có nguồn.
- Guard rời trang chỉ bật khi draft có thay đổi; đổi nhóm giữ draft. Lưu lỗi giữ draft.
- Lưu Mongo thành công không đồng nghĩa runtime đã áp dụng. APPLY_CONFIG / ACK / pending /
  failed và nút thử lại hiện trên thanh lưu lab (không chỉ dòng nhỏ trên toolbar).
- Copy config trên editor: mode `new` | `replace` | `sync` (API copy hiện có). Xoá/đổi tên
  account trên toolbar lab. Không thêm giao dịch lên sàn.
- Journey links trên chi tiết: Lịch sử signal, Lý do bỏ qua, Account Static, Position (theo
  username/env). Audit đầy đủ vẫn ở menu Lịch sử.
- Help: toggle Help vẫn bật gợi ý field; trong lab đặt gần toolbar để dễ thấy.

## Ngoài phạm vi bản này

- Preset mẫu (paper an toàn, scalping…) — thảo luận ghép sau.
- Wizard onboarding đầy đủ (API key + Telegram) — vẫn ở User API / Signal setup.
- Clone một bước từ tab Tìm Signal vào lab — giữ flow Signal Search; lab nhận deep-link
  `/config-lab/:user/:env` khi mở từ nơi khác.
- Thay thế hoàn toàn màn Bot detail — chỉ khi user xác nhận lab ổn.

## Kiểm chứng và bàn giao

Build client; regression API config/auth hiện có; test diff chuẩn hóa, list/filter, mode
không mất field. Kiểm tra giao diện desktop/mobile bằng fixture giả, không gọi backend
production hoặc lưu config thật để thử. Kiểm tra menu cũ còn hoạt động, readonly, đổi nhóm,
review/Hủy/Lưu thành công/lỗi, trạng thái áp dụng, tạo/`copyFrom`, bulk cùng user, copy
mode, sync picker, journey links và quay lại danh sách.

Cập nhật feature-spec/flows/API reference; commit riêng và push đúng upstream theo AGENTS.
Không deploy khi chưa được yêu cầu. Chỉ bỏ giao diện cũ sau khi user xác nhận bản mới ổn.
