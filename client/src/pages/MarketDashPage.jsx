import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import CandleChart from "../components/market-dash/CandleChart";
import "./market-dash.css";

function fmtPrice(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtPct(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtFunding(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${(Number(n) * 100).toFixed(4)}%`;
}

function ageLabel(ageMs) {
  if (ageMs == null) return "—";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}p`;
  return `${Math.round(ageMs / 3_600_000)}h`;
}

function heatColor(value, mode) {
  if (value == null || !Number.isFinite(Number(value))) return "#3a3b42";
  const v = Number(value);
  // funding percentile 0-100 centered at 50
  if (mode === "fundingPercentile") {
    const t = Math.max(-1, Math.min(1, (v - 50) / 50));
    if (t >= 0) {
      const g = Math.round(80 + t * 100);
      return `rgb(${60 + t * 40},${g},${90})`;
    }
    const r = Math.round(120 - t * 100);
    return `rgb(${r},${70},${90})`;
  }
  const t = Math.max(-1, Math.min(1, v / (mode === "oiDelta24h" ? 15 : 8)));
  if (t >= 0) {
    const g = Math.round(90 + t * 120);
    return `rgb(${40},${g},${90})`;
  }
  const r = Math.round(90 - t * 140);
  return `rgb(${r},${55},${70})`;
}

function cellValue(cell, mode) {
  if (mode === "fundingPercentile") return cell.fundingPercentile;
  if (mode === "oiDelta24h") return cell.oiDelta24h;
  if (mode === "change1h") return cell.change1h;
  if (mode === "change4h") return cell.change4h;
  if (mode === "change7d") return cell.change7d;
  return cell.change24h;
}

export default function MarketDashPage() {
  const [overview, setOverview] = useState(null);
  const [pulse, setPulse] = useState(null);
  const [heatmap, setHeatmap] = useState(null);
  const [deriv, setDeriv] = useState(null);
  const [signals, setSignals] = useState(null);
  const [colorMode, setColorMode] = useState("change24h");
  const [filters, setFilters] = useState({
    setup: "",
    timeframe: "",
    direction: "",
    minScore: "",
  });
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState(-1);
  const [drawerSymbol, setDrawerSymbol] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  const loadCore = useCallback(async () => {
    try {
      const [o, p, h, d] = await Promise.all([
        api("/api/market/dash/overview"),
        api("/api/market/dash/pulse"),
        api(`/api/market/dash/heatmap?color=${colorMode}`),
        api("/api/market/dash/derivatives"),
      ]);
      setOverview(o);
      setPulse(p);
      setHeatmap(h);
      setDeriv(d);
      setError("");
    } catch (e) {
      setError(e.message || "Lỗi tải dashboard");
    }
  }, [colorMode]);

  const loadSignals = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (filters.setup) q.set("setup", filters.setup);
      if (filters.timeframe) q.set("timeframe", filters.timeframe);
      if (filters.direction) q.set("direction", filters.direction);
      if (filters.minScore) q.set("minScore", filters.minScore);
      q.set("limit", "80");
      const s = await api(`/api/market/dash/signals?${q}`);
      setSignals(s);
    } catch (e) {
      setError(e.message || "Lỗi tải signals");
    }
  }, [filters]);

  useEffect(() => {
    loadCore();
    const t = setInterval(loadCore, 15_000);
    return () => clearInterval(t);
  }, [loadCore]);

  useEffect(() => {
    loadSignals();
    const t = setInterval(loadSignals, 30_000);
    return () => clearInterval(t);
  }, [loadSignals]);

  useEffect(() => {
    if (!drawerSymbol) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const body = await api(`/api/market/dash/symbols/${drawerSymbol}?tf=1h`);
        if (!cancelled) setDetail(body);
      } catch (e) {
        if (!cancelled) setError(e.message || "Lỗi chi tiết coin");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drawerSymbol]);

  const sortedSignals = useMemo(() => {
    const rows = [...(signals?.signals || [])];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av === bv) return 0;
      return av > bv ? sortDir : -sortDir;
    });
    return rows;
  }, [signals, sortKey, sortDir]);

  const heatCells = useMemo(() => {
    const cells = [...(heatmap?.cells || [])];
    cells.sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));
    return cells.slice(0, 100);
  }, [heatmap]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => -d);
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  const top = overview?.topBar || {};
  const levels = detail?.signals?.[0]
    ? {
        entry: detail.signals[0].entry,
        stopLoss: detail.signals[0].stopLoss,
        takeProfit: detail.signals[0].takeProfit,
      }
    : detail?.liveSetups?.[0]
      ? {
          entry: detail.liveSetups[0].entry,
          stopLoss: detail.liveSetups[0].stopLoss,
          takeProfit: detail.liveSetups[0].takeProfit,
        }
      : null;

  return (
    <div className="mdash">
      {error ? <p className="mdash-stale" role="alert">{error}</p> : null}

      <div className="mdash-topbar" aria-label="Top bar thị trường">
        <div className="pair">
          <span className="sym">BTC</span>
          <span>{fmtPrice(top.btc?.price)}</span>
          <span className={top.btc?.change24h >= 0 ? "up" : "down"}>
            {fmtPct(top.btc?.change24h)}
          </span>
        </div>
        <div className="pair">
          <span className="sym">ETH</span>
          <span>{fmtPrice(top.eth?.price)}</span>
          <span className={top.eth?.change24h >= 0 ? "up" : "down"}>
            {fmtPct(top.eth?.change24h)}
          </span>
        </div>
        <div className="pair">
          <span className="sym">BTC.D</span>
          <span>
            {top.btcDominance != null ? `${Number(top.btcDominance).toFixed(1)}%` : "—"}
          </span>
        </div>
        <div className="pair">
          <span className="sym">F&G</span>
          <span>
            {top.fearGreed != null ? `${top.fearGreed}` : "—"}
            {top.fearGreedLabel ? ` · ${top.fearGreedLabel}` : ""}
          </span>
        </div>
        <div className="pair">
          <span className="sym">UTC+7</span>
          <span>{overview?.clockUtc7 || "—"}</span>
        </div>
        {overview?.freshness?.macro?.stale ? (
          <span className="mdash-stale">Macro dữ liệu cũ</span>
        ) : null}
      </div>

      <section className="mdash-pulse" aria-label="Market Pulse">
        <div className="mdash-pulse-score">
          <div className="num">{pulse?.score != null ? pulse.score : "—"}</div>
          <div className="lbl">{pulse?.label || "Đang tải"}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            {pulse?.regime?.["1d"]?.label || pulse?.regime?.["4h"]?.label || "—"}
          </div>
        </div>
        <div className="mdash-pulse-body">
          <h3>Market Pulse</h3>
          <ul className="mdash-brief">
            {(pulse?.brief || ["Đang thu thập…"]).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mdash-groups">
            {Object.entries(pulse?.groups || {}).map(([key, g]) => (
              <div className="mdash-group" key={key}>
                <strong>
                  {key} {g.score != null ? Math.round(g.score) : "—"}
                  {g.stub ? " · stub" : ""}
                </strong>
                <span className="muted">{g.reason}</span>
              </div>
            ))}
          </div>
          {pulse?.hotWarning ? <div className="mdash-warn">{pulse.hotWarning}</div> : null}
          {pulse?.freshness?.stale ? (
            <p className="mdash-stale">Pulse stale ({ageLabel(pulse.freshness.ageMs)})</p>
          ) : null}
        </div>
      </section>

      <div className="mdash-grid2">
        <section className="mdash-panel">
          <h2>
            Heatmap top 100
            <span className="meta">
              size=vol24h · {heatmap?.freshness?.stale ? "stale" : "live"}
            </span>
          </h2>
          <div className="mdash-toggles" role="group" aria-label="Chế độ màu">
            {[
              ["change24h", "% 24h"],
              ["change1h", "% 1h"],
              ["change4h", "% 4h"],
              ["change7d", "% 7d"],
              ["fundingPercentile", "Funding %ile"],
              ["oiDelta24h", "OI Δ"],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={colorMode === k ? "active" : ""}
                onClick={() => setColorMode(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mdash-heatmap">
            {heatCells.map((cell) => {
              const val = cellValue(cell, colorMode);
              const short = cell.symbol.replace(/USDT$/, "");
              return (
                <button
                  type="button"
                  key={cell.symbol}
                  className="mdash-heat-cell"
                  style={{
                    background: heatColor(val, colorMode),
                    flexGrow: Math.max(1, Math.log10((cell.quoteVolume || 1e6) / 1e6) + 1),
                  }}
                  onClick={() => setDrawerSymbol(cell.symbol)}
                  title={`${cell.symbol} ${fmtPct(val)}`}
                >
                  <span className="s">{short}</span>
                  <span className="v">
                    {colorMode === "fundingPercentile"
                      ? val != null
                        ? `p${Math.round(val)}`
                        : "—"
                      : fmtPct(val, 1)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mdash-panel">
          <h2>
            Derivatives
            <span className="meta">{deriv?.updatedAt ? ageLabel(Date.now() - new Date(deriv.updatedAt).getTime()) : "—"}</span>
          </h2>
          <div className="mdash-deriv-metrics">
            <div className="mdash-metric">
              <span className="k">Funding OI-w top20</span>
              <span className="v">{fmtFunding(deriv?.fundingOiWeightedTop20)}</span>
            </div>
            <div className="mdash-metric">
              <span className="k">Global L/S</span>
              <span className="v">
                {deriv?.globalLongShort?.longShortRatio?.toFixed?.(2) ?? "—"}
              </span>
            </div>
            <div className="mdash-metric">
              <span className="k">Top trader L/S</span>
              <span className="v">
                {deriv?.topTraderLongShort?.longShortRatio?.toFixed?.(2) ?? "—"}
              </span>
            </div>
          </div>
          <div className="mdash-table-wrap">
            <table className="mdash-table">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Funding</th>
                  <th>OI Δ24h</th>
                  <th>Giá×OI</th>
                </tr>
              </thead>
              <tbody>
                {(deriv?.coins || []).slice(0, 20).map((c) => (
                  <tr key={c.symbol}>
                    <td>
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => setDrawerSymbol(c.symbol)}
                      >
                        {c.symbol.replace(/USDT$/, "")}
                      </button>
                    </td>
                    <td>{fmtFunding(c.funding)}</td>
                    <td className={c.oiDelta24h >= 0 ? "up" : "down"}>{fmtPct(c.oiDelta24h, 1)}</td>
                    <td>{c.priceOi?.label || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="mdash-panel">
        <h2>
          Signal Scanner
          <span className="meta">{signals?.count ?? 0} tín hiệu active</span>
        </h2>
        <div className="mdash-filters">
          <select
            value={filters.setup}
            onChange={(e) => setFilters((f) => ({ ...f, setup: e.target.value }))}
          >
            <option value="">Mọi setup</option>
            <option value="squeeze_breakout">Squeeze Breakout</option>
            <option value="range_breakout">Range Breakout</option>
            <option value="trend_pullback">Trend Pullback</option>
          </select>
          <select
            value={filters.timeframe}
            onChange={(e) => setFilters((f) => ({ ...f, timeframe: e.target.value }))}
          >
            <option value="">Mọi khung</option>
            <option value="1h">1H</option>
            <option value="4h">4H</option>
            <option value="1d">1D</option>
          </select>
          <select
            value={filters.direction}
            onChange={(e) => setFilters((f) => ({ ...f, direction: e.target.value }))}
          >
            <option value="">Long/Short</option>
            <option value="long">Long</option>
            <option value="short">Short</option>
          </select>
          <input
            type="number"
            placeholder="Score ≥"
            value={filters.minScore}
            onChange={(e) => setFilters((f) => ({ ...f, minScore: e.target.value }))}
            style={{ width: 88 }}
          />
        </div>
        <div className="mdash-table-wrap">
          <table className="mdash-table">
            <thead>
              <tr>
                {[
                  ["symbol", "Coin"],
                  ["price", "Giá"],
                  ["change24h", "%24h"],
                  ["setup", "Setup"],
                  ["score", "Score"],
                  ["timeframe", "TF"],
                  ["direction", "Hướng"],
                  ["funding", "Funding"],
                  ["oiDelta24h", "OI Δ"],
                  ["rs7d", "RS7d"],
                  ["volSpike", "Vol"],
                  ["entry", "Entry"],
                  ["stopLoss", "SL"],
                  ["rr", "R:R"],
                  ["ageMs", "Tuổi"],
                ].map(([k, label]) => (
                  <th key={k} onClick={() => toggleSort(k)}>
                    {label}
                    {sortKey === k ? (sortDir < 0 ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedSignals.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() => setDrawerSymbol(r.symbol)}
                    >
                      {r.symbol.replace(/USDT$/, "")}
                    </button>
                  </td>
                  <td>{fmtPrice(r.price)}</td>
                  <td className={r.change24h >= 0 ? "up" : "down"}>{fmtPct(r.change24h)}</td>
                  <td>
                    <span className="mdash-tag">{r.setup}</span>
                  </td>
                  <td>
                    <strong>{r.score}</strong>
                    {r.scoreRaw != null && r.scoreRaw !== r.score ? (
                      <span className="muted"> ({r.scoreRaw})</span>
                    ) : null}
                  </td>
                  <td>{r.timeframe}</td>
                  <td>{r.direction}</td>
                  <td>{fmtFunding(r.funding)}</td>
                  <td>{fmtPct(r.oiDelta24h, 1)}</td>
                  <td>{r.rs7d != null ? r.rs7d.toFixed(2) : "—"}</td>
                  <td>{r.volSpike != null ? `${r.volSpike}×` : "—"}</td>
                  <td>{fmtPrice(r.entry)}</td>
                  <td>{fmtPrice(r.stopLoss)}</td>
                  <td>{r.rr ?? "—"}</td>
                  <td>{ageLabel(r.ageMs)}</td>
                </tr>
              ))}
              {!sortedSignals.length ? (
                <tr>
                  <td colSpan={15} className="muted">
                    Chưa có tín hiệu active — analyzer chạy khi nến đóng.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {drawerSymbol ? (
        <>
          <button
            type="button"
            className="mdash-drawer-backdrop"
            aria-label="Đóng"
            onClick={() => setDrawerSymbol(null)}
          />
          <aside className="mdash-drawer" role="dialog" aria-label={`Chi tiết ${drawerSymbol}`}>
            <div className="mdash-drawer-head">
              <h2 style={{ margin: 0 }}>{drawerSymbol.replace(/USDT$/, "")}</h2>
              <button type="button" onClick={() => setDrawerSymbol(null)}>
                Đóng
              </button>
            </div>
            <div className="mdash-drawer-body">
              <CandleChart
                candles={detail?.candles || []}
                ema={detail?.emaOverlay}
                levels={levels}
              />
              <div className="mdash-mtf">
                {["15m", "1h", "4h", "1d"].map((tf) => {
                  const m = detail?.mtf?.[tf];
                  return (
                    <div className="mdash-mtf-cell" key={tf}>
                      <strong>{tf}</strong>
                      <div>{m?.trend || "—"}</div>
                      <div className="muted">RSI {m?.rsi14 ?? "—"}</div>
                    </div>
                  );
                })}
              </div>
              {(detail?.liveSetups || detail?.signals || []).slice(0, 2).map((s, idx) => (
                <div key={`${s.setup}-${idx}`}>
                  <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>
                    {s.setupLabel || s.setup} · {s.direction} · score {s.score ?? "live"}
                  </h3>
                  <ul className="mdash-check">
                    {(s.checklist || []).map((c) => (
                      <li key={c.id}>
                        <span>{c.ok ? "✔" : "✘"}</span>
                        <span>
                          {c.label}
                          {c.detail ? ` · ${c.detail}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 11 }}>
                {detail?.disclaimer}
              </p>
            </div>
          </aside>
        </>
      ) : null}

      <footer className="mdash-footer">
        {overview?.disclaimer || "Gợi ý tham khảo, không phải khuyến nghị đầu tư"}
      </footer>
    </div>
  );
}
