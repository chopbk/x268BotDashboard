import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import useDebouncedValue from "../hooks/useDebouncedValue";
import { useAuth } from "../auth";
import { ownsBot } from "../access";
import { useEscape } from "../navigation";

const can = (user, permission) => (user?.permissions || []).includes(permission);
const ALL_USERS = "__all__";
const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_SAMPLE = 20;

function threshold(value, max) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  if (max == null) return number;
  return Math.min(Math.max(0, number), max);
}

function keepGroup(row, rules) {
  if (rules.minWin != null && (Number(row.winRate) || 0) < rules.minWin) return false;
  if (rules.minTrades != null && (Number(row.count) || 0) < rules.minTrades) return false;
  if (rules.minPnl != null && (Number(row.profit) || 0) < rules.minPnl) return false;
  if (rules.gain && !(Number(row.profit) > 0)) return false;
  return true;
}
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
  const rows = series || [];
  const activeDays = rows.filter((row) => (row.trades || 0) > 0 || Number(row.profit)).length;
  const spanDays = rows.length;
  const slim = Math.min(activeDays || spanDays, spanDays) <= 3 || spanDays <= 3;
  const tiny = activeDays <= 1 || spanDays <= 1;
  const width = tiny ? 360 : slim ? 480 : 640;
  const height = tiny ? 100 : slim ? 140 : 220;
  const pad = { top: 12, right: 12, bottom: tiny ? 18 : 28, left: tiny ? 40 : 48 };
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
    <div className={`card perf-chart${slim ? " compact" : ""}${tiny ? " tiny" : ""}`}>
      <div className="perf-chart-head">
        <div>
          <h2>PnL theo ngày đóng (UTC)</h2>
          {activeDays > 1 ? (
            <p className="muted">
              Đường là PnL lũy kế của tập lệnh đang xem, bắt đầu từ 0 — không phải balance/equity tài khoản.
              {timeField === "openTime" ? " Đang lọc theo ngày mở; trục vẫn theo ngày đóng của nhóm lệnh đó." : ""}
            </p>
          ) : (
            <p className="muted">Một ngày trong kỳ — cột = PnL ngày (Account Static).</p>
          )}
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

function GroupTable({ rows, nameKey, nameLabel, username, active, onPick, onPeek, sortKey, onSort, book, showIncome }) {
  const [copied, setCopied] = useState(false);
  const sorted = sortGroups(rows, sortKey);
  const maxAbs = Math.max(1, ...sorted.map((row) => Math.abs(Number(row.profit) || 0)));
  const heads = [
    ["count", "Lệnh"],
    ["winRate", "Win rate"],
    ["profit", "PnL Static"],
    showIncome ? ["income", "Income DB"] : null,
    ["avgProfit", "PnL TB"],
    ["volume", "Volume"],
    ["profitFactor", "PF"],
  ].filter(Boolean);
  const colCount = 3 + heads.length + (onPeek ? 1 : 0);
  const listNames = sorted
    .map((row) => {
      const name = row[nameKey];
      if (name == null || name === "") return "";
      if (nameKey === "env" && (row.username || username)) return `${row.username || username}/${name}`;
      return String(name);
    })
    .filter(Boolean);
  const listText = listNames.join(", ");

  async function copyList() {
    if (!listText) return;
    try {
      await navigator.clipboard.writeText(listText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="perf-group-block">
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
              <th className="num">Thắng/Thua</th>
              {onPeek ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? <tr><td colSpan={colCount}>Không có nhóm đạt bộ lọc kết quả.</td></tr> : null}
            {sorted.map((row) => {
              const name = row[nameKey];
              const pnl = row.profit;
              const width = `${Math.max(4, (Math.abs(Number(pnl) || 0) / maxAbs) * 100)}%`;
              const avg = row.valid ? (Number(row.profit) || 0) / row.valid : null;
              const owner = row.username || username;
              const lowSample = row.lowSample || (Number(row.count) || 0) < LOW_SAMPLE;
              return (
                <tr key={`${nameKey}-${name}-${owner || ""}`} className={active === name ? "trade-row active" : "trade-row"}>
                  <td>
                    <button type="button" className="perf-linkish" onClick={() => onPick(name, row)}>
                      {nameKey === "env" && owner ? `${owner} / ${name}` : name}
                    </button>
                    {owner && nameKey !== "username" && nameKey !== "env" ? (
                      <small className="muted"> · {owner}</small>
                    ) : null}
                    {lowSample ? (
                      <span className="perf-badge" title={`Dưới ${LOW_SAMPLE} lệnh — chỉ đọc số liệu, không khẳng định tốt chỉ vì win rate cao.`}>Ít mẫu</span>
                    ) : null}
                    {book === "paper" ? <span className="perf-badge">Paper</span> : null}
                  </td>
                  <td className="num">{row.count ?? "—"}</td>
                  <td className="num">
                    {row.winRate == null ? "—" : `${fmt(row.winRate, 1)}%`}
                    <small className="muted"> · {row.count ?? 0} lệnh</small>
                  </td>
                  <td className="num">
                    <div className="perf-barcell">
                      <span className={tone(pnl)}>{money(pnl)}</span>
                      <span className={`perf-inlinebar ${tone(pnl)}`} style={{ width }} />
                    </div>
                  </td>
                  {showIncome ? <td className={`num ${tone(row.income)}`}>{money(row.income)}</td> : null}
                  <td className="num">{money(avg)}</td>
                  <td className="num">{row.volume == null ? "—" : money(row.volume)}</td>
                  <td className="num">{row.profitFactorLabel || (row.profitFactor == null ? "—" : fmt(row.profitFactor, 2))}</td>
                  <td className="num">{row.wins ?? 0}/{row.losses ?? 0}</td>
                  {onPeek ? (
                    <td>
                      <button type="button" className="ghost" onClick={(event) => { event.stopPropagation(); onPeek(name, row); }}>Xem</button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {listNames.length ? (
        <div className="perf-group-copy">
          <div className="perf-group-copy-head">
            <p className="muted">
              Danh sách {nameLabel.toLowerCase()} theo thứ tự bảng ({listNames.length})
              {nameKey === "signal" ? " — chép dán vào signals của bot" : ""}.
            </p>
            <button type="button" className="ghost" onClick={copyList} disabled={!listText}>
              {copied ? "Đã chép" : "Chép danh sách"}
            </button>
          </div>
          <textarea
            className="perf-group-copy-text"
            readOnly
            rows={Math.min(5, Math.max(2, Math.ceil(listText.length / 72)))}
            value={listText}
            onFocus={(event) => event.target.select()}
            aria-label={`Danh sách ${nameLabel} theo thứ tự bảng`}
          />
        </div>
      ) : null}
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
  const [groupTab, setGroupTab] = useState("user");
  const [groupSort, setGroupSort] = useState("profit");
  const [error, setError] = useState("");
  const [refreshNote, setRefreshNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [signalDraft, setSignalDraft] = useState("");
  const [tick, setTick] = useState(0);
  const [peek, setPeek] = useState(null);
  const [peekConfig, setPeekConfig] = useState(null);
  const [peekLoading, setPeekLoading] = useState(false);
  const [peekError, setPeekError] = useState("");
  const rowTriggerRef = useRef(null);
  const requestIdRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const username = params.get("username") || "";
  const allUsers = username === ALL_USERS;
  const env = params.get("env") || "";
  const q = params.get("q") || "";
  const side = params.get("side") || "";
  const signal = params.get("signal") || "";
  const status = params.get("status") || "";
  const profit = params.get("profit") || "";
  const book = params.get("book") === "paper" ? "paper" : "live";
  const copy = params.get("copy") || "";
  const closed = params.get("closed") || "closed";
  const timeField = params.get("time") === "open" ? "open" : "close";
  const range = params.get("range") || "today";
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const listDay = params.get("listDay") || "";
  const trade = params.get("trade") || "";
  const tradeUser = params.get("tradeUser") || "";
  const scopeParam = params.get("scope") || "";
  const minWinText = params.get("minWin") || "";
  const minTradesText = params.get("minTrades") || "";
  const minPnlText = params.get("minPnl") || "";
  const gain = params.get("gain") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  useEscape(Boolean(peek), () => setPeek(null));
  const debouncedQ = useDebouncedValue(q);
  const debouncedSignal = useDebouncedValue(signalDraft);

  const mineBots = useMemo(() => bots.filter((bot) => ownsBot(user, bot)), [bots, user]);
  const otherBots = useMemo(
    () => bots.filter((bot) => !ownsBot(user, bot) && (user?.role === "admin" || (bot.visibility || "public") !== "private")),
    [bots, user]
  );
  const listedBots = audience === "others" ? otherBots : mineBots;
  const selectedBot = useMemo(() => (allUsers ? null : bots.find((bot) => bot.username === username)), [bots, username, allUsers]);
  const configOptions = useMemo(() => {
    if (!allUsers) {
      return (selectedBot?.accounts || []).map((name) => ({ env: name, label: username ? `${username} / ${name}` : name }));
    }
    return listedBots.flatMap((bot) => (bot.accounts || []).map((name) => ({ env: name, label: `${bot.username} / ${name}` })));
  }, [allUsers, listedBots, selectedBot, username]);
  const audienceScope = audience === "others" ? "others" : "mine";

  function update(values, { replace = false } = {}) {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => {
      if (value === "" || value == null || value === false) next.delete(key);
      else next.set(key, String(value));
    });
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
      status: "",
      profit: "",
      book: "live",
      copy: "",
      closed: "closed",
      time: "close",
      range: "today",
      from: "",
      to: "",
      listDay: "",
      trade: "",
      tradeUser: "",
      minWin: "",
      minTrades: "",
      minPnl: "",
      gain: "",
      page: "1",
    });
    setSignalDraft("");
  }

  async function softRefresh() {
    if (loading || refreshing || !username) return;
    setRefreshing(true);
    setError("");
    setRefreshNote("");
    try {
      if (book === "live") {
        if (allUsers) {
          const result = await api("/api/account-ledger/refresh-all", {
            method: "POST",
            body: {
              days: "today",
              others: audience === "others" ? true : undefined,
            },
          });
          const ok = result?.refresh?.ok?.length || 0;
          const failed = result?.refresh?.failed || [];
          if (failed.length && !ok) {
            setRefreshNote(failed.map((row) => `${row.username}: ${row.message}`).join(" · "));
          } else if (failed.length) {
            setRefreshNote(`Income hôm nay: ${ok} ví ok · lỗi ${failed.map((row) => row.username).join(", ")}`);
          } else if (ok) {
            setRefreshNote(`Đã kéo income sàn hôm nay cho ${ok} ví`);
          }
        } else {
          await api(`/api/account-ledger/${encodeURIComponent(username)}/refresh`, {
            method: "POST",
            body: { days: "today" },
          });
          setRefreshNote("Đã kéo income sàn hôm nay · đang tải lại lệnh Static");
        }
      }
    } catch (err) {
      setRefreshNote(err.message || "Không kéo được income sàn; vẫn tải lại lệnh từ DB");
    }
    setTick((value) => value + 1);
  }

  function openConfigPeek(targetEnv, rowUser) {
    const owner = rowUser || (!allUsers ? username : "");
    if (!owner || !targetEnv || !configAllowed) return;
    setPeek({ username: owner, env: targetEnv });
    setPeekConfig(null);
    setPeekError("");
  }

  useEffect(() => {
    let cancelled = false;
    loadActiveBots().then((nextBots) => {
      if (cancelled) return;
      setBots(nextBots);
      const mine = nextBots.filter((bot) => ownsBot(user, bot));
      const others = nextBots.filter((bot) => !ownsBot(user, bot) && (user?.role === "admin" || (bot.visibility || "public") !== "private"));
      const current = username;
      const isAll = current === ALL_USERS;
      const inMine = mine.some((bot) => bot.username === current);
      const inOthers = others.some((bot) => bot.username === current);
      if (isAll && scopeParam === "others") setAudience("others");
      else if (current && inOthers && !inMine) setAudience("others");
      else if (!current || (!isAll && !inMine && !inOthers)) {
        update({
          username: ALL_USERS,
          scope: "mine",
          env: "",
          book: "live",
          range: "today",
          time: "close",
          closed: "closed",
          analytics: "1",
        }, { replace: true });
        setGroupTab("user");
      } else if (
        !params.get("analytics")
        || (onReports ? params.get("tab") !== "performance" : params.get("view") !== "performance")
        || (isAll && !scopeParam)
        || !params.get("range")
      ) {
        update({
          book: params.get("book") || "live",
          range: params.get("range") || (params.get("from") ? "custom" : "today"),
          time: params.get("time") || "close",
          closed: params.get("closed") || "closed",
          scope: isAll ? (scopeParam || "mine") : "",
          analytics: "1",
        }, { replace: true });
        if (isAll) setGroupTab("user");
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
      time: timeField,
      range: range === "custom" ? "custom" : range,
    });
    if (closed && closed !== "all") query.set("closed", closed);
    if (allUsers) query.set("scope", scopeParam || audienceScope);
    if (range === "custom") {
      if (from) query.set("from", from);
      if (to) query.set("to", to);
    }
    if (env) query.set("env", env);
    if (debouncedQ) query.set("q", debouncedQ);
    if (side) query.set("side", side);
    if (signal) query.set("signal", signal);
    if (status) query.set("status", status);
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
  }, [username, allUsers, audienceScope, scopeParam, env, debouncedQ, side, signal, status, profit, book, copy, closed, timeField, range, from, to, page, listDay, tick]);

  useEffect(() => {
    if (!peek?.username || !peek?.env || !configAllowed) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setPeekLoading(true);
    setPeekError("");
    api(`/api/bots/${encodeURIComponent(peek.username)}/configs/${encodeURIComponent(peek.env)}`, { signal: controller.signal })
      .then((result) => {
        if (!cancelled) setPeekConfig(result.config || null);
      })
      .catch((err) => {
        if (!cancelled && err.name !== "AbortError") {
          setPeekConfig(null);
          setPeekError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setPeekLoading(false);
      });
    return () => { cancelled = true; controller.abort(); };
  }, [peek, configAllowed]);

  useEffect(() => {
    const detailUser = tradeUser || (!allUsers ? username : "");
    if (!trade || !detailUser) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    api(`/api/account-statics/${encodeURIComponent(trade)}?username=${encodeURIComponent(detailUser)}`, { signal: controller.signal }).then((row) => {
      if (!cancelled) setDetail(row);
    }).catch((err) => {
      if (!cancelled) {
        setDetail(null);
        setError(err.message);
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [trade, tradeUser, username, allUsers]);

  function historyTo(rowSignal, rowEnv, rowUser) {
    const owner = rowUser || tradeUser || (!allUsers ? username : "");
    const query = new URLSearchParams({ tab: "history" });
    if (owner) query.set("fromUser", owner);
    const targetEnv = rowEnv || env;
    if (targetEnv) query.set("fromEnv", targetEnv);
    if (rowSignal) query.set("signal", rowSignal);
    if (data?.from) query.set("from", new Date(data.from).toISOString());
    if (data?.to) query.set("to", new Date(data.to).toISOString());
    return `/signal-search?${query}`;
  }

  function configTo(rowEnv, rowUser) {
    const owner = rowUser || tradeUser || (!allUsers ? username : "");
    if (!owner || !rowEnv) return "";
    return `/config-lab/${encodeURIComponent(owner)}/${encodeURIComponent(rowEnv)}`;
  }

  const groupRules = useMemo(() => ({
    minWin: threshold(minWinText, 100),
    minTrades: threshold(minTradesText),
    minPnl: threshold(minPnlText),
    gain: gain === "1",
  }), [minWinText, minTradesText, minPnlText, gain]);

  const chips = [
    username ? {
      key: "user",
      label: allUsers
        ? `Tất cả user · ${audience === "others" ? "người khác" : "của tôi"} (${(data?.usernames || listedBots.map((bot) => bot.username)).length})`
        : `User ${username}`,
      clear: null,
    } : null,
    { key: "book", label: book === "paper" ? "Paper" : "Live", clear: null },
    env ? { key: "env", label: `Config ${env}`, clear: { env: "" } } : null,
    signal ? { key: "signal", label: `Signal ${signal}`, clear: { signal: "" } } : null,
    q ? { key: "q", label: `Symbol ${q}`, clear: { q: "" } } : null,
    side ? { key: "side", label: side, clear: { side: "" } } : null,
    status ? { key: "status", label: `Status ${status}`, clear: { status: "" } } : null,
    copy === "copy" ? { key: "copy", label: "Copy", clear: { copy: "" } } : null,
    copy === "manual" ? { key: "manual", label: "Không Copy", clear: { copy: "" } } : null,
    profit === "win" ? { key: "profit", label: "Thắng", clear: { profit: "" } } : null,
    profit === "loss" ? { key: "profit", label: "Thua", clear: { profit: "" } } : null,
    profit === "flat" ? { key: "profit", label: "Hòa vốn", clear: { profit: "" } } : null,
    timeField === "open" ? { key: "time", label: "Theo ngày mở", clear: { time: "close" } } : { key: "time", label: "Theo ngày đóng", clear: null },
    listDay ? { key: "listDay", label: `Đang xem lệnh đóng ngày ${listDay}`, clear: { listDay: "" } } : null,
    groupRules.minWin != null ? { key: "minWin", label: `WR nhóm ≥ ${groupRules.minWin}%`, clear: { minWin: "" } } : null,
    groupRules.minTrades != null ? { key: "minTrades", label: `≥ ${groupRules.minTrades} lệnh/nhóm`, clear: { minTrades: "" } } : null,
    groupRules.minPnl != null ? { key: "minPnl", label: `PnL nhóm ≥ ${groupRules.minPnl}`, clear: { minPnl: "" } } : null,
    groupRules.gain ? { key: "gain", label: "Chỉ nhóm đang lãi", clear: { gain: "" } } : null,
  ].filter(Boolean);

  const stats = data?.stats;
  const { rawGroupRows, groupRows } = useMemo(() => {
    const raw = groupTab === "user" ? (stats?.byUser || [])
      : groupTab === "config" ? (stats?.byConfig || [])
        : groupTab === "symbol" ? (stats?.bySymbol || [])
          : groupTab === "side" ? (stats?.bySide || [])
            : (stats?.bySignal || []);
    return { rawGroupRows: raw, groupRows: raw.filter((row) => keepGroup(row, groupRules)) };
  }, [groupTab, stats, groupRules]);
  const groupNameKey = groupTab === "user" ? "username"
    : groupTab === "config" ? "env"
      : groupTab === "symbol" ? "symbol"
        : groupTab === "side" ? "side"
          : "signal";
  const formulas = data?.formulas || {};
  const resultFilterNote = [
    groupRules.minWin != null ? `WR ≥ ${groupRules.minWin}%` : "",
    groupRules.minTrades != null ? `≥ ${groupRules.minTrades} lệnh` : "",
    groupRules.minPnl != null ? `PnL ≥ ${groupRules.minPnl}` : "",
    groupRules.gain ? "đang lãi" : "",
  ].filter(Boolean).join(", ");

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
                  Phân tích kết quả theo signal, cấu hình và từng lệnh · sổ <strong>{book === "paper" ? "Paper" : "Live"}</strong> theo cờ <code>isPaper</code>.
                  Theo {timeField === "open" ? "thời gian mở lệnh" : "thời gian đóng lệnh"} (UTC).
                  PnL = field profit bot đã lưu trên Account Static
                  {book === "paper"
                    ? " · Paper: profit/cost mô phỏng theo bot; phí sàn / funding / nạp-rút: Chưa tính (không coi là 0)."
                    : " · Live: phí/funding theo cách bot ghi vào profit (xem chi tiết lệnh)."}
                </p>
              </div>
              <div className="perf-head-actions">
                <span className="muted">{data?.generatedAt ? `Cập nhật ${fmtTime(data.generatedAt)}` : "—"}{refreshing ? " · đang cập nhật" : ""}</span>
                <button
                  type="button"
                  disabled={loading || refreshing || !username}
                  onClick={softRefresh}
                  title={book === "live"
                    ? "Kéo income sàn hôm nay (UTC) rồi tải lại lệnh Account Static từ DB"
                    : "Tải lại lệnh Paper từ DB"}
                >
                  Làm mới
                </button>
                {allUsers ? (
                  <span className="muted" title="Gộp lệnh của mọi user trong phạm vi đang chọn; không đổi công thức từng user.">
                    Đang xem tổng hợp nhiều user
                  </span>
                ) : null}
              </div>
            </div>
            {refreshNote ? <p className="muted perf-range-note">{refreshNote}</p> : null}
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
              {data?.rangeLabel || "Kỳ theo UTC"}. Không trộn Live và Paper trong KPI hoặc xếp hạng.
              Bộ lọc kết quả nhóm (WR/số lệnh/PnL) chỉ thu hẹp bảng phân tích — không đổi KPI tổng phía trên.
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
                    allUsers ? ["user", "Tài khoản"] : null,
                    ["signal", "Signal"],
                    ["config", "Config"],
                    ["symbol", "Symbol"],
                    ["side", "Long/Short"],
                  ].filter(Boolean).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={groupTab === id} className={groupTab === id ? "active" : ""} onClick={() => setGroupTab(id)}>{label}</button>
                  ))}
                </div>
                <p className="muted">
                  {groupRows.length}/{rawGroupRows.length} nhóm
                  {resultFilterNote ? ` · lọc kết quả: ${resultFilterNote}` : " · chưa lọc kết quả nhóm"}.
                  Bấm một nhóm để lọc danh sách lệnh (giữ sổ {book === "paper" ? "Paper" : "Live"} và kỳ hiện tại).
                  {(groupTab === "user" || groupTab === "config")
                    ? " PnL Static = profit lệnh account_statics; Income DB = trading income futures_profits (gần /i) cùng kỳ UTC."
                    : ""}
                </p>
                <GroupTable
                  rows={groupRows.map((row) => ({ ...row, avgProfit: row.valid ? (Number(row.profit) || 0) / row.valid : null }))}
                  nameKey={groupNameKey}
                  nameLabel={groupTab === "user" ? "Tài khoản" : groupTab === "config" ? "Config" : groupTab === "symbol" ? "Symbol" : groupTab === "side" ? "Side" : "Signal"}
                  username={allUsers ? "" : username}
                  book={book}
                  showIncome={groupTab === "user" || groupTab === "config"}
                  active={groupTab === "config" ? env : groupTab === "signal" ? signal : groupTab === "side" ? side : groupTab === "user" ? "" : q}
                  sortKey={groupSort === "avgProfit" || groupSort === "volume" || groupSort === "income" ? groupSort : groupSort}
                  onSort={setGroupSort}
                  onPeek={groupTab === "config" && configAllowed
                    ? (value, row) => openConfigPeek(value, row?.username)
                    : null}
                  onPick={(value) => {
                    if (groupTab === "user") update({ username: value, scope: "", env: "", trade: "", tradeUser: "" });
                    else if (groupTab === "signal") update({ signal: signal === value ? "" : value });
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
                        {(data?.rows || []).map((row) => {
                          const owner = row.username || (!allUsers ? username : "");
                          return (
                          <tr
                            key={row.id}
                            className={trade === row.id ? "trade-row active" : "trade-row"}
                            tabIndex={0}
                            onClick={(event) => {
                              rowTriggerRef.current = event.currentTarget;
                              update({
                                trade: trade === row.id ? "" : row.id,
                                tradeUser: trade === row.id ? "" : owner,
                              });
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                rowTriggerRef.current = event.currentTarget;
                                update({
                                  trade: trade === row.id ? "" : row.id,
                                  tradeUser: trade === row.id ? "" : owner,
                                });
                              }
                            }}
                          >
                            <td>{fmtTime(row.closeTime || row.openTime)}</td>
                            <td>{row.symbol}</td>
                            <td>
                              <div className="perf-stack">
                                <span>{row.signal || "—"}</span>
                                <span className="muted">{owner || "?"}/{row.env}</span>
                              </div>
                            </td>
                            <td>{row.side}</td>
                            <td className={`num ${tone(row.profit)}`}>{money(row.profit)}</td>
                            <td className="num">{holdLabel(row.holdMs)}</td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {trade ? (
                    <TradePanel
                      row={detail}
                      triggerRef={rowTriggerRef}
                      onClose={() => update({ trade: "", tradeUser: "" })}
                      configHref={configAllowed && detail?.env ? configTo(detail.env, tradeUser || detail.username) : ""}
                      historyHref={signalAllowed && detail ? historyTo(detail.signal, detail.env, tradeUser || detail.username) : ""}
                      ledgerHref={staticAllowed && book !== "paper" && (tradeUser || (!allUsers && username))
                        ? `/reports?tab=ledger&book=live&username=${encodeURIComponent(tradeUser || username)}`
                        : ""}
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
              {book === "paper" ? (
                <Link to={`/reports?tab=ledger&book=paper${allUsers ? "&username=__all__" : username ? `&username=${encodeURIComponent(username)}` : ""}`}>
                  Ví & dòng tiền (Paper chưa hỗ trợ)
                </Link>
              ) : (
                <Link to={allUsers ? "/reports?tab=ledger&book=live&username=__all__" : `/reports?tab=ledger&book=live&username=${encodeURIComponent(username)}`}>
                  {allUsers ? "Xem Ví & dòng tiền (Tất cả)" : "Xem hiệu quả vốn tài khoản"}
                </Link>
              )}
              {!allUsers && configAllowed ? (
                <>
                  {" · "}
                  <Link to={`/config-lab?user=${encodeURIComponent(username)}`}>Mở Config · {username}</Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>

        <aside className="perf-side">
          <div className="card perf-filters" aria-label="Bộ lọc dữ liệu">
            <div className="perf-filters-head">
              <strong>Bộ lọc dữ liệu</strong>
              <button type="button" className="ghost" onClick={() => setFiltersOpen((value) => !value)}>
                {filtersOpen ? "Thu gọn" : "Mở rộng"}
              </button>
            </div>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: "0.78rem" }}>Chọn lệnh trước khi tính KPI/thống kê. Sổ theo cờ isPaper.</p>
            <div className="perf-filters-main">
              <label>Chế độ sổ
                <select value={book} onChange={(e) => update({ book: e.target.value, listDay: "", trade: "", tradeUser: "" })}>
                  <option value="live">Live</option>
                  <option value="paper">Paper</option>
                </select>
              </label>
              <label>Phạm vi
                <select value={audience} onChange={(e) => {
                  const next = e.target.value;
                  const list = next === "others" ? otherBots : mineBots;
                  setAudience(next);
                  if (allUsers) {
                    update({ username: ALL_USERS, scope: next === "others" ? "others" : "mine", env: "", trade: "", tradeUser: "" });
                  } else {
                    update({ username: list[0]?.username || ALL_USERS, scope: "", env: "", trade: "", tradeUser: "" });
                  }
                }}
                >
                  <option value="mine">Của tôi</option>
                  <option value="others">Người khác</option>
                </select>
              </label>
              <label>User / tài khoản
                <select
                  value={username}
                  onChange={(e) => {
                    const next = e.target.value;
                    update({
                      username: next,
                      scope: next === ALL_USERS ? audienceScope : "",
                      env: "",
                      trade: "",
                      tradeUser: "",
                    });
                    if (next === ALL_USERS) setGroupTab("user");
                    else if (groupTab === "user") setGroupTab("signal");
                  }}
                >
                  <option value={ALL_USERS}>Tất cả</option>
                  {listedBots.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}
                  {username && username !== ALL_USERS && !listedBots.some((bot) => bot.username === username) ? <option value={username}>{username}</option> : null}
                </select>
              </label>
              <label>Config
                <select value={env} onChange={(e) => update({ env: e.target.value })}>
                  <option value="">Tất cả config</option>
                  {configOptions.map((item) => <option key={`${item.label}-${item.env}`} value={item.env}>{item.label}</option>)}
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
                <label>Status
                  <select value={status} onChange={(e) => update({ status: e.target.value })}>
                    <option value="">Tất cả</option>
                    <option value="WIN">WIN</option>
                    <option value="LOSS">LOSS</option>
                    {(stats?.byStatus || []).filter((item) => item.status && item.status !== "WIN" && item.status !== "LOSS").map((item) => (
                      <option key={item.status} value={item.status}>{item.status}</option>
                    ))}
                  </select>
                </label>
                <label>Copy
                  <select value={copy} onChange={(e) => update({ copy: e.target.value })}>
                    <option value="">Tất cả</option>
                    <option value="copy">Copy</option>
                    <option value="manual">Không Copy</option>
                  </select>
                </label>
                <label>Kết quả lệnh
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
                <label>Đóng lệnh
                  <select value={closed === "all" ? "all" : closed || "closed"} onChange={(e) => update({ closed: e.target.value })}>
                    <option value="closed">Đã đóng</option>
                    <option value="all">Tất cả</option>
                    <option value="open">Đang mở</option>
                  </select>
                </label>
              </div>
            ) : null}
            {!listedBots.length ? <p className="muted">{audience === "mine" ? "Bạn chưa có user bot đang active." : "Không có user active của người khác."}</p> : null}
          </div>

          <div className="card perf-filters" aria-label="Bộ lọc kết quả nhóm">
            <div className="perf-filters-head">
              <strong>Bộ lọc kết quả nhóm</strong>
            </div>
            <p className="muted" style={{ margin: "0 0 8px", fontSize: "0.78rem" }}>
              Lọc sau khi đã tính thống kê. Không đổi KPI tổng của tập lệnh.
            </p>
            <div className="perf-filters-main">
              <label>Win rate từ %
                <input type="number" min="0" max="100" step="1" value={minWinText} placeholder="60" onChange={(e) => update({ minWin: e.target.value })} />
              </label>
              <label>Số lệnh từ
                <input type="number" min="1" step="1" value={minTradesText} placeholder="10" onChange={(e) => update({ minTrades: e.target.value })} />
              </label>
              <label>PnL từ
                <input type="number" step="1" value={minPnlText} placeholder="0" onChange={(e) => update({ minPnl: e.target.value })} />
              </label>
              <label>Nhóm lãi
                <select value={gain} onChange={(e) => update({ gain: e.target.value })}>
                  <option value="">Tất cả</option>
                  <option value="1">Chỉ đang lãi</option>
                </select>
              </label>
            </div>
          </div>
          {extrasCard}
        </aside>
      </div>

      {peek ? (
        <div className="modal-backdrop" onClick={() => setPeek(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="page-head">
              <div>
                <h2>Config {peek.username}/{peek.env}</h2>
                <p className="muted">Chỉ xem/copy cấu hình — không áp dụng hay bật giao dịch live.</p>
              </div>
              <button type="button" className="ghost" onClick={() => setPeek(null)}>Đóng</button>
            </header>
            {peekLoading ? <p className="muted">Đang tải…</p> : null}
            {peekError ? <p className="form-error">{peekError}</p> : null}
            {peekConfig ? (
              <pre className="dash-data" style={{ maxHeight: 360, overflow: "auto" }}>{JSON.stringify(peekConfig, null, 2)}</pre>
            ) : null}
            <div className="row-actions">
              {configAllowed ? <Link className="trail-link" to={configTo(peek.env, peek.username)}>Mở Config Lab</Link> : null}
              <button type="button" className="ghost" onClick={() => setPeek(null)}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
