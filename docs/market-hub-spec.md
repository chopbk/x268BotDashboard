# Hub Thị trường — gộp điều hướng Kỹ thuật và Dòng tiền

Ngày: 2026-10-16. Trạng thái: **P0 đã triển khai** (hub UI + redirect; API/collector không đổi).
Phạm vi: `web-bot`, P0 giao diện và điều hướng.

## 1. Quyết định sản phẩm

Một mục menu **Thị trường**, hai tab chính **Kỹ thuật** và **Dòng tiền**. Giữ nguyên hai pipeline dữ liệu và ý nghĩa chỉ số:

- Kỹ thuật trả lời giá/cấu trúc đang ủng hộ Long hay Short, theo market-v1.
- Dòng tiền trình bày vị thế trader/whale, OI, funding, taker và candidates Smart Money.
- Điểm kỹ thuật, điểm candidate và bias dòng tiền không cộng chung, không chuyển thành một “điểm vào lệnh”.

P0 gom menu, route và trải nghiệm chuyển góc nhìn. **Panel chi tiết vẫn thuộc từng tab**; panel symbol chung là P1a, không phải điều kiện nghiệm thu P0.

Nguồn nghiệp vụ: [Market scoring](market-scoring-spec.md), [Formula market-v1](market-formula-v1.md), [Smart Money](smart-money-spec.md). Quyền theo [auth/RBAC](auth-rbac-spec.md), không tạo role map mới.

## 2. Hiện trạng đã đối chiếu

| Thành phần | Hiện tại | Hệ quả cho P0 |
|---|---|---|
| Route/menu | `App.jsx` có `/market` và `/smart-money` riêng | Thay bằng một menu và một hub; giữ route cũ làm redirect |
| Kỹ thuật | `MarketPage.jsx`: bộ lọc, sort, 5 timeframe, composite, breakdown, lịch sử, panel | Tái sử dụng nội dung, chỉ điều chỉnh shell và điều hướng |
| Dòng tiền | `SmartMoneyPage.jsx`: `tab=market/notable/watchlist`, bộ lọc, AI, panel, lịch sử | Đổi query tab phụ để tránh xung đột với tab chính |
| Gate Smart Money | API nhận `smart_money.view` hoặc quyền Terminal; UI hiện chỉ nhận quyền Terminal | P0 phải sửa gate UI theo contract backend |
| Flow trong Market | `market/read-api.js:getSymbolDetail` đã đính kèm flow snapshot tùy khả dụng | Giữ contract này; không thêm request SM từ tab Kỹ thuật |
| Tải nền | Market poll mỗi 12 giây khi scoring chưa hoàn tất; SM tải theo mount/filter, AI qua nút bấm | Không mount hai trang cùng lúc hoặc tạo poll mới |
| Watchlist | Cá nhân actor; UI hiện lọc danh sách snapshot đang tải bằng membership watchlist | Giữ nghiệp vụ hiện tại; không hứa P0 sẽ kéo đủ mọi symbol đã lưu |

Số lượng symbol thuộc cấu hình collector, không thuộc tab UI. Top 50 kỹ thuật và tập SM có thể khác nhau; không mở rộng SM lên 50 chỉ vì gom menu. Bộ chọn Top của Dòng tiền không được diễn giải là thay đổi universe collector.

## 3. Bố cục và tương tác

```text
Menu: Thị trường
└── Tiêu đề: Thị trường
    ├── Kỹ thuật
    │   ├── Tổng quan / chất lượng / bộ lọc / ma trận điểm
    │   └── Panel kỹ thuật của symbol
    └── Dòng tiền
        ├── Tổng quan | Đáng chú ý | Watchlist
        ├── Trạng thái collector / bộ lọc / AI / bảng tương ứng
        └── Panel dòng tiền của symbol
```

- Tab phụ cũ “Thị trường” của SM đổi nhãn thành **Tổng quan**. “Đáng chú ý” và “Watchlist” chỉ thuộc Dòng tiền.
- Một tiêu đề trang; loại bỏ tiêu đề/menu trùng khi nhúng nội dung. Giữ status, coverage, cảnh báo và thao tác riêng từng tab.
- Tab mặc định là Kỹ thuật nếu có quyền, nếu không là Dòng tiền. Không dùng tab lần trước trong localStorage để ghi đè deep-link.
- Bấm dòng mở panel hiện tại; bấm ô timeframe vẫn mở breakdown khung tương ứng.
- Chuyển tab chính giữ symbol đang chọn. Nếu bên đích chưa có dữ liệu, hiển thị trạng thái thiếu dữ liệu của bên đó, không đóng panel hoặc tự chọn coin khác.
- Đóng panel xóa `symbol`; đóng panel kỹ thuật đồng thời xóa `tf` như hiện tại. Không xóa bộ lọc bảng.
- Chọn candidate giữ hành vi mở Tổng quan Dòng tiền với đúng symbol.
- Link qua lại dùng “Xem dòng tiền” / “Xem kỹ thuật”; chỉ hiện khi có quyền tab đích. Link Terminal chỉ hiện khi có quyền Terminal.
- Desktop giữ bố cục bảng/panel hiện có. Mobile bảo đảm hai cấp tab phân biệt, bảng cuộn ngang trong container, nút đóng panel luôn truy cập được; không mở hai panel đồng thời.
- Tab có trạng thái active, thao tác được bằng bàn phím và tên truy cập rõ ràng. Khi panel đóng, trả focus về nơi mở nếu còn tồn tại.

## 4. Contract URL

### 4.1 URL chuẩn

| Query | Ý nghĩa / mặc định |
|---|---|
| `tab=technical\|flow` | Tab chính; mặc định theo quyền |
| `flowTab=overview\|notable\|watchlist` | Tab phụ Dòng tiền; mặc định `overview` |
| `symbol` | Symbol chung của panel; chuẩn hóa uppercase theo validator hiện có |
| `q` | Tìm symbol chung cho hai bảng; giữ khi chuyển tab |
| `style,tf,side,regime,minScore,consensus,fresh,sort,dir` | Chỉ Kỹ thuật đọc; giữ tên và mặc định hiện tại |
| `top,bias,freshness,anomaly` | Chỉ Dòng tiền đọc; giữ tên và mặc định hiện tại |

Ví dụ:

```text
/market?tab=technical&style=intraday&symbol=BTCUSDT&tf=1h
/market?tab=flow&flowTab=overview&symbol=BTCUSDT
/market?tab=flow&flowTab=watchlist&bias=lean_long
```

- URL là nguồn chuẩn cho lựa chọn và filter. Giữ tham số của tab không active để chuyển lại không mất filter; chỉ gửi tham số thuộc domain đang đọc vào API.
- Tab chính không có/không hợp lệ: chuẩn hóa bằng `replace` về tab mặc định theo quyền. `flowTab` không hợp lệ: về `overview`. Giá trị filter sai đi qua validation/default hiện có, không bypass validation server.
- Người dùng chọn tab, tab phụ hoặc symbol: dùng history push. Gõ tìm kiếm và chuẩn hóa URL: replace. Back/Forward khôi phục tab, bộ lọc, symbol và timeframe đúng URL, không phát mutation.
- `q` chỉ lọc bảng, không ngăn tải panel symbol từ deep-link. Symbol không nằm trong bảng vẫn có thể mở panel nếu API có dữ liệu.
- Không nhân đôi một query key; khi URL lặp key, lấy giá trị đầu qua `URLSearchParams.get` và chuẩn hóa về một giá trị.

### 4.2 Tương thích link cũ

Redirect phía router bằng replace, trước khi mount nội dung; không mount SmartMoneyPage cũ rồi mới chuyển.

| URL cũ | URL đích |
|---|---|
| `/market` | `/market?tab=technical` nếu được phép; nếu chỉ có flow thì `tab=flow` |
| `/market?symbol=BTCUSDT&tf=1h` | Thêm tab mặc định, giữ các query hiện có |
| `/smart-money` | `/market?tab=flow&flowTab=overview` |
| `/smart-money?tab=market` | `/market?tab=flow&flowTab=overview` |
| `/smart-money?tab=notable` | `/market?tab=flow&flowTab=notable` |
| `/smart-money?tab=watchlist&symbol=BTCUSDT&top=20` | `/market?tab=flow&flowTab=watchlist&symbol=BTCUSDT&top=20` |

Đối với `/smart-money`, legacy `tab` quyết định `flowTab`; thiếu/sai thì `overview`, ghi đè `flowTab` đầu vào nếu xung đột. Giữ các query còn lại và hash, encode bằng URLSearchParams; query lạ không được chuyển thẳng sang API. Sau redirect áp dụng quyền hub ở mục 5. Không tạo vòng lặp redirect.

Rà mọi link nội bộ `/smart-money` và đổi sang URL chuẩn, gồm link từ Market và breadcrumb/navigation nếu có. Route redirect phải tiếp tục tồn tại để bookmark ngoài app hoạt động; không đổi `/api/smart-money/*`.

## 5. Phân quyền

Dùng permission trong session từ server; API vẫn là lớp bảo vệ quyết định.

```text
canTerminal = positions.view OR orders.view OR statistics.view
canTechnical = market.view OR canTerminal
canFlow = smart_money.view OR canTerminal
canMarketHub = canTechnical OR canFlow
```

| Quyền đọc hiệu lực | Menu / tab được thấy | Mặc định |
|---|---|---|
| Chỉ `market.view` | Thị trường / Kỹ thuật | Kỹ thuật |
| Chỉ `smart_money.view` | Thị trường / Dòng tiền | Dòng tiền |
| Cả hai hoặc một quyền Terminal | Thị trường / cả hai tab | Kỹ thuật |
| Không có quyền nào ở trên | Không có menu; direct URL hiện trang không có quyền hiện có | Không gọi API nghiệp vụ |

- Chỉ có một tab được phép vẫn hiển thị tên tab đó để định vị; không hiển thị tab bị cấm.
- URL yêu cầu tab không có quyền nhưng còn tab khác: replace sang tab được phép, giữ filter/symbol và báo ngắn “Bạn không có quyền xem tab đã chọn”. Không gọi API tab bị cấm.
- Chưa đăng nhập đi qua auth flow hiện có. Khi API trả 401/403, xử lý session/quyền theo cơ chế hiện có, dừng request lặp bị từ chối; không coi 403 là “chưa có dữ liệu”.
- Không cấp thêm permission, thay role template, gộp `market.manage` và `smart_money.manage` hoặc đổi middleware backend.
- Market refresh vẫn cần `market.manage`. SM refresh vẫn dùng quyền đọc SM và giới hạn/nhánh manage hiện có. AI, watchlist giữ authorization, CSRF và rate limit hiện tại.
- Flow tóm tắt đã được trả bởi Market detail tiếp tục theo quyền Market hiện hành. Điều này không cấp quyền đọc toàn bộ SM, gọi AI SM hoặc sửa watchlist cho user chỉ có `market.view`.

## 6. Dữ liệu và vòng đời request

Chuỗi đọc: menu/deep-link → gate hub → chọn tab → nội dung hiện có → API domain → read-api/cache/Mongo → bảng/panel domain.
Chuỗi ghi hiện có: thao tác watchlist → API SM theo actor → Mongo watchlist → cập nhật UI; nút refresh → scheduler hiện có; nút AI → endpoint AI hiện có.

- Chỉ mount nội dung tab chính active. Unmount phải dọn interval và abort request nếu hỗ trợ, hoặc bỏ qua response đã hết hiệu lực. Không dùng CSS hide để giữ hai trang cùng fetch.
- Giữ cache/dedup của `api.js`; không thêm dependency hay lớp collector/cache song song.
- Chuyển tab, reload URL, mở symbol không tự POST refresh, AI hoặc sửa watchlist. Collector nền server vẫn hoạt động độc lập như trước.
- Response của symbol/filter cũ không được đè dữ liệu mới; không hiển thị AI của symbol A dưới tiêu đề symbol B.
- Không yêu cầu lưu kết quả AI trong URL hoặc qua reload. Khi unmount có thể mất kết quả AI cục bộ; quay lại chỉ chạy AI khi người dùng bấm.
- Refresh chỉ tác động domain active với quyền tương ứng; không có nút “refresh tất cả” trong P0.
- Giữ timestamp và chất lượng từng nguồn. Thiếu flow không phải neutral/0; lỗi nguồn và thiếu snapshot là hai trạng thái khác nhau.
- `warming`, `partial`, `stale`, cooldown, không có kết quả filter và watchlist trống phải có thông báo phù hợp; không suy rằng bảng watchlist rỗng đồng nghĩa membership đã lưu rỗng.
- BAPI cooldown không chặn tab Kỹ thuật. API kỹ thuật lỗi không làm Dòng tiền mất khả năng mở.

## 7. Ranh giới triển khai

### Trong P0

1. Shell hub, menu, tab chính/phụ và URL contract.
2. Gate UI khớp quyền đọc backend, redirect tương thích.
3. Tái sử dụng nội dung và panel hiện có; giữ đủ bảng, filter, sort, AI, chart, watchlist, candidates và trạng thái dữ liệu.
4. Dọn vòng đời request khi chuyển tab; sửa link nội bộ và breadcrumb.
5. Regression điều hướng/quyền và cập nhật tài liệu phản ánh implementation sau khi triển khai.

### Ngoài P0

- Panel symbol chung, nhãn đồng thuận kỹ thuật/dòng tiền.
- Thêm cột OI Δ, SM bias, funding vào ma trận kỹ thuật.
- Hợp universe, đổi cadence/limiter, biến môi trường, schema/index/TTL hoặc backfill.
- Thay công thức scoring, candidates, AI prompt hay tự giao dịch/phát signal.
- Sửa phạm vi truy vấn watchlist để tải đủ mọi symbol đã lưu; cần yêu cầu riêng nếu làm.

## 8. File dự kiến và cách chia việc

| File / nhóm | Thay đổi khi triển khai |
|---|---|
| `client/src/App.jsx` | Một menu, route hub, hợp quyền đọc và legacy redirect |
| `client/src/pages/MarketHubPage.jsx` (dự kiến) | Shell mỏng: tab, URL và mount nội dung active; không nghiệp vụ chấm điểm |
| `client/src/pages/MarketPage.jsx`, `SmartMoneyPage.jsx` | Nhúng vào hub, tách tiêu đề trùng; SM đọc `flowTab`; giữ logic domain |
| CSS của hai trang / hub | Bố cục hai cấp tab, responsive và focus |
| `client/src/navigation.jsx` và caller link | Breadcrumb, đóng panel, link chuẩn nếu liên quan |
| `server/src/routes/market.js`, `smart-money.js` | Đối chiếu và regression quyền; không đổi endpoint theo P0 |
| `docs/index.md`, `feature-spec.md`, `flows.md`, `api-data-reference.md` | Cập nhật menu/route/luồng sau khi code được triển khai |
| `docs/auth-rbac-spec.md`, hai spec domain | Ghi hub mới, giữ authority và contract domain; không ghi đề xuất là hiện trạng |

Thứ tự: route/query/gate → nhúng nội dung → link và lifecycle → kiểm tra parity/responsive → cập nhật docs. Không viết lại hai module đang chạy chỉ để đổi menu.

## 9. Tiêu chí nghiệm thu P0

| ID | Kiểm tra | Kết quả bắt buộc |
|---|---|---|
| A1 | User có cả hai quyền | Một menu Thị trường; hai tab chính, mặc định Kỹ thuật |
| A2 | User chỉ có từng quyền riêng | Chỉ thấy đúng tab; `smart_money.view` vào Dòng tiền được |
| A3 | Không quyền / pending / session hết hạn | Gate đúng; không gọi API nghiệp vụ trái quyền |
| A4 | Direct URL tab bị cấm, còn tab khác được phép | Fallback đúng, thông báo rõ, không request domain bị cấm |
| A5 | Tất cả URL legacy ở mục 4 | Redirect một lần, giữ symbol/filter/hash, không history loop |
| A6 | Back/Forward, reload, URL sai/lặp key | State theo contract, không phát POST ngầm |
| A7 | Chọn timeframe, sort, mọi filter kỹ thuật | Kết quả và breakdown tương đương trước khi gom |
| A8 | Tổng quan / Đáng chú ý / Watchlist SM | Không mất cột/chart/AI/thao tác; candidate mở đúng symbol; watchlist đúng actor |
| A9 | Chuyển tab nhanh, đổi symbol khi request chưa xong | Không response cũ ghi đè, không nhân interval, không chạy đồng thời hai page |
| A10 | Symbol chỉ có dữ liệu một bên; filter loại symbol đang chọn | Panel không chọn coin khác; trạng thái thiếu dữ liệu rõ ràng |
| A11 | API lỗi / warming / stale / BAPI cooldown / AI lỗi | Hiển thị đúng domain; tab còn lại vẫn dùng được; không biến lỗi thành số 0 |
| A12 | Refresh và AI qua UI | Giữ quyền, rate limit; không chạy lại tự động khi chuyển tab |
| A13 | Network khi mở hub/chuyển tab | Chỉ fetch domain active, trừ flow đã nhúng trong response Market; không gọi sàn trực tiếp từ browser |
| A14 | Mobile và bàn phím | Chọn được hai cấp tab, bảng/panel không tràn trang, đóng panel và focus hoạt động |
| A15 | So sánh payload và cấu hình collector | Không đổi score, API contract, universe, cadence, Mongo hoặc env |

Khi triển khai: regression tự động cho mapping legacy URL, normalization và ma trận quyền allow/deny (`server/test/market-hub-url.test.js`); dùng hạ tầng test sẵn có, không thêm dependency. Chạy `npm --prefix server test` và `npm --prefix client run build`. Kiểm tra UI/network cho A7–A14; ghi rõ case chưa tự động hóa hoặc chưa kiểm tra thực tế.

### Kết quả kiểm tra triển khai (2026-10-16)

| ID | Cách kiểm | Kết quả |
|---|---|---|
| A1–A5 | Unit `market-hub-url.test.js` + đối chiếu `App.jsx` / `MarketHubPage` | Pass unit; UI login đa role chưa chạy browser |
| A6 | Code: `replace` normalize + `Navigate replace` redirect; Back/Forward dùng `setParams` không replace khi đổi tab | Logic đúng theo code; chưa ghi nhận thủ công history |
| A7–A8 | Parity: nhúng nguyên `MarketPage` / `SmartMoneyPage` | Giữ panel/filter/AI; chưa regression UI tay |
| A9 | `cancelled` + unmount clear interval; chỉ mount tab active | Code path pass; chưa network throttle UI |
| A10–A14 | Chưa browser/mobile | **Chưa kiểm chứng thực tế** |
| A15 | Diff: không đụng `server/src/lib/market/*`, `smart-money` collector/routes | Pass theo diff phạm vi commit |

## 10. Các bước sau P0

- **P1a — panel symbol chung:** kết luận kỹ thuật và flow độc lập, timestamp riêng, tải theo quyền; định nghĩa nhãn Thuận/Ngược/Thiếu flow/Chưa rõ trước khi làm. Không suy thuận/ngược khi một phía thiếu hoặc stale.
- **P1b — enrich bảng kỹ thuật:** join từ SM cache để thêm 2–3 cột; thiếu thì `—`, không kéo sàn, không cộng score. Cần contract và quyền rõ ràng trong spec riêng.
- **P2 — universe chia tầng:** nghiên cứu shared universe và SM deep-collect giới hạn; thay đổi collector/limiter/env phải tách khỏi UI.

P0 hoàn thành khi điều hướng thống nhất và tính năng cũ vẫn truy cập được theo đúng quyền. Không cần hoàn thành P1/P2 để bàn giao P0.
