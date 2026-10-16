import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import useDebouncedValue from "../hooks/useDebouncedValue";
import { useAuth } from "../auth";
import { ownsBot } from "../access";

const can = (user, permission) => (user?.permissions || []).includes(permission);
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_PRESETS = [
  { id: "today", label: "Hôm nay" },
  { id: "7", label: "7 ngày" },
  { id: "30", label: "30 ngày" },
  { id: "90", label: "90 ngày" },
  { id: "custom", label: "Tùy chọn" },
];

function fmtTime(value) {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "—";
}

function fmt(value, digits = 2) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function money(value, digits = 2) {
  if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const text = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (n > 0) return `+${text}$`;
  if (n < 0) return `−${text}$`;
  return `${text}$`;
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}

function holdLabel(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return "—";
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h >= 48) return `${Math.round(h / 24)} ngày`;
  if (h) return `${h}g ${m}p`;
  if (m) return `${m} phút`;
  return `${total}s`;
}

function daysAgoIso(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

async function loadActiveBots() {
  const rows = [];
  let page = 1;
  let total = Infinity;
  while (rows.length < total && page <= 20) {
    const data = await api(`/api/bots?active=true&page=${page}&limit=100`);
    const batch = data.bots || [];
    rows.push(...batch);
    total = Number(data.total) || rows.length;
    if (!batch.length) break;
    page += 1;
  }
  return rows;
}

function digitsFor(preferred, sample, fallback) {
  if (Number.isInteger(preferred) && preferred >= 0) return preferred;
  const amount = Math.abs(Number(sample));
  if (!Number.isFinite(amount) || amount === 0 || amount >= 1) return fallback;
  return Math.min(12, Math.max(fallback, Math.ceil(-Math.log10(amount)) + 2));
}

function fmtPrice(value, row) {
  return fmt(value, digitsFor(row?.symbolInfo?.priceDecimals, value, 2));
}

function Tip({ text }) {
  const id = useId();
  if (!text) return null;
  return (
    <button type="button" className="perf-tip" aria-describedby={id} title={text}>
      ?
      <span role="tooltip" id={id} className="perf-tip-bubble">{text}</span>
    </button>
  );
}

function Kpi({ label, value, note, tip, toneClass }) {
  return (
    <article className={`card perf-kpi ${toneClass || ""}`}>
      <div className="perf-kpi-label">
        <span>{label}</span>
        <Tip text={tip} />
      </div>
      <strong className="perf-num">{value}</strong>
      {note ? <small className="muted">{note}</small> : null}
    </article>
  );
}

function sortGroups(rows, key) {
  return [...(rows || [])].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    if (left == null && right == null) return (b.count || 0) - (a.count || 0);
    if (left == null) return 1;
    if (right == null) return -1;
    return Number(right) - Number(left) || (b.count || 0) - (a.count || 0);
  });
}

function PnlChart({ series, selectedDay, onSelectDay, timeField }) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 28, left: 48 };
  const rows = series || [];
  if (!rows.length) {
    return <div className="card perf-chart empty"><p className="muted">Chưa có chuỗi PnL để vẽ.</p></div>;
  }
  const profits = rows.map((row) => Number(row.profit) || 0);
  const cumulatives = rows.map((row) => Number(row.cumulative) || 0);
  const minBar = Math.min(0, ...profits);
  const maxBar = Math.max(0, ...profits);
  const minLine = Math.min(0, ...cumulatives);
  const maxLine = Math.max(0, ...cumulatives);
  const barSpan = maxBar - minBar || 1;
  const lineSpan = maxLine - minLine || 1;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const zeroY = pad.top + ((maxBar - 0) / barSpan) * innerH;
  const barW = Math.max(2, innerW / Math.max(rows.length, 1) * 0.62);
  const points = rows.map((row, index) => {
    const x = pad.left + ((index + 0.5) * innerW) / Math.max(rows.length, 1);
    const y = pad.top + ((maxLine - (Number(row.cumulative) || 0)) / lineSpan) * innerH;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="card perf-chart">
      <div className="perf-chart-head">
        <div>
          <h2>PnL theo ngày đóng (UTC)</h2>
          <p className="muted">
            Đường là PnL lũy kế của tập lệnh đang xem, bắt đầu từ 0 — không phải balance/equity tài khoản.
            {timeField === "openTime" ? " Đang lọc theo ngày mở; trục vẫn theo ngày đóng của nhóm lệnh đó." : ""}
          </p>
        </div>
      </div>
      <svg className="perf-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Biểu đồ PnL theo ngày">
        <line x1={pad.left} y1={zeroY} x2={width - pad.right} y2={zeroY} className="perf-chart-zero" />
        {rows.map((row, index) => {
          const x = pad.left + ((index + 0.5) * innerW) / Math.max(rows.length, 1) - barW / 2;
          const value = Number(row.profit) || 0;
          const y = value >= 0
            ? pad.top + ((maxBar - value) / barSpan) * innerH
            : zeroY;
          const h = Math.abs(((value) / barSpan) * innerH);
          const active = selectedDay === row.day;
          return (
            <rect
              key={row.day}
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, value === 0 ? 1 : 0)}
              className={`perf-bar ${value >= 0 ? "up" : "down"}${active ? " active" : ""}`}
              tabIndex={0}
              role="button"
              aria-label={`${row.day}: ${row.trades} lệnh, PnL ngày ${money(row.profit)}, lũy kế ${money(row.cumulative)}`}
              onClick={() => onSelectDay(selectedDay === row.day ? "" : row.day)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectDay(selectedDay === row.day ? "" : row.day);
                }
              }}
            >
              <title>{`${row.day} UTC · ${row.trades} lệnh · ngày ${money(row.profit)} · lũy kế ${money(row.cumulative)}`}</title>
            </rect>
          );
        })}
        <polyline fill="none" className="perf-line" strokeWidth="2" points={points} />
        {rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 6) === 0).map((row, _, list) => {
          const index = rows.indexOf(row);
          const x = pad.left + ((index + 0.5) * innerW) / Math.max(rows.length, 1);
          return <text key={`label-${row.day}`} x={x} y={height - 8} textAnchor="middle" className="perf-chart-label">{row.day.slice(5)}</text>;
        })}
      </svg>
    </div>
  );
}

function GroupTable({ rows, nameKey, nameLabel, username, active, onPick, sortKey, onSort }) {
  const sorted = sortGroups(rows, sortKey);
  const maxAbs = Math.max(1, ...sorted.map((row) => Math.abs(Number(row.profit) || 0)));
  const heads = [
    ["count", "Số lệnh"],
    ["profit", "PnL"],
    ["winRate", "Win rate"],
    ["profitFactor", "Profit factor"],
    ["avgProfit", "PnL TB"],
  ];
  return (
    <div className="table-wrap perf-table">
      <table>
        <thead>
          <tr>
            <th>{nameLabel}</th>
            {heads.map(([key, label]) => (
              <th key={key} className="num">
                <button type="button" className={sortKey === key ? "th-sort active" : "th-sort"} onClick={() => onSort(key)}>{label}</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? <tr><td colSpan={6}>Không có nhóm trong bộ lọc hiện tại.</td></tr> : null}
          {sorted.map((row) => {
            const name = row[nameKey];
            const pnl = row.profit;
            const width = `${Math.max(4, (Math.abs(Number(pnl) || 0) / maxAbs) * 100)}%`;
            const avg = row.valid ? (Number(row.profit) || 0) / row.valid : null;
            return (
              <tr key={`${nameKey}-${name}`} className={active === name ? "trade-row active" : "trade-row"}>
                <td>
                  <button type="button" className="perf-linkish" onClick={() => onPick(name)}>
                    {nameKey === "env" && username ? `${username} / ${name}` : name}
                  </button>
                  {row.lowSample ? (
                    <span className="perf-badge" title="Ngưỡng dưới 20 lệnh chỉ hỗ trợ đọc số liệu, không bảo đảm độ tin cậy thống kê.">Ít dữ liệu</span>
                  ) : null}
                </td>
                <td className="num">{row.wins}/{row.count}</td>
                <td className="num">
                  <div className="perf-barcell">
                    <span className={tone(pnl)}>{money(pnl)}</span>
                    <span className={`perf-inlinebar ${tone(pnl)}`} style={{ width }} />
                  </div>
                </td>
                <td className="num">{row.winRate == null ? "—" : `${fmt(row.winRate, 1)}%`}</td>
                <td className="num">{row.profitFactorLabel || (row.profitFactor == null ? "—" : fmt(row.profitFactor, 2))}</td>
                <td className="num">{money(avg)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TradePanel({ row, onClose, configHref, historyHref, ledgerHref, triggerRef }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const node = panelRef.current?.querySelector("button, [href], input, select, textarea");
    node?.focus?.();
    function onKey(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      triggerRef?.current?.focus?.();
    };
  }, [onClose, triggerRef]);

  if (!row) {
    return (
      <aside className="perf-panel card" ref={panelRef} aria-label="Chi tiết lệnh">
        <header><h2>Chi tiết lệnh</h2><button type="button" className="ghost" onClick={onClose}>Đóng</button></header>
        <p className="muted">Đang tải…</p>
      </aside>
    );
  }

  const qtyDigits = digitsFor(row.symbolInfo?.qtyDecimals, row.positionAmt, 4);
  return (
    <aside className="perf-panel card" ref={panelRef} aria-label="Chi tiết lệnh">
      <header>
        <div>
          <button type="button" className="ghost perf-back" onClick={onClose}>← Quay lại</button>
          <h2>{row.symbol || "Giao dịch"} · {row.side || "—"}</h2>
        </div>
        <button type="button" className="ghost" onClick={onClose}>Đóng</button>
      </header>
      <dl className="perf-detail-grid">
        <div><dt>User / Config</dt><dd>{configHref ? <Link className="trail-link" to={configHref}>{row.env}</Link> : row.env || "Chưa ghi nhận"}</dd></div>
        <div><dt>Signal</dt><dd>{historyHref ? <Link className="trail-link" to={historyHref}>{row.signal || "Chưa ghi nhận"}</Link> : (row.signal || "Chưa ghi nhận")}</dd></div>
        <div><dt>Sổ</dt><dd>{row.paper ? "Paper" : "Live"}</dd></div>
        <div><dt>Copy</dt><dd>{row.copy ? "Copy" : "Không Copy"}</dd></div>
        <div><dt>Mở</dt><dd>{fmtTime(row.openTime)}</dd></div>
        <div><dt>Đóng</dt><dd>{fmtTime(row.closeTime)}</dd></div>
        <div><dt>Giá vào</dt><dd>{fmtPrice(row.entryPrice, row)}</dd></div>
        <div><dt>Giá đóng</dt><dd>{fmtPrice(row.closePrice, row)}</dd></div>
        <div><dt>Đòn bẩy</dt><dd>{fmt(row.leverage, 0)}</dd></div>
        <div><dt>Cost</dt><dd>{row.cost == null ? "Chưa ghi nhận" : `${fmt(row.cost)}$`}</dd></div>
        <div><dt>Volume</dt><dd>{row.volume == null ? "Chưa ghi nhận" : `${fmt(row.volume)}$`}</dd></div>
        <div><dt>Khối lượng</dt><dd>{fmt(row.positionAmt, qtyDigits)}</dd></div>
        <div><dt>PnL</dt><dd className={tone(row.profit)}>{money(row.profit)}</dd></div>
        <div>
          <dt>roe đã lưu <Tip text={row.roeBasis || "Không hiển thị như ROI tài khoản."} /></dt>
          <dd>{row.roe == null ? "Chưa ghi nhận" : `${fmt(row.roe)}%`}</dd>
        </div>
        <div>
          <dt>PnL / cost lệnh <Tip text="profit ÷ costAmount của lệnh này. Không phải ROI vốn tài khoản." /></dt>
          <dd>{row.pnlOverCost == null ? "—" : `${fmt(row.pnlOverCost, 1)}%`}</dd>
        </div>
        <div><dt>Thời gian giữ</dt><dd>{holdLabel(row.holdMs)}</dd></div>
        <div><dt>TP</dt><dd>{row.tps?.length ? row.tps.map((price) => fmtPrice(price, row)).join(", ") : "Chưa ghi nhận"}</dd></div>
        <div><dt>Lý do đóng</dt><dd>{row.closeReason || "Chưa ghi nhận"}</dd></div>
        <div><dt>Status bot</dt><dd>{row.status || "Chưa ghi nhận"}</dd></div>
      </dl>
      {row.pnlNote ? <p className="muted perf-note">{row.pnlNote}</p> : null}
      {ledgerHref ? <p className="muted"><Link className="trail-link" to={ledgerHref}>Xem hiệu quả vốn tài khoản</Link></p> : null}
      {row.logs?.length ? (
        <div className="perf-logs">
          <h3>Timeline / log</h3>
          <ul>
            {row.logs.map((item, index) => (
              <li key={`${item.at || index}-${item.event || ""}`}>
                <span className="muted">{fmtTime(item.at)}</span>
                <strong>{item.event || item.phase || "event"}</strong>
                <span>{item.message || ""}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : <p className="muted">Chưa ghi nhận timeline/log.</p>}
    </aside>
  );
}

export default function TradePerformancePage() {
  const { user } = useAuth();
  const location = useLocation();
  const onReports = location.pathname.startsWith("/reports");
  const signalAllowed = can(user, "signals.history");
  const staticAllowed = can(user, "statistics.view");
  const configAllowed = can(user, "config.view");
  const [params, setParams] = useSearchParams();
  const [bots, setBots] = useState([]);
  const [audience, setAudience] = useState("mine");
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [groupTab, setGroupTab] = useState("signal");
  const [groupSort, setGroupSort] = useState("profit");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [signalDraft, setSignalDraft] = useState("");
  const [tick, setTick] = useState(0);
  const rowTriggerRef = useRef(null);
  const requestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const username = params.get("username") || "";
  const env = params.get("env") || "";
  const q = params.get("q") || "";
  const side = params.get("side") || "";
  const signal = params.get("signal") || "";
  const profit = params.get("profit") || "";
  const book = params.get("book") || "live";
  const copy = params.get("copy") || "";
  const closed = params.get("closed") || "closed";
  const timeField = params.get("time") === "open" ? "open" : "close";
  const range = params.get("range") || "7";
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const listDay = params.get("listDay") || "";
  const trade = params.get("trade") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const debouncedQ = useDebouncedValue(q);
  const debouncedSignal = useDebouncedValue(signalDraft);

  const mineBots = useMemo(() => bots.filter((bot) => ownsBot(user, bot)), [bots, user]);
  const otherBots = useMemo(
    () => bots.filter((bot) => !ownsBot(user, bot) && (user?.role === "admin" || (bot.visibility || "public") !== "private")),
    [bots, user]
  );
  const listedBots = audience === "others" ? otherBots : mineBots;
  const selectedBot = useMemo(() => bots.find((bot) => bot.username === username), [bots, username]);

  function update(values, { replace = false } = {}) {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => (value ? next.set(key, String(value)) : next.delete(key)));
    if (!Object.hasOwn(values, "page") && !Object.hasOwn(values, "trade") && !Object.hasOwn(values, "listDay")) next.set("page", "1");
    if (onReports) {
      next.set("tab", "performance");
      next.delete("view");
    } else {
      next.set("view", "performance");
    }
    next.set("analytics", "1");
    setParams(next, { replace });
  }

  function clearFilters() {
    update({
      env: "",
      q: "",
      side: "",
      signal: "",
      profit: "",
      book: "live",
      copy: "",
      closed: "closed",
      time: "close",
      range: "7",
      from: "",
      to: "",
      listDay: "",
      trade: "",
      page: "1",
    });
    setSignalDraft("");
  }

  useEffect(() => {
    let cancelled = false;
    loadActiveBots().then((nextBots) => {
      if (cancelled) return;
      setBots(nextBots);
      const mine = nextBots.filter((bot) => ownsBot(user, bot));
      const others = nextBots.filter((bot) => !ownsBot(user, bot) && (user?.role === "admin" || (bot.visibility || "public") !== "private"));
      const current = username;
      const inMine = mine.some((bot) => bot.username === current);
      const inOthers = others.some((bot) => bot.username === current);
      if (current && inOthers && !inMine) setAudience("others");
      else if (!current || (!inMine && !inOthers)) {
        update({ username: mine[0]?.username || "", env: "", book: "live", range: range || "7", time: "close", closed: "closed", analytics: "1" }, { replace: true });
      } else if (
        !params.get("analytics")
        || (onReports ? params.get("tab") !== "performance" : params.get("view") !== "performance")
      ) {
        update({
          book: params.get("book") || "live",
          range: params.get("range") || (params.get("from") ? "custom" : "7"),
          time: params.get("time") || "close",
          closed: params.get("closed") || "closed",
          analytics: "1",
        }, { replace: true });
      }
    }).catch((err) => {
      if (!cancelled) setError(err.message);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setSignalDraft(signal);
  }, [signal]);

  useEffect(() => {
    if (debouncedSignal === signal) return;
    update({ signal: debouncedSignal });
  }, [debouncedSignal]);

  useEffect(() => {
    if (!username) { setLoading(false); return undefined; }
    let cancelled = false;
    const controller = new AbortController();
    const reqId = ++requestIdRef.current;
    if (hasLoadedRef.current) setRefreshing(true);
    else setLoading(true);
    setError("");
    const query = new URLSearchParams({
      username,
      page: String(page),
      limit: "50",
      analytics: "1",
      book: book === "paper" ? "paper" : "live",
      closed: closed || "closed",
      time: timeField,
      range: range === "custom" ? "custom" : range,
    });
    if (range === "custom") {
      if (from) query.set("from", from);
      if (to) query.set("to", to);
    }
    if (env) query.set("env", env);
    if (debouncedQ) query.set("q", debouncedQ);
    if (side) query.set("side", side);
    if (signal) query.set("signal", signal);
    if (profit) query.set("profit", profit);
    if (copy) query.set("copy", copy);
    if (listDay) query.set("listDay", listDay);
    api(`/api/account-statics?${query}`, { signal: controller.signal }).then((result) => {
      if (cancelled || reqId !== requestIdRef.current) return;
      setData(result);
      hasLoadedRef.current = true;
    }).catch((err) => {
      if (cancelled || err.name === "AbortError" || reqId !== requestIdRef.current) return;
      setError(err.message || "Không tải được hiệu quả giao dịch");
    }).finally(() => {
      if (cancelled || reqId !== requestIdRef.current) return;
      setLoading(false);
      setRefreshing(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [username, env, debouncedQ, side, signal, profit, book, copy, closed, timeField, range, from, to, page, listDay, tick]);

  useEffect(() => {
    if (!trade || !username) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    api(`/api/account-statics/${encodeURIComponent(trade)}?username=${encodeURIComponent(username)}`, { signal: controller.signal }).then((row) => {
      if (!cancelled) setDetail(row);
    }).catch((err) => {
      if (!cancelled) {
        setDetail(null);
        setError(err.message);
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [trade, username]);

  function historyTo(rowSignal, rowEnv) {
    const query = new URLSearchParams({ tab: "history", fromUser: username });
    const targetEnv = rowEnv || env;
    if (targetEnv) query.set("fromEnv", targetEnv);
    if (rowSignal) query.set("signal", rowSignal);
    if (data?.from) query.set("from", new Date(data.from).toISOString());
    if (data?.to) query.set("to", new Date(data.to).toISOString());
    return `/signal-search?${query}`;
  }

  function configTo(rowEnv) {
    return `/config-lab/${encodeURIComponent(username)}/${encodeURIComponent(rowEnv)}`;
  }

  const chips = [
    username ? { key: "user", label: `User ${username}`, clear: null } : null,
    env ? { key: "env", label: `Config ${username}/${env}`, clear: { env: "" } } : null,
    signal ? { key: "signal", label: `Signal ${signal}`, clear: { signal: "" } } : null,
    q ? { key: "q", label: `Symbol ${q}`, clear: { q: "" } } : null,
    side ? { key: "side", label: side, clear: { side: "" } } : null,
    copy === "copy" ? { key: "copy", label: "Copy", clear: { copy: "" } } : null,
    copy === "manual" ? { key: "manual", label: "Không Copy", clear: { copy: "" } } : null,
    profit === "win" ? { key: "profit", label: "Thắng", clear: { profit: "" } } : null,
    profit === "loss" ? { key: "profit", label: "Thua", clear: { profit: "" } } : null,
    profit === "flat" ? { key: "profit", label: "Hòa vốn", clear: { profit: "" } } : null,
    book === "paper" ? { key: "book", label: "Paper", clear: { book: "live" } } : { key: "book", label: "Live", clear: null },
    timeField === "open" ? { key: "time", label: "Theo ngày mở", clear: { time: "close" } } : { key: "time", label: "Theo ngày đóng", clear: null },
    listDay ? { key: "listDay", label: `Đang xem lệnh đóng ngày ${listDay}`, clear: { listDay: "" } } : null,
  ].filter(Boolean);

  const stats = data?.stats;
  const groupRows = groupTab === "config" ? (stats?.byConfig || [])
    : groupTab === "symbol" ? (stats?.bySymbol || [])
      : groupTab === "side" ? (stats?.bySide || [])
        : (stats?.bySignal || []);
  const groupNameKey = groupTab === "config" ? "env" : groupTab === "symbol" ? "symbol" : groupTab === "side" ? "side" : "signal";
  const formulas = data?.formulas || {};

  const extrasCard = stats ? (
    <aside className="card perf-extras" aria-label="Chỉ số bổ sung">
      <h2 className="perf-extras-title">Chỉ số bổ sung</h2>
      <dl className="perf-extras-list">
        <div><dt>Tổng cost</dt><dd className="perf-num">{money(stats.cost)}</dd></div>
        <div><dt>Volume</dt><dd className="perf-num">{money(stats.volume)}</dd></div>
        <div><dt>Lãi lớn nhất</dt><dd className={`perf-num ${tone(stats.maxProfit)}`}>{money(stats.maxProfit)}</dd></div>
        <div><dt>Lỗ lớn nhất</dt><dd className={`perf-num ${tone(stats.minProfit)}`}>{money(stats.minProfit)}</dd></div>
        <div><dt>Lãi trung bình</dt><dd className={`perf-num ${tone(stats.avgWin)}`}>{money(stats.avgWin)}</dd></div>
        <div><dt>Lỗ trung bình</dt><dd className={`perf-num ${tone(stats.avgLoss)}`}>{money(stats.avgLoss)}</dd></div>
        <div><dt>Thời gian giữ TB</dt><dd className="perf-num">{holdLabel(stats.avgHoldMs)}</dd></div>
        <div>
          <dt>Chuỗi thua dài nhất</dt>
          <dd className="perf-num">
            {stats.longestLosingStreak ?? "—"}
            <small className="muted">{stats.streakTruncated ? " · ≤10k lệnh" : ""}</small>
          </dd>
        </div>
        <div>
          <dt>PnL / tổng cost <Tip text={formulas.pnlOverCost} /></dt>
          <dd className="perf-num">{stats.pnlOverCost == null ? "—" : `${fmt(stats.pnlOverCost, 1)}%`}</dd>
        </div>
      </dl>
    </aside>
  ) : null;

  return (
    <div className={`perf-page${trade ? " has-panel" : ""}`}>
      <div className="perf-layout">
        <div className="perf-main">
          <header className="page-head perf-head">
            <div className="perf-head-row">
              <div>
                <h1>Hiệu quả lệnh</h1>
                <p className="muted">
                  Phân tích kết quả theo signal, cấu hình và từng lệnh.
                  Theo {timeField === "open" ? "thời gian mở lệnh" : "thời gian đóng lệnh"} (UTC). Nguồn Account Static · profit đã lưu (đã gồm phí/funding theo cách bot ghi).
                </p>
              </div>
              <div className="perf-head-actions">
                <span className="muted">{data?.generatedAt ? `Cập nhật ${fmtTime(data.generatedAt)}` : "—"}{refreshing ? " · đang cập nhật" : ""}</span>
                <button
                  type="button"
                  disabled={loading || refreshing || !username}
                  onClick={() => setTick((value) => value + 1)}
                >
                  Làm mới
                </button>
              </div>
            </div>
            <div className="perf-chips perf-chips-inline">
              {chips.map((chip) => (
                <span key={chip.key} className="perf-chip">
                  {chip.label}
                  {chip.clear ? <button type="button" aria-label={`Xóa ${chip.label}`} onClick={() => update(chip.clear)}>×</button> : null}
                </span>
              ))}
              <button type="button" className="ghost" onClick={clearFilters}>Xóa lọc</button>
            </div>
            <p className="muted perf-range-note">
              {data?.rangeLabel || "Kỳ theo UTC"}. Live và Paper không trộn trong một tổng kết.
              {stats?.excludedMissingClose ? ` ${stats.excludedMissingClose} bản ghi thiếu closeTime đã bị loại khi lọc ngày đóng.` : ""}
            </p>
          </header>

          {loading && !data ? (
            <div className="perf-skeleton" aria-busy="true">
              <div className="perf-kpi-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="card skeleton-block" />)}</div>
              <div className="card skeleton-block skeleton-chart" />
            </div>
          ) : null}

          {error ? (
            <div className="card form-error perf-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={() => setTick((value) => value + 1)}>Thử lại</button>
            </div>
          ) : null}

          {!loading && !error && stats && stats.total === 0 ? (
            <div className="card empty">Không có giao dịch khớp bộ lọc. Thử đổi kỳ, sổ Live/Paper hoặc xóa bớt lọc.</div>
          ) : null}

          {stats && stats.total > 0 ? (
            <>
              <div className="perf-kpi-grid">
                <Kpi
                  label="Lãi/lỗ ghi nhận"
                  value={money(stats.profit)}
                  toneClass={tone(stats.profit)}
                  note={`${stats.valid} lệnh có profit hợp lệ`}
                  tip={formulas.pnl || "Tổng profit sau bộ lọc."}
                />
                <Kpi
                  label="Tỷ lệ thắng"
                  value={stats.winRate == null ? "—" : `${fmt(stats.winRate, 1)}%`}
                  note={`${stats.wins}/${stats.losses}/${stats.flats} · mẫu ${stats.valid}`}
                  tip={formulas.winRate}
                />
                <Kpi
                  label="Profit factor"
                  value={stats.profitFactorLabel || (stats.profitFactor == null ? "—" : fmt(stats.profitFactor, 2))}
                  tip={formulas.profitFactor}
                />
                <Kpi
                  label="PnL TB/lệnh"
                  value={money(stats.avgProfit)}
                  toneClass={tone(stats.avgProfit)}
                  tip={formulas.avgProfit}
                />
              </div>

              <div className="perf-analysis">
                <div className="perf-analysis-main">
                  <PnlChart
                    series={data?.series || []}
                    selectedDay={listDay}
                    timeField={data?.timeField}
                    onSelectDay={(day) => update({ listDay: day, page: "1" })}
                  />
                </div>
                <aside className="card perf-insights">
                  <h2>Điểm đáng chú ý</h2>
                  <p className="muted">Nhận xét theo quy tắc — mô tả số liệu, không khuyên tăng vốn.</p>
                  {(data?.insights || []).length === 0 ? <p className="muted">Không đủ điều kiện để tạo nhận xét.</p> : null}
                  <ul>
                    {(data?.insights || []).map((item) => (
                      <li key={item.code}>
                        <strong>{item.title}</strong>
                        <p>{item.text}</p>
                        {item.action?.type === "signal" ? <button type="button" className="ghost" onClick={() => update({ signal: item.action.value })}>Xem signal</button> : null}
                        {item.action?.type === "env" ? <button type="button" className="ghost" onClick={() => update({ env: item.action.value })}>Xem config</button> : null}
                        {item.action?.type === "side" ? <button type="button" className="ghost" onClick={() => update({ side: item.action.value })}>Xem {item.action.value}</button> : null}
                      </li>
                    ))}
                  </ul>
                </aside>
              </div>

              <section className="card perf-groups">
                <div className="perf-tabs" role="tablist" aria-label="Nhóm phân tích">
                  {[
                    ["signal", "Signal"],
                    ["config", "Config"],
                    ["symbol", "Symbol"],
                    ["side", "Long/Short"],
                  ].map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={groupTab === id} className={groupTab === id ? "active" : ""} onClick={() => setGroupTab(id)}>{label}</button>
                  ))}
                </div>
                <GroupTable
                  rows={groupRows.map((row) => ({ ...row, avgProfit: row.valid ? (Number(row.profit) || 0) / row.valid : null }))}
                  nameKey={groupNameKey}
                  nameLabel={groupTab === "config" ? "Config" : groupTab === "symbol" ? "Symbol" : groupTab === "side" ? "Side" : "Signal"}
                  username={username}
                  active={groupTab === "config" ? env : groupTab === "signal" ? signal : groupTab === "side" ? side : q}
                  sortKey={groupSort === "avgProfit" ? "avgProfit" : groupSort}
                  onSort={setGroupSort}
                  onPick={(value) => {
                    if (groupTab === "signal") update({ signal: signal === value ? "" : value });
                    else if (groupTab === "config") update({ env: env === value ? "" : value });
                    else if (groupTab === "side") update({ side: side === value ? "" : value });
                    else update({ q: q === value ? "" : value });
                  }}
                />
              </section>

              <section className="card perf-trades">
                <div className="perf-trades-head">
                  <h2>Danh sách lệnh</h2>
                  <p className="muted">
                    Phân trang phía server · {data?.listTotal ?? data?.total ?? 0} lệnh
                    {listDay ? ` · đang xem ngày đóng ${listDay}` : ""}.
                    Tổng kết phía trên không đổi khi sang trang.
                  </p>
                </div>
                <div className="perf-trades-layout">
                  <div className="table-wrap perf-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Ngày đóng</th>
                          <th>Symbol</th>
                          <th>Signal / Config</th>
                          <th>Side</th>
                          <th className="num">PnL</th>
                          <th className="num">Thời gian giữ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(data?.rows || []).length === 0 ? <tr><td colSpan={6}>{listDay ? "Không có lệnh đóng trong ngày đã chọn." : "Không có lệnh."}</td></tr> : null}
                        {(data?.rows || []).map((row) => (
                          <tr
                            key={row.id}
                            className={trade === row.id ? "trade-row active" : "trade-row"}
                            tabIndex={0}
                            onClick={(event) => {
                              rowTriggerRef.current = event.currentTarget;
                              update({ trade: trade === row.id ? "" : row.id });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                rowTriggerRef.current = event.currentTarget;
                                update({ trade: trade === row.id ? "" : row.id });
                              }
                            }}
                          >
                            <td>{fmtTime(row.closeTime || row.openTime)}</td>
                            <td>{row.symbol}</td>
                            <td>
                              <div className="perf-stack">
                                <span>{row.signal || "—"}</span>
                                <span className="muted">{username}/{row.env}</span>
                              </div>
                            </td>
                            <td>{row.side}</td>
                            <td className={`num ${tone(row.profit)}`}>{money(row.profit)}</td>
                            <td className="num">{holdLabel(row.holdMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {trade ? (
                    <TradePanel
                      row={detail}
                      triggerRef={rowTriggerRef}
                      onClose={() => update({ trade: "" })}
                      configHref={configAllowed && detail?.env ? configTo(detail.env) : ""}
                      historyHref={signalAllowed && detail ? historyTo(detail.signal, detail.env) : ""}
                      ledgerHref={staticAllowed && username ? `/reports?tab=ledger&username=${encodeURIComponent(username)}` : ""}
                    />
                  ) : null}
                </div>
                {(data?.listTotal || data?.total || 0) > (data?.limit || 50) ? (
                  <div className="audit-pagination">
                    <span className="muted">Trang {data.page} · {data.listTotal || data.total} bản ghi</span>
                    <div>
                      <button type="button" className="ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Trước</button>
                      <button type="button" className="ghost" disabled={page * (data.limit || 50) >= (data.listTotal || data.total)} onClick={() => update({ page: String(page + 1) })}>Sau</button>
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {username && staticAllowed ? (
            <p className="muted perf-ledger-link">
              <Link to={`/reports?tab=ledger&username=${encodeURIComponent(username)}`}>Xem hiệu quả vốn tài khoản</Link>
              {" · "}
              {configAllowed ? <Link to={`/config-lab?user=${encodeURIComponent(username)}`}>Mở Config · {username}</Link> : null}
            </p>
          ) : null}
        </div>

        <aside className="perf-side">
          <div className="card perf-filters" aria-label="Bộ lọc">
            <div className="perf-filters-head">
              <strong>Bộ lọc</strong>
              <button type="button" className="ghost" onClick={() => setFiltersOpen((value) => !value)}>
                {filtersOpen ? "Thu gọn" : "Mở rộng"}
              </button>
            </div>
            <div className="perf-filters-main">
              <label>Phạm vi
                <select value={audience} onChange={(e) => {
                  const next = e.target.value;
                  const list = next === "others" ? otherBots : mineBots;
                  setAudience(next);
                  update({ username: list[0]?.username || "", env: "" });
                }}
                >
                  <option value="mine">Của tôi</option>
                  <option value="others">Người khác</option>
                </select>
              </label>
              <label>User
                <select value={username} onChange={(e) => update({ username: e.target.value, env: "" })}>
                  {listedBots.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}
                  {username && !listedBots.some((bot) => bot.username === username) ? <option value={username}>{username}</option> : null}
                </select>
              </label>
              <label>Config
                <select value={env} onChange={(e) => update({ env: e.target.value })}>
                  <option value="">Tất cả config</option>
                  {(selectedBot?.accounts || []).map((name) => <option key={name} value={name}>{username ? `${username} / ${name}` : name}</option>)}
                </select>
              </label>
              <label>Sổ
                <select value={book === "paper" ? "paper" : "live"} onChange={(e) => update({ book: e.target.value })}>
                  <option value="live">Live</option>
                  <option value="paper">Paper</option>
                </select>
              </label>
              <label className="perf-filter-span">Kỳ (UTC)
                <div className="history-range">
                  {RANGE_PRESETS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={range === item.id ? "active" : "ghost"}
                      onClick={() => {
                        if (item.id === "custom") update({ range: "custom", from: from || daysAgoIso(7).slice(0, 10), to: to || new Date().toISOString().slice(0, 10) });
                        else update({ range: item.id, from: "", to: "" });
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </label>
              <label className="perf-filter-span">Signal
                <input
                  value={signalDraft}
                  onChange={(e) => setSignalDraft(e.target.value)}
                  list="perf-signal-list"
                  placeholder="Tìm signal"
                  autoComplete="off"
                />
                <datalist id="perf-signal-list">
                  {(stats?.bySignal || []).map((item) => <option key={item.signal} value={item.signal} />)}
                </datalist>
              </label>
            </div>
            {range === "custom" ? (
              <div className="perf-filters-main">
                <label>Từ ngày UTC<input type="date" value={toDateInput(from)} onChange={(e) => update({ range: "custom", from: e.target.value })} /></label>
                <label>Đến ngày UTC<input type="date" value={toDateInput(to)} onChange={(e) => update({ range: "custom", to: e.target.value })} /></label>
              </div>
            ) : null}
            {filtersOpen ? (
              <div className="perf-filters-main">
                <label>Symbol<input value={q} onChange={(e) => update({ q: e.target.value })} placeholder="BTCUSDT" /></label>
                <label>Long/Short
                  <select value={side} onChange={(e) => update({ side: e.target.value })}>
                    <option value="">Tất cả</option>
                    <option value="LONG">LONG</option>
                    <option value="SHORT">SHORT</option>
                  </select>
                </label>
                <label>Copy
                  <select value={copy} onChange={(e) => update({ copy: e.target.value })}>
                    <option value="">Tất cả</option>
                    <option value="copy">Copy</option>
                    <option value="manual">Không Copy</option>
                  </select>
                </label>
                <label>Kết quả
                  <select value={profit} onChange={(e) => update({ profit: e.target.value })}>
                    <option value="">Tất cả</option>
                    <option value="win">Thắng</option>
                    <option value="loss">Thua</option>
                    <option value="flat">Hòa vốn</option>
                  </select>
                </label>
                <label>Tiêu chí thời gian
                  <select value={timeField} onChange={(e) => update({ time: e.target.value })}>
                    <option value="close">Theo ngày đóng</option>
                    <option value="open">Theo ngày mở</option>
                  </select>
                </label>
                <label>Trạng thái lệnh
                  <select value={closed} onChange={(e) => update({ closed: e.target.value })}>
                    <option value="closed">Đã đóng</option>
                    <option value="">Tất cả</option>
                    <option value="open">Đang mở</option>
                  </select>
                </label>
              </div>
            ) : null}
            {!listedBots.length ? <p className="muted">{audience === "mine" ? "Bạn chưa có user bot đang active." : "Không có user active của người khác."}</p> : null}
          </div>
          {extrasCard}
        </aside>
      </div>
    </div>
  );
}
