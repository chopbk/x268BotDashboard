# Prompt triển khai Quant Terminal bằng Cursor

Ngày: 2026-11-01. Dùng cùng [master spec](quant-terminal-master-spec.md).

Mở workspace chứa cả `web-bot` và `binance-bot`. Gửi prompt khởi động bên dưới trước. Sau đó gửi lần lượt P1–P6; toàn bộ scope đã được chọn nhưng mỗi lần triển khai một milestone để review được. Nếu một milestone lớn, Cursor chia các slice end-to-end và tiếp tục tới khi xong phạm vi đó.

## Prompt khởi động — P0

```text
Hãy bắt đầu dự án Quant Trading Terminal cho web-bot theo:
@docs/quant-terminal-master-spec.md
@docs/quant-terminal-cursor-prompts.md

Scope toàn dự án bao gồm Q1–Q7/P0–P6, không bỏ phần ưu tiên sau. Lần này thực hiện P0 thật sự: audit source, chốt contract, tạo backlog và fixtures/contracts phù hợp; chưa bật hoặc thay đổi giao dịch live.

Hai repo sibling: web-bot (React/Vite, Express/Mongo/Redis) và binance-bot (Node trading/listener/monitor/scanner/MTF). Đọc AGENTS.md và rules áp dụng của từng repo trước sửa. Bắt đầu web-bot tại docs/index.md, architecture, flows, api-data-reference, development; đọc spec hiện có được master spec liên kết. Đọc đầy đủ auth-rbac-spec trước thay đổi quyền.

Yêu cầu:
1. Kiểm git status, giữ nguyên thay đổi có sẵn; không đọc .env/.env.deploy hay secret.
2. Audit từng Q1–Q7: existing/partial/missing, file:function và API/model thực tế, spec đang liên quan, producer/consumer, acceptance test cần có. Không coi mô tả trong spec là implementation đã tồn tại.
3. Ghi rõ web trading hiện đi routes/trading → trading-bridge → direct-trading → exchange adapter; config MQTT bridge là luồng khác. Tìm mọi entry tăng exposure ở bot để risk gate không bị bypass.
4. Chốt identity account/botUsername/env/exchange/instrument/side/positionIdx/tradeInstanceId, provenance, event correlation, accounting basis, capability và migration legacy additive.
5. Chốt reservation protocol giữa web và bot, unknown-order reconciliation, version compatibility/ACK coverage, bảo toàn giảm rủi ro khi chặn entry.
6. Audit engine backtest hiện có; ghi supported strategy/semantics và gaps, không hứa parity khi chưa có fixture.
7. Tạo docs/quant-terminal-implementation-status.md với gap matrix, decision log, migration/rollback, dependency backlog P0–P6, quota/retention đề xuất theo evidence và checklist nghiệm thu. Mỗi task ghi repo, entry files, dependency, contract và test. Không tự đặt ETA như đã đo.
8. Cập nhật docs/index.md liên kết status. Chỉ thêm contract fixtures có ích và không nối external service; không tạo boilerplate runtime cho mọi module.

Không thêm dependency, rewrite module ổn định, thay semantics PAPER/INVERT/NOTPSL/sibling/leftover, gom validator kênh hay bỏ messId. Không tạo auth map thứ hai. Không deploy/restart, sửa config live, chạy migration production hoặc đặt/hủy/đóng lệnh thật trong nhiệm vụ này. Chỉ commit thay đổi của nhiệm vụ theo quy tắc repo; không push commit không liên quan.

Nếu thiếu external dataset/provider, ghi unavailable và dependency cụ thể, tiếp tục phần độc lập; không dùng mock rồi báo feature production-ready. Chỉ hỏi khi thiếu quyết định không thể suy ra từ spec/source; các lựa chọn implementation nhỏ tự xử lý và ghi decision log.

Bàn giao P0: file đã tạo, inventory có evidence, quyết định contract, gaps/blockers, test đã chạy và chưa verify. Không dừng chỉ với kế hoạch miệng; phải tạo artifact trong repo. Chưa implement P1 trong lần này.
```

## Context bắt buộc cho mỗi prompt P1–P6

Dán khối này cùng prompt milestone nếu bắt đầu cuộc chat Cursor mới:

```text
Đọc docs/quant-terminal-master-spec.md, docs/quant-terminal-implementation-status.md và AGENTS/rules cả hai repo. Triển khai đúng milestone được chỉ định, giữ toàn bộ roadmap còn lại trong backlog. Nếu P0 chưa có thì hoàn thành P0 trước, sau đó làm milestone này khi dependencies đủ.

Trước sửa map caller → handler → read/write → consumer và đọc source hiện tại. Reuse modules/routes/models đang có; patch nhỏ, không rewrite, không thêm dependency tùy tiện. Giữ backwards compatibility, RBAC server-side, private scope, CSRF, idempotency, exchange capability, live/paper separation và mọi qty/sibling/leftover/PAPER/INVERT/NOTPSL invariant.

Làm các slice end-to-end UI/API/producer/storage/tests; không đánh dấu done khi chỉ có UI mock, API stub hoặc data không có nguồn. Không biến null thành zero, không đoán ID/correlation từ symbol. Tests offline/fixture; không khởi động app với DB hoặc credential thật để smoke test.

Mỗi slice phải review cả caller/reader và nhánh legacy không liên quan; test đúng tác động, chạy server tests/client build khi liên quan, bot tests đúng modules. Cập nhật status và docs/API/flows khi implementation thay đổi. Commit riêng các thay đổi của mình sau khi verify, theo rules repo; không stage hoặc push phần của người khác.

Trong nhiệm vụ coding này không deploy/restart, không sửa config/policy live, không apply migration production, không đặt/hủy/đóng lệnh thật, không activate strategy/enforce policy. Việc implement UI/control hợp lệ không phải quyền sử dụng control trên account thật. Hoàn thiện artifact, tests và rollout instructions để review.

Nếu bị chặn bởi external data/capability, ghi đúng blocker và hoàn tất phần độc lập. Đừng bỏ scope, bịa số liệu, hoặc tuyên bố toàn terminal hoàn thiện khi còn milestone chưa nghiệm thu. Bàn giao: kết quả, file/chuỗi đã đổi, tests/evidence, chưa verify, migration/rollback và task tiếp theo.
```

## P1 — Workspace/chart/trade plan

```text
Thực hiện P1 và toàn bộ Q1 của master spec, kèm foundation freshness/provenance từ P0.

Mở rộng TerminalPage/components hiện có: layout watchlist/chart/ticket/orders, chart lightweight-charts đã cài, timeframe/market identity đồng bộ, overlay setup/entry/SL/TP/fills, drawing cơ bản và prefs theo actor. Giữ các tabs, URL legacy, dirty guard, quyền và mutation dialogs đang chạy.

Tạo Trade Plan + preview backend có version/expiry; reuse OrderTicket, sizing, trading receipt và adapter. Drag chart chỉ sửa draft. Quote/account/size/SL thay đổi làm preview invalid; kiểm lại tại submit. Bracket không atomic phải hiện protection pending/failed. Không đưa MQTT config bridge vào order execution.

Test end-to-end bằng fixture từ chọn signal → đúng chart/setup → draft → preview → receipt → fill/protection overlay. Test response cũ khi đổi symbol nhanh, reconnect, stale quote, readonly/unsupported exchange, mobile và keyboard. Đưa evidence UI QA và giữ bảng vị thế dùng được khi chart lỗi.
```

## P2 — Portfolio risk xuyên web/bot

```text
Thực hiện P2/toàn Q2: risk cockpit, scenario, versioned policy, observe/enforce capability, durable reservation và ba controls độc lập.

Phải tích hợp cả web và các producer bot tăng exposure đã audit ở P0. Exposure account dùng exchange book một lần; config attribution dùng own qty. Không thay logic sibling/leftover hoặc tạo helper qty song song. Risk chưa đủ dữ liệu trả unknown/partial; daily loss và drawdown điều chỉnh external cashflows theo spec.

Implement gate nguyên tử với reservation/reconcile; pending orders và concurrent requests không vượt budget. Timeout sau submit phải đối soát exchange identity; lease hết hạn không giải phóng unknown order tùy tiện. Giữ close/reduce/protection hợp lệ khi entry bị chặn. Reverse partial phải báo chính xác.

Pause new entries không dừng monitor; cancel pending entries không cancel SL/TP; flatten scope/qty đúng. Có receipt/audit/producer revision coverage. Mặc định observe, không activate policy live.

Tests bắt buộc: hai sibling, web+bot concurrent, stale store, risk limit, duplicate key khác payload, crash/restart, partial fill/cancel-race, reverse close-success/open-blocked, readonly/private scope. Cập nhật compatibility/rollout cả hai repo.
```

## P3 — Market scanner, alerts, timeline và journal

```text
Thực hiện P3: toàn Q3 và Q4. Reuse Market collectors, Tracking/Inbox spec và journal/decision support hiện có.

Market: history price/OI/funding/taker, RS/breadth/sector/regime provenance, watchlist, predicate builder allowlist, saved scanner, cooldown/rearm/expiry, worker dedup và Inbox. Không đổi score engine/lifecycle hay coi entry_touched là fill. Không gửi Telegram/email hoặc browser notification chưa opt-in.

Execution: bổ sung producer events có signalEventId/tradeInstanceId/requestId/order/fill correlation, timeline fan-out theo account/config, skip reason, partial/protection/reconcile, arrival-price slippage và latency có clock uncertainty. Journal tương thích dữ liệu cũ; legacy thiếu identity hiện unresolved.

Tests: worker restart tạo một Inbox event, missing data không tạo tín hiệu ngược, candle đóng, permission revoked, late/duplicate events, mất ACK, fill sau cancel, hai vòng trade cùng symbol, không trộn hai sàn. Không tạo timeline giả cho history không có evidence.
```

## P4 — Strategy edge và execution analytics

```text
Thực hiện P4/toàn Q5 trên event/accounting foundations đã xong. Mở rộng scorecard/reports hiện có, không tạo dashboard PnL với định nghĩa khác.

Implement net accounting/cost coverage, expectancy/PF/R, drawdown/cashflow-adjusted equity, Sharpe/Sortino theo cadence, MAE/MFE có fidelity, rolling/regime/config-version breakdown, sample count/uncertainty và signal-vs-execution attribution. Lưu metric definitions/version dùng chung; thiếu initial risk/fees/funding phải hiện unknown/incomplete.

Test đối soát ledger với fixtures gross/net có phí đã bao gồm, all winners/losers, zero sample, missing funding, cashflows, equity<=0, partial/DCA inventory và không join nhầm trade. Ranking không dùng vài lệnh thắng làm bằng chứng edge; performance alert không tự tắt signal/config.
```

## P5 — Research Lab và paper/live lifecycle

```text
Thực hiện P5/toàn Q6 ở /quant-lab, giữ /research cho setup tracking.

Build dataset manifest/version/coverage, experiment immutable config/code/data hashes, durable bounded job runner cách ly, results compare, OOS/walk-forward/purge, parameter sensitivity, block-bootstrap stress, deterministic replay, paper deployments và promotion proposal qua Config Lab/ACK hiện có.

Audit/reuse engines trong binance-bot bằng adapter nhỏ; chỉ expose strategies có parity fixture. Không import trader startup hoặc cung cấp live credentials cho runner, không eval code upload. No-lookahead theo availableAt, next-available-event execution, fees/funding/slippage, ambiguous intrabar conservative và point-in-time universe. Missing history không được thay bằng snapshot hôm nay.

Tests: deterministic rerun/hash, đổi tương lai không đổi quá khứ, gap/delisting, partial fills, cùng bar TP/SL, job cancellation/crash/lease recovery, permission revoked trước artifact read và không side effect live. Promotion chỉ tạo reviewed proposal; không tự sửa PAPER/INVERT/config hoặc khởi động strategy live. Báo supported semantics và limitations từng engine.
```

## P6 — Allocation, microstructure và execution algos

```text
Thực hiện P6/toàn Q7 sau khi risk/reconcile/research prerequisites có evidence.

Allocation: fixed/equal/inverse-vol budgets, correlation caps, target/current, turnover/cost/risk preview, versioned rebalance proposal và explicit activation path có permission.

Market depth: sequence-safe book, tape, spread/imbalance, CVD/footprint/volume profile từ dữ liệu đủ fidelity, liquidation observed tách estimated heatmap. Không fabricate thiếu provider/history; unavailable phải hiện rõ và còn trong backlog.

Execution: capability-based post-only/IOC/FOK/trailing/multi-TP; durable server-side TWAP, participation caps, VWAP khi đủ volume model. Parent/child IDs, risk reservations không double-count, max quantity/duration/deviation, pause/cancel, retry/recovery. Browser đóng không làm mất scheduler; process restart reconcile trước gửi child tiếp theo.

Tests: parent qty bound, outstanding+fills, cancel unknown child, reconnect/restart, gate blocks unsent children, partial venue capability, scope và stale allocation preview. Không kích hoạt execution thật. Audit toàn P0–P6 và cập nhật status đúng phần completed/blocked; không coi adapter disabled là feature hoàn tất.
```

## Prompt tiếp tục khi hết context

```text
Tiếp tục milestone đang làm trong docs/quant-terminal-implementation-status.md. Đọc git diff/status, evidence và blockers trước; không làm lại phần đã verified. Hoàn thành slice đang dang dở, review call graph, chạy checks tương ứng, cập nhật trạng thái trung thực và tiếp tục trong scope milestone được giao. Giữ mọi giới hạn coding-only, không deploy/live mutation. Nếu milestone đã done, bàn giao evidence và tên milestone kế tiếp, không tự tuyên bố hoàn thành toàn roadmap.
```
