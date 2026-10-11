import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useEscape } from "../navigation";
import { alertText, positionAlerts } from "../position-alerts";
import { POSITION_COLUMNS, qtyOf, roiOf, sortedRows, volumeOf } from "../position-sort";
import { closePreview, openPreview, TAKER_FEE_RATE } from "../trade-preview";
import PositionHistory from "./PositionHistory";
import OpenOrdersTab from "../components/OpenOrdersTab";
import OrderHistoryTab from "../components/OrderHistoryTab";
import PositionCasePanel from "../components/PositionCasePanel";

const WARN = {
  "no-monitor": "Chưa có monitor",
  "qty-mismatch": "Lệch qty",
  "closed-on-exchange": "Đã đóng trên sàn, monitor chưa cập nhật",
  "monitor-without-position": "Monitor không thấy vị thế",
  stale: "Dữ liệu cũ",
};

function fmt(value, digits = 4) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN");
}

function pnlClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "pos-up" : "pos-down";
}

function matches(row, params) {
  const symbol = (params.get("symbol") || "").trim().toUpperCase();
  const signal = (params.get("signal") || "").trim().toUpperCase();
  const side = (params.get("side") || "").trim().toUpperCase();
  const book = (params.get("book") || "").trim().toLowerCase();
  const env = (params.get("env") || "").trim();
  if (symbol && !String(row.symbol || "").toUpperCase().includes(symbol)) return false;
  if (signal && !(row.monitors || []).some((monitor) => `${monitor.signal || ""} ${monitor.type || ""}`.toUpperCase().includes(signal))) return false;
  if (side && row.side !== side) return false;
  if (book === "all") {
    if (row.book === "pending") return false;
  } else if (book === "notpsl") {
    if (!row.notpsl && !row.monitors.some((monitor) => monitor.notpsl)) return false;
  } else if (book === "paper" || book === "pending") {
    if (row.book !== book) return false;
  } else if (row.book === "paper" || row.book === "pending") return false;
  if (env && !row.monitors.some((monitor) => monitor.env === env)) return false;
  if (params.get("warn") === "1" && !row.warnings.length) return false;
  return true;
}

const CLOSE_PERCENTS = [10, 25, 50, 75, 100];

function exchangeTpsl(row) {
  return {
    tp: row.exchangeTp != null ? row.exchangeTp : null,
    sl: row.exchangeSl != null ? row.exchangeSl : null,
    trailingCallback: row.exchangeTrailingCallback != null ? row.exchangeTrailingCallback : null,
    trailingActivation: row.exchangeTrailingActivation != null ? row.exchangeTrailingActivation : null,
    trailingOrderId: row.exchangeTrailingOrderId || null,
  };
}

function monitorTpsl(row) {
  const monitors = row.monitors || [];
  return {
    tp: monitors.map((monitor) => monitor.tp).find(Boolean) || null,
    sl: monitors.map((monitor) => monitor.sl).find(Boolean) || null,
    trailing: monitors.map((monitor) => monitor.trailing).find(Boolean) || null,
  };
}

function tpslText(row) {
  const exchange = exchangeTpsl(row);
  const parts = [];
  if (exchange.tp != null || exchange.sl != null) {
    parts.push(`TP ${exchange.tp != null ? fmt(exchange.tp) : "—"} / SL ${exchange.sl != null ? fmt(exchange.sl) : "—"}`);
  }
  if (exchange.trailingCallback != null) {
    parts.push(`Trail ${fmt(exchange.trailingCallback, 2)}%`);
  }
  if (parts.length) return parts.join(" · ");
  const monitor = monitorTpsl(row);
  if (monitor.sl || monitor.tp || monitor.trailing) {
    return `TP ${monitor.tp || "—"} / SL ${monitor.sl || "—"} · monitor`;
  }
  // Không có trong sổ Redis (algo chưa sync) ≠ chắc chắn sàn không có lệnh
  if ((row.monitors || []).length) return "Chưa thấy TP/SL sàn";
  return "TP/SL · chưa thấy trên sổ";
}

function PreviewBlock({ preview, title }) {
  if (!preview) return null;
  return (
    <div className="pos-preview">
      {title ? <strong>{title}</strong> : null}
      <ul>
        <li>Qty đóng/mở: {fmt(preview.quantity)}</li>
        {preview.exitPrice != null ? <li>Giá thoát ước tính: {fmt(preview.exitPrice)}</li> : null}
        {preview.price != null && preview.exitPrice == null ? <li>Giá tham chiếu: {fmt(preview.price)}</li> : null}
        {preview.notional != null ? <li>Notional ≈ {fmt(preview.notional, 2)} USDT</li> : null}
        {preview.estimatedPnl != null ? (
          <li className={pnlClass(preview.estimatedPnl)}>PnL dự kiến ≈ {fmt(preview.estimatedPnl, 2)} USDT</li>
        ) : null}
        {preview.estimatedFee != null ? (
          <li>Phí ước tính (taker {(preview.feeRate || TAKER_FEE_RATE) * 100}%) ≈ {fmt(preview.estimatedFee, 4)} USDT</li>
        ) : null}
        {preview.netAfterFee != null ? (
          <li className={pnlClass(preview.netAfterFee)}>Net sau phí ≈ {fmt(preview.netAfterFee, 2)} USDT</li>
        ) : null}
      </ul>
      {preview.siblings?.length ? (
        <>
          <p className="muted">Sibling monitor dùng chung position ({preview.siblings.length}):</p>
          <ul>
            {preview.siblings.map((item) => (
              <li key={item.id || `${item.env}-${item.signal}`}>
                {item.env || "config"} · {item.signal || "—"} · qty riêng {fmt(item.ownQty)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">Không có sibling monitor.</p>
      )}
    </div>
  );
}

function numInput(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(n);
}

function qtyAtPercent(fullQty, percent) {
  const n = Number(fullQty) * (Number(percent) / 100);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Number(n.toPrecision(12)));
}

function closeFormOf(forms, row) {
  const current = forms[row.key];
  if (current) return current;
  return { price: numInput(row.mark), qty: numInput(qtyOf(row)), percent: null };
}

export default function PositionsPage() {
  const { user } = useAuth();
  const canClose = (user?.permissions || []).includes("positions.close");
  const canOpen = (user?.permissions || []).includes("positions.open");
  const canTpsl = (user?.permissions || []).includes("positions.tpsl");
  const canPositions = (user?.permissions || []).includes("positions.view");
  const canHistory = (user?.permissions || []).includes("statistics.view");
  const canOrders = (user?.permissions || []).includes("orders.view");
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const account = params.get("account") || "";
  const audience = params.get("audience") === "all" ? "all" : "mine";
  const book = params.get("book") || "";
  const panel = params.get("panel") || "";
  const tabParam = params.get("tab") || "open";
  const tab = ["open", "history", "orders", "order-history"].includes(tabParam) ? tabParam : "open";
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [monitorId, setMonitorId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState({ key: "", dir: "desc" });
  const [actionNote, setActionNote] = useState("");
  const [closeForms, setCloseForms] = useState({});
  const [closePercentKey, setClosePercentKey] = useState("");
  const [closeConfirm, setCloseConfirm] = useState(null);
  const [closing, setClosing] = useState(false);
  const [tpslDraft, setTpslDraft] = useState(null);
  const [savingTpsl, setSavingTpsl] = useState(false);
  const [openTrade, setOpenTrade] = useState(null);
  const [opening, setOpening] = useState(false);
  const [reverseConfirm, setReverseConfirm] = useState(null);
  const [reversing, setReversing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [historyAccounts, setHistoryAccounts] = useState([]);
  const [notices, setNotices] = useState([]);
  const [notifyReady, setNotifyReady] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const watchKeyRef = useRef("");

  function pushNotices(alerts) {
    if (!alerts.length) return;
    setNotices((prev) => [...alerts, ...prev].slice(0, 8));
    for (const alert of alerts) {
      window.setTimeout(() => {
        setNotices((prev) => prev.filter((item) => item.id !== alert.id));
      }, 8000);
      if (document.visibilityState !== "hidden") continue;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") continue;
      try {
        new Notification("Vị thế", { body: alertText(alert), tag: alert.id });
      } catch (error) {
        console.error("[positions]", error);
      }
    }
  }

  function acceptView(prev, view) {
    if (!view) return prev;
    const versions = new Map((prev?.sources || []).map((item) => [item.account, item.version]));
    if ((view.sources || []).some((item) => item.version != null && versions.get(item.account) != null && item.version < versions.get(item.account))) {
      return prev;
    }
    const key = `${account}|${audience}|${book}`;
    if (watchKeyRef.current === key && prev) {
      const alerts = positionAlerts(prev, view);
      if (alerts.length) queueMicrotask(() => pushNotices(alerts));
    } else {
      watchKeyRef.current = key;
    }
    return view;
  }

  function go(mutate, { replace = false, layer = false } = {}) {
    const next = new URLSearchParams(location.search);
    mutate(next);
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace, state: layer ? { layer: (location.state?.layer || 0) + 1 } : location.state }
    );
  }

  const closePanel = useCallback(() => {
    const key = new URLSearchParams(location.search).get("panel");
    if ((location.state?.layer || 0) > 0) {
      navigate(-1);
    } else {
      const next = new URLSearchParams(location.search);
      next.delete("panel");
      const search = next.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
    }
    window.setTimeout(() => document.querySelector(`[data-row="${CSS.escape(key || "")}"]`)?.focus(), 0);
  }, [location.pathname, location.search, location.state, navigate]);

  useEscape(Boolean(panel), closePanel);

  useEffect(() => {
    if (!canPositions || tab === "history") return undefined;
    let socket = null;
    let poll = null;
    let retry = null;
    let gone = false;
    let attempt = 0;
    let lastPush = 0;
    let pushRevision = 0;

    function apply(view) {
      if (gone || !view) return;
      setPayload((prev) => acceptView(prev, view));
    }

    async function load() {
      try {
        const query = new URLSearchParams();
        query.set("audience", audience);
        if (book) query.set("book", book);
        if (account) query.set("account", account);
        const before = pushRevision;
        const view = await api(`/api/positions?${query}`);
        if (before === pushRevision) apply(view);
        setError("");
      } catch (err) {
        console.error("[positions]", err);
        setError(err.message || "Không tải được vị thế");
        setPayload((prev) => (prev ? { ...prev, stale: true, connection: "stale" } : prev));
      }
    }

    function startPoll() {
      if (poll) return;
      poll = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        if (socket?.readyState === WebSocket.OPEN && Date.now() - lastPush < 30_000) return;
        load();
      }, 15000);
    }

    function send(type) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type, account, audience, book }));
    }

    function openSocket() {
      if (document.visibilityState === "hidden") return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const current = new WebSocket(`${proto}//${window.location.host}/api/positions/ws`);
      socket = current;
      current.onopen = () => {
        if (socket !== current) return;
        attempt = 0;
        send("watch");
      };
      current.onmessage = (event) => {
        if (socket !== current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "error") {
            setError(message.error || "Không xem được vị thế");
            return;
          }
          if (message.type === "snapshot") {
            lastPush = Date.now();
            pushRevision += 1;
            apply(message);
            setError("");
          }
        } catch (err) {
          console.error("[positions]", err);
        }
      };
      current.onclose = () => {
        if (socket !== current) return;
        socket = null;
        setPayload((prev) => {
          if (!prev || prev.connection === "monitor" || prev.connection === "idle") return prev;
          return { ...prev, stale: true, connection: "stale" };
        });
        if (gone || document.visibilityState === "hidden") return;
        const wait = Math.min(10000, 1000 * (2 ** attempt));
        attempt += 1;
        retry = window.setTimeout(openSocket, wait);
      };
    }

    function onVisible() {
      if (document.visibilityState === "hidden") {
        send("pause");
        if (poll) window.clearInterval(poll);
        poll = null;
        return;
      }
      startPoll();
      if (socket?.readyState === WebSocket.OPEN) send("resume");
      else openSocket();
    }

    load();
    openSocket();
    startPoll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      send("pause");
      socket?.close();
      if (poll) window.clearInterval(poll);
      if (retry) window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account, audience, book, canPositions, tab]);

  const rows = useMemo(
    () => sortedRows((payload?.rows || []).filter((row) => matches(row, params)), sort.key, sort.dir),
    [payload, params, sort]
  );

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: POSITION_COLUMNS.find((column) => column.id === key)?.text ? "asc" : "desc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }
  const selected = rows.find((row) => row.key === panel) || (payload?.rows || []).find((row) => row.key === panel);
  const accountRows = tab === "history" ? historyAccounts : (payload?.accounts || []);
  const envs = [...new Set(accountRows.flatMap((item) => item.accounts || []))];
  const connection = payload?.connection || "idle";
  const stale = payload?.stale || connection === "stale";

  function setFilter(name, value) {
    const next = new URLSearchParams(location.search);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "account" || name === "audience") next.delete("panel");
    if (name === "audience") next.delete("account");
    const search = next.toString();
    const target = { pathname: location.pathname, search: search ? `?${search}` : "" };
    if ((location.state?.layer || 0) > 0 && next.get("panel")) {
      const under = new URLSearchParams(next);
      under.delete("panel");
      const underSearch = under.toString();
      navigate({ pathname: location.pathname, search: underSearch ? `?${underSearch}` : "" }, { replace: true });
      navigate(target, { state: { layer: 1 } });
      return;
    }
    navigate(target, { replace: true });
  }

  function toggle(key) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function patchCloseForm(row, patch) {
    setCloseForms((prev) => ({
      ...prev,
      [row.key]: { ...closeFormOf(prev, row), ...patch },
    }));
  }

  function applyClosePercent(row, percent) {
    const fullQty = qtyOf(row);
    patchCloseForm(row, {
      percent,
      qty: percent === 100 ? numInput(fullQty) : qtyAtPercent(fullQty, percent),
    });
    setClosePercentKey("");
    setError("");
  }

  function askClose(row, orderType) {
    if (!canClose) {
      setError("Thiếu quyền positions.close");
      return;
    }
    const form = closeFormOf(closeForms, row);
    const qty = Number(form.qty);
    const price = Number(form.price);
    const fullQty = Number(qtyOf(row));
    const percent = Number(form.percent);
    const usePercent = Number.isFinite(percent) && percent > 0 && percent <= 100;
    if (!usePercent && (!Number.isFinite(qty) || qty <= 0)) {
      setError("Số lượng đóng phải > 0");
      return;
    }
    if (!usePercent && Number.isFinite(fullQty) && qty > fullQty + 1e-12) {
      setError(`Số lượng đóng không được vượt position (${numInput(fullQty)})`);
      return;
    }
    if (orderType === "LIMIT" && (!Number.isFinite(price) || price <= 0)) {
      setError("Limit close cần giá > 0");
      return;
    }
    let quantityMode = "QUANTITY";
    if (usePercent && percent === 100) quantityMode = "ALL";
    else if (usePercent) quantityMode = "PERCENT";
    else if (Number.isFinite(fullQty) && Math.abs(qty - fullQty) < 1e-10) quantityMode = "ALL";
    const closeQty = usePercent && percent === 100
      ? fullQty
      : usePercent
        ? fullQty * (percent / 100)
        : qty;
    const exitPrice = orderType === "LIMIT" ? price : Number(row.mark);
    setClosePercentKey("");
    setError("");
    setCloseConfirm({
      account: row.account,
      symbol: row.symbol,
      positionSide: row.side,
      orderType,
      quantityMode,
      quantity: Number.isFinite(qty) && qty > 0 ? String(qty) : undefined,
      percent: quantityMode === "PERCENT" ? String(percent) : undefined,
      price: orderType === "LIMIT" ? String(price) : undefined,
      mark: row.mark,
      fullQty,
      preview: closePreview({
        side: row.side,
        entry: row.entry,
        exitPrice,
        qty: closeQty,
        monitors: row.monitors,
      }),
    });
  }

  async function submitClose() {
    if (!closeConfirm || closing) return;
    setClosing(true);
    try {
      const body = {
        username: closeConfirm.account,
        symbol: closeConfirm.symbol,
        positionSide: closeConfirm.positionSide,
        orderType: closeConfirm.orderType,
        quantityMode: closeConfirm.quantityMode,
      };
      if (closeConfirm.quantityMode === "PERCENT") body.percent = closeConfirm.percent;
      else if (closeConfirm.quantity != null) body.quantity = closeConfirm.quantity;
      if (closeConfirm.orderType === "LIMIT") body.price = closeConfirm.price;
      const result = await api("/api/trading/positions/close", { method: "POST", body });
      const orderId = result?.command?.result?.orderId || result?.command?.exchangeResult?.orderId;
      const sizeText = closeConfirm.quantityMode === "PERCENT"
        ? `${closeConfirm.percent}%`
        : closeConfirm.quantityMode === "ALL"
          ? "100%"
          : `qty ${closeConfirm.quantity}`;
      setActionNote(
        result?.duplicate
          ? `Đóng ${closeConfirm.symbol} trùng request trước đó.`
          : `Đã gửi đóng ${closeConfirm.orderType} ${closeConfirm.symbol} ${closeConfirm.positionSide} ${sizeText}${orderId ? ` · order ${orderId}` : ""}`
      );
      setCloseConfirm(null);
      setError("");
    } catch (err) {
      console.error("[positions]", err);
      setError(err.message || "Không đóng được position");
    } finally {
      setClosing(false);
    }
  }

  function openTpsl(row, tab = "tpsl") {
    if (!canTpsl) {
      setError("Thiếu quyền positions.tpsl");
      return;
    }
    if (row.book === "paper" || row.book === "pending") {
      setError("Paper/lệnh chờ không đặt Position TP/SL trên sàn");
      return;
    }
    const exchange = exchangeTpsl(row);
    const monitor = monitorTpsl(row);
    setError("");
    setTpslDraft({
      account: row.account,
      symbol: row.symbol,
      side: row.side,
      entry: row.entry,
      mark: row.mark,
      qty: qtyOf(row),
      monitors: row.monitors || [],
      tab: tab === "trailing" ? "trailing" : "tpsl",
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
    });
  }

  async function submitTpsl() {
    if (!tpslDraft || savingTpsl) return;
    const key = `${tpslDraft.account}|${tpslDraft.symbol}|${tpslDraft.side}`;
    setSavingTpsl(true);
    try {
      let body;
      if (tpslDraft.tab === "trailing") {
        const rate = Number(tpslDraft.callbackRate);
        if (!(rate >= 0.1 && rate <= 10)) {
          setError("callbackRate trailing phải trong 0.1–10 (%)");
          setSavingTpsl(false);
          return;
        }
        body = {
          takeProfit: { enabled: false },
          stopLoss: { enabled: false },
          trailing: {
            enabled: true,
            callbackRate: String(rate),
            activationPrice: tpslDraft.activationPrice ? String(tpslDraft.activationPrice) : undefined,
            workingType: tpslDraft.trailingWorkingType || "CONTRACT_PRICE",
          },
        };
      } else {
        const tpOn = tpslDraft.tpEnabled !== false && String(tpslDraft.tp || "").trim() !== "";
        const slOn = tpslDraft.slEnabled !== false && String(tpslDraft.sl || "").trim() !== "";
        if (!tpOn && !slOn) {
          setError("Nhập ít nhất giá TP hoặc SL");
          setSavingTpsl(false);
          return;
        }
        if (tpOn && !(Number(tpslDraft.tp) > 0)) {
          setError("Giá TP phải > 0");
          setSavingTpsl(false);
          return;
        }
        if (slOn && !(Number(tpslDraft.sl) > 0)) {
          setError("Giá SL phải > 0");
          setSavingTpsl(false);
          return;
        }
        body = {
          takeProfit: tpOn
            ? { enabled: true, type: "TAKE_PROFIT_MARKET", triggerPrice: String(tpslDraft.tp), workingType: tpslDraft.tpWorkingType || "CONTRACT_PRICE" }
            : { enabled: false },
          stopLoss: slOn
            ? { enabled: true, type: "STOP_MARKET", triggerPrice: String(tpslDraft.sl), workingType: tpslDraft.slWorkingType || "CONTRACT_PRICE" }
            : { enabled: false },
        };
      }
      const result = await api(`/api/trading/positions/${encodeURIComponent(key)}/tpsl`, { method: "PUT", body });
      const rows = result?.command?.result?.results || [];
      const summary = rows.length
        ? rows.map((row) => (row.success ? `${row.type}@${row.stopPrice || row.callbackRate || ""}` : `${row.type} lỗi: ${row.error}`)).join(" · ")
        : "đã gửi";
      setActionNote(`TP/SL ${tpslDraft.symbol} ${tpslDraft.side}: ${summary}`);
      setTpslDraft(null);
      setError("");
    } catch (err) {
      console.error("[positions]", err);
      setError(err.message || "Không đặt được TP/SL");
    } finally {
      setSavingTpsl(false);
    }
  }

  async function cancelTrailing() {
    if (!tpslDraft || savingTpsl) return;
    setSavingTpsl(true);
    try {
      const key = `${tpslDraft.account}|${tpslDraft.symbol}|${tpslDraft.side}`;
      await api(`/api/trading/positions/${encodeURIComponent(key)}/tpsl`, {
        method: "PUT",
        body: {
          takeProfit: { enabled: false },
          stopLoss: { enabled: false },
          trailing: { enabled: false, cancel: true },
        },
      });
      setActionNote(`Đã hủy Trailing ${tpslDraft.symbol} ${tpslDraft.side}`);
      setTpslDraft(null);
      setError("");
    } catch (err) {
      console.error("[positions]", err);
      setError(err.message || "Không hủy được Trailing");
    } finally {
      setSavingTpsl(false);
    }
  }

  function askReverse(row) {
    if (!canClose || !canOpen) {
      setError("Cần quyền positions.close và positions.open");
      return;
    }
    if (row.book === "paper" || row.book === "pending") {
      setError("Paper/lệnh chờ không reverse trên sàn");
      return;
    }
    const qty = qtyOf(row);
    setError("");
    setReverseConfirm({
      account: row.account,
      symbol: row.symbol,
      positionSide: row.side,
      newSide: row.side === "LONG" ? "SHORT" : "LONG",
      quantity: numInput(qty),
      mark: row.mark,
      entry: row.entry,
      preview: closePreview({
        side: row.side,
        entry: row.entry,
        exitPrice: row.mark,
        qty,
        monitors: row.monitors,
      }),
      openPreview: openPreview({
        side: row.side === "LONG" ? "SHORT" : "LONG",
        entryOrMark: row.mark,
        quantity: qty,
      }),
    });
  }

  async function submitReverse() {
    if (!reverseConfirm || reversing) return;
    setReversing(true);
    try {
      const body = {
        username: reverseConfirm.account,
        symbol: reverseConfirm.symbol,
        positionSide: reverseConfirm.positionSide,
        closeOrderType: "MARKET",
        openOrderType: "MARKET",
        newQuantity: reverseConfirm.quantity,
      };
      const result = await api("/api/trading/positions/reverse", { method: "POST", body });
      setActionNote(
        result?.duplicate
          ? `Reverse ${reverseConfirm.symbol} trùng request trước đó.`
          : `Đã reverse ${reverseConfirm.symbol} ${reverseConfirm.positionSide} → ${reverseConfirm.newSide}`
      );
      setReverseConfirm(null);
      setError("");
    } catch (err) {
      console.error("[positions]", err);
      setError(err.message || "Không reverse được");
    } finally {
      setReversing(false);
    }
  }

  function askOpenTrade(seed = {}) {
    if (!canOpen) {
      setError("Thiếu quyền positions.open");
      return;
    }
    const accounts = payload?.accounts || [];
    setError("");
    setOpenTrade({
      account: seed.account || account || accounts[0]?.username || "",
      symbol: seed.symbol || "",
      side: seed.side || "LONG",
      orderType: "MARKET",
      quantity: "",
      price: numInput(seed.mark) || "",
      mark: numInput(seed.mark) || "",
    });
  }

  async function submitOpenTrade() {
    if (!openTrade || opening) return;
    if (!openTrade.account || !openTrade.symbol) {
      setError("Thiếu account hoặc symbol");
      return;
    }
    if (!(Number(openTrade.quantity) > 0)) {
      setError("Quantity phải > 0");
      return;
    }
    if (openTrade.orderType === "LIMIT" && !(Number(openTrade.price) > 0)) {
      setError("LIMIT cần giá > 0");
      return;
    }
    setOpening(true);
    try {
      const body = {
        username: openTrade.account,
        symbol: String(openTrade.symbol).toUpperCase(),
        positionSide: openTrade.side,
        orderType: openTrade.orderType,
        quantity: String(openTrade.quantity),
      };
      if (openTrade.orderType === "LIMIT") body.price = String(openTrade.price);
      const result = await api("/api/trading/positions/open", { method: "POST", body });
      const orderId = result?.command?.result?.orderId;
      setActionNote(
        result?.duplicate
          ? `Mở ${body.symbol} trùng request trước đó.`
          : `Đã gửi mở ${body.orderType} ${body.symbol} ${body.positionSide} qty ${body.quantity}${orderId ? ` · order ${orderId}` : ""}`
      );
      setOpenTrade(null);
      setError("");
    } catch (err) {
      console.error("[positions]", err);
      setError(err.message || "Không mở được position");
    } finally {
      setOpening(false);
    }
  }

  async function removeMonitor(monitor) {
    const label = `${monitor.env || "monitor"} ${monitor.signal || ""}`.trim();
    if (!window.confirm(`Xoá monitor ${label}?\nBản ghi monitor_positions _id ${monitor.id}\nLệnh trên sàn không bị đóng.`)) return;
    try {
      await api(`/api/positions/monitors/${encodeURIComponent(monitor.id)}`, { method: "DELETE" });
      setPayload((prev) => prev && ({
        ...prev,
        rows: (prev.rows || []).map((row) => ({
          ...row,
          monitors: (row.monitors || []).filter((item) => item.id !== monitor.id),
        })),
      }));
      setError("");
      setActionNote("");
    } catch (err) {
      console.error("[positions]", err);
      setError(err.message || "Không xoá được monitor");
    }
  }

  return (
    <section className="stack pos-screen">
      <header className="pos-header-row">
        <div>
          <h1>Position</h1>
          <p className="muted">Mỗi vị thế hai dòng. PnL mở = Size × (mark − entry). PnL ghi nhận lấy từ income Binance lúc mở trang và lúc bấm Cập nhật sàn. Size và entry lấy từ sổ sàn; khi chưa có sổ thì lấy bản monitor lưu lần cuối.</p>
        </div>
        {canOpen && tab === "open" ? (
          <button type="button" className="pos-tpsl-confirm" onClick={() => askOpenTrade()}>Mở position</button>
        ) : null}
      </header>
      <div className="history-tabs" role="tablist">
        <button type="button" className={tab === "open" ? "active" : ""} onClick={() => go((query) => { query.delete("tab"); query.delete("trade"); })}>Đang mở</button>
        {canHistory ? <button type="button" className={tab === "history" ? "active" : ""} onClick={() => go((query) => { query.set("tab", "history"); query.delete("panel"); })}>Lịch sử vị thế</button> : null}
        {canOrders ? <button type="button" className={tab === "orders" ? "active" : ""} onClick={() => go((query) => { query.set("tab", "orders"); query.delete("panel"); })}>Order đang mở</button> : null}
        {canOrders ? <button type="button" className={tab === "order-history" ? "active" : ""} onClick={() => go((query) => { query.set("tab", "order-history"); query.delete("panel"); })}>Lịch sử order</button> : null}
      </div>
      <form className="signal-filters" onSubmit={(event) => event.preventDefault()}>
        <label>Phạm vi
          <select value={audience} onChange={(event) => setFilter("audience", event.target.value)}>
            <option value="mine">Của tôi</option>
            <option value="all">Có quyền xem</option>
          </select>
        </label>
        <label>Tài khoản
          <select value={account} onChange={(event) => setFilter("account", event.target.value)}>
            <option value="">Tất cả</option>
            {accountRows.map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
          </select>
        </label>
        <label>Config
          <select value={params.get("env") || ""} onChange={(event) => setFilter("env", event.target.value)}>
            <option value="">Tất cả</option>
            {envs.map((env) => <option key={env} value={env}>{env}</option>)}
          </select>
        </label>
        <label>Symbol
          <input value={params.get("symbol") || ""} placeholder="NEAR, BTC…" onChange={(event) => setFilter("symbol", event.target.value.toUpperCase())} />
        </label>
        <label>Signal
          <input value={params.get("signal") || ""} placeholder="GAU, ROSE…" onChange={(event) => setFilter("signal", event.target.value)} />
        </label>
        <label>Side
          <select value={params.get("side") || ""} onChange={(event) => setFilter("side", event.target.value)}>
            <option value="">Tất cả</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>
        <label>Sổ
          <select value={params.get("book") || ""} onChange={(event) => setFilter("book", event.target.value)}>
            <option value="">Live</option>
            <option value="paper">Paper</option>
            <option value="all">Live và paper</option>
            <option value="pending" disabled={tab === "history"}>Lệnh chờ</option>
            <option value="notpsl" disabled={tab === "history"}>NOTPSL</option>
          </select>
        </label>
        <button type="button" disabled={tab === "history" || refreshing} title={tab === "history" ? "Cập nhật sàn chỉ dùng cho vị thế đang mở" : ""} onClick={async () => {
          setRefreshing(true);
          try {
            const view = await api("/api/positions/refresh", { method: "POST", body: { account, audience, book }, timeoutMs: 60000 });
            setPayload((prev) => acceptView(prev, view));
            setError("");
          } catch (err) {
            console.error("[positions]", err);
            setError(err.message || "Không cập nhật được sổ sàn");
          } finally {
            setRefreshing(false);
          }
        }}>{refreshing ? "Đang cập nhật…" : "Cập nhật sàn"}</button>
        {canOpen && tab === "open" ? <button type="button" onClick={() => setDraft({ account: account || "", env: "", symbol: "", side: "LONG", signal: "NOTPSL", positionAmt: "" })}>Thêm monitor position</button> : null}
        {tab === "open" && canPositions && typeof Notification !== "undefined" && !notifyReady ? (
          <button type="button" className="ghost" title="Khi tab đang ẩn, trình duyệt sẽ hiện thông báo đóng/mở vị thế" onClick={async () => {
            try {
              const permission = await Notification.requestPermission();
              setNotifyReady(permission === "granted");
            } catch (error) {
              console.error("[positions]", error);
            }
          }}>Bật thông báo trình duyệt</button>
        ) : null}
        <label>Bất thường
          <select value={params.get("warn") || ""} disabled={tab === "history"} title={tab === "history" ? "Cảnh báo chỉ áp cho vị thế đang mở" : ""} onChange={(event) => setFilter("warn", event.target.value)}>
            <option value="">Tất cả</option>
            <option value="1">Chỉ cảnh báo</option>
          </select>
        </label>
      </form>
      {tab === "history" ? <PositionHistory params={params} go={go} canStats={canHistory} onAccounts={setHistoryAccounts} /> : null}
      {tab === "orders" && canOrders ? <OpenOrdersTab params={params} go={go} accounts={payload?.accounts} audience={audience} /> : null}
      {tab === "orders" && !canOrders ? <p className="muted">Cần quyền orders.view để xem order đang mở.</p> : null}
      {tab === "order-history" && canOrders ? <OrderHistoryTab params={params} go={go} accounts={payload?.accounts} /> : null}
      {tab === "order-history" && !canOrders ? <p className="muted">Cần quyền orders.view để xem lịch sử order.</p> : null}
      {tab === "open" && !canPositions ? <p className="muted">Cần quyền positions.view để xem vị thế đang mở.</p> : null}
      {tab === "open" && canPositions ? <>
      {notices.length ? (
        <div className="pos-toast-stack" aria-live="polite">
          {notices.map((alert) => (
            <button key={alert.id} type="button" className={`pos-toast pos-toast-${alert.kind}`} onClick={() => setNotices((prev) => prev.filter((item) => item.id !== alert.id))}>
              {alertText(alert)}
            </button>
          ))}
        </div>
      ) : null}
      <p className={stale ? "pos-status pos-stale" : "pos-status"}>
        {account
          ? (connection === "live" ? "Kết nối live" : connection === "polling" ? "Đang polling" : connection === "monitor" ? "Đang hiện monitor, chưa có snapshot live" : stale ? "Dữ liệu vị thế chưa được xác minh gần đây" : "Snapshot")
          : (stale ? "Dữ liệu vị thế chưa được xác minh gần đây" : "Live · các tài khoản được phép xem")}
        {payload?.priceFeed === "live" ? " · giá mark" : ""}
        {payload?.version != null ? ` · v${payload.version}` : ""}
        {payload?.updatedAt ? ` · đối chiếu sàn ${when(payload.updatedAt)}` : ""}
        {payload?.sources?.some((source) => source.stale) ? ` · cần đối chiếu: ${payload.sources.filter((source) => source.stale).map((source) => source.account).join(", ")}` : ""}
      </p>
      {actionNote ? <p className="muted">{actionNote}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {payload?.exchangeErrors?.length ? <p className="form-error">{payload.exchangeErrors.map((item) => `${item.account}: ${item.error}`).join(" · ")}</p> : null}
      {!payload ? <p className="muted">Đang tải…</p> : null}
      {payload && !rows.length && !stale ? <p className="muted">Không có vị thế trong bộ lọc này.</p> : null}
      {payload && !rows.length && stale ? <p className="pos-stale">Chưa có snapshot mới. Không coi đây là hết vị thế.</p> : null}
      {rows.length ? (
        <div className="table-wrap">
          <table className="pos-table">
            <thead>
              <tr>
                <th />
                {POSITION_COLUMNS.map((column) => (
                  <th key={column.id} aria-sort={sort.key === column.id ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="sort-col" title={column.title} onClick={() => toggleSort(column.id)}>
                      {column.label}{sort.key === column.id ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const roi = roiOf(row);
                const recordedFrom = row.recorded?.source === "positionHistory" ? "Position history" : row.recorded?.source === "trades" ? "Lệnh đóng" : row.recorded?.source === "income" ? "Income" : "Monitor";
                const recordedTitle = row.recorded
                  ? `${recordedFrom} · chốt ${fmt(row.recorded.realized, 2)} · fee ${fmt(row.recorded.fee, 2)} · funding ${fmt(row.recorded.funding, 2)}`
                  : "Chưa có position history, lệnh đóng hoặc stats";
                return (
                <Fragment key={row.key}>
                  <tr className={row.warnings.length ? "pos-alert" : ""}>
                    <td><button type="button" className="ghost" onClick={() => toggle(row.key)}>{open.has(row.key) ? "−" : "+"}</button></td>
                    <td>{row.account}</td>
                    <td>
                      <span className="pos-inline">
                        <button type="button" className="linkish" data-row={row.key} onClick={(event) => { setMonitorId(""); go((query) => query.set("panel", row.key), { layer: true }); event.currentTarget.blur(); }}>{row.symbol}</button>
                        <span className="muted">{row.side}{row.leverage == null ? "" : ` · ${fmt(row.leverage, 0)}x`}{row.notpsl ? " · NOTPSL" : ""}{row.book === "pending" ? " · lệnh chờ" : ""}</span>
                      </span>
                    </td>
                    <td>{qtyOf(row) == null ? "—" : fmt(qtyOf(row))}</td>
                    <td>{fmt(row.entry)}</td>
                    <td>{fmt(row.mark)}</td>
                    <td className={pnlClass(row.unrealized)} title="Size × (mark − entry)">
                      <span className="pos-inline">
                        <span>{row.unrealized == null ? "—" : fmt(row.unrealized, 2)}</span>
                        {roi == null ? null : <span>{roi > 0 ? "+" : ""}{fmt(roi, 2)}%</span>}
                      </span>
                    </td>
                    <td className={pnlClass(row.recorded?.net)} title={recordedTitle}>{row.recorded ? fmt(row.recorded.net, 2) : "—"}</td>
                    <td>{fmt(row.liquidation)}</td>
                    <td>{volumeOf(row) == null ? "—" : fmt(volumeOf(row), 2)}</td>
                  </tr>
                  <tr className={row.warnings.length ? "pos-sub pos-alert" : "pos-sub"}>
                    <td />
                    <td colSpan={9}>
                      <div className="pos-actions">
                        {canClose && row.book !== "paper" && row.book !== "pending" ? (() => {
                          const form = closeFormOf(closeForms, row);
                          const showPercents = closePercentKey === row.key;
                          return (
                            <span className="pos-close-form">
                              <button type="button" className="pos-close-type" disabled={closing} onClick={() => askClose(row, "MARKET")}>Market</button>
                              <span className="muted">|</span>
                              <button type="button" className="pos-close-type" disabled={closing} onClick={() => askClose(row, "LIMIT")}>Limit</button>
                              <input
                                type="text"
                                inputMode="decimal"
                                aria-label={`Giá đóng ${row.symbol}`}
                                title="Giá limit"
                                value={form.price}
                                onFocus={() => setClosePercentKey("")}
                                onChange={(event) => patchCloseForm(row, { price: event.target.value.replace(/,/g, "") })}
                                placeholder="Giá"
                              />
                              <span className="pos-close-qty">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  aria-label={`Số lượng đóng ${row.symbol}`}
                                  title="Volume đóng — bấm để chọn % như /close?per="
                                  value={form.qty}
                                  onFocus={() => setClosePercentKey(row.key)}
                                  onBlur={() => {
                                    window.setTimeout(() => {
                                      setClosePercentKey((key) => (key === row.key ? "" : key));
                                    }, 120);
                                  }}
                                  onChange={(event) => {
                                    patchCloseForm(row, { qty: event.target.value.replace(/,/g, ""), percent: null });
                                    setClosePercentKey(row.key);
                                  }}
                                  placeholder="Amount"
                                />
                                {form.percent != null ? <span className="pos-close-per muted">{form.percent}%</span> : null}
                                {showPercents ? (
                                  <span className="pos-close-percents" role="listbox" aria-label="Chọn % đóng">
                                    {CLOSE_PERCENTS.map((percent) => (
                                      <button
                                        key={percent}
                                        type="button"
                                        role="option"
                                        aria-selected={form.percent === percent}
                                        className={form.percent === percent ? "active" : ""}
                                        disabled={closing || qtyOf(row) == null}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => applyClosePercent(row, percent)}
                                      >
                                        {percent}%
                                      </button>
                                    ))}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                          );
                        })() : (
                          <>
                            <button type="button" className="ghost" onClick={() => setActionNote(canClose ? "Paper/lệnh chờ không đóng bằng Market/Limit." : "Thiếu quyền positions.close")}>Market</button>
                            <button type="button" className="ghost" onClick={() => setActionNote(canClose ? "Paper/lệnh chờ không đóng bằng Market/Limit." : "Thiếu quyền positions.close")}>Limit</button>
                          </>
                        )}
                        <button type="button" className="ghost" disabled={reversing} onClick={() => askReverse(row)}>Reverse</button>
                        <button
                          type="button"
                          className="pos-tpsl-link"
                          title={canTpsl ? "Chỉnh Position TP/SL / Trailing trên sàn" : "Thiếu quyền positions.tpsl"}
                          onClick={() => openTpsl(row, "tpsl")}
                        >
                          {tpslText(row)}
                        </button>
                        <button type="button" className="ghost" onClick={() => { setMonitorId(row.monitors[0]?.id || ""); go((query) => query.set("panel", row.key), { layer: true }); }}>Add</button>
                        {canOpen ? <button type="button" className="ghost" onClick={() => setDraft({ account: row.account, env: "", symbol: row.symbol, side: row.side, signal: "NOTPSL", positionAmt: qtyOf(row) ?? "", entry: row.entry ?? "", mark: row.mark ?? "", leverage: row.leverage ?? "", liquidation: row.liquidation ?? "" })}>Thêm monitor</button> : null}
                        {canClose ? row.monitors.map((monitor) => (
                          <button key={monitor.id} type="button" className="ghost" title={`Xoá monitor_positions _id ${monitor.id}. Không đóng lệnh sàn.`} onClick={() => removeMonitor(monitor)}>Xoá monitor {monitor.env} {monitor.signal || monitor.type || ""}</button>
                        )) : null}
                        {row.warnings.length ? <span className="muted">{row.warnings.map((item) => WARN[item] || item).join(" · ")}</span> : null}
                      </div>
                    </td>
                  </tr>
                  {open.has(row.key) ? row.monitors.map((monitor) => (
                    <tr key={monitor.id} className="pos-child">
                      <td />
                      <td colSpan={9}>
                        <button type="button" className="linkish" onClick={() => { setMonitorId(monitor.id); go((query) => query.set("panel", row.key), { layer: true }); }}>
                          {monitor.env || "config"}
                        </button>
                        {" · "}{monitor.signal || monitor.type || "—"}
                        {" · qty riêng "}{fmt(monitor.ownQty)}
                        {" · sàn snapshot "}{fmt(monitor.exchangeSnapshotQty)}
                        {" · SL "}{monitor.sl || "—"} dự kiến
                        {" · TP "}{monitor.tp || "—"} dự kiến
                        {" · trailing "}{monitor.trailing || "—"}
                        {" · HP "}{monitor.hp || "—"}
                        {" · mở "}{when(monitor.openedAt)}
                        {" · cập nhật "}{when(monitor.updatedAt)}
                        {" · "}{monitor.watching ? "Đang theo dõi" : "Không có heartbeat"}
                        {monitor.estimatedPnl != null ? <span className={pnlClass(monitor.estimatedPnl)}> · PnL {fmt(monitor.estimatedPnl)} ước tính</span> : null}
                      </td>
                    </tr>
                  )) : null}
                  {open.has(row.key) && !row.monitors.length ? <tr className="pos-child"><td /><td colSpan={9}>Không có monitor cho vị thế này.</td></tr> : null}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}</> : null}
      {tpslDraft ? (
        <div className="modal-backdrop" onClick={() => { if (!savingTpsl) setTpslDraft(null); }}>
          <form
            className="modal-card stack pos-tpsl-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tpsl-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => { event.preventDefault(); submitTpsl(); }}
          >
            <header>
              <h2 id="tpsl-title">Position TP/SL</h2>
              <button type="button" disabled={savingTpsl} onClick={() => setTpslDraft(null)}>Đóng</button>
            </header>
            <p className="muted">
              {tpslDraft.account} · {tpslDraft.symbol} · {tpslDraft.side}
              {" · entry "}{fmt(tpslDraft.entry)}
              {" · mark "}{fmt(tpslDraft.mark)}
            </p>
            <div className="history-tabs" role="tablist">
              <button type="button" className={tpslDraft.tab === "tpsl" ? "active" : ""} onClick={() => setTpslDraft({ ...tpslDraft, tab: "tpsl" })}>Position TP/SL</button>
              <button type="button" className={tpslDraft.tab === "trailing" ? "active" : ""} onClick={() => setTpslDraft({ ...tpslDraft, tab: "trailing" })}>Trailing Stop</button>
            </div>
            {tpslDraft.tab === "tpsl" ? (
              <>
                <label className="pos-tpsl-field">
                  <span className="pos-tpsl-label pos-tpsl-tp">Take Profit</span>
                  <span className="pos-tpsl-inputs">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Giá trigger"
                      value={tpslDraft.tp}
                      onChange={(event) => setTpslDraft({ ...tpslDraft, tp: event.target.value.replace(/,/g, ""), tpEnabled: true })}
                    />
                    <select
                      value={tpslDraft.tpWorkingType}
                      onChange={(event) => setTpslDraft({ ...tpslDraft, tpWorkingType: event.target.value })}
                      aria-label="TP theo giá"
                    >
                      <option value="CONTRACT_PRICE">Last</option>
                      <option value="MARK_PRICE">Mark</option>
                    </select>
                  </span>
                </label>
                <label className="pos-tpsl-field">
                  <span className="pos-tpsl-label pos-tpsl-sl">Stop Loss</span>
                  <span className="pos-tpsl-inputs">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Giá trigger"
                      value={tpslDraft.sl}
                      onChange={(event) => setTpslDraft({ ...tpslDraft, sl: event.target.value.replace(/,/g, ""), slEnabled: true })}
                    />
                    <select
                      value={tpslDraft.slWorkingType}
                      onChange={(event) => setTpslDraft({ ...tpslDraft, slWorkingType: event.target.value })}
                      aria-label="SL theo giá"
                    >
                      <option value="CONTRACT_PRICE">Last</option>
                      <option value="MARK_PRICE">Mark</option>
                    </select>
                  </span>
                </label>
                <PreviewBlock
                  title="Preview nếu chạm TP/SL (ước tính)"
                  preview={closePreview({
                    side: tpslDraft.side,
                    entry: tpslDraft.entry,
                    exitPrice: Number(tpslDraft.tp) || Number(tpslDraft.sl) || tpslDraft.mark,
                    qty: tpslDraft.qty,
                    monitors: tpslDraft.monitors,
                  })}
                />
                <p className="muted">Algo Order TAKE_PROFIT_MARKET / STOP_MARKET (closePosition). Lệnh cũ cùng loại bị hủy trước.</p>
              </>
            ) : (
              <>
                <label className="pos-tpsl-field">
                  <span className="pos-tpsl-label">Callback rate (%)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="1.0"
                    value={tpslDraft.callbackRate}
                    onChange={(event) => setTpslDraft({ ...tpslDraft, callbackRate: event.target.value.replace(/,/g, "") })}
                  />
                </label>
                <label className="pos-tpsl-field">
                  <span className="pos-tpsl-label">Activation price (optional)</span>
                  <span className="pos-tpsl-inputs">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Để trống = kích hoạt ngay"
                      value={tpslDraft.activationPrice}
                      onChange={(event) => setTpslDraft({ ...tpslDraft, activationPrice: event.target.value.replace(/,/g, "") })}
                    />
                    <select
                      value={tpslDraft.trailingWorkingType}
                      onChange={(event) => setTpslDraft({ ...tpslDraft, trailingWorkingType: event.target.value })}
                      aria-label="Trailing theo giá"
                    >
                      <option value="CONTRACT_PRICE">Last</option>
                      <option value="MARK_PRICE">Mark</option>
                    </select>
                  </span>
                </label>
                {tpslDraft.hasTrailing ? <p className="muted">Đang có trailing {fmt(tpslDraft.callbackRate, 2)}% trên sàn — Confirm sẽ thay lệnh cũ.</p> : null}
                <p className="muted">TRAILING_STOP_MARKET + closePosition qua Algo Order API.</p>
              </>
            )}
            <div className="pos-inline">
              <button type="button" className="ghost" disabled={savingTpsl} onClick={() => setTpslDraft(null)}>Huỷ</button>
              {tpslDraft.tab === "trailing" && tpslDraft.hasTrailing ? (
                <button type="button" className="ghost" disabled={savingTpsl} onClick={cancelTrailing}>Xóa trailing</button>
              ) : null}
              <button type="submit" className="pos-tpsl-confirm" disabled={savingTpsl}>{savingTpsl ? "Đang gửi…" : "Confirm"}</button>
            </div>
          </form>
        </div>
      ) : null}
      {closeConfirm ? (
        <div className="modal-backdrop" onClick={() => { if (!closing) setCloseConfirm(null); }}>
          <div className="modal-card stack" role="dialog" aria-modal="true" aria-labelledby="close-pos-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="close-pos-title">Xác nhận đóng vị thế</h2>
              <button type="button" disabled={closing} onClick={() => setCloseConfirm(null)}>Huỷ</button>
            </header>
            <p>
              {closeConfirm.account} · {closeConfirm.symbol} · {closeConfirm.positionSide}
              <br />
              {closeConfirm.orderType}
              {closeConfirm.orderType === "LIMIT" ? ` @ ${closeConfirm.price}` : " (giá thị trường)"}
              {closeConfirm.quantityMode === "PERCENT"
                ? ` · ${closeConfirm.percent}% (~${closeConfirm.quantity || "qty sàn"})`
                : closeConfirm.quantityMode === "ALL"
                  ? " · 100% (toàn bộ)"
                  : ` · qty ${closeConfirm.quantity}`}
            </p>
            <PreviewBlock preview={closeConfirm.preview} title="Preview trước khi gửi" />
            <p className="muted">Phí là ước tính taker mặc định, không phải phí VIP thật. Limit chưa khớp thì position vẫn còn.</p>
            <div className="pos-inline">
              <button type="button" className="ghost" disabled={closing} onClick={() => setCloseConfirm(null)}>Giữ lệnh</button>
              <button type="button" disabled={closing} onClick={submitClose}>{closing ? "Đang gửi…" : "Xác nhận đóng"}</button>
            </div>
          </div>
        </div>
      ) : null}
      {reverseConfirm ? (
        <div className="modal-backdrop" onClick={() => { if (!reversing) setReverseConfirm(null); }}>
          <div className="modal-card stack" role="dialog" aria-modal="true" aria-labelledby="reverse-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="reverse-title">Xác nhận Reverse</h2>
              <button type="button" disabled={reversing} onClick={() => setReverseConfirm(null)}>Huỷ</button>
            </header>
            <p>
              {reverseConfirm.account} · {reverseConfirm.symbol}: {reverseConfirm.positionSide} → {reverseConfirm.newSide}
              <br />
              Đóng MARKET toàn bộ rồi mở MARKET qty {reverseConfirm.quantity}
            </p>
            <PreviewBlock preview={reverseConfirm.preview} title="Bước 1 — đóng vị thế hiện tại" />
            <PreviewBlock preview={reverseConfirm.openPreview} title="Bước 2 — mở phía đối ứng" />
            <p className="muted">Hai lệnh liên tiếp; nếu mở thất bại sau khi đóng, vị thế có thể về flat.</p>
            <div className="pos-inline">
              <button type="button" className="ghost" disabled={reversing} onClick={() => setReverseConfirm(null)}>Giữ lệnh</button>
              <button type="button" disabled={reversing} onClick={submitReverse}>{reversing ? "Đang gửi…" : "Xác nhận reverse"}</button>
            </div>
          </div>
        </div>
      ) : null}
      {openTrade ? (
        <div className="modal-backdrop" onClick={() => { if (!opening) setOpenTrade(null); }}>
          <form
            className="modal-card stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="open-trade-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => { event.preventDefault(); submitOpenTrade(); }}
          >
            <header>
              <h2 id="open-trade-title">Mở position</h2>
              <button type="button" disabled={opening} onClick={() => setOpenTrade(null)}>Đóng</button>
            </header>
            <label>Tài khoản
              <select value={openTrade.account} onChange={(event) => setOpenTrade({ ...openTrade, account: event.target.value })} required>
                <option value="">Chọn</option>
                {(payload?.accounts || []).map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
              </select>
            </label>
            <label>Symbol
              <input value={openTrade.symbol} onChange={(event) => setOpenTrade({ ...openTrade, symbol: event.target.value.toUpperCase() })} required />
            </label>
            <label>Side
              <select value={openTrade.side} onChange={(event) => setOpenTrade({ ...openTrade, side: event.target.value })}>
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </label>
            <label>Loại lệnh
              <select value={openTrade.orderType} onChange={(event) => setOpenTrade({ ...openTrade, orderType: event.target.value })}>
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
              </select>
            </label>
            <label>Quantity
              <input type="text" inputMode="decimal" value={openTrade.quantity} onChange={(event) => setOpenTrade({ ...openTrade, quantity: event.target.value.replace(/,/g, "") })} required />
            </label>
            {openTrade.orderType === "LIMIT" ? (
              <label>Giá
                <input type="text" inputMode="decimal" value={openTrade.price} onChange={(event) => setOpenTrade({ ...openTrade, price: event.target.value.replace(/,/g, "") })} required />
              </label>
            ) : null}
            <PreviewBlock
              title="Preview"
              preview={openPreview({
                side: openTrade.side,
                entryOrMark: openTrade.orderType === "LIMIT" ? openTrade.price : (openTrade.mark || openTrade.price),
                quantity: openTrade.quantity,
              })}
            />
            <div className="pos-inline">
              <button type="button" className="ghost" disabled={opening} onClick={() => setOpenTrade(null)}>Huỷ</button>
              <button type="submit" className="pos-tpsl-confirm" disabled={opening}>{opening ? "Đang gửi…" : "Confirm mở"}</button>
            </div>
          </form>
        </div>
      ) : null}
      {draft ? (
        <div className="modal-backdrop" onClick={() => { if (!saving) setDraft(null); }}>
          <form className="modal-card stack" onClick={(event) => event.stopPropagation()} onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            try {
              const created = await api("/api/positions/monitors", { method: "POST", body: draft });
              setPayload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  rows: (prev.rows || []).map((row) => {
                    if (row.account !== created.account || row.symbol !== created.symbol || row.side !== created.side) return row;
                    return {
                      ...row,
                      notpsl: row.notpsl || created.row?.notpsl,
                      warnings: (row.warnings || []).filter((item) => item !== "no-monitor"),
                      monitors: [...(row.monitors || []), created.row],
                    };
                  }),
                };
              });
              setActionNote(created.monitorOff ? `Đã thêm monitor ${created.env} ${created.signal}. Config đang tắt MONITOR nên bot sẽ không chạy monitor này.` : `Đã thêm monitor ${created.env} ${created.signal}. Bot nhận ở vòng kiểm tra monitor kế tiếp.`);
              setDraft(null);
              setError("");
            } catch (err) {
              console.error("[positions]", err);
              setError(err.message || "Không thêm được monitor");
            } finally {
              setSaving(false);
            }
          }}>
            <header>
              <h2>Thêm monitor position</h2>
              <button type="button" onClick={() => setDraft(null)}>Đóng</button>
            </header>
            <p className="muted">Tạo bản ghi monitor. Không mở thêm lệnh trên sàn. Bot nhận bản ghi ở vòng kiểm tra kế tiếp và dùng trade config của env.</p>
            <label>Tài khoản
              <select value={draft.account} onChange={(event) => setDraft({ ...draft, account: event.target.value, env: "" })} required>
                <option value="">Chọn</option>
                {(payload?.accounts || []).map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
              </select>
            </label>
            <label>Config
              <select value={draft.env} onChange={(event) => setDraft({ ...draft, env: event.target.value })} required>
                <option value="">Chọn</option>
                {((payload?.accounts || []).find((item) => item.username === draft.account)?.accounts || []).map((env) => <option key={env} value={env}>{env}</option>)}
              </select>
            </label>
            <label>Symbol
              <input value={draft.symbol} onChange={(event) => setDraft({ ...draft, symbol: event.target.value.toUpperCase() })} required />
            </label>
            <label>Side
              <select value={draft.side} onChange={(event) => setDraft({ ...draft, side: event.target.value })}>
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </label>
            <label>Signal
              <input value={draft.signal} onChange={(event) => setDraft({ ...draft, signal: event.target.value })} />
            </label>
            <button type="submit" disabled={saving}>{saving ? "Đang lưu…" : "Thêm monitor"}</button>
          </form>
        </div>
      ) : null}
      {tab === "open" && panel && selected ? (
        <PositionCasePanel
          row={selected}
          audience={audience}
          selectedMonitorId={monitorId}
          onSelectMonitor={setMonitorId}
          onClose={closePanel}
        />
      ) : null}
    </section>
  );
}
