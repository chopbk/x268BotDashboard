import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import MarketLocationTable from "../components/market/MarketLocationTable";
import { useEscape } from "../navigation";
import {
  normalizeTopParam,
  normalizeViewParam,
  normalizeAnalysisTfParam,
  TOP_OPTIONS,
  ANALYSIS_TFS,
} from "../lib/market-hub";
import { fmtMarketPrice } from "../lib/market-price";
import "./market.css";

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"];
const STYLES = [
  { id: "intraday", label: "Trong ngày" },
  { id: "scalp", label: "Ngắn hạn" },
  { id: "swing", label: "Swing" },
];
const SIGNAL_HOURS = 72;

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtVol(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(Math.round(n));
}

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("vi-VN");
}

function biasClass(bias) {
  if (bias === "long") return "mkt-long";
  if (bias === "short") return "mkt-short";
  return "mkt-wait";
}

function cellLabel(cell) {
  if (!cell || cell.quality === "missing") return { text: "—", cls: "mkt-wait" };
  if (cell.quality === "pending") return { text: "…", cls: "mkt-warm" };
  if (cell.quality === "warming") return { text: "Warm", cls: "mkt-warm" };
  if (cell.bias === "long" && cell.lead != null) return { text: `L${fmt(cell.lead, 0)}`, cls: "mkt-long" };
  if (cell.bias === "short" && cell.lead != null) return { text: `S${fmt(cell.lead, 0)}`, cls: "mkt-short" };
  if (cell.longScore != null || cell.shortScore != null) {
    return { text: "Chờ", cls: "mkt-wait" };
  }
  return { text: "—", cls: "mkt-wait" };
}

function statusLabel(status) {
  if (status === "lean_long") return "Thiên Long";
  if (status === "lean_short") return "Thiên Short";
  if (status === "conflict") return "Mâu thuẫn";
  if (status === "incomplete") return "Thiếu khung";
  return "Chờ";
}

function compositeLabel(c) {
  if (!c) return "—";
  if (c.status === "lean_long" && c.long != null) return `L${fmt(c.long, 0)}`;
  if (c.status === "lean_short" && c.short != null) return `S${fmt(c.short, 0)}`;
  if (c.long != null || c.short != null) return "Chờ";
  return "—";
}

function relTime(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 60) return `${mins}p`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / (60 * 24))}d`;
}

function sideShort(side) {
  if (side === "LONG") return "L";
  if (side === "SHORT") return "S";
  return "?";
}

function qualityLabel(q) {
  if (q === "fresh" || q === "ready") return "đủ";
  if (q === "stale") return "cũ";
  if (q === "warming" || q === "pending") return "đang nóng";
  if (q === "missing") return "thiếu";
  if (q === "error") return "lỗi";
  return q || "—";
}

function fmtPctSafe(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${fmt(value, 2)}%`;
}

function signalCellLabel(pack) {
  if (!pack?.count || !pack.latest) return { text: "—", cls: "mkt-wait", title: "Không có signal trong cửa sổ" };
  const latest = pack.latest;
  const name = String(latest.signal || "?").slice(0, 8);
  const side = sideShort(latest.side);
  const age = relTime(latest.openTime);
  const extra = pack.count > 1 ? ` ·${pack.count}` : "";
  const cls = latest.side === "LONG" ? "mkt-long" : latest.side === "SHORT" ? "mkt-short" : "mkt-wait";
  return {
    text: `${name}${side}${extra}${age ? ` ${age}` : ""}`,
    cls,
    title: `${latest.signal || "?"} ${latest.side || "—"} · ${pack.count} signal / ${SIGNAL_HOURS}h`,
  };
}

/** Signal đáng chú ý: mới nhất + cùng chiều lean kỹ thuật (nếu có). */
function notableSignals(pack, composite) {
  const recent = pack?.recent || [];
  if (!recent.length) return [];
  const lean =
    composite?.status === "lean_long" ? "LONG" : composite?.status === "lean_short" ? "SHORT" : null;
  const scored = recent.map((row, index) => {
    let score = recent.length - index;
    if (lean && row.side === lean) score += 10;
    if (String(row.status || "").toUpperCase() === "OPEN") score += 3;
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const seen = new Set();
  for (const item of scored) {
    const key = item.row.id || `${item.row.signal}-${item.row.openTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ ...item.row, matchLean: lean && item.row.side === lean });
    if (picked.length >= 5) break;
  }
  return picked;
}

export default function MarketPage({
  embedded = false,
  canFlow = false,
  canTerminal = true,
} = {}) {
  const [params, setParams] = useSearchParams();
  const symbol = (params.get("symbol") || "").toUpperCase();
  const view = normalizeViewParam(params.get("view"));
  const analysisTf = normalizeAnalysisTfParam(params.get("analysisTf"));
  const top = normalizeTopParam(params.get("top"), 10);
  const screen = params.get("screen") || "all";
  const entrySource = params.get("entrySource") === "signal" ? "signal" : "technical";
  const recentHours = ["24", "72", "168"].includes(params.get("recentHours") || "")
    ? params.get("recentHours")
    : "72";
  const style = STYLES.some((s) => s.id === params.get("style")) ? params.get("style") : "intraday";
  const timeframe = TIMEFRAMES.includes(params.get("tf")) ? params.get("tf") : "";
  const focusSignals = params.get("signals") === "1";
  const q = params.get("q") || "";
  const side = params.get("side") || "";
  const regime = params.get("regime") || "";
  const minScore = params.get("minScore") || "";
  const consensus = params.get("consensus") === "1";
  const fresh = params.get("fresh") === "1";
  const sort = params.get("sort") || "";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";
  const pollRef = useRef(null);
  const pollInFlight = useRef(false);
  const pollGen = useRef(0);
  const pollStopped = useRef(false);
  const pollBackoffMs = useRef(30_000);
  const tableRef = useRef(null);
  const lastFocusedSymbol = useRef(null);

  const [overview, setOverview] = useState(null);
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState(null);
  const [signalMap, setSignalMap] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [briefFocus, setBriefFocus] = useState(null);

  const patchParams = useCallback(
    (patch, { replace = false } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === "" || v === false) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace }
      );
    },
    [setParams]
  );

  const loadList = useCallback(async () => {
    const qs = new URLSearchParams();
    qs.set("top", String(top));
    if (q) qs.set("q", q);
    if (view === "location") {
      qs.set("view", "location");
      qs.set("analysisTf", analysisTf);
      qs.set("screen", screen);
      qs.set("entrySource", entrySource);
      qs.set("recentHours", recentHours);
      if (canFlow && screen === "flow_aligned") qs.set("includeFlow", "1");
      if (sort) qs.set("sort", sort);
      if (dir) qs.set("dir", dir);
      return api(`/api/market/symbols?${qs}`);
    }
    qs.set("style", style);
    qs.set("limit", String(top));
    if (side) qs.set("side", side);
    if (regime) qs.set("regime", regime);
    if (minScore) qs.set("minScore", minScore);
    if (consensus) qs.set("consensus", "1");
    if (fresh) qs.set("fresh", "1");
    if (sort) qs.set("sort", sort);
    if (dir) qs.set("dir", dir);
    return api(`/api/market/symbols?${qs}`);
  }, [view, analysisTf, screen, entrySource, recentHours, top, canFlow, style, q, side, regime, minScore, consensus, fresh, sort, dir]);

  const activeSort = list?.sort || sort || "composite";
  const activeDir = list?.dir || dir;

  const onSortColumn = useCallback(
    (key) => {
      if (activeSort === key) {
        patchParams({ sort: key, dir: activeDir === "asc" ? "desc" : "asc" });
      } else {
        // Symbol mặc định A→Z; số liệu mặc định cao→thấp.
        patchParams({ sort: key, dir: key === "symbol" ? "asc" : "desc" });
      }
    },
    [activeSort, activeDir, patchParams]
  );

  function SortTh({ col, children, className = "" }) {
    const active = activeSort === col;
    const mark = !active ? "" : activeDir === "asc" ? " ↑" : " ↓";
    return (
      <th className={className} aria-sort={active ? (activeDir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className={active ? "th-sort active" : "th-sort"} onClick={() => onSortColumn(col)}>
          {children}
          {mark}
        </button>
      </th>
    );
  }

  const overviewUrl = useCallback(() => {
    const qs = new URLSearchParams();
    if (view === "location") qs.set("analysisTf", analysisTf);
    const s = qs.toString();
    return s ? `/api/market/overview?${s}` : "/api/market/overview";
  }, [view, analysisTf]);

  const handlePollError = useCallback((err) => {
    const status = err?.status;
    if (status === 401 || status === 403) {
      pollStopped.current = true;
      setError(err.message || "Hết phiên hoặc không có quyền — dừng poll");
      return;
    }
    if (status === 429 || status === 503) {
      pollBackoffMs.current = Math.min(120_000, (pollBackoffMs.current || 30_000) * 2);
      setError(err.message || `Nguồn tạm thời (${status}) — backoff ${Math.round(pollBackoffMs.current / 1000)}s`);
      return;
    }
    // Giữ snapshot cũ; chỉ báo lỗi tạm
    if (err?.message) setError(err.message);
  }, []);

  useEffect(() => {
    let cancelled = false;
    pollStopped.current = false;
    pollBackoffMs.current = 30_000;
    setLoading(true);
    setError("");
    const gen = ++pollGen.current;
    Promise.all([api(overviewUrl()), loadList()])
      .then(([ov, listBody]) => {
        if (cancelled || gen !== pollGen.current) return;
        setOverview(ov);
        setList(listBody);
      })
      .catch((err) => {
        if (!cancelled) {
          handlePollError(err);
          if (!(err?.status === 401 || err?.status === 403)) {
            setError(err.message || "Lỗi tải Thị trường");
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadList, overviewUrl, handlePollError]);

  // Poll: warming 12s hoặc ổn định 30s — serial, pause hidden, discard cũ, không POST.
  useEffect(() => {
    pollStopped.current = false;
    const warming = overview?.progress && !overview.progress.complete;
    const baseMs = warming ? 12_000 : 30_000;

    async function tick() {
      if (pollStopped.current) return;
      if (document.visibilityState === "hidden") return;
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      const gen = ++pollGen.current;
      try {
        const [ov, listBody] = await Promise.all([api(overviewUrl()), loadList()]);
        if (gen !== pollGen.current) return;
        setOverview(ov);
        setList(listBody);
        pollBackoffMs.current = baseMs;
        setError((prev) => (prev && /backoff|tạm thời/i.test(prev) ? "" : prev));
      } catch (err) {
        if (gen === pollGen.current) handlePollError(err);
      } finally {
        pollInFlight.current = false;
      }
    }

    function schedule() {
      clearInterval(pollRef.current);
      const ms = Math.max(baseMs, pollBackoffMs.current || baseMs);
      pollRef.current = setInterval(tick, ms);
    }

    schedule();
    const onVis = () => {
      if (document.visibilityState === "visible" && !pollStopped.current) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVis);
      pollGen.current += 1;
    };
  }, [overview?.progress?.complete, overview?.progress?.scored, loadList, overviewUrl, handlePollError]);

  useEffect(() => {
    if (!symbol) {
      setDetail(null);
      setHistory(null);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({ style });
    if (timeframe) qs.set("timeframe", timeframe);
    if (view === "location") {
      qs.set("view", "location");
      qs.set("analysisTf", analysisTf);
      qs.set("recentHours", recentHours);
    }
    Promise.all([
      api(`/api/market/symbols/${encodeURIComponent(symbol)}?${qs}`),
      api(`/api/market/symbols/${encodeURIComponent(symbol)}/scores?limit=30`),
    ])
      .then(([d, h]) => {
        if (cancelled) return;
        setDetail(d);
        setHistory(h);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Lỗi chi tiết");
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, style, timeframe, view, analysisTf, recentHours]);

  const listSymbolsKey = (list?.rows || []).map((r) => r.symbol).join(",");

  useEffect(() => {
    if (!listSymbolsKey) {
      setSignalMap(null);
      return undefined;
    }
    let cancelled = false;
    const qs = new URLSearchParams({
      symbols: listSymbolsKey,
      hours: String(SIGNAL_HOURS),
      perSymbol: "5",
    });
    api(`/api/market/recent-signals?${qs}`)
      .then((body) => {
        if (!cancelled) setSignalMap(body?.bySymbol || {});
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[MarketPage:signals]", err.message || err);
          setSignalMap({});
        }
      });
    return () => {
      cancelled = true;
    };
  }, [listSymbolsKey]);

  useEffect(() => {
    if (!focusSignals || !symbol) return undefined;
    const el = document.getElementById("mkt-signals-panel");
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return undefined;
  }, [focusSignals, symbol, signalMap, detail]);

  const mobileTf = timeframe || "15m";
  const symbolSignals = symbol && signalMap ? signalMap[symbol] : null;
  const notableForSymbol = useMemo(
    () => notableSignals(symbolSignals, detail?.composite || list?.rows?.find((r) => r.symbol === symbol)?.composite),
    [symbolSignals, detail?.composite, list?.rows, symbol]
  );

  const breakdownRows = useMemo(() => {
    const frame = detail?.frame || (timeframe ? detail?.snapshot?.timeframes?.[timeframe] : null);
    const tf = timeframe || "15m";
    const f = frame || detail?.snapshot?.timeframes?.[tf];
    if (!f?.breakdown?.length) return [];
    const byId = new Map();
    for (const r of f.breakdown) {
      if (!byId.has(r.id)) byId.set(r.id, { id: r.id, value: r.value, condition: r.condition, long: 0, short: 0, max: r.maxPoints });
      const row = byId.get(r.id);
      if (r.side === "long") row.long = r.points;
      if (r.side === "short") row.short = r.points;
      if (r.value != null) row.value = r.value;
      if (r.condition) row.condition = r.condition;
    }
    return [...byId.values()];
  }, [detail, timeframe]);

  async function onRefresh() {
    setRefreshing(true);
    setError("");
    try {
      await api("/api/market/refresh", { method: "POST", body: {} });
      const [ov, listBody] = await Promise.all([api(overviewUrl()), loadList()]);
      setOverview(ov);
      setList(listBody);
    } catch (err) {
      setError(err.message || "Refresh thất bại (cần market.manage)");
    } finally {
      setRefreshing(false);
    }
  }

  const closePanel = useCallback(() => {
    const prev = symbol;
    lastFocusedSymbol.current = prev || lastFocusedSymbol.current;
    patchParams({ symbol: null, tf: null, signals: null });
    requestAnimationFrame(() => {
      const sym = lastFocusedSymbol.current;
      if (sym && tableRef.current?.focusSymbol) tableRef.current.focusSymbol(sym);
    });
  }, [symbol, patchParams]);

  useEscape(Boolean(symbol), closePanel);

  const selectSymbol = useCallback(
    (sym) => {
      lastFocusedSymbol.current = sym;
      patchParams({ symbol: sym, signals: null });
    },
    [patchParams]
  );

  const coverage = overview?.coverage || {};
  const progress = overview?.progress || {};
  const ctx = overview?.context || null;
  const briefStatements = ctx?.brief?.statements || [];
  const dc = detail?.decisionContext || null;
  const detailSymbolInfo =
    detail?.symbolInfo || list?.rows?.find((r) => r.symbol === symbol)?.symbolInfo || null;

  const TitleTag = embedded ? "h2" : "h1";

  return (
    <div className="mkt-page">
      <header className="mkt-header">
        <div>
          <TitleTag>
            {embedded ? "Kỹ thuật · Futures theo volume24h" : "Thị trường · Futures theo volume24h"}
          </TitleTag>
          <p className="mkt-sub">
            {view === "location"
              ? "Vị trí giá so với hỗ trợ/kháng cự, setup kỹ thuật — không phải lệnh mua/bán."
              : "Scoring Long/Short độc lập trên 5m–1d (chỉ nến đóng). Điểm market-v1 không phải xác suất thắng."}
          </p>
          <p className="mkt-meta-line" aria-label="Nguồn phạm vi cập nhật chất lượng">
            <span>Nguồn: Binance USDM cache · {overview?.formulaVersion || "market-v1"}</span>
            <span>
              Phạm vi: Top {top}
              {view === "location" ? ` · khung ${analysisTf}` : ""} · universe {overview?.universe?.count ?? "—"}
              {overview?.universe?.version != null ? ` (v${overview.universe.version})` : ""}
            </span>
            <span>Cập nhật: {when(ctx?.asOf || overview?.universe?.refreshedAt)}</span>
            <span>
              Chất lượng: {qualityLabel(ctx?.quality)} · {coverage.label || "—"}
            </span>
          </p>
        </div>
        <div className="mkt-meta">
          <button type="button" className="ghost" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "Đang refresh…" : "Refresh collector"}
          </button>
        </div>
      </header>

      {progress.total ? (
        <div className={`mkt-banner ${progress.complete ? "" : "mkt-progress"}`}>
          {progress.complete ? (
            <>Đã chấm đủ {progress.scored}/{progress.total} symbol.</>
          ) : (
            <>
              <strong>Đang tính dần:</strong> giá/%/volume hiện trước · điểm{" "}
              <strong>{progress.scored ?? 0}/{progress.total}</strong>
              {progress.etaLabel ? <> · còn khoảng <strong>{progress.etaLabel}</strong></> : null}
              <div className="mkt-progress-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.round(((progress.scored || 0) / progress.total) * 100))}%` }} />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {progress.bootstrapHint || "Ô khung hiện “…” cho đến khi nến đủ và score xong."}
              </div>
            </>
          )}
        </div>
      ) : null}

      <div className="mkt-context-cards" id="mkt-context">
        {ctx?.btc4h && ctx.btc4h.quality !== "missing" ? (
          <button
            type="button"
            className={`mkt-ctx-card ${briefFocus === "btc4h" ? "active" : ""}`}
            onClick={() => setBriefFocus("btc4h")}
          >
            <span className="mkt-ctx-label">BTC 4h</span>
            <strong>
              {ctx.btc4h.value?.structureLabel || ctx.btc4h.value?.structureBias || "—"}
              {ctx.btc4h.value?.regime ? ` · ${ctx.btc4h.value.regime}` : ""}
            </strong>
            <span className="muted">
              {qualityLabel(ctx.btc4h.quality)} · {when(ctx.btc4h.asOf)}
            </span>
          </button>
        ) : (
          <div className="mkt-ctx-card mkt-ctx-missing">
            <span className="mkt-ctx-label">BTC 4h</span>
            <strong>Thiếu dữ liệu</strong>
            <span className="muted">{ctx?.btc4h?.reason || "không có snapshot BTC"}</span>
          </div>
        )}
        {ctx?.breadth?.value ? (
          <button
            type="button"
            className={`mkt-ctx-card ${briefFocus === "breadth" ? "active" : ""}`}
            onClick={() => setBriefFocus("breadth")}
          >
            <span className="mkt-ctx-label">Độ rộng 1h</span>
            <strong>
              L {ctx.breadth.value.leanLong}/{ctx.breadth.value.universeTotal} · S {ctx.breadth.value.leanShort}/
              {ctx.breadth.value.universeTotal}
            </strong>
            <span className="muted">
              thiếu {ctx.breadth.value.missing ?? "—"}/{ctx.breadth.value.universeTotal} ·{" "}
              {qualityLabel(ctx.breadth.quality)}
            </span>
          </button>
        ) : null}
        {ctx?.volatility && ctx.volatility.quality !== "missing" ? (
          <button
            type="button"
            className={`mkt-ctx-card ${briefFocus === "volatility" ? "active" : ""}`}
            onClick={() => setBriefFocus("volatility")}
          >
            <span className="mkt-ctx-label">Biến động</span>
            <strong>ATR% BTC 4h {fmtPctSafe(ctx.volatility.value?.atrPct)}</strong>
            <span className="muted">không gắn nhãn cực đoan · {qualityLabel(ctx.volatility.quality)}</span>
          </button>
        ) : null}
        {ctx?.setupCounts && ctx.setupCounts.quality !== "missing" ? (
          <button
            type="button"
            className={`mkt-ctx-card ${briefFocus === "setups" ? "active" : ""}`}
            onClick={() => setBriefFocus("setups")}
          >
            <span className="mkt-ctx-label">Setup · {ctx.setupCounts.value?.analysisTf || analysisTf}</span>
            <strong>
              {ctx.setupCounts.value?.active ?? "—"} active · {ctx.setupCounts.value?.inEntry ?? "—"} in-entry
            </strong>
            <span className="muted">{ctx.setupCounts.value?.scope || "universe"}</span>
          </button>
        ) : null}
      </div>

      {briefStatements.length ? (
        <div className="mkt-brief" role="region" aria-label="Tóm tắt bối cảnh">
          {briefStatements.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`mkt-brief-item ${briefFocus === s.id ? "active" : ""}`}
              onClick={() => {
                setBriefFocus(s.id);
                document.getElementById("mkt-context")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
              }}
            >
              {s.text}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mkt-filters">
        <label>
          Chế độ
          <select value={view} onChange={(e) => patchParams({ view: e.target.value })}>
            <option value="location">Vị trí & Setup</option>
            <option value="scores">Điểm đa khung</option>
          </select>
        </label>
        <label title="Số dòng tối đa hiển thị">
          Top
          <select value={String(top)} onChange={(e) => patchParams({ top: e.target.value })}>
            {TOP_OPTIONS.map((n) => (
              <option key={n} value={n}>Top {n}</option>
            ))}
          </select>
        </label>
        <label>
          Symbol
          <input value={q} onChange={(e) => patchParams({ q: e.target.value }, { replace: true })} placeholder="BTC…" />
        </label>
        {view === "location" ? (
          <>
            <label>
              Khung phân tích
              <select value={analysisTf} onChange={(e) => patchParams({ analysisTf: e.target.value })}>
                {ANALYSIS_TFS.map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </label>
            <label>
              Màn hình
              <select value={screen} onChange={(e) => patchParams({ screen: e.target.value })}>
                <option value="all">Tất cả</option>
                <option value="near_support">Gần hỗ trợ</option>
                <option value="near_resistance">Gần kháng cự</option>
                <option value="buy_zone">Vùng mua (setup)</option>
                <option value="sell_zone">Vùng bán (setup)</option>
                <option value="entry_long">Còn entry Long</option>
                <option value="entry_short">Còn entry Short</option>
                <option value="retest">Retest gần đây</option>
                {canFlow ? <option value="flow_aligned">Đồng thuận flow</option> : null}
              </select>
            </label>
            <label>
              Nguồn entry
              <select value={entrySource} onChange={(e) => patchParams({ entrySource: e.target.value })}>
                <option value="technical">Setup kỹ thuật</option>
                <option value="signal">Signal kênh</option>
              </select>
            </label>
            <label>
              Signal trong
              <select value={recentHours} onChange={(e) => patchParams({ recentHours: e.target.value })}>
                <option value="24">24h</option>
                <option value="72">72h</option>
                <option value="168">7d</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              Phong cách
              <select value={style} onChange={(e) => patchParams({ style: e.target.value })}>
                {STYLES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              Side
              <select value={side} onChange={(e) => patchParams({ side: e.target.value || null })}>
                <option value="">Tất cả</option>
                <option value="lean_long">Thiên Long</option>
                <option value="lean_short">Thiên Short</option>
                <option value="wait">Chờ</option>
              </select>
            </label>
            <label>
              Regime 1h
              <select value={regime} onChange={(e) => patchParams({ regime: e.target.value || null })}>
                <option value="">Tất cả</option>
                <option value="trending">Trending</option>
                <option value="ranging">Ranging</option>
                <option value="transitional">Transitional</option>
              </select>
            </label>
            <label>
              Điểm ≥
              <input
                type="number"
                min="0"
                max="100"
                value={minScore}
                onChange={(e) => patchParams({ minScore: e.target.value || null }, { replace: true })}
              />
            </label>
            <label className="mkt-check">
              <input type="checkbox" checked={consensus} onChange={(e) => patchParams({ consensus: e.target.checked || null })} />
              Ứng viên đủ ĐK
            </label>
            <label className="mkt-check">
              <input type="checkbox" checked={fresh} onChange={(e) => patchParams({ fresh: e.target.checked || null })} />
              Chỉ dữ liệu mới
            </label>
          </>
        )}
      </div>

      {error ? <div className="mkt-banner">{error}</div> : null}
      {overview?.note ? <p className="muted mkt-sub">{overview.note}</p> : null}

      <div className={`mkt-layout ${symbol ? "has-detail" : ""}`}>
        <div className="mkt-table-wrap panel">
          {view === "location" ? (
            <MarketLocationTable
              ref={tableRef}
              rows={list?.rows || []}
              symbol={symbol}
              canFlow={canFlow}
              top={top}
              loading={loading}
              onSelect={selectSymbol}
            />
          ) : loading && !list ? (
            <div className="mkt-empty mkt-skel">Đang tải giá top 50…</div>
          ) : !list?.rows?.length ? (
            <div className="mkt-empty">
              Chưa có universe — collector chưa chạy hoặc không lấy được ticker.
            </div>
          ) : (
            <table className="mkt-table">
              <thead>
                <tr>
                  <SortTh col="symbol">Symbol</SortTh>
                  <SortTh col="price" className="num">Giá</SortTh>
                  <SortTh col="change" className="num mkt-col-hide-mobile">%24h</SortTh>
                  <SortTh col="volume" className="num">Vol24h</SortTh>
                  {TIMEFRAMES.map((tf) => (
                    <SortTh
                      key={tf}
                      col={tf}
                      className={`num ${tf !== mobileTf && tf !== "1h" && tf !== "4h" ? "mkt-col-hide-mobile" : ""}`}
                    >
                      {tf}
                    </SortTh>
                  ))}
                  <SortTh col="composite" className="num">Tổng hợp</SortTh>
                  <th title={`Signal gần đây (${SIGNAL_HOURS}h)`}>Signal</th>
                  <SortTh col="status">Trạng thái</SortTh>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => {
                  const selected = row.symbol === symbol;
                  const sigLab = signalCellLabel(signalMap?.[row.symbol]);
                  return (
                    <tr
                      key={row.symbol}
                      className={selected ? "selected" : ""}
                      onClick={() => selectSymbol(row.symbol)}
                    >
                      <td>
                        <strong>{row.symbol}</strong>
                        {!row.inTop ? <span className="muted"> · ngoài top</span> : null}
                        {canFlow ? (
                          <>
                            {" "}
                            <Link
                              className="mkt-flow-link"
                              to={`/market?tab=flow&flowTab=overview&symbol=${encodeURIComponent(row.symbol)}&top=${top}`}
                              aria-label={`Xem dòng tiền ${row.symbol}`}
                              title={`Xem dòng tiền ${row.symbol}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Dòng tiền
                            </Link>
                          </>
                        ) : null}
                      </td>
                      <td className="num">{fmtMarketPrice(row.price?.last, row.symbolInfo)}</td>
                      <td className={`num mkt-col-hide-mobile ${Number(row.price?.changePct24h) >= 0 ? "mkt-long" : "mkt-short"}`}>
                        {row.price?.changePct24h == null ? "—" : `${fmt(row.price.changePct24h, 2)}%`}
                      </td>
                      <td className="num">{fmtVol(row.price?.volume24h)}</td>
                      {TIMEFRAMES.map((tf) => {
                        const cell = row.cells?.[tf];
                        const lab = cellLabel(cell);
                        const hide = tf !== mobileTf && tf !== "1h" && tf !== "4h";
                        return (
                          <td key={tf} className={`num ${hide ? "mkt-col-hide-mobile" : ""}`}>
                            <button
                              type="button"
                              className={`mkt-cell ${lab.cls} ${cell?.quality === "stale" ? "mkt-stale" : ""}`}
                              title={cell ? `L${fmt(cell.longScore)} / S${fmt(cell.shortScore)} · ${cell.regime || "—"} · ${cell.quality || ""}` : ""}
                              onClick={(e) => {
                                e.stopPropagation();
                                patchParams({ symbol: row.symbol, tf, signals: null });
                              }}
                            >
                              {lab.text}
                            </button>
                          </td>
                        );
                      })}
                      <td className={`num ${biasClass(row.composite?.lean === "lean_long" ? "long" : row.composite?.lean === "lean_short" ? "short" : "wait")}`}>
                        {compositeLabel(row.composite)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`mkt-cell mkt-sig-cell ${sigLab.cls}`}
                          title={sigLab.title}
                          onClick={(e) => {
                            e.stopPropagation();
                            patchParams({ symbol: row.symbol, signals: "1", tf: null });
                          }}
                        >
                          {signalMap == null ? "…" : sigLab.text}
                        </button>
                      </td>
                      <td>
                        {row.pending ? (
                          <span className="mkt-status mkt-warm">Đang tính…</span>
                        ) : (
                          <span className={`mkt-status ${row.composite?.status || ""}`}>
                            {statusLabel(row.composite?.status)}
                          </span>
                        )}
                        {row.qualityOverall && row.qualityOverall !== "ready" && !row.pending ? (
                          <div className="muted" style={{ fontSize: 11 }}>{row.qualityOverall}</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {symbol ? (
          <aside className="mkt-detail panel">
            {!detail ? (
              <div className="mkt-empty mkt-skel">Đang tải {symbol}…</div>
            ) : (
              <>
                <div className="mkt-detail-head">
                  <h2>{symbol}</h2>
                  <button type="button" className="ghost" onClick={closePanel}>
                    Đóng
                  </button>
                </div>
                <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                  {detail.composite
                    ? `${statusLabel(detail.composite.status)} · L${fmt(detail.composite.compositeLong)} / S${fmt(detail.composite.compositeShort)} · ${style}`
                    : "Chưa có composite"}
                  {" · "}
                  {detail.snapshot?.qualityOverall || "—"}
                  {" · "}
                  {detail.snapshot?.formulaVersion}
                </p>
                <div className="mkt-detail-links">
                  {canFlow ? (
                    <Link to={`/market?tab=flow&flowTab=overview&symbol=${encodeURIComponent(symbol)}`}>
                      Xem dòng tiền
                    </Link>
                  ) : null}
                  {canTerminal ? (
                    <Link to={`/terminal?symbol=${encodeURIComponent(symbol)}`}>Terminal</Link>
                  ) : null}
                  <Link to={`/signal-search?tab=history&symbol=${encodeURIComponent(symbol)}`}>
                    Lịch sử signal
                  </Link>
                </div>

                {dc ? (
                  <section className="mkt-decision" aria-label="Luận điểm quyết định">
                    <h3 style={{ margin: "8px 0 4px", fontSize: 13 }}>
                      Định vị · {dc.analysisTf || analysisTf}
                      <span className="muted"> · {qualityLabel(dc.quality)}</span>
                    </h3>
                    <p className="muted" style={{ fontSize: 12, margin: "0 0 6px" }}>
                      Giá {fmtMarketPrice(dc.positioning?.price, detailSymbolInfo)} · nguồn{" "}
                      {dc.positioning?.priceSource || "—"} ·{" "}
                      {dc.positioning?.priceFresh ? "tươi" : "stale/unknown"} ·{" "}
                      {dc.positioning?.structureLabel || "—"}
                      {dc.positioning?.htfLabel ? ` / HTF ${dc.positioning.htfLabel}` : ""}
                    </p>
                    <div className="mkt-ruler" aria-hidden="true">
                      <span>Hỗ trợ</span>
                      <span className="mkt-ruler-bar" />
                      <span>Kháng cự</span>
                    </div>
                    <ul className="mkt-sig-list">
                      <li>
                        <span>Hỗ trợ</span>
                        <span className="muted">
                          {dc.positioning?.support
                            ? `[${fmtMarketPrice(dc.positioning.support.low, detailSymbolInfo)}–${fmtMarketPrice(dc.positioning.support.high, detailSymbolInfo)}] · ${fmtPctSafe(dc.positioning.support.distancePct)}`
                            : "—"}
                        </span>
                      </li>
                      <li>
                        <span>Kháng cự</span>
                        <span className="muted">
                          {dc.positioning?.resistance
                            ? `[${fmtMarketPrice(dc.positioning.resistance.low, detailSymbolInfo)}–${fmtMarketPrice(dc.positioning.resistance.high, detailSymbolInfo)}] · ${fmtPctSafe(dc.positioning.resistance.distancePct)}`
                            : "—"}
                        </span>
                      </li>
                    </ul>

                    <h3 style={{ margin: "10px 0 4px", fontSize: 13 }}>Kịch bản</h3>
                    {(dc.scenarios || []).length ? (
                      <ul className="mkt-sig-list">
                        {dc.scenarios.map((sc) => (
                          <li key={sc.id}>
                            <span className={sc.side === "long" ? "mkt-long" : "mkt-short"}>
                              {sc.side} · {sc.type} · {sc.entryState}
                            </span>
                            <span className="muted">
                              entry [{fmtMarketPrice(sc.entryLow, detailSymbolInfo)}–
                              {fmtMarketPrice(sc.entryHigh, detailSymbolInfo)}] · invalidation{" "}
                              {fmtMarketPrice(sc.invalidationLevel, detailSymbolInfo)}
                              {sc.expiresAt
                                ? ` · hết ${when(sc.expiresAt)}`
                                : sc.expiresAtIndex != null
                                  ? ` · hết bar #${sc.expiresAtIndex}`
                                  : ""}
                            </span>
                            <span className="muted" style={{ fontSize: 11 }}>
                              Trigger: {sc.trigger?.description || sc.type} · {sc.entryNote}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ fontSize: 12 }}>{dc.note || "Chưa có setup active."}</p>
                    )}

                    <h3 style={{ margin: "10px 0 4px", fontSize: 13 }}>Bằng chứng</h3>
                    {(dc.evidence || []).length ? (
                      <ul className="mkt-sig-list">
                        {dc.evidence.map((e) => (
                          <li key={e.id}>
                            <span>{e.text}</span>
                            <span className="muted">
                              {e.source} · {when(e.asOf)} · {e.version || ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ fontSize: 12 }}>Chưa có bằng chứng đủ từ snapshot.</p>
                    )}

                    <h3 style={{ margin: "10px 0 4px", fontSize: 13 }}>Phản biện</h3>
                    {(dc.conflicts || []).length ? (
                      <ul className="mkt-sig-list">
                        {dc.conflicts.map((c) => (
                          <li key={c.id}>
                            <span>{c.text}</span>
                            <span className="muted">
                              {c.source} · {when(c.asOf)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted" style={{ fontSize: 12 }}>Không ghi nhận mâu thuẫn từ dữ liệu hiện có.</p>
                    )}
                  </section>
                ) : null}

                {view === "location" && (detail.signalEntries || []).length ? (
                  <section className="mkt-signals">
                    <h3 style={{ margin: "8px 0 4px", fontSize: 13 }}>Entry signal (tách khỏi setup)</h3>
                    <ul className="mkt-sig-list">
                      {detail.signalEntries.slice(0, 8).map((e) => (
                        <li key={e.id}>
                          <span>
                            {e.source} · {e.side}
                            {e.missingEntry ? " · thiếu giá entry" : ` · ${e.priceRelation}/${e.validity}`}
                          </span>
                          <span className="muted">{e.openTime || "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section
                  id="mkt-signals-panel"
                  className={`mkt-signals ${focusSignals ? "mkt-signals-focus" : ""}`}
                >
                  <h3 style={{ margin: "8px 0 4px", fontSize: 13 }}>
                    Signal đáng chú ý · {SIGNAL_HOURS}h
                    {symbolSignals?.count ? (
                      <span className="muted"> · {symbolSignals.count} tín hiệu</span>
                    ) : null}
                  </h3>
                  {!signalMap ? (
                    <p className="muted" style={{ fontSize: 12 }}>Đang tải signal…</p>
                  ) : notableForSymbol.length ? (
                    <ul className="mkt-sig-list">
                      {notableForSymbol.map((row) => (
                        <li key={row.id || `${row.signal}-${row.openTime}`}>
                          <span className={row.side === "LONG" ? "mkt-long" : row.side === "SHORT" ? "mkt-short" : ""}>
                            {row.signal || "—"} · {row.side || "—"}
                          </span>
                          <span className="muted">
                            {row.type || "—"} · {row.status || "—"} · {relTime(row.openTime) || when(row.openTime)}
                            {row.matchLean ? " · khớp lean" : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted" style={{ fontSize: 12 }}>
                      Không có signal gần đây cho {symbol} trong {SIGNAL_HOURS} giờ.
                    </p>
                  )}
                </section>

                <div className="mkt-matrix">
                  {TIMEFRAMES.map((tf) => {
                    const cell = cellLabel(detail.snapshot?.timeframes?.[tf] ? {
                      bias: detail.snapshot.timeframes[tf].bias,
                      lead: detail.snapshot.timeframes[tf].bias === "long"
                        ? detail.snapshot.timeframes[tf].longScore
                        : detail.snapshot.timeframes[tf].bias === "short"
                          ? detail.snapshot.timeframes[tf].shortScore
                          : Math.max(detail.snapshot.timeframes[tf].longScore ?? 0, detail.snapshot.timeframes[tf].shortScore ?? 0),
                      longScore: detail.snapshot.timeframes[tf].longScore,
                      shortScore: detail.snapshot.timeframes[tf].shortScore,
                      quality: detail.snapshot.timeframes[tf].quality?.overall,
                    } : null);
                    return (
                      <button
                        key={tf}
                        type="button"
                        className={`mkt-matrix-item ${timeframe === tf ? "active" : ""}`}
                        onClick={() => patchParams({ tf })}
                      >
                        <span className="tf">{tf}</span>
                        <span className={`score ${cell.cls}`}>{cell.text}</span>
                      </button>
                    );
                  })}
                </div>

                <h3 style={{ margin: "8px 0 4px", fontSize: 13 }}>Breakdown {timeframe || "15m"}</h3>
                {breakdownRows.length ? (
                  <table className="mkt-break">
                    <thead>
                      <tr>
                        <th>Nhóm</th>
                        <th>Giá trị</th>
                        <th className="num">Long</th>
                        <th className="num">Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdownRows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.id}</td>
                          <td title={r.condition}>{fmt(typeof r.value === "number" ? r.value : null) === "—" ? String(r.value ?? "—") : fmt(r.value)}</td>
                          <td className={`num ${r.long > 0 ? "mkt-long" : r.long < 0 ? "mkt-short" : ""}`}>{fmt(r.long, 1)}</td>
                          <td className={`num ${r.short > 0 ? "mkt-long" : r.short < 0 ? "mkt-short" : ""}`}>{fmt(r.short, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>Chưa có breakdown (warming/missing).</p>
                )}

                {detail.strongest ? (
                  <p style={{ fontSize: 12 }}>
                    Mạnh nhất: <strong>{detail.strongest.id}</strong> +{fmt(detail.strongest.points, 1)} ({detail.strongest.side})
                  </p>
                ) : null}
                {detail.weakest ? (
                  <p style={{ fontSize: 12 }}>
                    Điểm trừ: <strong>{detail.weakest.id}</strong> {fmt(detail.weakest.points, 1)} ({detail.weakest.side})
                  </p>
                ) : null}

                {detail.flow ? (
                  <div className="mkt-banner" style={{ marginTop: 8 }}>
                    <strong>Dòng tiền (Smart Money)</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Bias {detail.flow.bias || "—"} · OI {detail.flow.openInterest?.value ?? "—"} · Funding{" "}
                      {detail.flow.funding?.rate ?? "—"} · {when(detail.flow.collectedAt)}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>{detail.flow.note}</div>
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: 12 }}>Chưa có snapshot Smart Money cho symbol.</p>
                )}

                <h3 style={{ margin: "12px 0 4px", fontSize: 13 }}>Lịch sử score</h3>
                <ul className="mkt-hist">
                  {(history?.rows || []).slice(0, 12).map((h, i) => {
                    const c = h.composites?.[style];
                    return (
                      <li key={`${h.calculatedAt}-${i}`}>
                        <span>{when(h.calculatedAt)}</span>
                        <span>
                          L{fmt(c?.compositeLong)} / S{fmt(c?.compositeShort)} · {statusLabel(c?.status)}
                        </span>
                      </li>
                    );
                  })}
                  {!history?.rows?.length ? <li className="muted">Chưa có lịch sử</li> : null}
                </ul>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
