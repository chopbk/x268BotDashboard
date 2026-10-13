import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import OrderTicket from "../OrderTicket";
import PositionCasePanel from "../PositionCasePanel";
import { closePreview, openPreview } from "../../trade-preview";
import { qtyOf } from "../../position-sort";
import { CLOSE_PERCENTS, fmt, numInput, pnlClass, qtyAtPercent, exchangeTpsl, monitorTpsl } from "./format.js";
import { protectionStatus } from "./protection.js";
import { ownershipView } from "./summary.js";
import PreviewBlock from "./PreviewBlock.jsx";
import PriceStrip from "./PriceStrip.jsx";
import MutationStatus from "./MutationStatus.jsx";
import SizeControls from "./SizeControls.jsx";
import JournalPanel from "./JournalPanel.jsx";
import DecisionPanel from "./DecisionPanel.jsx";

const PANEL_TABS = [
  { id: "overview", label: "Tổng quan" },
  { id: "orders", label: "Lệnh" },
  { id: "monitor", label: "Monitor" },
  { id: "trade", label: "Giao dịch" },
];

/** Tab cũ → tab mới (AI/Journal nằm Tổng quan; Timeline gộp Monitor). */
function normalizePanelTab(tab) {
  if (tab === "timeline") return "monitor";
  if (tab === "ai" || tab === "journal") return "overview";
  if (PANEL_TABS.some((t) => t.id === tab)) return tab;
  return "overview";
}

export default function DetailPanel({
  row,
  audience,
  panelTab,
  onPanelTab,
  monitorId,
  onSelectMonitor,
  accounts,
  canClose,
  canOpen,
  canTpsl,
  canOrders,
  canCreateOrder,
  mutation,
  onCloseRequest,
  onOpenRequest,
  onTpslRequest,
  onReverseRequest,
  onDirtyChange,
  onClosePanel,
  onApplyProtect,
  width = 480,
  overlay,
  aiOpen = false,
  onAiOpen,
  onAiClose,
}) {
  const [tradeMode, setTradeMode] = useState("close"); // close | open | protect | advanced
  const [closeForm, setCloseForm] = useState(() => defaultClose(row));
  const [openForm, setOpenForm] = useState(() => defaultOpen(row, accounts));
  const [protectForm, setProtectForm] = useState(() => defaultProtect(row));
  const [localAiOpen, setLocalAiOpen] = useState(false);
  const activeTab = normalizePanelTab(panelTab);
  const decisionOpen = onAiOpen ? Boolean(aiOpen) : localAiOpen;

  useEffect(() => {
    setCloseForm(defaultClose(row));
    setOpenForm(defaultOpen(row, accounts));
    setProtectForm(defaultProtect(row));
    onDirtyChange?.(false);
    if (!onAiOpen) setLocalAiOpen(false);
  }, [row?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (panelTab === "timeline" || panelTab === "ai" || panelTab === "journal") {
      onPanelTab?.(normalizePanelTab(panelTab));
    }
  }, [panelTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const panelStyle = overlay ? undefined : { width, maxWidth: "100%" };

  function openAi() {
    if (onAiOpen) onAiOpen();
    else setLocalAiOpen(true);
  }

  function closeAi() {
    if (onAiClose) onAiClose();
    else setLocalAiOpen(false);
  }

  if (!row) {
    return (
      <aside className={`term-panel ${overlay ? "term-panel-overlay" : ""}`} style={panelStyle}>
        <div className="term-panel-empty muted">Chọn một vị thế để xem chi tiết và đặt lệnh.</div>
      </aside>
    );
  }

  const status = protectionStatus(row);
  const own = ownershipView(row);
  const fullQty = qtyOf(row);

  function markDirty() {
    onDirtyChange?.(true);
  }

  return (
    <aside className={`term-panel ${overlay ? "term-panel-overlay" : ""}`} style={panelStyle} aria-label="Panel chi tiết">
      <header className="term-panel-head">
        <div>
          <h2>{row.symbol} <span className={`term-side term-side-${String(row.side).toLowerCase()}`}>{row.side}</span></h2>
          <p className="muted">{row.account}{row.leverage != null ? ` · ${fmt(row.leverage, 0)}x` : ""}{row.book === "paper" ? " · Paper" : ""}</p>
        </div>
        <button type="button" className="ghost" onClick={onClosePanel} aria-label="Đóng panel">✕</button>
      </header>

      <nav className="term-panel-tabs" role="tablist">
        {PANEL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => onPanelTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="term-panel-body">
        {activeTab === "overview" ? (
          <section className="term-panel-section stack">
            <PriceStrip entry={row.entry} mark={row.mark} sl={status.exchange.sl} tp={status.exchange.tp} />
            <div className="term-kv">
              <div><span>Size (sàn)</span><strong className="term-num">{fmt(own.exchangeQty ?? own.size)}</strong></div>
              <div><span>Own qty mở</span><strong className="term-num">{fmt(own.ownTotal)}</strong></div>
              <div><span>Entry</span><strong className="term-num">{fmt(row.entry)}</strong></div>
              <div><span>Mark</span><strong className="term-num">{fmt(row.mark)}</strong></div>
              <div><span>PnL mở (toàn vị thế)</span><strong className={`term-num ${pnlClass(row.unrealized)}`}>{row.unrealized == null ? "—" : fmt(row.unrealized, 2)}</strong></div>
              <div><span>PnL ghi nhận</span><strong className={`term-num ${pnlClass(row.recorded?.net)}`}>{row.recorded ? fmt(row.recorded.net, 2) : "—"}</strong></div>
              <div><span>Thanh lý</span><strong className="term-num">{fmt(row.liquidation)}</strong></div>
              <div><span>SL</span><strong className={`term-protect-${status.sl.kind}`}>{status.sl.label} {status.sl.detail}</strong></div>
              <div><span>TP</span><strong className={`term-protect-${status.tp.kind}`}>{status.tp.label} {status.tp.detail}</strong></div>
            </div>
            {own.allocation === "over" ? <p className="form-error">Lệch phân bổ: tổng ownQty &gt; qty sàn — không clamp về 0.</p> : null}
            {own.allocation === "under" ? <p className="muted">Leftover ~{fmt(own.leftover)} chưa gán monitor (không tự gán config).</p> : null}
            {own.allocation === "unassigned" ? <p className="muted">Qty sàn chưa có monitor.</p> : null}
            <MutationStatus phase={mutation?.phase} message={mutation?.message} requestId={mutation?.requestId} exchangeStatus={mutation?.exchangeStatus} />
            <div className="term-journal-actions">
              <button type="button" className="term-primary" onClick={openAi}>AI phân tích</button>
              <button type="button" className="ghost" onClick={() => onPanelTab("monitor")}>Monitor & timeline</button>
              <button type="button" className="ghost" onClick={() => onPanelTab("trade")}>Giao dịch</button>
            </div>

            <div className="term-overview-journal">
              <h3 className="term-overview-subhead">Journal</h3>
              <JournalPanel row={row} />
            </div>
          </section>
        ) : null}

        {activeTab === "trade" ? (
          <section className="term-panel-section stack">
            <div className="term-trade-modes">
              <button type="button" className={tradeMode === "close" ? "active" : ""} onClick={() => setTradeMode("close")}>Đóng</button>
              <button type="button" className={tradeMode === "open" ? "active" : ""} onClick={() => setTradeMode("open")}>Mở</button>
              <button type="button" className={tradeMode === "protect" ? "active" : ""} onClick={() => setTradeMode("protect")}>Bảo vệ</button>
              {canCreateOrder ? <button type="button" className={tradeMode === "advanced" ? "active" : ""} onClick={() => setTradeMode("advanced")}>Lệnh nâng cao</button> : null}
            </div>

            {tradeMode === "close" ? (
              <div className="stack">
                {!canClose ? <p className="form-error">Thiếu quyền positions.close</p> : null}
                {row.book === "paper" || row.book === "pending" ? <p className="muted">Paper/lệnh chờ không đóng bằng Market/Limit trên sàn.</p> : null}
                <label>Loại
                  <select value={closeForm.orderType} disabled={!canClose} onChange={(e) => { setCloseForm({ ...closeForm, orderType: e.target.value }); markDirty(); }}>
                    <option value="MARKET">Market</option>
                    <option value="LIMIT">Limit</option>
                  </select>
                </label>
                {closeForm.orderType === "LIMIT" ? (
                  <label>Giá
                    <input value={closeForm.price} disabled={!canClose} onChange={(e) => { setCloseForm({ ...closeForm, price: e.target.value.replace(/,/g, "") }); markDirty(); }} />
                  </label>
                ) : null}
                <label>Số lượng
                  <input
                    value={closeForm.qty}
                    disabled={!canClose}
                    onChange={(e) => { setCloseForm({ ...closeForm, qty: e.target.value.replace(/,/g, ""), percent: null }); markDirty(); }}
                  />
                </label>
                <div className="term-percents">
                  {CLOSE_PERCENTS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={closeForm.percent === p ? "active" : ""}
                      disabled={!canClose || fullQty == null}
                      onClick={() => {
                        setCloseForm({
                          ...closeForm,
                          percent: p,
                          qty: p === 100 ? numInput(fullQty) : qtyAtPercent(fullQty, p),
                        });
                        markDirty();
                      }}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
                <PreviewBlock
                  title="Preview đóng (ước tính)"
                  preview={closePreview({
                    side: row.side,
                    entry: row.entry,
                    exitPrice: closeForm.orderType === "LIMIT" ? Number(closeForm.price) : Number(row.mark),
                    qty: Number(closeForm.qty) || (closeForm.percent ? fullQty * (closeForm.percent / 100) : fullQty),
                    monitors: row.monitors,
                  })}
                />
                <p className="muted">Đóng vị thế sàn — không gắn “chỉ config này”.</p>
                <button
                  type="button"
                  className="term-primary"
                  disabled={!canClose || row.book === "paper" || row.book === "pending"}
                  onClick={() => onCloseRequest(row, closeForm)}
                >
                  Xem xác nhận đóng
                </button>
                <button type="button" className="ghost" onClick={() => onReverseRequest(row)}>Đảo chiều…</button>
              </div>
            ) : null}

            {tradeMode === "open" ? (
              <div className="stack">
                {!canOpen ? <p className="form-error">Thiếu quyền positions.open</p> : null}
                <label>Tài khoản
                  <select value={openForm.account} disabled={!canOpen} onChange={(e) => { setOpenForm({ ...openForm, account: e.target.value }); markDirty(); }}>
                    <option value="">Chọn</option>
                    {(accounts || []).map((a) => <option key={a.username} value={a.username}>{a.username}</option>)}
                  </select>
                </label>
                <label>Symbol
                  <input value={openForm.symbol} disabled={!canOpen} onChange={(e) => { setOpenForm({ ...openForm, symbol: e.target.value.toUpperCase() }); markDirty(); }} />
                </label>
                <label>Side
                  <select value={openForm.side} disabled={!canOpen} onChange={(e) => { setOpenForm({ ...openForm, side: e.target.value }); markDirty(); }}>
                    <option value="LONG">LONG</option>
                    <option value="SHORT">SHORT</option>
                  </select>
                </label>
                <label>Loại
                  <select value={openForm.orderType} disabled={!canOpen} onChange={(e) => { setOpenForm({ ...openForm, orderType: e.target.value }); markDirty(); }}>
                    <option value="MARKET">MARKET</option>
                    <option value="LIMIT">LIMIT</option>
                  </select>
                </label>
                {openForm.orderType === "LIMIT" ? (
                  <label>Giá
                    <input value={openForm.price} disabled={!canOpen} onChange={(e) => { setOpenForm({ ...openForm, price: e.target.value.replace(/,/g, "") }); markDirty(); }} />
                  </label>
                ) : null}
                <SizeControls
                  account={openForm.account}
                  price={openForm.orderType === "LIMIT" ? openForm.price : (openForm.mark || openForm.price || row.mark)}
                  leverage={row.leverage}
                  disabled={!canOpen}
                  value={openForm}
                  onChange={(next) => {
                    setOpenForm({
                      ...openForm,
                      sizeMode: next.sizeMode,
                      quantity: next.sizeMode === "qty" ? next.quantity : (next.estimate?.ready ? String(next.estimate.quantity) : ""),
                      percent: next.percent,
                      usdt: next.usdt,
                      riskBudget: next.riskBudget,
                      stop: next.stop,
                      estimate: next.estimate,
                      balance: next.balance,
                    });
                    markDirty();
                  }}
                />
                <PreviewBlock
                  title="Preview mở"
                  preview={openPreview({
                    side: openForm.side,
                    entryOrMark: openForm.orderType === "LIMIT" ? openForm.price : (openForm.mark || openForm.price || row.mark),
                    quantity: openForm.quantity,
                  })}
                />
                <button type="button" className="term-primary" disabled={!canOpen} onClick={() => onOpenRequest(openForm)}>Xem xác nhận mở</button>
              </div>
            ) : null}

            {tradeMode === "protect" ? (
              <div className="stack">
                {!canTpsl ? <p className="form-error">Thiếu quyền positions.tpsl</p> : null}
                <div className="history-tabs">
                  <button type="button" className={protectForm.tab === "tpsl" ? "active" : ""} onClick={() => setProtectForm({ ...protectForm, tab: "tpsl" })}>TP/SL</button>
                  <button type="button" className={protectForm.tab === "trailing" ? "active" : ""} onClick={() => setProtectForm({ ...protectForm, tab: "trailing" })}>Trailing</button>
                </div>
                {protectForm.tab === "tpsl" ? (
                  <>
                    <label>Take Profit
                      <input value={protectForm.tp} disabled={!canTpsl} onChange={(e) => { setProtectForm({ ...protectForm, tp: e.target.value.replace(/,/g, ""), tpEnabled: true }); markDirty(); }} />
                    </label>
                    <label>Stop Loss
                      <input value={protectForm.sl} disabled={!canTpsl} onChange={(e) => { setProtectForm({ ...protectForm, sl: e.target.value.replace(/,/g, ""), slEnabled: true }); markDirty(); }} />
                    </label>
                  </>
                ) : (
                  <>
                    <label>Callback %
                      <input value={protectForm.callbackRate} disabled={!canTpsl} onChange={(e) => { setProtectForm({ ...protectForm, callbackRate: e.target.value.replace(/,/g, "") }); markDirty(); }} />
                    </label>
                    <label>Activation (optional)
                      <input value={protectForm.activationPrice} disabled={!canTpsl} onChange={(e) => { setProtectForm({ ...protectForm, activationPrice: e.target.value.replace(/,/g, "") }); markDirty(); }} />
                    </label>
                  </>
                )}
                <button type="button" className="term-primary" disabled={!canTpsl} onClick={() => onTpslRequest(row, protectForm)}>Xem xác nhận bảo vệ</button>
              </div>
            ) : null}

            {tradeMode === "advanced" && canCreateOrder ? (
              <div className="term-advanced-ticket">
                <p className="muted">Dùng `orders.create` — không né quyền bằng endpoint positions.</p>
                <OrderTicket
                  key={`${row.account}-${row.symbol}`}
                  accounts={accounts}
                  defaultAccount={row.account}
                  defaultSymbol={row.symbol}
                  canCreate={canCreateOrder}
                  onPlaced={() => onDirtyChange?.(false)}
                />
              </div>
            ) : null}

            <MutationStatus phase={mutation?.phase} message={mutation?.message} requestId={mutation?.requestId} exchangeStatus={mutation?.exchangeStatus} />
          </section>
        ) : null}

        {(activeTab === "orders" || activeTab === "monitor") && !canOrders && activeTab === "orders" ? (
          <p className="muted">Cần quyền orders.view để xem lệnh liên quan.</p>
        ) : null}

        {["orders", "monitor"].includes(activeTab) && (activeTab !== "orders" || canOrders) ? (
          <PositionCasePanel
            key={`${row.key}|${audience}`}
            embedded
            section={activeTab}
            row={row}
            audience={audience}
            selectedMonitorId={monitorId}
            onSelectMonitor={onSelectMonitor}
          />
        ) : null}
      </div>

      {decisionOpen && typeof document !== "undefined"
        ? createPortal(
          <div
            className="modal-backdrop term-modal term-ai-modal"
            role="presentation"
            onClick={closeAi}
          >
            <div
              className="modal-card term-ai-dialog stack"
              role="dialog"
              aria-modal="true"
              aria-labelledby="term-ai-title"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="term-ai-dialog-head">
                <div>
                  <h2 id="term-ai-title">AI phân tích · {row.symbol} {row.side}</h2>
                  <p className="muted">{row.account}</p>
                </div>
                <button type="button" className="ghost" onClick={closeAi} aria-label="Đóng">✕</button>
              </header>
              <div className="term-ai-dialog-body">
                <DecisionPanel row={row} />
              </div>
            </div>
          </div>,
          document.body
        )
        : null}

    </aside>
  );
}

function defaultClose(row) {
  return {
    orderType: "MARKET",
    price: numInput(row?.mark),
    qty: numInput(qtyOf(row)),
    percent: null,
  };
}

function defaultOpen(row, accounts) {
  return {
    account: row?.account || accounts?.[0]?.username || "",
    symbol: row?.symbol || "",
    side: row?.side || "LONG",
    orderType: "MARKET",
    sizeMode: "qty",
    quantity: "",
    percent: "",
    usdt: "",
    riskBudget: "",
    stop: "",
    price: numInput(row?.mark),
    mark: numInput(row?.mark),
  };
}

function defaultProtect(row) {
  const exchange = exchangeTpsl(row);
  const monitor = monitorTpsl(row);
  return {
    tab: "tpsl",
    tp: numInput(exchange.tp ?? monitor.tp),
    sl: numInput(exchange.sl ?? monitor.sl),
    tpEnabled: true,
    slEnabled: true,
    tpWorkingType: "CONTRACT_PRICE",
    slWorkingType: "CONTRACT_PRICE",
    callbackRate: numInput(exchange.trailingCallback) || "1",
    activationPrice: numInput(exchange.trailingActivation),
    trailingWorkingType: "CONTRACT_PRICE",
    hasTrailing: exchange.trailingCallback != null,
    trailingOrderId: exchange.trailingOrderId,
  };
}
