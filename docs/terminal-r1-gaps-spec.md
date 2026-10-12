# Spec hoàn thiện 5 gap Terminal R1

Ngày: 2026-10-12. Trạng thái: **yêu cầu triển khai**, chưa phải chức năng đã hoàn thành.

## 1. Phạm vi và nguyên tắc

Hoàn thiện năm nhóm: ticket mở độc lập; trạng thái giao dịch/receipt; editor TP-SL; độ mới và coverage SL; saved views/attention filter/dirty guard. Áp dụng menu `/terminal`, giữ bố cục chi tiết dưới bảng và các tab case inline vừa sửa. Không mở rộng R2/R3, không thay menu `/positions`, không thêm dependency, không viết lại runtime bot.

Đọc `AGENTS.md`, `terminal-workspace-spec.md`, `terminal-review.md`, `auth-rbac-spec.md`, `api-data-reference.md` và source thực tế trước khi sửa. Tài liệu này cụ thể hóa năm gap, không thay invariant qty riêng/sàn, sibling, PAPER, NOTPSL, Hedge/One-way, scope và idempotency.

Source chính: `client/src/pages/TerminalPage.jsx`, `components/terminal/{DetailPanel,ConfirmDialogs,MutationStatus,FilterBar,PositionTable}.jsx`, `components/terminal/{mutation,protection,prefs,matches,summary,usePositionsFeed}.js`; backend `routes/{trading,positions}.js`, `lib/{trading-bridge,direct-trading,position-case,position-live}.js`, `models/trading-receipt.js`.

Trước khi code kiểm tra worktree và giữ mọi sửa đổi đang có của người dùng. Chỉ commit phần thuộc task. Không gọi Binance/Mongo thật hoặc gửi lệnh live để test.

## 2. Gap A — Ticket mở vị thế độc lập

### A1. Hành vi UI bắt buộc

- Nút **Đặt lệnh** mở ticket mode **Mở vị thế** ngay cả khi không có vị thế, danh sách đang loading hoặc bộ lọc trả rỗng. Ticket không phụ thuộc `selectedRow`, không tạo position giả để ép DetailPanel render.
- Desktop/tablet: ticket trong vùng detail dưới bảng. Mobile: drawer hiện hành. Ticket và panel xem position là hai mode của cùng vùng workspace; không chồng popup.
- Khi đang xem một position, bấm Đặt lệnh mở mode Mở; không rơi vào form Đóng. Bấm Đóng trên hàng vẫn mở mode Đóng. Bấm TP/SL vào editor Bảo vệ.
- Account: nếu context chỉ rõ một account được phép mở thì prefill; context Tất cả thì để “Chọn tài khoản”. Không tự lấy `accounts[0]` hoặc `rows[0]`. Nếu account chưa tải xong, ticket vẫn mở nhưng submit disabled kèm lý do.
- Symbol nhập/chọn độc lập với danh sách position. Chỉ prefill symbol/account từ hành động rõ trên hàng hoặc context cụ thể; không đổi draft theo tick giá/bảng refresh.
- Giữ Market/Limit, LONG/SHORT và mapping One-way/Hedge của backend. Trong One-way, không gửi LONG/SHORT một cách máy móc nếu contract yêu cầu BOTH; xác minh adapter hiện tại.
- Preview gồm account, symbol, side, loại, qty, giá limit hoặc quote market có timestamp, notional/phí ước tính. Thiếu quote vẫn có form nhưng không dựng số 0 thành giá thật. Server xác minh filters/precision/mode trước thực thi.
- Có nút Đóng ticket/Hủy nháp; dirty guard theo mục F. Lệnh gửi thành công không tự biến thành position khi chưa có fill.
- Context Paper: không gọi live endpoint. Trong phạm vi này không xây paper execution mới; hiển thị rõ ticket live không khả dụng cho Paper.

### A2. Dữ liệu và quyền

`positions.open` dùng `POST /api/trading/positions/open`; order ticket nâng cao vẫn dùng `orders.create` và endpoint orders. Không đổi endpoint để vượt permission.

Account options phải lấy được khi positions rỗng, không phụ thuộc có ít nhất một row. Kiểm tra API danh sách account hiện hành có đủ scope mutation; nếu thiếu, bổ sung endpoint đọc tối thiểu theo conventions repo, liệt kê rõ contract trong PR. Không dùng quyền view để suy ra quyền mở. Backend kiểm tra lại quyền/scope lúc submit.

State đề xuất: `workspaceMode = position | new-position`, `ticketDraft`, `selectedPositionKey`; không lưu draft vào preferences. URL có thể dùng `ticket=open`; URL không chứa qty/giá hoặc tự thực thi giao dịch. Back đóng ticket trước khi rời context khi có history layer; deep-link trực tiếp vẫn có Close hoạt động.

### A3. Nghiệm thu

1. Payload rows=[] + account hợp lệ → mở ticket, nhập Market/Limit, preview và submit qua mocked API.
2. Header Tất cả → account rỗng, không gửi trước khi chọn.
3. Có position đang chọn → Đặt lệnh mở form Mở; Đóng/TP-SL mở đúng mode.
4. Account ngoài scope/thiếu permission/quote lỗi/Paper → trạng thái rõ, không có request live sai scope.

## 3. Gap B — Kết quả giao dịch, receipt và retry

### B1. Hiện trạng cần sửa

`classifyMutationResult` hiện coi gần như mọi response có body là accepted; duplicate được coi trạng thái tích cực bất kể lệnh gốc. `trading-bridge.createTradingRequest` hiện kiểm tra key, gọi `executeDirectTrading`, rồi mới tạo receipt. Unique index sau side effect không ngăn được hai request đồng thời cùng gọi sàn. Model có claimed/submitted/unknown nhưng không có nghĩa flow đã sử dụng chúng đúng.

`GET /api/trading/commands/:requestId` tra requestId do server tạo; **idempotencyKey của client không phải requestId**. Không gán key vào trường requestId để giả tra receipt được. Receipt cũ có thể thiếu field terminal; serializer hiện dùng `!!doc.terminal`, cần chuẩn hóa từ status cho record legacy.

### B2. Hai lớp trạng thái độc lập

| Kết quả thực thi yêu cầu | UI | Terminal? |
|---|---|---|
| Nháp/chờ xác nhận | draft/preview | Không |
| claimed/submitted | Đang xử lý | Không |
| succeeded, đủ kết quả yêu cầu | Đã thực hiện yêu cầu | Có, nhưng order có thể chưa khớp |
| failed, xác nhận không có tác động thành công | Bị từ chối/thất bại | Có |
| Có child thành công và child thất bại | Thành công một phần + từng bước | Có nếu mọi child đã xác định; nếu còn unknown thì chưa |
| Timeout/disconnect sau dispatch, crash chưa đối chiếu | Chưa xác định | Không |
| Duplicate | Badge “Yêu cầu đã gửi trước” | Kế thừa trạng thái gốc, không là success riêng |

Trạng thái order sàn (NEW/PARTIALLY_FILLED/FILLED/CANCELED/EXPIRED/REJECTED) hiển thị riêng. Ví dụ request tạo limit succeeded + order NEW → “Đã đặt lệnh — chờ khớp”; không hiện “Đã mở vị thế”.

Ưu tiên phân loại: kết quả child/partial và unknown → explicit failed/error → explicit succeeded → pending → unknown vì response thiếu bằng chứng. HTTP 2xx không là đủ. Response body mâu thuẫn status/result phải giữ thông tin mâu thuẫn và yêu cầu đối chiếu, không chọn màu xanh mặc định. Body rỗng sau dispatch là unknown, không phải bằng chứng thất bại.

Validation/auth lỗi xác nhận xảy ra trước gọi sàn có thể rejected. Lỗi transport/5xx hoặc exception không chứng minh sàn chưa nhận thì unknown. Không chỉ so sánh `err.message === 'Request timeout'`; chuẩn hóa loại lỗi từ api client mà giữ nguyên contract caller cũ.

### B3. Durable claim trước side effect

Backend phải:

1. Auth + quyền/scope + validate + canonicalize action/target/params; tính payload fingerprint ổn định (decimal strings chuẩn hóa nhất quán).
2. Atomic claim receipt với unique `(actorUserId,idempotencyKey)` **trước** gọi sàn. Chỉ request thắng claim được execute. Mongo ghi claim lỗi → không gọi sàn.
3. Cùng key/cùng fingerprint → trả receipt gốc; cùng key/khác payload → 409 conflict, không execute. Không gọi sàn rồi mới chờ unique index báo trùng.
4. Lưu server requestId, action/target/fingerprint, claimedAt/submittedAt, progress/child results. Submitted phản ánh đã bắt đầu dispatch, không khẳng định exchange acceptance.
5. Ghi result thành succeeded/failed/unknown hoặc partial theo schema mở rộng có chủ đích. Có child đã thành công rồi exception thì lưu progress; không mất dấu phần thành công.
6. Crash/timeout sau dispatch: phục hồi bằng IDs đã lưu/client order ID nếu exchange adapter thực sự hỗ trợ. Không thêm tham số exchange theo phỏng đoán. Receipt treo cần chuyển sang recovery/reconcile, không tự execute lại toàn yêu cầu.
7. Claim cũ không có evidence dispatch cũng không đủ để worker khác tự gửi lại nếu không có thiết kế lease/fencing chứng minh request trước không còn execute. Ưu tiên reconcile hoặc giữ unknown.
8. Không tuyên bố exactly-once tuyệt đối: khi không thể chứng minh outcome, giữ unknown và hướng dẫn đối chiếu. TTL hiện tại 24h cần xem lại: unresolved không được mất recovery metadata chỉ vì hết TTL; retry sau hết cửa sổ không tự coi là giao dịch mới. Record legacy/cùng key đã expired nhưng TTL chưa xóa phải xử lý rõ, không lỗi unique rồi gửi trùng.

Phải có migration/index plan tương thích records cũ. Không xóa receipt cũ hoặc sửa runtime bot để lách idempotency.

### B4. Contract tra receipt

Giữ endpoint requestId hiện có. Bổ sung lookup theo idempotencyKey trong phạm vi actor khi client chưa nhận requestId. Tên endpoint cụ thể do conventions repo quyết định, nhưng phải ghi chính xác trong API docs trước bàn giao; đây là API mới cần implement, không coi đã tồn tại.

Response chuẩn hóa tối thiểu: requestId, idempotencyKey, action, target đã sanitize, status, terminal được tính đúng, duplicate flag, child results/progress nếu có, exchange IDs, error safe, createdAt/updatedAt và recovery status. Không trả raw request/credentials.

Lookup key luôn scoped actor và quyền/scope hiện tại; lookup requestId giữ policy được xác minh trong auth spec, không mở rộng quyền. Revoked permission phải fail-closed. Receipt không thấy/404 không chứng minh lệnh chưa gửi; UI tiếp tục unknown và cho reconcile đúng account/position.

Client giữ một operation record theo ý định (action/account/key), không dùng một biến idempotencyKey chung bị ghi đè bởi form khác. Pending/unknown hiện trong trạng thái giao dịch gắn đúng account/symbol, không mất khi đóng panel hoặc chọn vị thế khác. Có thể persist **chỉ opaque pending keys** trong sessionStorage có user namespace để recover sau reload; không lưu draft/payload/credential, không đưa vào saved preferences, clear khi logout/đổi user.

### B5. UI recovery

- Unknown có nút **Kiểm tra trạng thái**; nếu có requestId thì tra ID, chưa có thì tra key. Receipt succeeded → refresh nguồn account liên quan và theo dõi order riêng.
- Auto-poll chỉ receipt read, backoff 1/2/4/8/15 giây, tối đa 60 giây một lượt; sau đó dừng polling với nhãn “Chưa xác định”, giữ nút kiểm tra thủ công. Không coi hết poll là failed. Tôn trọng 429/Retry-After, dừng khi logout/mất quyền.
- Không retry mutation tự động bằng key mới. Retry cùng key chỉ an toàn sau B3 và không execute lại receipt unknown. Muốn gửi ý định mới cần outcome cũ rõ hoặc flow xử lý thủ công rõ ràng; không làm thành nút “Thử lại” màu xanh ngay cạnh unknown.
- Reverse: hiển thị bước đóng/mở riêng. Đóng thành công, mở thất bại → partial, có thể flat; không tự khôi phục vị thế cũ.
- TP/SL replace và batch cancel: kết quả từng child/order; thiếu results không được cộng tất cả vào success. Đã hủy SL cũ nhưng tạo SL mới lỗi phải hiện rõ trạng thái mất bảo vệ.

### B6. Test bắt buộc

2xx failed; duplicate của failed/unknown/succeeded; partial batch; reverse bước mở lỗi; cancel-create lỗi; body thiếu/mâu thuẫn; network timeout; 404 receipt; 429; quyền bị thu hồi; hai request concurrent cùng key; cùng key khác payload; crash sau claim/dispatch/acceptance; lưu result lỗi sau sàn nhận. Mock exchange phải chứng minh số lần execute đúng, không chỉ test nhãn UI.

## 4. Gap C — Editor TP/SL đầy đủ, không xác nhận quá sớm

### C1. Luồng UI

Nút TP/SL trên row → panel Giao dịch/Bảo vệ → editor → preview diff → Confirm. Không gọi `askTpsl` từ row để mở Confirm ngay. Confirm chỉ xuất hiện khi người dùng đã nhập/chọn và bấm Xem xác nhận.

TP và SL có điều khiển riêng: bật mức sửa, giá trigger, working type `MARK_PRICE | CONTRACT_PRICE`, trạng thái lệnh hiện có và nhãn nguồn. Trailing giữ callback/activation/working type và hủy theo chức năng cũ. Không tự điền giá monitor dạng phần trăm hoặc chuỗi config vào field absolute trigger của sàn.

### C2. Phân biệt no-op và hủy

Mỗi TP/SL có operation nội bộ **unchanged | upsert | cancel**, default unchanged khi mở editor:

- Không chọn sửa hoặc bỏ thay đổi nháp → unchanged, giữ lệnh sàn nguyên trạng.
- Bật/sửa mức → upsert, preview giá cũ/mới, working type, qty/phạm vi.
- Muốn bỏ mức đang có → hành động **Hủy TP/SL đang có**, chọn đúng order IDs và xác nhận; không dùng checkbox bỏ tick để hủy âm thầm.
- Mức chưa có: toggle off nghĩa không tạo. Editor không tự bật cả TP và SL.

`enabled:false` trong setTpsl hiện tại không đồng nghĩa hủy TP/SL. Adapter chỉ gửi upsert đã dirty; cancel dùng endpoint hủy order cụ thể hiện có. Không sửa một SL mà gửi lại/hủy TP không liên quan. Preview không có diff → không cho submit.

Nếu có nhiều protective orders cùng loại, phải hiển thị danh sách để chọn order/phạm vi. `direct-trading.cancelProtectiveOrders` hiện có thể hủy nhiều order theo loại/side; phải audit và sửa tối thiểu để chỉ tác động IDs được xác nhận, hoặc chặn thao tác khi contract chưa hỗ trợ an toàn. Không đánh đồng “cùng positionSide” với “thuộc cùng monitor”.

### C3. Validation và concurrency

- Validate giá > 0, tickSize, working type enum và trigger semantics theo side/type; giá tham chiếu phải đúng working type. Backend quyết định cuối cùng, không tự dịch giá để né lỗi immediate trigger.
- Giữ quantity vs closePosition đúng contract; không gửi cả hai. Trailing dùng contract thực tế, không giả cùng semantics với TP/SL toàn vị thế.
- Snapshot/order IDs thay đổi sau preview → invalidate preview, tải lại và cho người dùng duyệt diff mới. Truyền expected version/IDs chỉ có giá trị khi backend enforce, không chỉ thêm field vào body.
- Nêu rõ tác động vị thế sàn và sibling; không quảng cáo sửa riêng config nếu backend không hỗ trợ ownership đó.
- Guard draft khi đổi vị thế/account; refresh quote không đè giá đang nhập.

Test: chỉ sửa SL không đụng TP; chỉ sửa TP không đụng SL; unchanged không gửi; cancel chỉ đúng ID; nhiều sibling; working type từng mức; stale preview; price precision; partial replace failure; không có quyền; PAPER không live mutate.

## 5. Gap D — SL có nguồn, độ mới và coverage

### D1. View-model bắt buộc

Chuẩn hóa từ nguồn thật thành: source, checkedAt, freshness `verified|stale|unknown|error`, matching order IDs/status, position quantity/side, protected quantity hoặc close-all semantics được xác minh, coverage `full|partial|none|unknown`, monitor heartbeat riêng.

Field trên là contract cần bổ sung nếu thiếu, không suy ra chỉ từ `exchangeSl`. Orders/positions/mark có timestamp độc lập. Mark mới không làm orders thành verified. Reconcile chưa đủ trang, source lỗi, snapshot thuộc phiên trước hoặc position tăng qty sau lần đối chiếu đều phải đánh giá lại coverage.

### D2. Bảng trạng thái

| Điều kiện | Hiển thị |
|---|---|
| Orders fresh, position fresh, SL đúng side đang active và bảo vệ đủ | SL sàn · Đủ qty · giá + working type |
| Bảo vệ một phần | SL sàn · 0.4/1 BTC (40%) |
| Có giá/SL cũ nhưng stale/error | SL ghi nhận 95 · Chưa xác minh · lần đối chiếu gần nhất |
| Nguồn đầy đủ, mới và không có SL phù hợp | Chưa có SL sàn |
| Chỉ monitor SL | Bot theo dõi · condition + heartbeat; không giả có order sàn |
| Thiếu dữ liệu lượng/side/status hoặc chưa tải orders | Chưa xác minh mức bảo vệ |

TP có freshness nhất quán; trailing không tự coi đã kích hoạt từ mark. Có thể hiển thị SL lịch sử để tham khảo nhưng màu/nhãn không được là “đã bảo vệ”.

### D3. Coverage

Chỉ tính orders khớp đúng account/symbol/positionSide, đúng loại protective, active và còn khả năng đóng vị thế. Dedupe regular/algo theo identity nguồn. Không cộng tất cả SL một cách mù quáng: các orders có thể chồng phạm vi, cùng group/OCO hoặc close-all. Nếu chưa chứng minh được phạm vi đóng độc lập, coverage=unknown.

Fixed qty dùng remaining executable qty đã xác minh; close-all được coi full chỉ khi adapter xác nhận semantics, mode và liên kết đúng vị thế. Nếu nhiều mức SL khác giá, không dựng một giá SL chung rồi tính rủi ro cho toàn qty; hiện số mức/danh sách. Quy tắc mapping nguồn phải có fixtures từ shape thực tế đã sanitize.

Logic này dùng chung bảng, overview và needsAttention, không ba cách tính khác nhau. Thay đổi row/dữ liệu freshness phải cập nhật nhãn, không cần user đóng/mở panel.

Test: stale vẫn có exchangeSl; missing orders timestamp; qty tăng sau snapshot; partial 40%; close-all đúng/sai side; duplicate order; canceled; monitor-only heartbeat yếu; multi-level SL; reconcile thất bại; unknown không thành none.

## 6. Gap E/F — Saved views, attention và bảo vệ nháp

### E1. Saved views

Tách context account/audience/book khỏi filter riêng tab. Saved view R1 lưu bộ lọc Positions có hiệu lực: symbol, config/env, signal, side, warn, điều kiện PnL và sort. Context giữ nguyên khi đổi view; giao diện phải ghi rõ view không đổi tài khoản/sổ. Không lưu selection, ticket hoặc draft trong view.

- Tạo, đổi tên, xóa view cá nhân; view built-in không sửa/xóa. Quyền lưu preference không phụ thuộc positions.open; user chỉ xem positions vẫn được lưu view.
- Áp view phải đưa đầy đủ filter đã lưu vào URL, thay thế bộ filter view trước; xóa filter không có trong view mới. Không AND ngầm với query cũ. Chỉnh filter sau áp view hiển thị “Đã chỉnh”, có Lưu mới/Cập nhật view cá nhân.
- Sort key/direction vào URL, reload giữ sort. Unknown key fallback an toàn. Giữ columns/density ở preferences namespace user/version hiện tại.
- Migration preferences: whitelist field, validate kiểu/enum/length, không làm mất view cũ. Warn custom view phải có tác dụng, signal phải được lưu/khôi phục. Không nâng scope bằng view hoặc URL.

### E2. Attention thống nhất

`needsAttention` là một predicate chung cho badge, summary và view Cần chú ý. Không set `warn=1` để prefilter trước predicate rộng hơn. “Chỉ cảnh báo” có thể giữ nghĩa warnings cụ thể nhưng label phải khác; khi chọn built-in Cần chú ý thì xóa warn filter cũ không phù hợp.

Attention bao gồm: warning thực, SL thiếu/chưa xác minh/coverage partial khi relevant, monitor heartbeat yếu và mismatch theo rule đã xác minh. Paper/pending có policy riêng, không gắn cảnh báo thiếu SL live cho mọi paper record. Document policy và unit test các nhánh. Summary đếm đúng tập đã lọc, không lọc lần hai bằng warnings.length.

Sửa coverage summary: unrealized null/undefined/empty/non-finite là missing, không coi `Number(null)=0` là PnL đã biết. Zero thật vẫn là dữ liệu hợp lệ.

### F1. Dirty guard

Một cơ chế dùng chung cho ticket Mở/Đóng/Bảo vệ và form sửa order trong Terminal:

- dirty tính từ thay đổi input so với baseline, không set/reset bằng mỗi lần click; revert về baseline thì sạch.
- Quote/WS/reconcile không làm dirty và không ghi đè user input.
- Đổi position/account/book/audience/tab, đóng panel/ticket, chọn view làm mất context, điều hướng menu/Back đều phải giữ nháp hoặc hỏi bỏ nháp trước khi unmount. Hủy hộp hỏi thì URL/selection/form giữ nguyên; đồng ý thì thực hiện đúng một navigation.
- Refresh/đóng tab dùng beforeunload khi dirty hoặc có operation đang gửi; không tự submit khi rời trang.
- Không gắn guard trên mỗi refresh/tick. Chuyển tab nội bộ mà form vẫn được giữ có thể không hỏi; phải thực sự giữ draft.
- Preview phải gắn fingerprint draft; sửa field hoặc thay identity/qty/ownership ảnh hưởng giao dịch thì preview cũ hết hiệu lực. Không confirm body cũ sau khi editor đã đổi.
- Unknown/pending là operation đã gửi, không phải nháp: người dùng được đóng panel, operation vẫn theo dõi trong mục trạng thái; “Bỏ nháp” không hủy lệnh trên sàn.

Không triển khai router blocker chỉ chặn click nhưng bỏ qua Back hoặc gây vòng lặp navigation. Tận dụng navigation guard hiện có và kiểm tra router mode thực tế.

## 7. Phân kỳ thực hiện và định nghĩa hoàn tất

1. Audit source/contract, ghi rõ API hiện có và mới; fixtures không dùng dữ liệu thật.
2. B3/B4 receipt claim/recovery + tests trước, rồi B2/B5 UI; không quảng cáo retry an toàn khi backend chưa sửa.
3. A ticket độc lập và C editor; phối hợp operation state và dirty guard F.
4. D freshness/coverage cùng E attention/summary để dùng một định nghĩa.
5. E saved views/URL migration; kiểm tra toàn flow và regression Position cũ.

Bắt buộc bàn giao cả năm nhóm; nếu thực hiện theo từng PR thì nêu trạng thái rõ, không gọi hoàn tất R1 khi thiếu backend cần thiết. Không thay giao diện desktop thành panel cạnh phải hoặc tự mở modal case trở lại.

Kiểm tra tối thiểu:

- Unit/integration cho từng case A3/B6/C/D/E/F; test concurrent idempotency phải đi qua service thật với exchange stub.
- `npm --prefix server test` khi đổi trading/receipt/auth; `npm --prefix client run build`; chạy tests client phù hợp.
- Browser fixture tại desktop/mobile: rows rỗng, nhiều vị thế/account, viewer vs trader, stale/partial/unknown; không gửi lệnh live.
- Cập nhật API/data/flows/auth docs nếu contract thay đổi. Báo migration/index, rollback tương thích, tests pass/fail và phần chưa verify.
- Review diff, commit đúng phạm vi theo AGENTS; không gom thay đổi đang có của user.

## 8. Prompt giao Cursor

> Triển khai đầy đủ năm nhóm gap trong `docs/terminal-r1-gaps-spec.md` của web-bot. Đọc AGENTS, spec Terminal và source hiện tại trước khi sửa; giữ nguyên các sửa đổi đang có của tôi. Giữ layout chi tiết dưới bảng và Lệnh/Monitor/Timeline inline; không thay `/positions`, không thêm dependency, không làm R2/R3. Làm cả backend receipt/idempotency còn thiếu, không chỉ sửa nhãn UI. Ticket Mở phải hoạt động khi rows rỗng; TP/SL vào editor trước confirm và phân biệt unchanged/upsert/cancel; SL stale/coverage phải đúng; saved views/attention/dirty guard phải thống nhất. Kiểm thử bằng fixture/mock, không gửi giao dịch live. Hoàn thành năm nhóm cùng tests/build/docs, bàn giao checklist A–F, API/migration thay đổi, commit và giới hạn còn lại. Tự xử lý chi tiết kỹ thuật theo design hiện có; chỉ hỏi nếu có mâu thuẫn nghiệp vụ không giải quyết được từ source.
