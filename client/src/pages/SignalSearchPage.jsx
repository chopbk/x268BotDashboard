import { useEffect, useMemo, useRef, useState } from "react";
import SignalSetupPanel from "./SignalSetupPanel";
import SignalStatsPanel from "./SignalStatsPanel";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useEscape } from "../navigation";
import { api } from "../api";
import useDebouncedValue from "../hooks/useDebouncedValue";
import { useAuth } from "../auth";
import { canEditResource } from "../access";

const CONFIG_EDIT = "config.edit";
const SIGNALS_HISTORY = "signals.history";
const CONFIG_VIEW = "config.view";
const can = (user, permission) => (user?.permissions || []).includes(permission);
const DAY_MS = 24 * 60 * 60 * 1000;
const fmtTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const fmt = (value, digits = 2) => value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);

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

function numText(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  return String(Math.round(Number(value) * 10000) / 10000);
}

function configLine(row) {
  const config = row.config;
  if (!config) return "—";
  const volume = config.volume == null ? "vol —" : `vol ${fmt(config.volume, 0)}$`;
  const tpNums = (config.tp || []).map(numText).filter(Boolean).join(", ");
  const slNum = numText(config.sl);
  const trail = config.trailing
    ? `Trail ${config.trailingType || "FIX"}${numText(config.sp) ? ` sp ${numText(config.sp)}` : ""}${numText(config.trigger) ? ` trg ${numText(config.trigger)}` : ""}`
    : "Trail tắt";
  return [
    volume,
    config.mode || "—",
    `TP ${config.tpType || "—"}${tpNums ? ` ${tpNums}` : ""}`,
    `SL ${config.slType || "—"}${slNum ? ` ${slNum}` : ""}`,
    trail,
  ].join(" · ");
}

function sortValue(row, key) {
  if (key === "username") return row.username || "";
  if (key === "env") return row.env || "";
  if (key === "signal") return (row.matched || []).join(", ");
  if (key === "trades") return row.trades || 0;
  if (key === "winRate") return row.winRate || 0;
  if (key === "profit") return row.profit || 0;
  if (key === "lastTime") return row.lastTime ? new Date(row.lastTime).getTime() : 0;
  if (key === "config") return configLine(row);
  return "";
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
      <Glance title="Sync" items={[
        ["Interval (giây)", show(config.interval)],
        ["Sync from", show(config.syncFrom)],
        ["Sync except", show(config.syncExcept)],
        ["Sync scale", yesNo(config.syncScale)],
        ["Sync margin ratio", show(config.syncMarginRatio)],
        ["Sync wallet", show(config.syncWalletBal)],
      ]} />
    </div>
  );
}

function bookText(config) {
  if (!config) return "—";
  return config.paper ? "Paper" : "Live";
}

function onText(config) {
  if (!config || config.on == null) return "—";
  return config.on ? "Bật" : "Tắt";
}

function capitalText(config) {
  if (!config) return "—";
  const mode = config.mode || "FIX";
  const vol = config.volume == null ? "vol —" : `vol ${fmt(config.volume, 0)}$`;
  if (mode === "RATIO") return `${mode} · ratio ${show(config.ratio)} · ${vol}`;
  if (mode === "LOSS" || mode === "RR") return `${mode} · lỗ ${show(config.fixloss)}$ · ${vol}`;
  if (mode === "RISK") return `${mode} · risk ${show(config.risk)} · ${vol}`;
  return `${mode} · cost ${show(config.cost)}$ · ${vol}`;
}

function slText(config) {
  if (!config) return "—";
  const value = numText(config.sl);
  return `${config.slType || "—"}${value ? ` ${value}` : ""}`;
}

function tpText(config) {
  if (!config) return "—";
  const nums = (config.tpPercent || []).map(numText).filter(Boolean).join(", ");
  return `${config.tpType || "—"}${nums ? ` ${nums}` : ""}`;
}

function signalText(config) {
  if (!config) return "—";
  const list = Array.isArray(config.signals) ? config.signals.filter(Boolean) : [];
  return list.length ? list.join(", ") : "—";
}

function syncText(config) {
  if (!config) return "—";
  return config.syncFrom ? `từ ${config.syncFrom}` : "không gắn";
}

const TRANSFER_FIELDS = [
  ["Vốn", capitalText],
  ["Live/Paper", bookText],
  ["On", onText],
  ["SL", slText],
  ["TP", tpText],
  ["Signal", signalText],
  ["Sync", syncText],
];

function afterTransfer(label, action, source, current) {
  if (label === "Sync") {
    if (action === "replace" || action === "new") return "không gắn";
    return source?.env ? `từ ${source.env}` : "—";
  }
  if (action === "sync-existing") return current;
  const field = TRANSFER_FIELDS.find(([name]) => name === label);
  return field ? field[1](source) : "—";
}

const TRANSFER_NOTE = {
  new: "Config mới nhận trade_config, danh sách signal, blacklist và whitelist của nguồn, không gắn sync.",
  replace: "Ghi đè thay cả trade_config, danh sách signal, blacklist, whitelist và gỡ liên kết sync cũ của đích.",
  "sync-new": "Config mới nhận nội dung nguồn và gắn sync. Gốc đổi thì nhánh bị ghi đè.",
  "sync-existing": "Bước này chỉ gắn sync. trade_config của đích chưa bị ghi. Khi gốc đổi, nhánh bị ghi đè trừ nhóm trong Sync except.",
};

function TransferCheck({ action, sourceLabel, targetLabel, source, target, busy, error }) {
  const needsTarget = action === "replace" || action === "sync-existing";
  const waiting = busy || (needsTarget && !target && !error);
  return (
    <div className="transfer-check">
      <h3>Kiểm tra trước khi ghi</h3>
      <p className="transfer-path">{sourceLabel} → {targetLabel}</p>
      <p className="muted">{TRANSFER_NOTE[action]}</p>
      {error ? <p className="form-error">{error}</p> : waiting ? <p className="muted">Đang đối chiếu đích…</p> : (
        <>
          {needsTarget ? (
            <p className="muted">
              {action === "replace"
                ? "Dòng tô là nguồn và đích đang khác nhau. Cột sau khi ghi là giá trị sẽ được lưu."
                : "Dòng tô là nguồn và đích đang khác nhau. Cột sau khi ghi chỉ đổi Sync; các mục kia giữ đến khi gốc đổi."}
            </p>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Mục</th>
                  <th>Nguồn</th>
                  {needsTarget ? <th>Đích hiện tại</th> : null}
                  <th>{needsTarget ? "Sau khi ghi" : "Sẽ ghi"}</th>
                </tr>
              </thead>
              <tbody>
                {TRANSFER_FIELDS.map(([label, read]) => {
                  const from = read(source);
                  const current = target ? read(target) : "";
                  const next = afterTransfer(label, action, source, current);
                  const changed = Boolean(target) && (from !== current || next !== current);
                  return (
                    <tr key={label} className={changed ? "diff" : undefined}>
                      <td>{label}</td>
                      <td>{from}</td>
                      {needsTarget ? <td>{current}</td> : null}
                      <td>{next}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function contextNames(value) {
  return String(value || "").split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function SignalLog({ canSearch, onFindConfig }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [fallbackFrom] = useState(() => daysAgo(3));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(null);
  const signal = params.get("signal") || "";
  const symbol = params.get("symbol") || "";
  const side = params.get("side") || "";
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const fromUser = params.get("fromUser") || "";
  const fromEnv = params.get("fromEnv") || "";
  const contextSignals = contextNames(params.get("signals"));
  const fromSummary = params.get("src") === "summary";
  const debouncedSymbol = useDebouncedValue(symbol);
  const activeFrom = from || fallbackFrom;
  const staticAllowed = can(user, "statistics.view");

  function update(values) {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (!Object.hasOwn(values, "page")) next.set("page", "1");
    setParams(next);
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), limit: "50", from: activeFrom });
    if (to) query.set("to", to);
    if (debouncedSymbol) query.set("q", debouncedSymbol);
    if (side) query.set("side", side);
    if (signal) query.set("signal", signal);
    api(`/api/signal-history?${query}`, { signal: controller.signal }).then((result) => {
      setData(result);
      setLoadedAt(new Date().toISOString());
    }).catch((err) => {
      if (!controller.signal.aborted) setError(err.message || "Không tải được lịch sử signal");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [signal, debouncedSymbol, side, activeFrom, to, page]);

  function pick(name) {
    update({ signal: signal === name ? "" : name });
  }

  const counts = new Map((data?.stats?.bySignal || []).map((item) => [String(item.signal || "").toUpperCase(), item.count]));
  const chips = contextSignals.length
    ? contextSignals.map((name) => ({ signal: name, count: counts.get(name.toUpperCase()) || 0 }))
    : (data?.stats?.bySignal || []);
  const count = signal ? (data?.total || 0) : 0;
  const statsHref = (() => {
    const next = new URLSearchParams(params);
    next.set("tab", "stats");
    return `/signal-search?${next}`;
  })();
  return (
    <>
      {fromUser && fromEnv ? (
        <p className="trail-note muted">
          <span>Từ config {fromUser}/{fromEnv}. {contextSignals.length ? "Nhật ký vẫn là signal_infos của cả hệ thống, danh sách signal được thu vào config này." : "Config chưa khai báo signal. Nhật ký bên dưới là signal_infos của cả hệ thống."}</span>
          {canSearch ? <Link className="trail-link" to={`/bots/${encodeURIComponent(fromUser)}/accounts/${encodeURIComponent(fromEnv)}`}>Mở config</Link> : null}
          {staticAllowed ? <Link className="trail-link" to={`/signals?view=statics&username=${encodeURIComponent(fromUser)}&env=${encodeURIComponent(fromEnv)}${from ? `&from=${encodeURIComponent(from)}` : ""}${to ? `&to=${encodeURIComponent(to)}` : ""}`}>Giao dịch của config</Link> : null}
          <Link className="trail-link" to={statsHref}>Lý do bỏ qua</Link>
          {contextSignals.length ? <button type="button" className="ghost" onClick={() => update({ signals: "", signal: "" })}>Mọi signal trong kỳ</button> : null}
        </p>
      ) : null}
      {fromSummary ? <p className="muted">Mở từ Tổng kết. Profit ở Tổng kết là lệnh đóng theo closeTime. Nhật ký này đếm signal_infos theo openTime, cùng mốc từ/đến trên URL.</p> : null}
      <div className="card signal-filters">
        <label>Symbol<input value={symbol} placeholder="BTCUSDT" onChange={(event) => update({ symbol: event.target.value })} /></label>
        <label>Side<select value={side} onChange={(event) => update({ side: event.target.value })}><option value="">Tất cả</option><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></label>
        <label>Từ<input type="datetime-local" value={toLocalInput(activeFrom)} onChange={(event) => update({ from: applyDatePick(activeFrom, event.target.value) || fallbackFrom })} /></label>
        <label>Đến<input type="datetime-local" value={toLocalInput(to)} onChange={(event) => update({ to: applyDatePick(to, event.target.value) })} /></label>
        <div className="history-range">
          {[1, 3, 7, 30, 90].map((days) => (
            <button type="button" className="ghost" key={days} onClick={() => update({ from: daysAgo(days), to: "" })}>{days} ngày</button>
          ))}
        </div>
      </div>
      <p className="muted">Nguồn: signal_infos, lọc openTime từ {fmtTime(data?.from || activeFrom)}{data?.to || to ? ` đến ${fmtTime(data?.to || to)}` : ""}. {loadedAt ? `Tải lúc ${fmtTime(loadedAt)}.` : ""} Đây không phải profit lệnh.</p>
      {chips.length ? (
        <div className="chips signal-chips">
          <span className="muted">{contextSignals.length ? "Signal của config" : "Signal"}</span>
          {chips.map((item) => (
            <button type="button" className={signal.toUpperCase() === String(item.signal).toUpperCase() ? "symbol-chip active" : "symbol-chip"} key={item.signal} onClick={() => pick(item.signal)}>
              {item.signal}: {item.count}
            </button>
          ))}
        </div>
      ) : null}
      {signal ? (
        <div className="card signal-pick">
          <div>
            <h2>{signal}</h2>
            <p className="muted">{count} signal trong khoảng này{data?.stats ? ` · ${data.stats.long} LONG · ${data.stats.short} SHORT` : ""}</p>
          </div>
          {canSearch ? <button type="button" onClick={() => onFindConfig(signal)}>Tìm config</button> : null}
        </div>
      ) : <p className="muted">Bấm một signal để xem lịch sử và số lượng.</p>}
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {signal && !loading && data?.rows?.length === 0 ? <div className="card empty">Không có signal trong khoảng này.</div> : null}
      {signal && data?.rows?.length ? (
        <div className="table-wrap signal-table">
          <table>
            <thead><tr><th>Thời gian</th><th>Signal</th><th>Symbol</th><th>Side</th><th>Loại</th><th>Trạng thái</th></tr></thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}><td>{fmtTime(row.openTime)}</td><td>{row.signal}</td><td>{row.symbol}</td><td>{row.side}</td><td>{row.type}</td><td>{row.status}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {signal && data?.total > data?.limit ? (
        <div className="audit-pagination">
          <span className="muted">Trang {data.page} · {data.total} signal</span>
          <div>
            <button type="button" className="ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Trước</button>
            <button type="button" className="ghost" disabled={page * data.limit >= data.total} onClick={() => update({ page: String(page + 1) })}>Sau</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SortHead({ label, name, order, onSort }) {
  const active = order?.key === name;
  return (
    <th aria-sort={active ? (order.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sort-col" onClick={() => onSort(name)}>
        {label}{active ? (order.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

export default function SignalSearchPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const openerRef = useRef(null);
  const layerOpenerRef = useRef(null);
  const historyAllowed = can(user, SIGNALS_HISTORY);
  const searchAllowed = can(user, CONFIG_VIEW);
  const requestedTab = params.get("tab");
  const tab = requestedTab === "setup"
    ? "setup"
    : requestedTab === "stats"
      ? "stats"
      : requestedTab === "history" && historyAllowed
        ? "history"
        : searchAllowed
          ? "search"
          : "history";
  const staticAllowed = can(user, "statistics.view");
  const editAllowed = can(user, CONFIG_EDIT);
  const [signal, setSignal] = useState("");
  const [days, setDays] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minWinRate, setMinWinRate] = useState("");
  const [profit, setProfit] = useState("");
  const [profitOp, setProfitOp] = useState("gt");
  const [minTrades, setMinTrades] = useState("");
  const [sort, setSort] = useState("recent");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [range, setRange] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const order = useMemo(() => {
    const [key, dir] = String(params.get("order") || "").split(":");
    return key ? { key, dir: dir === "asc" ? "asc" : "desc" } : null;
  }, [params]);
  const panelKind = ["config", "copy", "sync", "static"].includes(params.get("panel") || "") ? params.get("panel") : "";
  const [panelUser, panelEnv] = String(params.get("row") || "").split("/");
  const panelRow = panelUser && panelEnv
    ? (rows || []).find((row) => row.username === panelUser && row.env === panelEnv)
      || { username: panelUser, env: panelEnv, matched: String(params.get("signal") || "").split(/[,\s]+/).filter(Boolean) }
    : null;
  const panel = panelKind && panelRow ? { kind: panelKind, row: panelRow } : null;
  const [trades, setTrades] = useState(null);
  const [trade, setTrade] = useState(null);
  const [detail, setDetail] = useState(null);
  const [targets, setTargets] = useState([]);
  const [targetUser, setTargetUser] = useState("");
  const [targetConfigs, setTargetConfigs] = useState([]);
  const [targetEnv, setTargetEnv] = useState("");
  const [copyName, setCopyName] = useState("");
  const [copyMode, setCopyMode] = useState("new");
  const [syncMode, setSyncMode] = useState("existing");
  const [notice, setNotice] = useState("");
  const [popupError, setPopupError] = useState("");
  const [popupBusy, setPopupBusy] = useState(false);
  const [sourceDetail, setSourceDetail] = useState(null);
  const [targetDetail, setTargetDetail] = useState(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [resultTarget, setResultTarget] = useState(null);
  const searchController = useRef(null);
  const popupController = useRef(null);

  function renewController(ref) {
    ref.current?.abort();
    ref.current = new AbortController();
    return ref.current;
  }

  const shown = useMemo(() => {
    if (!rows) return null;
    if (!order) return rows;
    const dir = order.dir === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = sortValue(left, order.key);
      const b = sortValue(right, order.key);
      if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
      return String(a).localeCompare(String(b), "vi") * dir;
    });
  }, [rows, order]);

  function go(mutate, { replace = false, layer = false } = {}) {
    const next = new URLSearchParams(location.search);
    mutate(next);
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace, state: layer ? { layer: (location.state?.layer || 0) + 1 } : null }
    );
  }

  const searchKey = [
    tab,
    params.get("signal") || "",
    params.get("days") || "",
    params.get("from") || "",
    params.get("to") || "",
    params.get("minWinRate") || "",
    params.get("profit") || "",
    params.get("profitOp") || "",
    params.get("minTrades") || "",
    params.get("q") || "",
    params.get("sort") || "",
  ].join("|");

  useEffect(() => {
    setSignal(params.get("signal") || "");
    setDays(params.get("days") || "30");
    setFrom(params.get("from") || "");
    setTo(params.get("to") || "");
    setMinWinRate(params.get("minWinRate") || "");
    setProfit(params.get("profit") || "");
    setProfitOp(params.get("profitOp") === "lt" ? "lt" : "gt");
    setMinTrades(params.get("minTrades") || "");
    setSort(params.get("sort") || "recent");
    setQ(params.get("q") || "");
  }, [searchKey]);

  useEffect(() => {
    if (tab !== "search") return undefined;
    const name = (params.get("signal") || "").trim();
    if (!name) {
      setRows(null);
      setRange(null);
      return undefined;
    }
    setBusy(true);
    setError("");
    const controller = renewController(searchController);
    const query = new URLSearchParams();
    query.set("signal", name);
    if (params.get("from") || params.get("to")) {
      if (params.get("from")) query.set("from", params.get("from"));
      if (params.get("to")) query.set("to", params.get("to"));
    } else {
      query.set("days", params.get("days") || "30");
    }
    if (params.get("minWinRate")) query.set("minWinRate", params.get("minWinRate"));
    if (params.get("profit")) {
      query.set("profit", params.get("profit"));
      query.set("profitOp", params.get("profitOp") === "lt" ? "lt" : "gt");
    }
    if (params.get("minTrades")) query.set("minTrades", params.get("minTrades"));
    if (params.get("q")) query.set("q", params.get("q"));
    query.set("sort", params.get("sort") || "recent");
    api(`/api/bots/config-search?${query}`, { signal: controller.signal })
      .then((data) => {
        setRows(data.rows || []);
        setRange({ from: data.from, to: data.to });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setRows(null);
        setError(err.message || "Không tìm được signal");
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [searchKey, tab]);

  useEffect(() => {
    if (!panel) return undefined;
    setNotice("");
    setPopupError("");
    setDetail(null);
    setTrades(null);
    setTrade(null);
    setSourceDetail(null);
    setTargetDetail(null);
    setTargetUser("");
    setTargetEnv("");
    setTargetConfigs([]);
    setCopyName("");
    setCheckError("");
    setCheckBusy(false);
    setResultTarget(null);
    setPopupBusy(true);
    const controller = renewController(popupController);
    const row = panel.row;
    const job = panel.kind === "config"
      ? api(`/api/bots/${encodeURIComponent(row.username)}/configs/${encodeURIComponent(row.env)}`, { signal: controller.signal }).then((data) => setDetail(data.config))
      : panel.kind === "static"
        ? api(`/api/account-statics?${staticQuery(row)}`, { signal: controller.signal }).then((data) => setTrades(data))
        : Promise.all([
          loadTargets(controller.signal),
          api(`/api/bots/${encodeURIComponent(row.username)}/configs/${encodeURIComponent(row.env)}`, { signal: controller.signal }).then((data) => data.config),
        ]).then(async ([bots, config]) => {
          if (controller.signal.aborted) return;
          setTargets(bots);
          setSourceDetail(config);
          setCopyName("");
          setCopyMode(panel.kind === "copy" ? "new" : "existing");
          setSyncMode("existing");
          setTargetEnv("");
          setTargetConfigs([]);
          const preferred = bots.some((bot) => bot.username === row.username) ? row.username : "";
          setTargetUser(preferred);
          if (panel.kind === "sync" && preferred) await loadTargetConfigs(preferred, row, controller.signal);
        });
    Promise.resolve(job)
      .catch((err) => { if (!controller.signal.aborted) setPopupError(err.message || "Không tải được"); })
      .finally(() => { if (!controller.signal.aborted) setPopupBusy(false); });
    return () => controller.abort();
  }, [panel?.kind, panel?.row?.username, panel?.row?.env]);

  useEffect(() => {
    const kind = panel?.kind;
    const replacing = kind === "copy" && copyMode === "replace";
    const linking = kind === "sync" && syncMode === "existing";
    if (!replacing && !linking) {
      setTargetDetail(null);
      setCheckBusy(false);
      setCheckError("");
      return undefined;
    }
    if (!targetUser || !targetEnv) {
      setTargetDetail(null);
      setCheckBusy(false);
      setCheckError("");
      return undefined;
    }
    const controller = new AbortController();
    setCheckBusy(true);
    setCheckError("");
    setTargetDetail(null);
    api(`/api/bots/${encodeURIComponent(targetUser)}/configs/${encodeURIComponent(targetEnv)}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setTargetDetail({ username: targetUser, env: targetEnv, config: data.config });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setTargetDetail(null);
        setCheckError(err.message || "Không đối chiếu được config đích");
      })
      .finally(() => { if (!controller.signal.aborted) setCheckBusy(false); });
    return () => controller.abort();
  }, [panel?.kind, copyMode, syncMode, targetUser, targetEnv]);

  function staticQuery(row) {
    const query = new URLSearchParams();
    query.set("username", row.username);
    query.set("env", row.env);
    query.set("signal", (row.matched || []).join(","));
    query.set("limit", "50");
    const start = params.get("from") || range?.from;
    const end = params.get("to") || range?.to;
    if (start) query.set("from", start);
    if (end) query.set("to", end);
    return query;
  }

  function onSearch(event, name = signal) {
    event?.preventDefault();
    const term = String(name ?? signal).trim();
    if (!term) return;
    go((next) => {
      next.set("tab", "search");
      next.set("signal", term);
      next.delete("order");
      next.delete("panel");
      next.delete("row");
      next.delete("trade");
      if (from || to) {
        next.delete("days");
        if (from) next.set("from", from);
        else next.delete("from");
        if (to) next.set("to", to);
        else next.delete("to");
      } else {
        next.set("days", days || "30");
        next.delete("from");
        next.delete("to");
      }
      if (minWinRate.trim()) next.set("minWinRate", minWinRate.trim());
      else next.delete("minWinRate");
      if (profit.trim()) {
        next.set("profit", profit.trim());
        next.set("profitOp", profitOp);
      } else {
        next.delete("profit");
        next.delete("profitOp");
      }
      if (minTrades.trim()) next.set("minTrades", minTrades.trim());
      else next.delete("minTrades");
      if (q.trim()) next.set("q", q.trim());
      else next.delete("q");
      next.set("sort", sort || "recent");
    });
  }

  function toggleSort(key) {
    const text = key === "username" || key === "env" || key === "signal" || key === "config";
    const dir = order?.key === key ? (order.dir === "desc" ? "asc" : "desc") : (text ? "asc" : "desc");
    go((next) => next.set("order", `${key}:${dir}`), { replace: true });
  }

  function closeTop() {
    popupController.current?.abort();
    const focus = openerRef.current;
    if (location.state?.layer) navigate(-1);
    else if (params.get("trade")) go((next) => next.delete("trade"), { replace: true });
    else {
      go((next) => {
        next.delete("panel");
        next.delete("row");
        next.delete("trade");
      }, { replace: true });
    }
    if (params.get("trade")) openerRef.current = layerOpenerRef.current;
    focus?.focus();
  }

  function closeAll() {
    popupController.current?.abort();
    const layers = Number(location.state?.layer) || 0;
    if (layers > 0) navigate(-layers);
    else {
      go((next) => {
        next.delete("panel");
        next.delete("row");
        next.delete("trade");
      }, { replace: true });
    }
    layerOpenerRef.current?.focus();
  }

  function openLayer(kind, row, event) {
    openerRef.current = event?.currentTarget || null;
    layerOpenerRef.current = openerRef.current;
    go((next) => {
      next.set("panel", kind);
      next.set("row", `${row.username}/${row.env}`);
      next.delete("trade");
    }, { layer: true });
  }

  function openStatic(row, event) {
    if (!staticAllowed) return;
    openLayer("static", row, event);
  }

  function openConfig(row, event) {
    openLayer("config", row, event);
  }

  async function loadTargets(signal) {
    const data = await api("/api/bots?limit=100", { signal });
    return (data.bots || []).filter((bot) => canEditResource(user, CONFIG_EDIT, bot));
  }

  function openCopy(row, event) {
    openLayer("copy", row, event);
  }

  function openSync(row, event) {
    openLayer("sync", row, event);
  }

  useEscape(Boolean(panel), closeTop);

  async function loadTargetConfigs(username, row = panel?.row, signal) {
    const data = await api(`/api/bots/${encodeURIComponent(username)}/configs`, { signal });
    if (signal?.aborted) return;
    const configs = (data.configs || []).filter((item) => !(username === row?.username && item.env === row?.env));
    setTargetConfigs(configs);
    setTargetEnv("");
  }

  function openTrade(row, event) {
    if (!panel) return;
    if (params.get("trade") === row.id) {
      closeTop();
      return;
    }
    openerRef.current = event?.currentTarget || null;
    go((next) => next.set("trade", row.id), { layer: true });
  }

  useEffect(() => {
    const id = params.get("trade");
    if (!id || panel?.kind !== "static") {
      setTrade(null);
      return undefined;
    }
    const controller = new AbortController();
    api(`/api/account-statics/${encodeURIComponent(id)}?username=${encodeURIComponent(panel.row.username)}`, { signal: controller.signal })
      .then((next) => setTrade(next))
      .catch((err) => { if (!controller.signal.aborted) setPopupError(err.message || "Không tải được lệnh"); });
    return () => controller.abort();
  }, [params, panel?.kind, panel?.row?.username]);

  async function onCopy(event) {
    event.preventDefault();
    const replacing = copyMode === "replace";
    const env = replacing ? targetEnv : copyName.trim();
    const compared = replacing && targetDetail?.username === targetUser && targetDetail?.env === env;
    if (!panel?.row || !sourceDetail || !targetUser || !env) return;
    if (replacing && (!compared || checkBusy || checkError)) return;
    setPopupBusy(true);
    setPopupError("");
    setNotice("");
    setResultTarget(null);
    try {
      const data = await api(`/api/bots/${encodeURIComponent(panel.row.username)}/configs/${encodeURIComponent(panel.row.env)}/copy`, {
        method: "POST",
        body: { username: targetUser, env, mode: replacing ? "replace" : "new" },
      });
      setResultTarget({ username: data.username, env: data.env });
      setNotice(data.replaced
        ? `Đã ghi đè ${data.username}/${data.env}. Sync của config đích đã được gỡ. Bot nhận bản mới sau khi restart.`
        : `Đã tạo ${data.username}/${data.env}. Bot nhận bản mới sau khi restart.`);
    } catch (err) {
      setPopupError(err.message || "Không copy được");
    } finally {
      setPopupBusy(false);
    }
  }

  async function onSync(event) {
    event.preventDefault();
    const creating = syncMode === "new";
    const env = creating ? copyName.trim() : targetEnv;
    const compared = !creating && targetDetail?.username === targetUser && targetDetail?.env === env;
    if (!panel?.row || !sourceDetail || !targetUser || !env) return;
    if (!creating && (!compared || checkBusy || checkError)) return;
    setPopupBusy(true);
    setPopupError("");
    setNotice("");
    setResultTarget(null);
    try {
      if (creating) {
        const data = await api(`/api/bots/${encodeURIComponent(panel.row.username)}/configs/${encodeURIComponent(panel.row.env)}/copy`, {
          method: "POST",
          body: { username: targetUser, env, mode: "sync" },
        });
        setResultTarget({ username: data.username, env: data.env });
        setNotice(`Đã tạo ${data.username}/${data.env} và gắn sync từ ${panel.row.env}. Bot nhận bản mới sau khi restart.`);
      } else {
        await api(`/api/bots/${encodeURIComponent(targetUser)}/configs/${encodeURIComponent(env)}`, {
          method: "PATCH",
          body: { syncFrom: panel.row.env },
        });
        setResultTarget({ username: targetUser, env });
        setNotice(`Đã gắn ${targetUser}/${env} sync từ ${panel.row.env}. Bot nhận bản mới sau khi restart.`);
      }
    } catch (err) {
      setPopupError(err.message || "Không sync được");
    } finally {
      setPopupBusy(false);
    }
  }

  function openTab(next) {
    const copy = new URLSearchParams(params);
    copy.set("tab", next);
    setParams(copy);
  }

  function findConfig(name) {
    setSignal(name);
    onSearch(null, name);
  }

  const copyAction = copyMode === "replace" ? "replace" : "new";
  const syncAction = syncMode === "new" ? "sync-new" : "sync-existing";
  const copyDest = copyAction === "replace" ? targetEnv : copyName.trim();
  const syncDest = syncAction === "sync-new" ? copyName.trim() : targetEnv;
  const activeDest = panel?.kind === "sync" ? syncDest : copyDest;
  const matchedTarget = targetDetail?.username === targetUser && targetDetail?.env === activeDest ? targetDetail.config : null;
  const sourceLabel = panel?.row ? `${panel.row.username}/${panel.row.env}` : "";
  const copyReady = Boolean(sourceDetail && targetUser && copyDest && (copyAction !== "replace" || (matchedTarget && !checkBusy && !checkError)));
  const syncReady = Boolean(sourceDetail && targetUser && syncDest && (syncAction !== "sync-existing" || (matchedTarget && !checkBusy && !checkError)));

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Signal</h1>
          <p className="muted">
            {tab === "setup"
              ? "Thêm hoặc xoá signal trên config của user đang sở hữu hoặc được gán. Signal đang dùng cũng chỉ đếm các account đó."
              : tab === "stats"
                ? "Channel, lỗi parse, signal bị gỡ vì chuỗi thua, và signal đang chạy trên config của bạn."
                : tab === "history"
                  ? "Bấm một signal để xem lịch sử và số lượng. Tìm config đưa sang bộ lọc config với đúng signal đó."
                  : "Gõ một hoặc nhiều tên, ví dụ SIGNAL_A hoặc SIGNAL_A, BULL. Chỉ hiện config có lệnh thật để chọn bản tốt, rồi xem, copy hoặc sync ngay tại đây."}
          </p>
        </div>
      </header>
      <div className="history-tabs">
        {historyAllowed ? <button type="button" className={tab === "history" ? "active" : "ghost"} onClick={() => openTab("history")}>Lịch sử signal</button> : null}
        {searchAllowed ? <button type="button" className={tab === "search" ? "active" : "ghost"} onClick={() => openTab("search")}>Tìm Signal</button> : null}
        <button type="button" className={tab === "stats" ? "active" : "ghost"} onClick={() => openTab("stats")}>Thống kê Signal</button>
        <button type="button" className={tab === "setup" ? "active" : "ghost"} onClick={() => openTab("setup")}>Cấu hình Signal</button>
      </div>
      {tab === "setup" ? <SignalSetupPanel onFindConfig={searchAllowed ? findConfig : null} /> : null}
      {tab === "stats" ? <SignalStatsPanel onFindConfig={searchAllowed ? findConfig : null} /> : null}
      {tab === "history" ? <SignalLog canSearch={searchAllowed} onFindConfig={findConfig} /> : null}
      {tab === "search" ? <form className="card signal-filters" onSubmit={onSearch}>
        <label>
          Signal
          <input value={signal} placeholder="SIGNAL_A, BULL" onChange={(event) => setSignal(event.target.value)} />
        </label>
        <label>
          Thời gian
          <select value={from || to ? "custom" : days} onChange={(event) => { if (event.target.value === "custom") return; setDays(event.target.value); setFrom(""); setTo(""); }}>
            {from || to ? <option value="custom">Tuỳ chọn</option> : null}
            <option value="1">1 ngày</option>
            <option value="3">3 ngày</option>
            <option value="7">7 ngày</option>
            <option value="30">30 ngày</option>
            <option value="90">90 ngày</option>
          </select>
        </label>
        <label>
          Từ
          <input type="datetime-local" value={toLocalInput(from)} onChange={(event) => setFrom(applyDatePick(from, event.target.value))} />
        </label>
        <label>
          Đến
          <input type="datetime-local" value={toLocalInput(to)} onChange={(event) => setTo(applyDatePick(to, event.target.value))} />
        </label>
        <label>
          Win rate tối thiểu (%)
          <input inputMode="decimal" value={minWinRate} placeholder="50" onChange={(event) => setMinWinRate(event.target.value)} />
        </label>
        <label>
          Lợi nhuận
          <span className="volume-filter-row">
            <select value={profitOp} onChange={(event) => setProfitOp(event.target.value)}>
              <option value="gt">Lớn hơn</option>
              <option value="lt">Bé hơn</option>
            </select>
            <input inputMode="decimal" value={profit} placeholder="0" onChange={(event) => setProfit(event.target.value)} />
          </span>
        </label>
        <label>
          Số lệnh tối thiểu
          <input inputMode="numeric" value={minTrades} placeholder="5" onChange={(event) => setMinTrades(event.target.value)} />
        </label>
        <label>
          User hoặc config
          <input value={q} placeholder="user / tên config" onChange={(event) => setQ(event.target.value)} />
        </label>
        <label>
          Lấy trước
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recent">Lệnh gần nhất</option>
            <option value="profit">Lợi nhuận</option>
            <option value="winrate">Win rate</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !signal.trim()}>{busy ? "Đang tìm…" : "Tìm"}</button>
      </form> : null}
      {tab === "search" && error ? <p className="form-error">{error}</p> : null}
      {tab === "search" && params.get("src") === "summary" ? <p className="muted">Mở từ Tổng kết. Profit ở Tổng kết tính lệnh đóng theo closeTime, không paper. Bảng này là config có lệnh thật, lọc openTime.</p> : null}
      {tab === "search" && shown && range ? <p className="muted">Nguồn: Account Static. Từ {fmtTime(range.from)}{range.to ? ` đến ${fmtTime(range.to)}` : ""}, theo openTime. Bỏ config chưa có lệnh. Win rate là tỷ lệ lệnh có profit &gt; 0, không tính paper.</p> : null}
      {tab === "search" && shown ? (
        shown.length === 0 ? <p className="muted">Không có config có lệnh trong khoảng này.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortHead label="User" name="username" order={order} onSort={toggleSort} />
                  <SortHead label="Config" name="env" order={order} onSort={toggleSort} />
                  <SortHead label="Signal" name="signal" order={order} onSort={toggleSort} />
                  <SortHead label="Lệnh" name="trades" order={order} onSort={toggleSort} />
                  <SortHead label="Win rate" name="winRate" order={order} onSort={toggleSort} />
                  <SortHead label="Profit" name="profit" order={order} onSort={toggleSort} />
                  <SortHead label="Gần nhất" name="lastTime" order={order} onSort={toggleSort} />
                  <SortHead label="Cấu hình" name="config" order={order} onSort={toggleSort} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={`${row.username}/${row.env}`}>
                    <td>{row.username}</td>
                    <td>{row.env}</td>
                    <td>{row.matched.join(", ")}</td>
                    <td>{row.trades}</td>
                    <td>{fmt(row.winRate, 1)}%</td>
                    <td>{fmt(row.profit)}$</td>
                    <td>{fmtTime(row.lastTime)}</td>
                    <td><span className="config-brief muted">{configLine(row)}</span></td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="ghost" onClick={(event) => openConfig(row, event)}>Xem</button>
                        {staticAllowed ? <button type="button" className="ghost" onClick={(event) => openStatic(row, event)}>Static</button> : null}
                        {editAllowed ? <button type="button" className="ghost" onClick={(event) => openCopy(row, event)}>Copy</button> : null}
                        {editAllowed ? <button type="button" className="ghost" onClick={(event) => openSync(row, event)}>Sync</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      {tab === "search" && panel ? (
        <div className="modal-backdrop" onClick={closeAll}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>{panel.row.username} · {panel.row.env} · {(panel.row.matched || []).join(", ")}</h2>
              <button type="button" className="ghost" onClick={closeAll}>Đóng</button>
            </header>
            {popupError ? <p className="form-error">{popupError}</p> : null}
            {notice ? <p className="muted">{notice}</p> : null}
            {resultTarget ? (
              <p className="row-actions">
                <Link className="link-btn" to={`/bots/${encodeURIComponent(resultTarget.username)}/accounts/${encodeURIComponent(resultTarget.env)}`}>
                  Mở config đích
                </Link>
              </p>
            ) : null}
            {popupBusy ? <p className="muted">Đang tải…</p> : null}
            {panel.kind === "config" && detail ? <ConfigGlance config={detail} /> : null}
            {panel.kind === "copy" && !popupBusy ? (
              <form className="action-form transfer-form" onSubmit={onCopy}>
                <p className="muted">{copyMode === "replace" ? "Ghi đè signal, volume, TP, SL và các mục lệnh vào config có sẵn. Sync của config đích sẽ được gỡ." : "Tạo account config mới từ bản này. Cần quyền sửa user đích."}</p>
                <label>
                  Cách copy
                  <select value={copyMode} onChange={(event) => {
                    const mode = event.target.value;
                    setCopyMode(mode);
                    setTargetEnv("");
                    setResultTarget(null);
                    if (mode === "replace" && targetUser) loadTargetConfigs(targetUser).catch((err) => setPopupError(err.message || "Không tải được config"));
                  }}>
                    <option value="new">Tạo config mới</option>
                    <option value="replace">Ghi vào config có sẵn</option>
                  </select>
                </label>
                <label>
                  User đích
                  <select value={targetUser} onChange={(event) => {
                    const username = event.target.value;
                    setTargetUser(username);
                    setTargetEnv("");
                    setTargetConfigs([]);
                    setResultTarget(null);
                    if (copyMode === "replace" && username) loadTargetConfigs(username).catch((err) => setPopupError(err.message || "Không tải được config"));
                  }}>
                    <option value="">{targets.length === 0 ? "Không có user bạn được sửa" : "Chọn user đích"}</option>
                    {targets.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}
                  </select>
                </label>
                {copyMode === "replace" ? (
                  <label>
                    Config nhận bản copy
                    <select value={targetEnv} onChange={(event) => { setTargetEnv(event.target.value); setResultTarget(null); }}>
                      <option value="">{targetConfigs.length === 0 ? "Không có config" : "Chọn config"}</option>
                      {targetConfigs.map((item) => <option key={item.env} value={item.env}>{item.env}</option>)}
                    </select>
                  </label>
                ) : (
                  <label>
                    Tên config mới
                    <input value={copyName} onChange={(event) => { setCopyName(event.target.value); setResultTarget(null); }} required />
                  </label>
                )}
                {copyDest && targetUser && sourceDetail ? (
                  <TransferCheck
                    action={copyAction}
                    sourceLabel={sourceLabel}
                    targetLabel={`${targetUser}/${copyDest}`}
                    source={sourceDetail}
                    target={copyAction === "replace" ? matchedTarget : null}
                    busy={copyAction === "replace" && checkBusy}
                    error={copyAction === "replace" ? checkError : ""}
                  />
                ) : <p className="muted">Chọn đích để xem nguồn, vốn, Live/Paper, On và SL/TP trước khi ghi.</p>}
                <button type="submit" className={copyAction === "replace" ? "danger" : undefined} disabled={popupBusy || !copyReady}>{copyAction === "replace" ? "Ghi đè cấu hình" : "Tạo bản sao"}</button>
              </form>
            ) : null}
            {panel.kind === "sync" && !popupBusy ? (
              <form className="action-form transfer-form" onSubmit={onSync}>
                <p className="muted">{syncMode === "new" ? "Tạo config mới, chép nội dung bản này và để nó theo gốc. Gốc đổi thì nhánh bị ghi đè." : "Gắn một config của bạn theo bản này. Nhánh bị ghi đè khi gốc đổi, trừ nhóm trong Sync except."}</p>
                <label>
                  Cách sync
                  <select value={syncMode} onChange={(event) => {
                    const mode = event.target.value;
                    setSyncMode(mode);
                    setTargetEnv("");
                    setResultTarget(null);
                    if (mode === "existing" && targetUser) loadTargetConfigs(targetUser).catch((err) => setPopupError(err.message || "Không tải được config"));
                  }}>
                    <option value="existing">Config có sẵn</option>
                    <option value="new">Config mới</option>
                  </select>
                </label>
                <label>
                  User của bạn
                  <select value={targetUser} onChange={(event) => {
                    const username = event.target.value;
                    setTargetUser(username);
                    setTargetEnv("");
                    setTargetConfigs([]);
                    setResultTarget(null);
                    if (syncMode === "existing" && username) loadTargetConfigs(username).catch((err) => setPopupError(err.message || "Không tải được config"));
                  }}>
                    <option value="">{targets.length === 0 ? "Không có user bạn được sửa" : "Chọn user đích"}</option>
                    {targets.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}
                  </select>
                </label>
                {syncMode === "new" ? (
                  <label>
                    Tên config mới
                    <input value={copyName} onChange={(event) => { setCopyName(event.target.value); setResultTarget(null); }} required />
                  </label>
                ) : (
                  <label>
                    Config nhận sync
                    <select value={targetEnv} onChange={(event) => { setTargetEnv(event.target.value); setResultTarget(null); }}>
                      <option value="">{targetConfigs.length === 0 ? "Không có config" : "Chọn config"}</option>
                      {targetConfigs.map((item) => <option key={item.env} value={item.env}>{item.env}</option>)}
                    </select>
                  </label>
                )}
                {syncDest && targetUser && sourceDetail ? (
                  <TransferCheck
                    action={syncAction}
                    sourceLabel={sourceLabel}
                    targetLabel={`${targetUser}/${syncDest}`}
                    source={sourceDetail}
                    target={syncAction === "sync-existing" ? matchedTarget : null}
                    busy={syncAction === "sync-existing" && checkBusy}
                    error={syncAction === "sync-existing" ? checkError : ""}
                  />
                ) : <p className="muted">Chọn đích để xem nguồn, vốn, Live/Paper, On và SL/TP trước khi ghi.</p>}
                <button type="submit" disabled={popupBusy || !syncReady}>Thiết lập đồng bộ</button>
              </form>
            ) : null}
            {panel.kind === "static" && trades?.stats ? <p className="muted">{trades.stats.total} lệnh · lãi {fmt(trades.stats.profit)}$ · win rate {fmt(trades.stats.winRate, 1)}%</p> : null}
            {panel.kind === "static" && trade ? (
              <article className="card trade-detail">
                <header>
                  <h2>{trade.symbol || "Giao dịch"} · {trade.side || "—"}</h2>
                  <button type="button" className="ghost" onClick={closeTop}>Đóng lệnh</button>
                </header>
                <dl>
                  <DetailItem label="Config" value={trade.env} />
                  <DetailItem label="Signal" value={trade.signal} />
                  <DetailItem label="Status" value={trade.status} />
                  <DetailItem label="Profit" value={`${fmt(trade.profit)} $`} />
                  <DetailItem label="ROE" value={`${fmt(trade.roe)} %`} />
                  <DetailItem label="Volume" value={`${fmt(trade.volume)} $`} />
                  <DetailItem label="Mở" value={fmtTime(trade.openTime)} />
                  <DetailItem label="Đóng" value={fmtTime(trade.closeTime)} />
                  <DetailItem label="Paper" value={trade.paper ? "Có" : "Không"} />
                </dl>
              </article>
            ) : null}
            {panel.kind === "static" && trades?.rows?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Signal</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Status</th>
                      <th>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.rows.map((row) => (
                      <tr key={row.id} className="trade-row" tabIndex={0} onClick={(event) => openTrade(row, event)} onKeyDown={(event) => { if (event.key === "Enter") openTrade(row, event); }}>
                        <td>{fmtTime(row.openTime)}</td>
                        <td>{row.signal}</td>
                        <td>{row.symbol}</td>
                        <td>{row.side}</td>
                        <td>{row.status}</td>
                        <td>{fmt(row.profit)}$</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : panel.kind === "static" && trades && !popupBusy ? <p className="muted">Không có lệnh trong khoảng này.</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
