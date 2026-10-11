import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useEscape } from "../navigation";
import { alertText } from "../position-alerts";
import { qtyOf, sortedRows } from "../position-sort";
import { closePreview, openPreview } from "../trade-preview";
import PositionHistory from "./PositionHistory";
import OpenOrdersTab from "../components/OpenOrdersTab";
import OrderHistoryTab from "../components/OrderHistoryTab";
import "../components/terminal/terminal.css";
import FilterBar from "../components/terminal/FilterBar.jsx";
import TerminalSummary from "../components/terminal/TerminalSummary.jsx";
import PositionTable, { SORTABLE } from "../components/terminal/PositionTable.jsx";
import DetailPanel from "../components/terminal/DetailPanel.jsx";
import MutationStatus from "../components/terminal/MutationStatus.jsx";
import { classifyMutationResult } from "../components/terminal/mutation.js";
import {
  CloseConfirmDialog,
  ReverseConfirmDialog,
  OpenConfirmDialog,
  TpslConfirmDialog,
  MonitorDraftDialog,
} from "../components/terminal/ConfirmDialogs.jsx";
import { matches, normalizeTab, bookForApi } from "../components/terminal/matches.js";
import { buildSummary } from "../components/terminal/summary.js";
import { needsAttention } from "../components/terminal/protection.js";
import { loadPrefs, savePrefs, clampPanelWidth, DEFAULT_COLUMNS, rowMatchesSavedView } from "../components/terminal/prefs.js";
import { usePositionsFeed } from "../components/terminal/usePositionsFeed.js";
import { CLOSE_PERCENTS, newIdempotencyKey, numInput, when } from "../components/terminal/format.js";

export default function TerminalPage() {
  const { user } = useAuth();
  const perms = {
    canClose: (user?.permissions || []).includes("positions.close"),
    canOpen: (user?.permissions || []).includes("positions.open"),
    canTpsl: (user?.permissions || []).includes("positions.tpsl"),
    canPositions: (user?.permissions || []).includes("positions.view"),
    canHistory: (user?.permissions || []).includes("statistics.view"),
    canOrders: (user?.permissions || []).includes("orders.view"),
    canCreateOrder: (user?.permissions || []).includes("orders.create"),
  };

  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const account = params.get("account") || "";
  const audience = params.get("audience") === "all" ? "all" : "mine";
  const book = params.get("book") || "";
  const selected = params.get("selected") || params.get("panel") || "";
  const panelTab = params.get("panelTab") || "overview";
  const viewId = params.get("view") || "all";
  const tab = normalizeTab(params.get("tab") || "", perms);

  const [prefs, setPrefs] = useState(() => loadPrefs(user?.id || user?.username));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [sort, setSort] = useState({ key: "", dir: "desc" });
  const [monitorId, setMonitorId] = useState("");
  const [notices, setNotices] = useState([]);
  const [notifyReady, setNotifyReady] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const [historyAccounts, setHistoryAccounts] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [overlay, setOverlay] = useState(() => typeof window !== "undefined" && window.innerWidth < 1440);

  const [closeConfirm, setCloseConfirm] = useState(null);
  const [closing, setClosing] = useState(false);
  const [reverseConfirm, setReverseConfirm] = useState(null);
  const [reversing, setReversing] = useState(false);
  const [openConfirm, setOpenConfirm] = useState(null);
  const [opening, setOpening] = useState(false);
  const [tpslDraft, setTpslDraft] = useState(null);
  const [savingTpsl, setSavingTpsl] = useState(false);
  const [monitorDraft, setMonitorDraft] = useState(null);
  const [savingMonitor, setSavingMonitor] = useState(false);
  const [mutation, setMutation] = useState({ phase: "idle" });
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [ticketOpen, setTicketOpen] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs(user?.id || user?.username));
  }, [user?.id, user?.username]);

  useEffect(() => {
    function onResize() {
      setOverlay(window.innerWidth < 1440);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
        new Notification("Terminal", { body: alertText(alert), tag: alert.id });
      } catch (error) {
        console.error("[terminal]", error);
      }
    }
  }

  // Giữ feed khi sang tab lệnh (lấy account list) — giống PositionsPage (chỉ tắt ở lịch sử vị thế).
  const feedEnabled = perms.canPositions && tab !== "position-history";
  const { payload, setPayload, patchPayload, error, setError, refreshing, refreshExchange } = usePositionsFeed({
    account,
    audience,
    book,
    enabled: feedEnabled,
    onAlerts: pushNotices,
  });

  const rows = useMemo(() => {
    const base = (payload?.rows || []).filter((row) => matches(row, params));
    const withView = base.filter((row) => {
      if (viewId === "attention") return needsAttention(row, { stale: payload?.stale });
      return rowMatchesSavedView(row, viewId, prefs.customViews);
    });
    const sortKey = ["symbol", "account", "size", "entry", "unrealized", "recorded", "liquidation", "volume"].includes(sort.key)
      ? sort.key
      : "";
    return sortKey ? sortedRows(withView, sortKey, sort.dir) : withView;
  }, [payload, params, sort, viewId, prefs.customViews]);

  const summary = useMemo(() => buildSummary(rows, { stale: payload?.stale }), [rows, payload?.stale]);
  const selectedRow = rows.find((r) => r.key === selected) || (payload?.rows || []).find((r) => r.key === selected);
  const accountRows = tab === "position-history" ? historyAccounts : (payload?.accounts || []);
  const envs = [...new Set(accountRows.flatMap((item) => item.accounts || []))];
  const connection = payload?.connection || "idle";
  const stale = payload?.stale || connection === "stale";

  function go(mutate, { replace = false, layer = false } = {}) {
    const next = new URLSearchParams(location.search);
    mutate(next);
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace, state: layer ? { layer: (location.state?.layer || 0) + 1 } : location.state }
    );
  }

  function setFilter(name, value) {
    const next = new URLSearchParams(location.search);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "book" && (value === "" || value === "live")) next.delete("book");
    if (name === "account" || name === "audience") {
      next.delete("selected");
      next.delete("panel");
    }
    if (name === "audience") next.delete("account");
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
  }

  const closePanel = useCallback(() => {
    if (dirty && !window.confirm("Form chưa gửi — đóng panel?")) return;
    setDirty(false);
    const key = params.get("selected") || params.get("panel");
    if ((location.state?.layer || 0) > 0) {
      navigate(-1);
    } else {
      go((q) => {
        q.delete("selected");
        q.delete("panel");
        q.delete("panelTab");
      }, { replace: true });
    }
    window.setTimeout(() => document.querySelector(`[data-row="${CSS.escape(key || "")}"]`)?.focus(), 0);
  }, [dirty, location.state, navigate, params]); // eslint-disable-line react-hooks/exhaustive-deps

  useEscape(Boolean(selected) && (overlay || prefs.panelOpen), closePanel);

  function selectRow(key, opts = {}) {
    if (dirty && selected && selected !== key && !window.confirm("Form chưa gửi — đổi vị thế?")) return;
    setDirty(false);
    if (opts.monitorId) setMonitorId(opts.monitorId);
    go((q) => {
      q.set("selected", key);
      q.delete("panel");
      if (opts.panelTab) q.set("panelTab", opts.panelTab);
      else if (!q.get("panelTab")) q.set("panelTab", "overview");
    }, { layer: true });
    if (!prefs.panelOpen) {
      const next = { ...prefs, panelOpen: true };
      setPrefs(next);
      savePrefs(user?.id || user?.username, next);
    }
  }

  function toggleSort(key) {
    setSort((prev) => {
      const col = SORTABLE.find((c) => c.id === key);
      if (prev.key !== key) return { key, dir: col?.text ? "asc" : "desc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  function updatePrefs(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    savePrefs(user?.id || user?.username, next);
  }

  function askClose(row, form) {
    if (!perms.canClose) {
      setError("Thiếu quyền positions.close");
      return;
    }
    if (row.book === "paper" || row.book === "pending") {
      setError("Paper/lệnh chờ không đóng bằng Market/Limit");
      return;
    }
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
    if (form.orderType === "LIMIT" && (!Number.isFinite(price) || price <= 0)) {
      setError("Limit close cần giá > 0");
      return;
    }
    let quantityMode = "QUANTITY";
    if (usePercent && percent === 100) quantityMode = "ALL";
    else if (usePercent) quantityMode = "PERCENT";
    else if (Number.isFinite(fullQty) && Math.abs(qty - fullQty) < 1e-10) quantityMode = "ALL";
    const closeQty = usePercent && percent === 100 ? fullQty : usePercent ? fullQty * (percent / 100) : qty;
    const exitPrice = form.orderType === "LIMIT" ? price : Number(row.mark);
    setError("");
    setIdempotencyKey(newIdempotencyKey("close"));
    setMutation({ phase: "preview" });
    setCloseConfirm({
      account: row.account,
      symbol: row.symbol,
      positionSide: row.side,
      orderType: form.orderType,
      quantityMode,
      quantity: Number.isFinite(qty) && qty > 0 ? String(qty) : undefined,
      percent: quantityMode === "PERCENT" ? String(percent) : undefined,
      price: form.orderType === "LIMIT" ? String(price) : undefined,
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
    setMutation({ phase: "submitting", message: "Đang gửi đóng…" });
    try {
      const body = {
        username: closeConfirm.account,
        symbol: closeConfirm.symbol,
        positionSide: closeConfirm.positionSide,
        orderType: closeConfirm.orderType,
        quantityMode: closeConfirm.quantityMode,
        idempotencyKey,
      };
      if (closeConfirm.quantityMode === "PERCENT") body.percent = closeConfirm.percent;
      else if (closeConfirm.quantity != null) body.quantity = closeConfirm.quantity;
      if (closeConfirm.orderType === "LIMIT") body.price = closeConfirm.price;
      const result = await api("/api/trading/positions/close", { method: "POST", body });
      setMutation(classifyMutationResult(result));
      setCloseConfirm(null);
      setDirty(false);
      setError("");
    } catch (err) {
      console.error("[terminal]", err);
      if (err.message === "Request timeout" || err.name === "AbortError" || err.status === 0) {
        setMutation({ phase: "unknown", message: err.message || "Timeout sau khi gửi", requestId: idempotencyKey });
      } else {
        setMutation({ phase: "rejected", message: err.message || "Không đóng được" });
        setError(err.message || "Không đóng được position");
      }
    } finally {
      setClosing(false);
    }
  }

  function askReverse(row) {
    if (!perms.canClose || !perms.canOpen) {
      setError("Cần quyền positions.close và positions.open");
      return;
    }
    if (row.book === "paper" || row.book === "pending") {
      setError("Paper/lệnh chờ không reverse trên sàn");
      return;
    }
    const qty = qtyOf(row);
    setError("");
    setIdempotencyKey(newIdempotencyKey("reverse"));
    setMutation({ phase: "preview" });
    setReverseConfirm({
      account: row.account,
      symbol: row.symbol,
      positionSide: row.side,
      newSide: row.side === "LONG" ? "SHORT" : "LONG",
      quantity: numInput(qty),
      preview: closePreview({ side: row.side, entry: row.entry, exitPrice: row.mark, qty, monitors: row.monitors }),
      openPreview: openPreview({ side: row.side === "LONG" ? "SHORT" : "LONG", entryOrMark: row.mark, quantity: qty }),
    });
  }

  async function submitReverse() {
    if (!reverseConfirm || reversing) return;
    setReversing(true);
    setMutation({ phase: "submitting", message: "Đang reverse (đóng → mở)…" });
    try {
      const result = await api("/api/trading/positions/reverse", {
        method: "POST",
        body: {
          username: reverseConfirm.account,
          symbol: reverseConfirm.symbol,
          positionSide: reverseConfirm.positionSide,
          closeOrderType: "MARKET",
          openOrderType: "MARKET",
          newQuantity: reverseConfirm.quantity,
          idempotencyKey,
        },
      });
      const classified = classifyMutationResult(result);
      const openFailed = result?.command?.result?.openError || result?.command?.result?.steps?.open?.error;
      if (openFailed) {
        setMutation({
          phase: "unknown",
          message: `Đóng có thể đã xong; mở đối ứng lỗi: ${openFailed}. Không tự mở lại phía cũ.`,
          requestId: result?.command?.requestId,
        });
      } else {
        setMutation(classified);
      }
      setReverseConfirm(null);
      setError("");
    } catch (err) {
      console.error("[terminal]", err);
      if (err.message === "Request timeout" || err.status === 0) {
        setMutation({ phase: "unknown", message: "Timeout reverse — kiểm tra receipt, không tự retry key mới" });
      } else {
        setMutation({ phase: "rejected", message: err.message || "Không reverse được" });
        setError(err.message || "Không reverse được");
      }
    } finally {
      setReversing(false);
    }
  }

  function askOpen(form) {
    if (!perms.canOpen) {
      setError("Thiếu quyền positions.open");
      return;
    }
    if (!form.account || !form.symbol) {
      setError("Ticket cần tài khoản và symbol cụ thể");
      return;
    }
    if (!(Number(form.quantity) > 0)) {
      setError("Quantity phải > 0");
      return;
    }
    if (form.orderType === "LIMIT" && !(Number(form.price) > 0)) {
      setError("LIMIT cần giá > 0");
      return;
    }
    setError("");
    setIdempotencyKey(newIdempotencyKey("open"));
    setMutation({ phase: "preview" });
    setOpenConfirm({
      ...form,
      preview: openPreview({
        side: form.side,
        entryOrMark: form.orderType === "LIMIT" ? form.price : (form.mark || form.price),
        quantity: form.quantity,
      }),
    });
  }

  async function submitOpen() {
    if (!openConfirm || opening) return;
    setOpening(true);
    setMutation({ phase: "submitting" });
    try {
      const body = {
        username: openConfirm.account,
        symbol: String(openConfirm.symbol).toUpperCase(),
        positionSide: openConfirm.side,
        orderType: openConfirm.orderType,
        quantity: String(openConfirm.quantity),
        idempotencyKey,
      };
      if (openConfirm.orderType === "LIMIT") body.price = String(openConfirm.price);
      const result = await api("/api/trading/positions/open", { method: "POST", body });
      setMutation(classifyMutationResult(result));
      setOpenConfirm(null);
      setDirty(false);
      setError("");
    } catch (err) {
      console.error("[terminal]", err);
      if (err.message === "Request timeout" || err.status === 0) {
        setMutation({ phase: "unknown", message: err.message });
      } else {
        setMutation({ phase: "rejected", message: err.message || "Không mở được" });
        setError(err.message || "Không mở được position");
      }
    } finally {
      setOpening(false);
    }
  }

  function askTpsl(row, form) {
    if (!perms.canTpsl) {
      setError("Thiếu quyền positions.tpsl");
      return;
    }
    if (row.book === "paper" || row.book === "pending") {
      setError("Paper/lệnh chờ không đặt Position TP/SL trên sàn");
      return;
    }
    setError("");
    setIdempotencyKey(newIdempotencyKey("tpsl"));
    setMutation({ phase: "preview" });
    setTpslDraft({
      ...form,
      account: row.account,
      symbol: row.symbol,
      side: row.side,
      entry: row.entry,
      mark: row.mark,
      qty: qtyOf(row),
      monitors: row.monitors || [],
    });
  }

  async function submitTpsl() {
    if (!tpslDraft || savingTpsl) return;
    const key = `${tpslDraft.account}|${tpslDraft.symbol}|${tpslDraft.side}`;
    setSavingTpsl(true);
    setMutation({ phase: "submitting" });
    try {
      let body;
      if (tpslDraft.tab === "trailing") {
        const rate = Number(tpslDraft.callbackRate);
        if (!(rate >= 0.1 && rate <= 10)) {
          setError("callbackRate trailing phải trong 0.1–10 (%)");
          setSavingTpsl(false);
          setMutation({ phase: "rejected", message: "callbackRate không hợp lệ" });
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
          idempotencyKey,
        };
      } else {
        const tpOn = tpslDraft.tpEnabled !== false && String(tpslDraft.tp || "").trim() !== "";
        const slOn = tpslDraft.slEnabled !== false && String(tpslDraft.sl || "").trim() !== "";
        if (!tpOn && !slOn) {
          setError("Nhập ít nhất giá TP hoặc SL");
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
          idempotencyKey,
        };
      }
      const result = await api(`/api/trading/positions/${encodeURIComponent(key)}/tpsl`, { method: "PUT", body });
      const rowsResult = result?.command?.result?.results || [];
      const partialFail = rowsResult.some((r) => !r.success);
      const summaryText = rowsResult.length
        ? rowsResult.map((r) => (r.success ? `${r.type}@${r.stopPrice || r.callbackRate || ""}` : `${r.type} lỗi: ${r.error}`)).join(" · ")
        : "đã gửi";
      setMutation({
        phase: partialFail ? "unknown" : classifyMutationResult(result).phase,
        message: summaryText,
        requestId: result?.command?.requestId,
      });
      setTpslDraft(null);
      setDirty(false);
      setError("");
    } catch (err) {
      console.error("[terminal]", err);
      if (err.message === "Request timeout" || err.status === 0) {
        setMutation({ phase: "unknown", message: err.message });
      } else {
        setMutation({ phase: "rejected", message: err.message || "Không đặt được TP/SL" });
        setError(err.message || "Không đặt được TP/SL");
      }
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
          idempotencyKey: newIdempotencyKey("trail-cancel"),
        },
      });
      setMutation({ phase: "accepted", message: `Đã hủy Trailing ${tpslDraft.symbol}` });
      setTpslDraft(null);
      setError("");
    } catch (err) {
      console.error("[terminal]", err);
      setMutation({ phase: "rejected", message: err.message || "Không hủy được Trailing" });
      setError(err.message || "Không hủy được Trailing");
    } finally {
      setSavingTpsl(false);
    }
  }

  async function removeMonitor(monitor) {
    const label = `${monitor.env || "monitor"} ${monitor.signal || ""}`.trim();
    if (!window.confirm(`Xóa monitor ${label}?\nKhông đóng vị thế sàn.`)) return;
    try {
      await api(`/api/positions/monitors/${encodeURIComponent(monitor.id)}`, { method: "DELETE" });
      patchPayload((prev) => ({
        ...prev,
        rows: (prev.rows || []).map((row) => ({
          ...row,
          monitors: (row.monitors || []).filter((item) => item.id !== monitor.id),
        })),
      }));
      setMutation({ phase: "accepted", message: `Đã xóa monitor ${label} (không đóng sàn)` });
      setError("");
    } catch (err) {
      console.error("[terminal]", err);
      setError(err.message || "Không xoá được monitor");
    }
  }

  async function submitMonitor() {
    if (!monitorDraft || savingMonitor) return;
    setSavingMonitor(true);
    try {
      const created = await api("/api/positions/monitors", { method: "POST", body: monitorDraft });
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
      setMutation({
        phase: "accepted",
        message: created.monitorOff
          ? `Đã thêm monitor ${created.env}. Config tắt MONITOR — bot sẽ không chạy.`
          : `Đã thêm monitor ${created.env} ${created.signal}`,
      });
      setMonitorDraft(null);
      setError("");
    } catch (err) {
      console.error("[terminal]", err);
      setError(err.message || "Không thêm được monitor");
    } finally {
      setSavingMonitor(false);
    }
  }

  function onRowMenu(row, action, monitor) {
    if (action === "reverse") askReverse(row);
    else if (action === "add-monitor") {
      if (!perms.canOpen) {
        setError("Thiếu quyền positions.open");
        return;
      }
      setMonitorDraft({
        account: row.account,
        env: "",
        symbol: row.symbol,
        side: row.side,
        signal: "NOTPSL",
        positionAmt: qtyOf(row) ?? "",
        entry: row.entry ?? "",
        mark: row.mark ?? "",
        leverage: row.leverage ?? "",
        liquidation: row.liquidation ?? "",
      });
    } else if (action === "remove-monitor") removeMonitor(monitor);
    else if (action === "detail") selectRow(row.key, { panelTab: "overview" });
  }

  function onSaveView() {
    const name = window.prompt("Tên view", "View của tôi");
    if (!name) return;
    const id = `custom-${Date.now()}`;
    const filters = {
      symbol: params.get("symbol") || undefined,
      side: params.get("side") || undefined,
      env: params.get("env") || undefined,
      warn: params.get("warn") || undefined,
    };
    updatePrefs({ customViews: [...(prefs.customViews || []), { id, name, filters }] });
    go((q) => q.set("view", id), { replace: true });
  }

  const bookLabel = !book || book === "live" ? "live" : book;
  const showPanel = Boolean(selected && selectedRow && prefs.panelOpen);

  // Params bridge for reused history/orders tabs (book=live → empty)
  const childParams = useMemo(() => {
    const next = new URLSearchParams(params);
    const apiBook = bookForApi(book);
    if (!apiBook) next.delete("book");
    else next.set("book", apiBook);
    // PositionHistory / OpenOrders expect tab names from Positions — map
    if (tab === "position-history") next.set("tab", "history");
    if (tab === "open-orders") next.set("tab", "orders");
    if (tab === "order-history") next.set("tab", "order-history");
    return next;
  }, [params, book, tab]);

  function childGo(mutate, opts) {
    go((query) => {
      mutate(query);
      // keep terminal tab names
      const t = query.get("tab");
      if (t === "history") query.set("tab", "position-history");
      if (t === "orders") query.set("tab", "open-orders");
      if (t === "open") query.set("tab", "positions");
    }, opts);
  }

  return (
    <section className="term-screen">
      <header className="term-header">
        <div className="term-header-title">
          <h1>Terminal</h1>
          <p className="muted">Workspace giao dịch — Position cũ vẫn ở /positions.</p>
        </div>
        <div className="term-header-status">
          <span className={stale ? "term-badge term-badge-warn" : "term-badge"}>
            {account
              ? (connection === "live" ? "Live" : connection === "polling" ? "Polling" : connection === "monitor" ? "Monitor" : stale ? "Stale" : "Snapshot")
              : (stale ? "Stale" : "Live · scope")}
          </span>
          {payload?.updatedAt ? <span className="muted">Đối chiếu {when(payload.updatedAt)}</span> : null}
          <button
            type="button"
            disabled={tab !== "positions" || refreshing || !perms.canPositions}
            onClick={() => refreshExchange().catch(() => {})}
          >
            {refreshing ? "Đang đồng bộ…" : "Đồng bộ"}
          </button>
          {perms.canOpen && tab === "positions" ? (
            <button
              type="button"
              className="term-primary"
              onClick={() => {
                setTicketOpen(true);
                go((q) => {
                  if (!q.get("selected") && rows[0]) q.set("selected", rows[0].key);
                  q.set("panelTab", "trade");
                });
                updatePrefs({ panelOpen: true });
              }}
            >
              Đặt lệnh
            </button>
          ) : null}
        </div>
      </header>

      <div className="term-tabs" role="tablist">
        {perms.canPositions ? (
          <button type="button" className={tab === "positions" ? "active" : ""} onClick={() => go((q) => { q.set("tab", "positions"); q.delete("trade"); })}>Vị thế</button>
        ) : null}
        {perms.canOrders ? (
          <button type="button" className={tab === "open-orders" ? "active" : ""} onClick={() => go((q) => { q.set("tab", "open-orders"); q.delete("selected"); q.delete("panel"); })}>Lệnh chờ</button>
        ) : null}
        {perms.canHistory ? (
          <button type="button" className={tab === "position-history" ? "active" : ""} onClick={() => go((q) => { q.set("tab", "position-history"); q.delete("selected"); })}>Lịch sử vị thế</button>
        ) : null}
        {perms.canOrders ? (
          <button type="button" className={tab === "order-history" ? "active" : ""} onClick={() => go((q) => { q.set("tab", "order-history"); q.delete("selected"); })}>Lịch sử lệnh</button>
        ) : null}
        <span className="term-tab-r2 muted" title="Roadmap R2">Khớp lệnh</span>
      </div>

      <FilterBar
        tab={tab}
        params={params}
        audience={audience}
        account={account}
        accounts={accountRows}
        envs={envs}
        viewId={viewId}
        customViews={prefs.customViews || []}
        density={prefs.density}
        columnsOpen={columnsOpen}
        advancedOpen={advancedOpen}
        canPositions={perms.canPositions}
        canOpen={perms.canOpen}
        notifyReady={notifyReady || prefs.notifyOptIn}
        onFilter={setFilter}
        onView={(id) => {
          go((q) => {
            if (!id || id === "all") q.delete("view");
            else q.set("view", id);
            if (id === "attention") q.set("warn", "1");
            else if (params.get("warn") === "1" && id !== "attention") q.delete("warn");
          }, { replace: true });
        }}
        onDensity={(d) => updatePrefs({ density: d })}
        onToggleColumns={() => setColumnsOpen((v) => !v)}
        onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
        onNotify={async () => {
          try {
            const permission = await Notification.requestPermission();
            setNotifyReady(permission === "granted");
            updatePrefs({ notifyOptIn: permission === "granted" });
          } catch (error) {
            console.error("[terminal]", error);
          }
        }}
        onSaveView={onSaveView}
        onDeleteView={(id) => {
          updatePrefs({ customViews: (prefs.customViews || []).filter((v) => v.id !== id) });
          go((q) => q.delete("view"), { replace: true });
        }}
      />

      {columnsOpen && tab === "positions" ? (
        <div className="term-columns-pop">
          {Object.keys(DEFAULT_COLUMNS).map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={prefs.columns?.[key] !== false}
                disabled={key === "symbol" || key === "actions"}
                onChange={(e) => updatePrefs({ columns: { ...prefs.columns, [key]: e.target.checked } })}
              />
              {key}
            </label>
          ))}
          <label>
            Rộng panel
            <input
              type="range"
              min={360}
              max={560}
              value={prefs.panelWidth}
              onChange={(e) => updatePrefs({ panelWidth: clampPanelWidth(e.target.value) })}
            />
          </label>
          <label>
            <input type="checkbox" checked={prefs.panelOpen !== false} onChange={(e) => updatePrefs({ panelOpen: e.target.checked })} />
            Hiện panel
          </label>
        </div>
      ) : null}

      {notices.length ? (
        <div className="term-toast-stack" aria-live="polite">
          {notices.map((alert) => (
            <button key={alert.id} type="button" className={`term-toast term-toast-${alert.kind}`} onClick={() => setNotices((prev) => prev.filter((i) => i.id !== alert.id))}>
              {alertText(alert)}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {payload?.exchangeErrors?.length ? (
        <p className="form-error">{payload.exchangeErrors.map((item) => `${item.account}: ${item.error}`).join(" · ")}</p>
      ) : null}
      <MutationStatus phase={mutation.phase} message={mutation.message} requestId={mutation.requestId} exchangeStatus={mutation.exchangeStatus} />

      {tab === "positions" && !perms.canPositions ? <p className="muted">Cần quyền positions.view để xem vị thế đang mở.</p> : null}

      {tab === "positions" && perms.canPositions ? (
        <>
          <TerminalSummary summary={summary} bookLabel={bookLabel} />
          <div
            className={`term-workspace ${showPanel && !overlay ? "with-panel" : ""}`}
            style={showPanel && !overlay ? { "--term-panel-w": `${prefs.panelWidth}px` } : undefined}
          >
            <div className="term-main">
              {!payload ? (
                <div className="term-skeleton" aria-busy="true">
                  <div /><div /><div /><div />
                </div>
              ) : null}
              {payload && !rows.length && !stale ? <p className="muted">Không có vị thế trong bộ lọc.</p> : null}
              {payload && !rows.length && stale ? <p className="term-warn-text">Chưa có dữ liệu xác minh. Không coi đây là hết vị thế.</p> : null}
              {rows.length ? (
                <PositionTable
                  rows={rows}
                  sort={sort}
                  onSort={toggleSort}
                  selectedKey={selected}
                  expanded={expanded}
                  columns={prefs.columns || DEFAULT_COLUMNS}
                  density={prefs.density}
                  stale={stale}
                  canClose={perms.canClose}
                  canOpen={perms.canOpen}
                  canTpsl={perms.canTpsl}
                  onSelect={selectRow}
                  onToggleExpand={(key) => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  onClose={(row) => {
                    selectRow(row.key, { panelTab: "trade" });
                    askClose(row, { orderType: "MARKET", price: numInput(row.mark), qty: numInput(qtyOf(row)), percent: 100 });
                  }}
                  onTpsl={(row) => {
                    selectRow(row.key, { panelTab: "trade" });
                    askTpsl(row, {
                      tab: "tpsl",
                      tp: numInput(row.exchangeTp),
                      sl: numInput(row.exchangeSl),
                      tpEnabled: true,
                      slEnabled: true,
                      tpWorkingType: "CONTRACT_PRICE",
                      slWorkingType: "CONTRACT_PRICE",
                      callbackRate: numInput(row.exchangeTrailingCallback) || "1",
                      activationPrice: numInput(row.exchangeTrailingActivation),
                      trailingWorkingType: "CONTRACT_PRICE",
                      hasTrailing: row.exchangeTrailingCallback != null,
                      trailingOrderId: row.exchangeTrailingOrderId,
                    });
                  }}
                  onMenu={onRowMenu}
                />
              ) : null}
            </div>
            {showPanel ? (
              <DetailPanel
                row={selectedRow}
                audience={audience}
                panelTab={panelTab}
                onPanelTab={(id) => go((q) => q.set("panelTab", id), { replace: true })}
                monitorId={monitorId}
                onSelectMonitor={setMonitorId}
                accounts={payload?.accounts}
                canClose={perms.canClose}
                canOpen={perms.canOpen}
                canTpsl={perms.canTpsl}
                canOrders={perms.canOrders}
                canCreateOrder={perms.canCreateOrder}
                mutation={mutation}
                onCloseRequest={askClose}
                onOpenRequest={askOpen}
                onTpslRequest={askTpsl}
                onReverseRequest={askReverse}
                onDirtyChange={setDirty}
                onClosePanel={closePanel}
                width={prefs.panelWidth}
                overlay={overlay}
              />
            ) : null}
          </div>
          {ticketOpen && !selected ? (
            <p className="muted">Chọn tài khoản/vị thế hoặc mở panel Giao dịch → Mở để đặt lệnh.</p>
          ) : null}
        </>
      ) : null}

      {tab === "position-history" && perms.canHistory ? (
        <div className="term-tab-body">
          <PositionHistory params={childParams} go={childGo} canStats={perms.canHistory} onAccounts={setHistoryAccounts} />
        </div>
      ) : null}
      {tab === "position-history" && !perms.canHistory ? <p className="muted">Cần quyền statistics.view.</p> : null}

      {tab === "open-orders" && perms.canOrders ? (
        <div className="term-tab-body">
          <OpenOrdersTab params={childParams} go={childGo} accounts={payload?.accounts || accountRows} audience={audience} />
        </div>
      ) : null}
      {tab === "open-orders" && !perms.canOrders ? <p className="muted">Cần quyền orders.view.</p> : null}

      {tab === "order-history" && perms.canOrders ? (
        <div className="term-tab-body">
          <OrderHistoryTab params={childParams} go={childGo} accounts={payload?.accounts || accountRows} />
        </div>
      ) : null}
      {tab === "order-history" && !perms.canOrders ? <p className="muted">Cần quyền orders.view.</p> : null}

      <CloseConfirmDialog confirm={closeConfirm} busy={closing} onCancel={() => { setCloseConfirm(null); setMutation({ phase: "draft" }); }} onSubmit={submitClose} />
      <ReverseConfirmDialog confirm={reverseConfirm} busy={reversing} onCancel={() => setReverseConfirm(null)} onSubmit={submitReverse} />
      <OpenConfirmDialog confirm={openConfirm} busy={opening} onCancel={() => setOpenConfirm(null)} onSubmit={submitOpen} />
      <TpslConfirmDialog draft={tpslDraft} busy={savingTpsl} onCancel={() => setTpslDraft(null)} onSubmit={submitTpsl} onCancelTrailing={cancelTrailing} />
      <MonitorDraftDialog
        draft={monitorDraft}
        accounts={payload?.accounts}
        busy={savingMonitor}
        onChange={setMonitorDraft}
        onCancel={() => setMonitorDraft(null)}
        onSubmit={submitMonitor}
      />

      <details className="term-data-details">
        <summary>Chi tiết dữ liệu</summary>
        <p className="muted">
          mode={payload?.mode || "—"} · connection={connection} · version={payload?.version ?? "—"}
          {payload?.sources?.length ? ` · sources ${payload.sources.map((s) => `${s.account}${s.stale ? "*" : ""}`).join(", ")}` : ""}
        </p>
        <p className="muted">Presets đóng: {CLOSE_PERCENTS.join("/")}%. API book adapter: live → (trống).</p>
      </details>
    </section>
  );
}
