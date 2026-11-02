# Quant Terminal — implementation status

Ngày cập nhật: **2026-11-02**. Milestone hiện tại: **pre-deploy hardening** (auth/scope, preview await, WF hang, enforce locked; foundation P0–P6 chưa nghiệm thu đầy đủ).  
Nguồn chuẩn sản phẩm: [quant-terminal-master-spec.md](quant-terminal-master-spec.md).  
Contracts: [docs/contracts/quant-terminal/](contracts/quant-terminal/).

> Inventory + evidence. Không tuyên bố enforce production hay collector trả phí đã bật.

## 0. Git / phạm vi lần này

| Repo | Git | Ghi chú |
|---|---|---|
| `web-bot` | Untracked sẵn: `.planning/`, `.tmux.conf` — **giữ nguyên** | Commit P2/P3 + docs; push; **không deploy** |
| `binance-bot` | Chỉ stage `services/risk-gate/**` + hooks entry đã liệt kê | Không commit dirty sẵn (config/session/…) |

Không đọc `.env` / `.env.deploy`. Không deploy / restart / migration production / lệnh thật.

---

## 1. Decision log (P0)

| ID | Quyết định | Lý do / evidence |
|---|---|---|
| D1 | Web order path giữ `routes/trading → trading-bridge → direct-trading → adapter`; **không** đưa order qua MQTT config bridge | `trading-bridge.js` gọi `executeDirectTrading`; bridge config là `bot-command-bridge` allowlist APPLY_* |
| D2 | Identity: tách `actorId` / `botUsername` / `env`; market = `exchange+marketType+instrumentId`; thêm `tradeInstanceId` additive | Spec §3.2; journal key hiện `account\|symbol\|side` không đủ 2 vòng trade |
| D3 | `messId` chỉ dedupe MQTT; không dùng làm trade/correlation id | bot MQTT; contract `identity.v1` |
| D4 | `signalEventId` = tên mới; ingest alias `eventId` từ payload V2 bot | `ensureSignalPayloadMeta` / V2 MQTT |
| D5 | Account exposure = **sổ sàn một lần**; attribution config = **own qty**; cấm cộng qty sàn theo monitor | sibling rule bot + positions feed web |
| D6 | Reservation durable Mongo (đề xuất `web_risk_reservations`); default policy **observe**; lease hết hạn **không** auto-release khi exchange unknown | Spec §5.3; contract `reservation.v1` |
| D7 | Gate phải phủ mọi entry tăng exposure đã audit (kể cả `/open` bypass `checkBotStatus`, COPY DCA, MTF scale-in, ROSEI open leg) | bot inventory GOAL1 |
| D8 | Close/reduce/protection **không** bị chặn chỉ vì vượt exposure / store enforce unavailable | Spec §5.3 |
| D9 | Preview trading: server-side versioned + `expiresAt` (P1); client `trade-preview.js` chỉ advisory | `POST /api/trading/preview` đã có (P1) |
| D10 | Chart Terminal reuse `lightweight-charts` | TerminalChart P1 |
| D11 | Research tracks/Inbox dưới `/api/research/*` + UI `/inbox`; Research Lab = `/quant-lab` (P5) | P3 |
| D12 | Backtest engines: **không parity-ready**; chỉ expose strategy có fixture parity ở P5 | `backtest-engines.fixture.json` |
| D13 | `risk.manage` đã vào catalog + OPERATOR template; `research.run` / `portfolio.allocate` vẫn đề xuất | auth-rbac + access-control |
| D14 | Retention đề xuất (chưa apply TTL lên collection tài chính legacy) | Xem §6 |
| D15 | Live/paper luôn tách sổ | positions/account_statics/PAPER/DCA_MTF_PAPER đã có precedent |

---

## 2. Chuỗi runtime đã xác nhận

### 2.1 Web trading (execution)

```
UI → POST/PUT/DELETE /api/trading/*
  → server/src/routes/trading.js
  → lib/trading-bridge.js#createTradingRequest
  → models/trading-receipt.js (web_trading_receipts)
  → lib/direct-trading.js#executeDirectTrading
  → lib/exchanges/factory → adapters
```

Actions: `ORDER_CANCEL`, `ORDER_CANCEL_BATCH`, `POSITION_SET_TPSL`, `POSITION_CANCEL_TPSL`, `POSITION_CLOSE`, `POSITION_OPEN`, `POSITION_REVERSE`, `ORDER_CREATE`, `ORDER_REPLACE`.

**Risk reservation trước submit: hooked** trên `POSITION_OPEN` / `ORDER_CREATE` / `ORDER_REPLACE` (observe mặc định). `POSITION_REVERSE` không hard-gate cả saga (close phải chạy).

### 2.2 Config MQTT bridge (không đặt lệnh)

```
Config Lab / bots API → bot-command-bridge → web_bot_commands → MQTT wakeup → ACK
```

Allowlist: `APPLY_CONFIG`, `LOAD/UNLOAD/RENAME_ACCOUNT`.

### 2.3 Bot entry → order (rút gọn)

```
new_mess / new_signal / new_command / MTF cron / COPY UPDATE
  → (gates local tùy path)
  → futuresOpen* / OrderHandler.openPosition / MTF openMarketAndVerify
```

Chi tiết surfaces: [entry-surfaces.v1.json](contracts/quant-terminal/entry-surfaces.v1.json).

---

## 3. Gap matrix Q1–Q7

| ID | Theme | Status | Evidence chính | Spec liên quan | Gap lớn |
|---|---|---|---|---|---|
| Q1 | Workspace / chart / trade plan | **partial→implemented foundation** | Terminal quant strip: Watchlist/Chart/Plan/Ticket; `POST /api/terminal/plans`, `POST /api/trading/preview`, `GET /api/terminal/candles`, workspace prefs; overlay + hline drawings; bracket `entry_filled_protection_pending` | terminal-workspace, master §4, contracts P0 | UI QA browser chưa chạy trong CI; fills overlay từ live stream còn mỏng; multi-chart sync optional chưa làm |
| Q2 | Portfolio risk / gate | **implemented foundation (observe)** | `/api/risk/*`, models policies/reservations/acks, trading-bridge gate, bot `services/risk-gate`, RiskCockpit UI | master §5 | Enforce live chưa bật; reverse open-leg partial; ACK coverage UI tối giản; concurrent stress chưa CI |
| Q3 | Market scanner / alerts | **implemented foundation** | `/api/research/scanners|tracks|inbox`, predicate allowlist, Inbox UI `/inbox`, dedupe `sourceEventId` | research-tracking-inbox | Worker cron tự chạy scanner chưa; history OI/funding collector mới chưa (reuse market cache) |
| Q4 | Timeline / journal / TCA | **implemented foundation** | `web_trade_events`, bridge append, journal `tradeInstanceId`/`legacy_unresolved`, `arrivalSlippageBps` | master §7 | Bot fill/signal-skip producers chưa đầy đủ; clock sync UI mỏng |
| Q5 | Strategy analytics | **integrated (partial verified)** | `/api/analytics/*` + account load phân biệt no_trades/load_failed/truncated | master §8 | Browser QA; full-suite tích hợp chưa |
| Q6 | Research Lab | **implemented (stub) / blocked parity** | lease + actor-scoped dataset; cancel không bị ghi đè succeeded; WF validate | master §9 | Worker process tách + pullback parity |
| Q7 | Allocation / microstructure / algos | **implemented (dry) / blocked live** | allocation preview; algo outstanding đúng partial; depth unavailable | master §10 | Scheduler TWAP; provider depth |

### Identity / provenance / capability (cross-cutting)

| Item | Status | Evidence |
|---|---|---|
| Receipt requestId / idempotencyKey | existing | `trading-receipt.js` |
| exchange/instrument trên fill | **partial/missing** | `exchange-fill.js` chỉ username+symbol+tradeId |
| tradeInstanceId / planId | missing | — |
| Provenance envelope quality/TTL | missing (proposed) | contract `provenance.v1` |
| Adapter capability check | partial | `direct-trading.withAdapter` |
| Reservation / policy ACK matrix | missing | contract `compatibility.v1` |

---

## 4. Bot exposure inventory (tóm tắt)

Full list: [entry-surfaces.v1.json](contracts/quant-terminal/entry-surfaces.v1.json) + audit P0.

| Surface | Local gate hôm nay | Reservation |
|---|---|---|
| Signal `callHandleSignalBot` | `checkBotStatus` | missing |
| Manual `/open` | **bypass** checkBotStatus | missing |
| `/long` `/short` raw | none | missing |
| COPY open | checkBotStatus + COPY.ON | missing |
| COPY DCA add | COPY.DCA caps | missing |
| DCA/MTF open + scale-in | RiskControl / dca-gate | missing |
| MTF publish → trader | checkBotStatus (secondary) | missing — double exposure risk |
| ROSEI open leg | checkBotStatus if mapped | missing — tách close vs entry |
| Paper PAPER / DCA_MTF_PAPER | local / sim | missing (sim book riêng) |

**Protect/reduce phải sống khi chặn entry:** SL/TP monitor, close own, COPY reduce, MTF exit, cancel protection (không cancel-all khi sibling), post-open filter own close.

---

## 5. Backtest engine audit

Chi tiết: [fixtures/backtest-engines.fixture.json](contracts/quant-terminal/fixtures/backtest-engines.fixture.json).

| Engine | Repo paths | Supported (tóm tắt) | Gaps | Parity |
|---|---|---|---|---|
| Signal-config BT | `binance-bot/services/backtest/` | Replay OPEN/SL/TP theo config; `/bt` | Không MQTT live; HL2 approx; không sibling/leftover | **false** |
| DCA MTF BT | `…/dca-mtf-bot/backtest/` | Cron replay; pullback; confirmed candle; CONSERVATIVE intrabar; Vision CSV | No funding; skeleton breakout/reversal; precision approx | **false** |
| Paper managers | paper-trading-manager / DCA_MTF_PAPER | Sim fill | Không phải research runner cách ly | **false** |

**Quy tắc P5:** chỉ expose strategy có parity fixture; runner không import trader startup / live credentials.

---

## 6. Quota / retention đề xuất (chưa enforce)

Đề xuất vận hành từ master §11–12 + evidence collectors hiện có. **Chưa apply** TTL lên collection tài chính legacy (`account_statics`, fills production indexes, …).

| Data class | Đề xuất giữ | Ghi chú |
|---|---|---|
| Tick/book raw (khi có Q7) | 7 ngày | Provider chưa có → unavailable |
| Normalized market history | 180 ngày | Market/SM collectors hiện hữu — capacity review trước TTL |
| Execution events / receipts / timeline | 365 ngày | Receipt đã có `expiresAt` TTL riêng (idempotency window) |
| Dataset/run artifacts (P5) | pin đến khi user archive | Manifest + data cần replay |
| Risk reservations | tới terminal state + audit window ≥ 30 ngày | — |
| Research job concurrency | mặc định 1 worker, queue bounded | Không đo máy ở P0 → API phải enforce khi implement |
| Alert/Inbox dedupe | unique (source, sourceEventId) | — |

Load-test fixture khởi điểm (chưa chạy): 100 symbols, 10 books, 500 positions/orders, 50k events — ghi hardware khi đo ở milestone UI.

---

## 7. Migration / rollback

### Migration (additive)

1. Schema mới: workspace/plan/preview/risk/reservation/events/quant_* — collection mới hoặc field optional.
2. Fill/order: thêm `exchange`, `instrumentId`, `tradeInstanceId` optional; **không drop** unique `{username,symbol,tradeId}` trước audit duplicate.
3. Journal: thêm `tradeInstanceId` optional; legacy key vẫn đọc; link history chỉ khi evidence → else `legacy_unresolved`.
4. Bot producers: emit additive correlation fields; giữ messId / V1 payload.
5. Index mới tạo trước backfill bounded; backfill chỉ khi provenance đủ.

### Rollback

1. Tắt UI/worker mới / feature flag; route cũ còn.
2. Giữ dữ liệu additive.
3. Enforce/reservation/algo: drain hoặc reconcile in-flight trước khi gỡ writer; không gỡ gate khi producer khác vẫn tưởng enforce.
4. Không drop data, không đổi PAPER/INVERT, không flatten/restart như “migration”.

Compatibility matrix: [compatibility.v1.json](contracts/quant-terminal/compatibility.v1.json).

---

## 8. Dependency backlog P0→P6

Mỗi task: repo, entry files, dependency, contract, test. **Không ETA.**

### P0 — Contracts & inventory (này)

| Task | Repo | Entry | Dep | Contract | Test |
|---|---|---|---|---|---|
| P0.1 Status + gap matrix | web-bot | `docs/quant-terminal-implementation-status.md` | master spec | — | review |
| P0.2 Lock contracts | web-bot | `docs/contracts/quant-terminal/*.json` | audit | identity/provenance/reservation/capability/compatibility/entry-surfaces | `server/test/quant-terminal-contracts.test.js` |
| P0.3 Offline fixtures | web-bot | `docs/contracts/quant-terminal/fixtures/*` | P0.2 | timeline/risk/backtest | same test |
| P0.4 Link docs/index | web-bot | `docs/index.md` | P0.1 | — | — |

**P0 acceptance:** artifact trong repo; gap có source links; existing vs proposed tách; không bật live trading.

### P1 — Q1 workspace/chart/plan (+ freshness)

| Task | Repo | Entry | Dep | Contract | Test | Status |
|---|---|---|---|---|---|---|
| P1.1 Terminal layout watchlist/chart/ticket | web-bot | `TerminalPage.jsx`, `components/terminal/` | P0 | provenance | client build + UI QA | **done** (UI QA tay còn) |
| P1.2 Chart overlays + drawings prefs | web-bot | `TerminalChart.jsx` + workspace | P1.1 | identity market | fixture signal→chart | **done** |
| P1.3 Trade plan API | web-bot | routes/terminal + model `web_trade_plans` | P0 identity | identity/plan | server tests | **done** |
| P1.4 `POST /api/trading/preview` | web-bot | trading routes + bridge (no place) | P1.3, quote TTL | provenance | stale/expiry tests | **done** |
| P1.5 Submit revalidate preview + bracket states | web-bot | OrderTicket + trading-bridge | P1.4, capability | capability | protection pending/failed | **done** |
| P1.6 Keep legacy tabs/URL/dirty/RBAC | web-bot | TerminalPage | — | — | regression | **done** (build) |

### P2 — Q2 risk

| Task | Repo | Entry | Dep | Contract | Test |
|---|---|---|---|---|---|
| P2.1 Risk read cockpit + scenarios | web-bot | `/api/risk/*` + RiskCockpit | positions/balance scope | provenance | **done** unit snapshot/scenarios |
| P2.2 Policy versioned observe | web-bot | `web_risk_policies` + CAS + scope doc | auth | reservation | **verified** unit; enforce locked unless RISK_ENFORCE_READY |
| P2.3 Durable reservation store | web-bot | account lock + bind/release auth | P2.2 | reservation | **integrated**; concurrent stress còn thiếu |
| P2.4 Hook web increase paths | web-bot | book load + reverse open-leg after close | P2.3 | entry-surfaces | **integrated** |
| P2.5 Hook bot entry surfaces | binance-bot | username identity + notional estimate | shared Mongo | entry-surfaces | **integrated** observe; enforce fail-closed khi ready |
| P2.6 Three controls | both | `/api/risk/controls` + bot pause honor | P2.4–5 | reservation | **implemented** |
| P2.7 Producer ACK coverage UI | web-bot | API acks + matrix doc | P2.5 | compatibility | **partial** |

### P3 — Q3 + Q4

| Task | Repo | Entry | Dep | Contract | Test |
|---|---|---|---|---|---|
| P3.1 History price/OI/funding + RS/breadth provenance | web-bot | reuse market cache provenance | P0 | provenance | **partial** (không collector mới) |
| P3.2 Scanner predicate + saved + Inbox | web-bot | `/api/research/*` + `/inbox` | P3.1 | — | **done** unit missing≠false |
| P3.3 Producer timeline events | both | bridge append + `/api/research/timeline` | identity | timeline fixture | **partial** web; bot fills chưa |
| P3.4 Journal tradeInstanceId additive | web-bot | trade-journal | identity | identity | **done** legacy_unresolved |
| P3.5 Slippage/latency flags | web-bot | `arrivalSlippageBps` + clockUncertainty | P3.3 | provenance | **done** unit |

### P4 — Q5 analytics

| Task | Repo | Entry | Dep | Contract | Test |
|---|---|---|---|---|---|
| P4.1 Shared metric definitions/version | web-bot | `lib/analytics/metric-definitions.js` | P3 | accounting basis | **done** |
| P4.2 Net PnL / R / PF / DD / Sharpe | web-bot | `/api/analytics/strategies*` | P4.1 | — | **done** unit |
| P4.3 MAE/MFE fidelity flags | web-bot | strategy-metrics excursion | inventory | — | **done** DCA incomplete |
| P4.4 Alerts phân tích (không auto-off config) | web-bot | `/api/analytics/alerts/evaluate` | P4.2 | — | **done** |

### P5 — Q6 quant-lab

| Task | Repo | Entry | Dep | Contract | Test |
|---|---|---|---|---|---|
| P5.1 `/quant-lab` + datasets/experiments | web-bot | `/api/quant/*` + UI | P0 D11 | — | **done** RBAC `research.run` |
| P5.2 Isolated job runner | web-bot | lease on `web_quant_runs` (stub inline) | engines | — | **done** cancel/lease; process riêng follow-up |
| P5.3 Adapter pullback (+ chỉ parity-ready) | binance-bot | **blocked** catalog | P5.2 | engines | **blocked** parityReady=false |
| P5.4 OOS/walk-forward/bootstrap | web-bot | stub-engine | P5.2 | — | **done** unit |
| P5.5 Paper deploy + promotion proposal | web-bot | `POST /api/quant/promotions` | Config Lab | — | **done** proposal only |

### P6 — Q7 allocation / microstructure / algos

| Task | Repo | Entry | Dep | Contract | Test |
|---|---|---|---|---|---|
| P6.1 Allocation proposals | web-bot | `/api/portfolio/allocations*` | P2 | capability | **done** stale 409 |
| P6.2 Depth/tape/CVD if provider | web-bot | capabilities endpoint | **provider missing** | capability | **done** unavailable explicit |
| P6.3 Server TWAP/participation/VWAP | web-bot | `/api/trading/algo-orders*` | P2 | capability | **done** bound/reconcile; live chặn |
| P6.4 Full P0–P6 status audit | web-bot | this file | all | — | **done** (honest blocked items) |

---

## 9. Proposed APIs (chưa tồn tại) vs existing

| Proposed (master §11) | P0 status |
|---|---|
| `/api/terminal/workspaces` | **existing** (`/me`) |
| `/api/terminal/plans` | **existing** |
| `POST /api/trading/preview` | **existing** |
| `/api/risk/*` | **existing** (P2; risk-profile vẫn riêng) |
| `/api/research/inbox` (+ scanners/tracks) | **existing** (P3; dash Telegram khác) |
| `/api/research/timeline` | **existing** (alias trade timeline) |
| `/api/analytics/strategies` | **existing** (P4; khác scorecard win-by-status) |
| `/api/quant/*` | **existing** (P5 stub) |
| `/api/portfolio/allocations` | **existing** (P6 preview/activate) |
| `/api/trading/algo-orders` | **existing** (P6 durable; live blocked) |
| `/api/trading/*` mutations | **existing** |
| `/api/terminal/journal` | **existing** |
| `/api/provider-scorecard` | **existing** |

Conflict codes đề xuất (chưa wire): `source_changed`, `preview_expired`, `risk_rejected`, `unsupported_capability`, `data_unavailable`.

---

## 10. Permissions

| Permission | Trạng thái | Không suy ra |
|---|---|---|
| `risk.manage` | **đã merge** catalog + OPERATOR templates | không thay `positions.close` |
| `research.run` | **đã merge** catalog + OPERATOR templates | không live trade |
| `portfolio.allocate` | **đã merge** catalog + OPERATOR templates | không tự place thiếu risk gate |

Map controls: pause → trade-policy/risk.manage explicit; cancel pending → `orders.cancel`; flatten → `positions.close`.

---

## 11. External / unavailable blockers

| Need | Status | Impact |
|---|---|---|
| Historical OI/funding full archive | partial (collectors hiện tại; Vision cho klines MTF) | Q3 history / P5 funding sim |
| Tick/book/liquidation provider | **unavailable** chưa gắn | Q7 microstructure — ghi unavailable, không fabricate |
| Volume model cho VWAP | unavailable | VWAP server disabled until model |
| Parity fixtures per strategy | missing | P5 chỉ pullback candidate sau fixture |
| Measured hardware quotas | not measured at P0 | giữ bound conservative khi implement |

---

## 12. Tests đã chạy / chưa verify

| Check | Kết quả |
|---|---|
| `node --test server/test/quant-terminal-contracts.test.js` | **pass** (11) 2026-11-01 |
| `node --test server/test/trading-preview.test.js` | **pass** (P1) |
| `node --test client/.../workspace-flow.test.js` + protection/sizing | chạy ở bàn giao P1 |
| `npm --prefix client run build` | **pass** P1 |
| Full `npm --prefix server test` | chạy selective; suite đầy đủ tùy môi trường Mongo |
| Bot module tests | **chưa** (P1 không sửa bot) |
| UI QA Terminal chart (browser) | **chưa verify** — fixture `q1-workspace-flow` ghi acceptance; cần QA tay |
| Concurrent reservation | **chưa** (P2) |
| Production deploy / live order | **cấm** trong coding prompt P1 |

---

## 13. Checklist nghiệm thu P0

- [x] Gap matrix Q1–Q7 có status + evidence paths
- [x] Web trading vs MQTT config bridge tách rõ
- [x] Bot entry surfaces + protect paths inventoried
- [x] Identity / provenance / reservation / capability / compatibility locked as JSON contracts
- [x] Backtest engines audited; parityReady=false
- [x] Migration/rollback + backlog P1–P6
- [x] Retention/quota đề xuất (chưa apply)
- [x] Fixtures offline (timeline, risk, engines)
- [x] `docs/index.md` liên kết status
- [x] Không implement P1 runtime; không deploy; không đụng dirty tree sẵn

---

## 14. Bàn giao & bước tiếp

**P0 xong khi:** commit artifact này + contracts + test contracts xanh.

**Milestone kế tiếp:** **P1** — workspace/chart/trade plan + server preview/freshness (xem prompt P1 trong [quant-terminal-cursor-prompts.md](quant-terminal-cursor-prompts.md)).

Không tuyên bố toàn roadmap hoàn thành cho đến khi P0–P6 có evidence nghiệm thu.
