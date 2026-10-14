import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import useDebouncedValue from "../hooks/useDebouncedValue";
import { useAuth } from "../auth";
import { ownsBot } from "../access";
import { useEscape } from "../navigation";

const can = (user, permission) => (user?.permissions || []).includes(permission);
const fmtTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const fmt = (value, digits = 2) => value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);
const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_PRESETS = [
  { id: "today", label: "Hôm nay" },
  { id: "1", label: "1 ngày" },
  { id: "3", label: "3 ngày" },
  { id: "7", label: "7 ngày" },
  { id: "30", label: "30 ngày" },
  { id: "90", label: "90 ngày" },
];

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function applyDatePick(currentIso, localValue) {
  if (!localValue) return "";
  const next = new Date(localValue);
  if (Number.isNaN(next.getTime())) return "";
  const prev = currentIso ? new Date(currentIso) : null;
  const sameDay = prev && !Number.isNaN(prev.getTime())
    && prev.getFullYear() === next.getFullYear()
    && prev.getMonth() === next.getMonth()
    && prev.getDate() === next.getDate();
  if (!sameDay) next.setHours(0, 0, 0, 0);
  else next.setMinutes(0, 0, 0);
  return next.toISOString();
}

function activeRangeId(fromIso, toIso) {
  if (toIso) return "custom";
  if (!fromIso) return "";
  const fromMs = new Date(fromIso).getTime();
  if (Number.isNaN(fromMs)) return "custom";
  if (Math.abs(fromMs - new Date(startOfToday()).getTime()) < 2 * 60 * 1000) return "today";
  for (const days of [1, 3, 7, 30, 90]) {
    if (Math.abs(fromMs - (Date.now() - days * DAY_MS)) < 5 * 60 * 1000) return String(days);
  }
  return "custom";
}

function rangeFromPreset(id) {
  if (id === "today") return { from: startOfToday(), to: "" };
  const days = Number(id);
  if (Number.isFinite(days) && days > 0) return { from: daysAgo(days), to: "" };
  return null;
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

function DetailItem({ label, value }) {
  return <div><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

function yesNo(value) {
  return value ? "Bật" : "Tắt";
}

function show(value) {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

function objectText(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const keys = Object.keys(value);
  if (!keys.length) return "—";
  return keys.map((key) => `${key}: ${show(value[key])}`).join(", ");
}

function volumeHint(config) {
  if (config.mode === "RATIO") return `RATIO lấy cost theo ratio ${show(config.ratio)} của ví.`;
  if (config.mode === "RISK") return `RISK size theo risk ${show(config.risk)}.`;
  if (config.mode === "LOSS" || config.mode === "RR") return `${config.mode} size để khi chạm SL thì lỗ khoảng ${show(config.fixloss)}$.`;
  return `FIX: volume = cost ${show(config.cost)} × đòn bẩy long ${show(config.leverage)} = ${config.volume == null ? "—" : `${fmt(config.volume, 0)}$`}.`;
}

function Glance({ title, note, items }) {
  return (
    <section>
      <h3>{title}</h3>
      {note ? <p className="muted mode-note">{note}</p> : null}
      <dl>
        {items.map(([label, value]) => <DetailItem key={label} label={label} value={value} />)}
      </dl>
    </section>
  );
}

function ConfigGlance({ config }) {
  return (
    <div className="config-glance">
      <Glance title="Bật tắt" items={[
        ["On", yesNo(config.on)],
        ["Long", yesNo(config.long)],
        ["Short", yesNo(config.short)],
        ["Invert", yesNo(config.invert)],
        ["Paper", yesNo(config.paper)],
        ["Monitor", yesNo(config.monitor)],
        ["Whitelist mode", yesNo(config.wl)],
        ["Auto config", yesNo(config.autoConfig)],
        ["Report profit", yesNo(config.reportProfit)],
      ]} />
      <Glance title="Danh sách" items={[
        ["Signal", show(config.signals)],
        ["Blacklist", show(config.blacklist)],
        ["Whitelist", show(config.whitelist)],
      ]} />
      <Glance title="Volume" note={volumeHint(config)} items={[
        ["Mode", show(config.mode)],
        ["Cost ($)", show(config.cost)],
        ["Đòn bẩy long", show(config.leverage)],
        ["Đòn bẩy short", show(config.shortLeverage)],
        ["Level", show(config.level)],
        ["Ratio", show(config.ratio)],
        ["Fix loss ($)", show(config.fixloss)],
        ["Volume ($)", config.volume == null ? "—" : fmt(config.volume, 0)],
      ]} />
      <Glance title="Mở lệnh" items={[
        ["Open type", show(config.openType)],
        ["Spread", show(config.spread)],
        ["Wait (phút)", show(config.wait)],
        ["Risk", show(config.risk)],
        ["Mark", show(config.mark)],
        ["Max position", show(config.maxPosition)],
        ["Symbol types", show(config.symbolTypes)],
        ["Symbol types deny", show(config.symbolTypesDeny)],
        ["Filter", yesNo(config.filterOn)],
        ["Filters", show(config.filters)],
        ["Chase %", show(config.chasePct)],
        ["Blow ATR", show(config.blowAtr)],
        ["Fomo ATR", show(config.fomoAtr)],
      ]} />
      <Glance title="Chốt lời" note={config.tpType === "FIX" ? "FIX: số TP là tỷ lệ lãi. 0.2 = 20%." : config.tpType === "ATR" || config.tpType === "ROSE" ? `${config.tpType}: số TP là số lần ATR.` : null} items={[
        ["TP type", show(config.tpType)],
        ["TP percent", show(config.tpPercent)],
        ["Close", show(config.tpClose)],
        ["TP time (giây)", show(config.tpTime)],
        ["Hold", yesNo(config.tpHold)],
        ["TP hybrid", objectText(config.tpHybrid)],
      ]} />
      <Glance title="Cắt lỗ" items={[
        ["SL type", show(config.slType)],
        ["SL candle", show(config.slCandle)],
        ["Period", show(config.slPeriod)],
        ["SL", show(config.sl)],
        ["SLI", show(config.sli)],
        ["SL2", show(config.sl2)],
        ["SL time (giây)", show(config.slTime)],
        ["Max loss", show(config.maxLoss)],
        ["SL theo position", yesNo(config.slPosition)],
        ["SL hybrid", objectText(config.slHybrid)],
      ]} />
      <Glance title="Trailing" note={config.trailing ? "Bật thì dời SL theo lời. SP là khoảng cách, Trigger là ngưỡng bắt đầu gồng." : "Trailing đang tắt."} items={[
        ["Trailing", yesNo(config.trailing)],
        ["Type", show(config.trailingType)],
        ["SP", show(config.sp)],
        ["Trigger", show(config.trigger)],
        ["R", show(config.r)],
        ["HP", yesNo(config.hp)],
        ["HP trigger", show(config.hpTrigger)],
        ["RHSL", show(config.rhsl)],
        ["RH", show(config.rh)],
      ]} />
      <Glance title="Copy" items={[
        ["Copy", yesNo(config.copy)],
        ["Fix cost", yesNo(config.copyFix)],
        ["DCA", yesNo(config.copyDca)],
        ["Follow", yesNo(config.copyFollow)],
        ["Max volume ($)", show(config.maxVolume)],
        ["Rate", show(config.copyRate)],
      ]} />
    </div>
  );
}

function digitsFor(preferred, sample, fallback) {
  if (Number.isInteger(preferred) && preferred >= 0) return preferred;
  const amount = Math.abs(Number(sample));
  if (!Number.isFinite(amount) || amount === 0 || amount >= 1) return fallback;
  return Math.min(12, Math.max(fallback, Math.ceil(-Math.log10(amount)) + 2));
}

function fmtPrice(value, row) {
  return fmt(value, digitsFor(row.symbolInfo?.priceDecimals, value, 2));
}

function sortRows(rows, key) {
  return [...(rows || [])].sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0) || (b.profit || 0) - (a.profit || 0));
}

function threshold(value, max) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return max == null ? number : Math.min(number, max);
}

function keepGroup(row, rules) {
  if (rules.minWin != null && (Number(row.winRate) || 0) < rules.minWin) return false;
  if (rules.minTrades != null && (Number(row.count) || 0) < rules.minTrades) return false;
  if (rules.gain && !(Number(row.profit) > 0)) return false;
  return true;
}

function CompareTable({ title, note, rows, nameKey, nameLabel, active, onPick, onPeek, sortKey, onSort }) {
  const sorted = sortRows(rows, sortKey);
  const heads = [
    ["count", "Lệnh"],
    ["winRate", "Win rate"],
    ["profit", "Profit"],
    ["avgRoi", "ROI / cost"],
    ["volume", "Volume"],
  ];
  return (
    <div className="compare-block">
      <h2 className="summary-section-title">{title}</h2>
      {note ? <p className="muted">{note}</p> : null}
      <div className="table-wrap signal-table">
        <table>
          <thead>
            <tr>
              <th>{nameLabel}</th>
              {heads.map(([key, label]) => (
                <th key={key}>
                  <button type="button" className={sortKey === key ? "th-sort active" : "th-sort"} onClick={() => onSort(key)}>{label}</button>
                </th>
              ))}
              <th>Long</th>
              <th>Short</th>
              <th>Max lãi</th>
              <th>Max lỗ</th>
              <th>ROE thắng / thua</th>
              {onPeek ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? <tr><td colSpan={onPeek ? 12 : 11}>Không có dòng đạt bộ lọc.</td></tr> : null}
            {sorted.map((row) => (
              <tr key={row[nameKey]} className={active === row[nameKey] ? "trade-row active" : "trade-row"} tabIndex={0} onClick={() => onPick(row[nameKey])} onKeyDown={(event) => { if (event.key === "Enter") onPick(row[nameKey]); }}>
                <td>{row[nameKey]}</td>
                <td>{row.wins}/{row.count}</td>
                <td>{fmt(row.winRate, 1)}%</td>
                <td>{fmt(row.profit)}$</td>
                <td>{fmt(row.avgRoi, 1)}%</td>
                <td>{fmt(row.volume)}$</td>
                <td>{row.longCount} · {fmt(row.longProfit)}$</td>
                <td>{row.shortCount} · {fmt(row.shortProfit)}$</td>
                <td>{fmt(row.maxProfit)}$</td>
                <td>{fmt(row.minProfit)}$</td>
                <td>{fmt(row.avgWinRoe, 1)}% / {fmt(row.avgLossRoe, 1)}%</td>
                {onPeek ? (
                  <td>
                    <button type="button" className="ghost" onClick={(event) => { event.stopPropagation(); onPeek(row[nameKey]); }}>Xem</button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeDetail({ row, onClose, configHref, historyHref }) {
  const qtyDigits = digitsFor(row.symbolInfo?.qtyDecimals, row.positionAmt, 4);
  return (
    <article className="card trade-detail">
      <header>
        <h2>{row.symbol || "Giao dịch"} · {row.side || "—"}</h2>
        <button type="button" className="ghost" onClick={onClose}>Đóng</button>
      </header>
      <dl>
        <DetailItem label="Config" value={configHref ? <Link className="trail-link" to={configHref}>{row.env}</Link> : row.env} />
        <DetailItem label="Signal" value={historyHref ? <Link className="trail-link" to={historyHref}>{row.signal || "—"}</Link> : row.signal} />
        <DetailItem label="Status" value={row.status} />
        <DetailItem label="Profit" value={`${fmt(row.profit)} $`} />
        <DetailItem label="ROE" value={`${fmt(row.roe)} %`} />
        <DetailItem label="Volume" value={`${fmt(row.volume)} $`} />
        <DetailItem label="Giá vào" value={fmtPrice(row.entryPrice, row)} />
        <DetailItem label="Giá đóng" value={fmtPrice(row.closePrice, row)} />
        <DetailItem label="Đòn bẩy" value={fmt(row.leverage, 0)} />
        <DetailItem label="Cost" value={fmt(row.cost)} />
        <DetailItem label="Khối lượng" value={fmt(row.positionAmt, qtyDigits)} />
        <DetailItem label="Mở" value={fmtTime(row.openTime)} />
        <DetailItem label="Đóng" value={fmtTime(row.closeTime)} />
        <DetailItem label="TP" value={row.tps?.length ? row.tps.map((price) => fmtPrice(price, row)).join(", ") : "—"} />
        <DetailItem label="Copy" value={row.copy ? "Có" : "Không"} />
        <DetailItem label="Limit" value={row.limit ? "Có" : "Không"} />
        <DetailItem label="Paper" value={row.paper ? "Có" : "Không"} />
        <DetailItem label="Đã đóng" value={row.closed ? "Có" : "Không"} />
      </dl>
    </article>
  );
}

function ConfigPeekModal({ username, env, config, loading, error, configHref, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="static-config-peek-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2 id="static-config-peek-title">{username} · {env}</h2>
            <p className="muted">Xem nhanh account config đang chọn.</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>Đóng</button>
        </header>
        {loading ? <p className="muted">Đang tải config…</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!loading && config ? <ConfigGlance config={config} /> : null}
        {!loading && !error && !config ? <p className="muted">Không có dữ liệu config.</p> : null}
        <div className="modal-actions">
          {configHref ? <Link className="trail-link" to={configHref}>Mở Config Lab</Link> : null}
          <button type="button" className="ghost" onClick={onClose}>Đóng</button>
        </div>
      </div>
    </div>
  );
}

export default function AccountStaticLegacyPage() {
  const { user } = useAuth();
  const signalAllowed = can(user, "signals.history");
  const staticAllowed = can(user, "statistics.view");
  const configAllowed = can(user, "config.view");
  const [params, setParams] = useSearchParams();
  const [bots, setBots] = useState([]);
  const [audience, setAudience] = useState("mine");
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [signalSort, setSignalSort] = useState("profit");
  const [envSort, setEnvSort] = useState("profit");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [peek, setPeek] = useState(null);
  const [peekConfig, setPeekConfig] = useState(null);
  const [peekLoading, setPeekLoading] = useState(false);
  const [peekError, setPeekError] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const [aiError, setAiError] = useState("");
  const softReadyRef = useRef(false);
  const requestedView = params.get("view");
  const view = requestedView === "signals" && signalAllowed ? "signals" : requestedView === "statics" && staticAllowed ? "statics" : staticAllowed ? "statics" : "signals";
  const username = params.get("username") || "";
  const env = params.get("env") || "";
  const q = params.get("q") || "";
  const side = params.get("side") || "";
  const signal = params.get("signal") || "";
  const status = params.get("status") || "";
  const profit = params.get("profit") || "";
  const bookChoice = params.get("book") || "";
  const copy = params.get("copy") || "";
  const closed = params.get("closed") || "";
  const minWinText = params.get("minWin") || "";
  const minTradesText = params.get("minTrades") || "";
  const gain = params.get("gain") || "";
  const trade = params.get("trade") || "";
  const [fallbackFrom] = useState(() => daysAgo(3));
  const [loadedAt, setLoadedAt] = useState(null);
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const mineBots = useMemo(() => bots.filter((bot) => ownsBot(user, bot)), [bots, user]);
  const otherBots = useMemo(
    () => bots.filter((bot) => !ownsBot(user, bot) && (user?.role === "admin" || (bot.visibility || "public") !== "private")),
    [bots, user]
  );
  const listedBots = audience === "others" ? otherBots : mineBots;
  const selectedBot = useMemo(() => bots.find((bot) => bot.username === username), [bots, username]);
  const activeFrom = from || fallbackFrom;
  const rangeId = activeRangeId(activeFrom, to);
  const debouncedQ = useDebouncedValue(q);

  function update(values, options = {}) {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (!Object.hasOwn(values, "page") && !Object.hasOwn(values, "trade")) next.set("page", "1");
    next.set("view", "statics");
    next.delete("analytics");
    setParams(next, { replace: Boolean(options.replace) });
  }

  function openConfigPeek(targetEnv) {
    if (!username || !targetEnv || !configAllowed) return;
    setPeek({ username, env: targetEnv });
    setPeekConfig(null);
    setPeekError("");
  }

  useEscape(Boolean(peek), () => setPeek(null));

  useEffect(() => {
    if (view !== "statics") return undefined;
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
      else if (!inMine) update({ username: mine[0]?.username || "", env: "", book: "" });
    }).catch((err) => {
      if (!cancelled) setError(err.message);
    });
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => {
    softReadyRef.current = false;
    setData(null);
    setAiNote("");
    setAiError("");
  }, [username]);

  useEffect(() => {
    if (view !== "statics") return undefined;
    if (!username) { setLoading(false); setRefreshing(false); return undefined; }
    let cancelled = false;
    const controller = new AbortController();
    const soft = softReadyRef.current;
    if (soft) {
      setRefreshing(true);
      setError("");
    } else {
      setLoading(true);
      setError("");
    }
    const query = new URLSearchParams({ page: String(page), limit: "50", from: activeFrom });
    if (to) query.set("to", to);
    if (debouncedQ) query.set("q", debouncedQ);
    if (side) query.set("side", side);
    if (signal) query.set("signal", signal);
    query.set("username", username);
    if (env) query.set("env", env);
    if (status) query.set("status", status);
    if (profit) query.set("profit", profit);
    if (bookChoice) query.set("book", bookChoice);
    if (copy) query.set("copy", copy);
    if (closed) query.set("closed", closed);
    api(`/api/account-statics?${query}`, { signal: controller.signal }).then((result) => {
      if (!cancelled) {
        setData(result);
        softReadyRef.current = true;
        setLoadedAt(new Date().toISOString());
      }
    }).catch((err) => {
      if (!cancelled && err.name !== "AbortError") setError(err.message);
    }).finally(() => {
      if (!cancelled) {
        setLoading(false);
        setRefreshing(false);
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [view, username, env, debouncedQ, side, signal, status, profit, bookChoice, copy, closed, activeFrom, to, page]);

  useEffect(() => {
    if (view !== "statics" || !trade || !username) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setDetail(null);
    api(`/api/account-statics/${encodeURIComponent(trade)}?username=${encodeURIComponent(username)}`, { signal: controller.signal }).then((row) => {
      if (!cancelled) setDetail(row);
    }).catch((err) => {
      if (!cancelled) {
        setDetail(null);
        setError(err.message);
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [view, trade, username]);

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

  const groupRules = {
    minWin: threshold(minWinText, 100),
    minTrades: threshold(minTradesText),
    gain: gain === "1",
  };
  const signalRows = useMemo(
    () => (data?.stats?.bySignal || []).filter((row) => keepGroup(row, groupRules)),
    [data, minWinText, minTradesText, gain]
  );
  const configRows = useMemo(
    () => (data?.stats?.byConfig || data?.stats?.byEnv || []).filter((row) => keepGroup(row, groupRules)),
    [data, minWinText, minTradesText, gain]
  );
  const book = bookChoice || data?.book || "live";
  const bookLabel = book === "paper" ? "paper" : book === "all" ? "live và paper" : "live";
  function historyTo(rowSignal, rowEnv) {
    const query = new URLSearchParams({ tab: "history", fromUser: username });
    const targetEnv = rowEnv || env;
    if (targetEnv) query.set("fromEnv", targetEnv);
    if (rowSignal) query.set("signal", rowSignal);
    const names = env && targetEnv === env
      ? (data?.stats?.bySignal || []).map((item) => item.signal).filter(Boolean).slice(0, 20)
      : (rowSignal ? [rowSignal] : []);
    if (names.length) query.set("signals", names.join(","));
    if (activeFrom) query.set("from", activeFrom);
    if (to) query.set("to", to);
    return `/signal-search?${query}`;
  }
  function configTo(rowEnv) {
    return `/config-lab/${encodeURIComponent(username)}/${encodeURIComponent(rowEnv)}`;
  }

  async function askAi() {
    if (!username || aiBusy) return;
    const instructions = aiPrompt.trim();
    if (!instructions) {
      setAiError("Nhập câu hỏi, ví dụ: tìm signal win rate cao và đang lãi");
      return;
    }
    setAiBusy(true);
    setAiError("");
    setAiNote("");
    try {
      const result = await api("/api/account-statics/ai-suggest", {
        method: "POST",
        body: {
          username,
          env,
          book: bookChoice || "live",
          closed,
          from: activeFrom,
          to: to || undefined,
          instructions,
        },
      });
      const suggestion = result.suggestion || {};
      const next = {
        signal: suggestion.signal || "",
        minWin: suggestion.minWin || "",
        minTrades: suggestion.minTrades || "",
        gain: suggestion.gain || "",
        side: suggestion.side || "",
        profit: suggestion.profit || "",
      };
      if (suggestion.from) {
        next.from = suggestion.from;
        next.to = suggestion.to || "";
      }
      if (suggestion.clearSymbol) next.q = "";
      update(next, { replace: true });
      const sampleNote = result.sample?.rangeNote ? ` · kỳ ${result.sample.rangeNote}` : "";
      setAiNote(
        (suggestion.note || (suggestion.signal ? `Đã chọn ${suggestion.signal}` : "AI không chọn signal cụ thể; đã áp ngưỡng nếu có."))
        + sampleNote
      );
    } catch (err) {
      setAiError(err.message || "Không hỏi được AI");
    } finally {
      setAiBusy(false);
    }
  }

  const ruleNote = [
    groupRules.minWin != null ? `win rate ≥ ${groupRules.minWin}%` : "",
    groupRules.minTrades != null ? `≥ ${groupRules.minTrades} lệnh` : "",
    groupRules.gain ? "profit đang lãi" : "",
    side ? `side ${side}` : "",
  ].filter(Boolean).join(", ");
  const tradeStats = view === "statics" ? data?.stats : null;
  if (view === "signals") return <Navigate to="/signal-search?tab=history" replace />;
  return (
    <section className={refreshing ? "static-soft-refresh" : undefined}>
      <header className="page-head">
        <div>
          <h1>Account Static</h1>
          <p className="muted">Lọc signal theo win rate, số lệnh và profit. Chọn một signal rồi để Tất cả config để xem config live hoặc paper nào tốt với signal đó.</p>
        </div>
      </header>
      <div className="card signal-filters">
        <label>Phạm vi<select value={audience} onChange={(e) => { const next = e.target.value; const list = next === "others" ? otherBots : mineBots; setAudience(next); update({ username: list[0]?.username || "", env: "", book: "" }); }}><option value="mine">Của tôi</option><option value="others">Người khác</option></select></label>
        <label>User bot<select value={username} onChange={(e) => update({ username: e.target.value, env: "", book: "" })}>{listedBots.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}{username && !listedBots.some((bot) => bot.username === username) ? <option value={username}>{username}</option> : null}</select></label>
        <label>
          Account Config
          <span className="static-env-row">
            <select value={env} onChange={(e) => update({ env: e.target.value })}>
              <option value="">Tất cả config</option>
              {(selectedBot?.accounts || []).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {configAllowed && env ? (
              <button type="button" className="ghost" onClick={() => openConfigPeek(env)}>Xem</button>
            ) : null}
          </span>
        </label>
        {!listedBots.length ? <p className="muted">{audience === "mine" ? "Bạn chưa có user bot đang active." : "Không có user active của người khác."}</p> : null}
        <label>Symbol<input value={q} onChange={(e) => update({ q: e.target.value })} placeholder="BTCUSDT" /></label>
        <label>Signal<select value={signal} onChange={(e) => update({ signal: e.target.value }, { replace: true })}><option value="">Tất cả</option>{(data?.stats?.bySignal || []).map((item) => <option key={item.signal} value={item.signal}>{item.signal}</option>)}{signal && !(data?.stats?.bySignal || []).some((item) => item.signal === signal) ? <option value={signal}>{signal}</option> : null}</select></label>
        <label>Side<select value={side} onChange={(e) => update({ side: e.target.value }, { replace: true })}><option value="">Tất cả</option><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></label>
        <label>Status<select value={status} onChange={(e) => update({ status: e.target.value }, { replace: true })}><option value="">Tất cả</option><option value="WIN">WIN</option><option value="LOSS">LOSS</option>{(data?.stats?.byStatus || []).filter((item) => item.status && item.status !== "WIN" && item.status !== "LOSS").map((item) => <option key={item.status} value={item.status}>{item.status}</option>)}</select></label>
        <label>Profit<select value={profit} onChange={(e) => update({ profit: e.target.value }, { replace: true })}><option value="">Tất cả</option><option value="win">Lãi</option><option value="loss">Lỗ</option><option value="flat">Hòa</option></select></label>
        <label>Sổ<select value={book} onChange={(e) => update({ book: e.target.value })}><option value="live">Live</option><option value="paper">Paper</option><option value="all">Live và paper</option></select></label>
        <label>Copy<select value={copy} onChange={(e) => update({ copy: e.target.value }, { replace: true })}><option value="">Tất cả</option><option value="copy">Copy</option><option value="manual">Không copy</option></select></label>
        <label>Đóng lệnh<select value={closed} onChange={(e) => update({ closed: e.target.value }, { replace: true })}><option value="">Tất cả</option><option value="closed">Đã đóng</option><option value="open">Đang mở</option></select></label>
        <label>Win rate từ %<input type="number" min="0" max="100" step="1" value={minWinText} placeholder="60" onChange={(e) => update({ minWin: e.target.value }, { replace: true })} /></label>
        <label>Số lệnh từ<input type="number" min="1" step="1" value={minTradesText} placeholder="10" onChange={(e) => update({ minTrades: e.target.value }, { replace: true })} /></label>
        <label>Nhóm lãi<select value={gain} onChange={(e) => update({ gain: e.target.value }, { replace: true })}><option value="">Tất cả</option><option value="1">Chỉ đang lãi</option></select></label>
        <label>Từ<input type="datetime-local" value={toLocalInput(activeFrom)} onChange={(e) => update({ from: applyDatePick(activeFrom, e.target.value) || fallbackFrom, to })} /></label>
        <label>Đến<input type="datetime-local" value={toLocalInput(to)} onChange={(e) => update({ from: activeFrom, to: applyDatePick(to, e.target.value) })} /></label>
        <div className="history-range">
          {RANGE_PRESETS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={rangeId === item.id ? "active" : "ghost"}
              onClick={() => {
                const next = rangeFromPreset(item.id);
                if (next) update(next);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card static-ai-box">
        <label>
          Hỏi AI lọc signal
          <textarea
            rows={2}
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Ví dụ: tìm signal win rate trên 70% trong tháng 10 này"
            disabled={!username || aiBusy}
          />
        </label>
        <div className="static-ai-actions">
          <button type="button" disabled={!username || aiBusy || !aiPrompt.trim()} onClick={askAi}>
            {aiBusy ? "Đang hỏi…" : "Gợi ý lọc"}
          </button>
          {aiNote ? <p className="muted">{aiNote}</p> : null}
          {aiError ? <p className="form-error">{aiError}</p> : null}
        </div>
      </div>

      {params.get("src") === "summary" ? <p className="muted">Mở từ Tổng kết. Tổng kết tính lệnh đóng theo closeTime. Bảng này lọc openTime, sổ {bookLabel}{closed === "closed" ? ", chỉ lệnh đã đóng" : ""}.</p> : null}
      {refreshing ? <p className="muted static-refresh-hint">Đang cập nhật bảng…</p> : null}
      <div className={refreshing ? "static-stats-pane is-refreshing" : "static-stats-pane"}>
        {tradeStats ? <div className="stats-grid signal-stats"><article className="card"><span className="muted">Số lượng giao dịch</span><strong>{tradeStats.total}</strong><small className="muted">{tradeStats.wins} thắng · {tradeStats.losses} thua</small></article><article className="card"><span className="muted">Win rate</span><strong>{fmt(tradeStats.winRate, 1)}%</strong></article><article className="card"><span className="muted">Profit</span><strong>{fmt(tradeStats.profit)}$</strong><small className="muted">Cost {fmt(tradeStats.cost)}$ · ROI {fmt(tradeStats.avgRoi, 1)}%</small></article><article className="card"><span className="muted">Volume</span><strong>{fmt(tradeStats.volume)}$</strong></article><article className="card"><span className="muted">Long</span><strong>{fmt(tradeStats.longProfit)}$</strong></article><article className="card"><span className="muted">Short</span><strong>{fmt(tradeStats.shortProfit)}$</strong></article></div> : null}
        {tradeStats ? <p className="muted">Nguồn: Account Static, sổ {bookLabel}. Khoảng openTime {fmtTime(data?.from || activeFrom)}{data?.to || to ? ` → ${fmtTime(data?.to || to)}` : " → nay"}.{loadedAt ? ` Tải lúc ${fmtTime(loadedAt)}.` : ""} Không lấy từ income sàn.</p> : null}
        {data?.stats?.byStatus?.length ? <div className="chips signal-chips"><span className="muted">Status</span>{data.stats.byStatus.map((item) => <button type="button" className={status === item.status ? "symbol-chip active" : "symbol-chip"} key={item.status} onClick={() => update({ status: status === item.status ? "" : item.status }, { replace: true })}>{item.status}: {item.count} · {fmt(item.profit)}$</button>)}</div> : null}
        {data?.stats?.bySide?.length ? <div className="chips signal-chips"><span className="muted">Side</span>{data.stats.bySide.map((item) => <button type="button" className={side === item.side ? "symbol-chip active" : "symbol-chip"} key={item.side} onClick={() => update({ side: side === item.side ? "" : item.side }, { replace: true })}>{item.side}: {item.wins}/{item.count} · WR {fmt(item.winRate, 1)}% · {fmt(item.profit)}$</button>)}</div> : null}
        {data?.stats?.bySignal?.length ? (
          <CompareTable
            title={env ? `Signal của ${env}` : `Signal của ${username || "user"}`}
            note={`${signalRows.length}/${data.stats.bySignal.length} signal${ruleNote ? ` · ${ruleNote}` : ""}. Bấm một dòng để giữ signal đó và so config.`}
            rows={signalRows}
            nameKey="signal"
            nameLabel="Signal"
            active={signal}
            onPick={(value) => update({ signal: signal === value ? "" : value }, { replace: true })}
            sortKey={signalSort}
            onSort={setSignalSort}
          />
        ) : null}
        {env ? (
          <p className="trail-note muted">
            <span>Đang xem config {env}. Chọn Tất cả config để so config nào tốt hơn.</span>
            {configAllowed ? <button type="button" className="ghost" onClick={() => openConfigPeek(env)}>Xem popup</button> : null}
            {configAllowed ? <Link className="trail-link" to={configTo(env)}>Mở config</Link> : null}
            {signalAllowed ? <Link className="trail-link" to={historyTo(signal, env)}>Lịch sử signal của config</Link> : null}
          </p>
        ) : null}
        {!env && (data?.stats?.byConfig || data?.stats?.byEnv || []).length ? (
          <CompareTable
            title={signal ? `Config ${bookLabel} của signal ${signal}` : `Config ${bookLabel} của ${username || "user"}`}
            note={signal ? `Mỗi dòng chỉ tính signal ${signal}${side ? `, side ${side}` : ""}. ${configRows.length} config đạt bộ lọc.` : `Chưa chọn signal nên mỗi dòng là cả config. Chọn một signal để so đúng signal đó. ${configRows.length} config đạt bộ lọc.`}
            rows={configRows}
            nameKey="env"
            nameLabel="Config"
            active={env}
            onPick={(value) => {
              update({ env: value }, { replace: true });
              if (configAllowed) openConfigPeek(value);
            }}
            onPeek={configAllowed ? openConfigPeek : null}
            sortKey={envSort}
            onSort={setEnvSort}
          />
        ) : null}
        {detail ? <TradeDetail row={detail} onClose={() => update({ trade: "" })} configHref={configAllowed && detail.env ? configTo(detail.env) : ""} historyHref={signalAllowed ? historyTo(detail.signal, detail.env) : ""} /> : null}
        {loading && !data ? <p className="muted">Đang tải…</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!loading && data?.rows?.length === 0 ? <div className="card empty">Không có dữ liệu trong khoảng thời gian này.</div> : null}
        {data?.rows?.length ? (
          <div className="table-wrap signal-table">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Config</th>
                  <th>Signal</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Status</th>
                  <th>Profit</th>
                  <th>ROE</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr
                    key={row.id}
                    className={trade === row.id ? "trade-row active" : "trade-row"}
                    tabIndex={0}
                    onClick={() => update({ trade: trade === row.id ? "" : row.id }, { replace: true })}
                    onKeyDown={(event) => { if (event.key === "Enter") update({ trade: trade === row.id ? "" : row.id }, { replace: true }); }}
                  >
                    <td>{fmtTime(row.openTime)}</td>
                    <td>
                      {configAllowed && row.env ? (
                        <button type="button" className="trail-link ghost-link" onClick={(event) => { event.stopPropagation(); openConfigPeek(row.env); }}>{row.env}</button>
                      ) : row.env}
                    </td>
                    <td>{signalAllowed && row.signal ? <Link className="trail-link" to={historyTo(row.signal, row.env)} onClick={(event) => event.stopPropagation()}>{row.signal}</Link> : row.signal}</td>
                    <td>{row.symbol}</td>
                    <td>{row.side}</td>
                    <td>{row.status}</td>
                    <td>{fmt(row.profit)}$</td>
                    <td>{fmt(row.roe)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {data?.total > data?.limit ? (
          <div className="audit-pagination">
            <span className="muted">Trang {data.page} · {data.total} bản ghi</span>
            <div>
              <button type="button" className="ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, { replace: true })}>Trước</button>
              <button type="button" className="ghost" disabled={page * data.limit >= data.total} onClick={() => update({ page: String(page + 1) }, { replace: true })}>Sau</button>
            </div>
          </div>
        ) : null}
      </div>
      {username ? <p className="muted"><Link to={`/config-lab?user=${encodeURIComponent(username)}`}>Mở Config · {username}</Link></p> : null}
      {peek ? (
        <ConfigPeekModal
          username={peek.username}
          env={peek.env}
          config={peekConfig}
          loading={peekLoading}
          error={peekError}
          configHref={configAllowed ? configTo(peek.env) : ""}
          onClose={() => setPeek(null)}
        />
      ) : null}
    </section>
  );
}
