import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import "./market.css";

const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"];
const STYLES = [
  { id: "intraday", label: "Trong ngày" },
  { id: "scalp", label: "Ngắn hạn" },
  { id: "swing", label: "Swing" },
];

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

export default function MarketPage() {
  const [params, setParams] = useSearchParams();
  const symbol = (params.get("symbol") || "").toUpperCase();
  const style = STYLES.some((s) => s.id === params.get("style")) ? params.get("style") : "intraday";
  const timeframe = TIMEFRAMES.includes(params.get("tf")) ? params.get("tf") : "";
  const q = params.get("q") || "";
  const side = params.get("side") || "";
  const regime = params.get("regime") || "";
  const minScore = params.get("minScore") || "";
  const consensus = params.get("consensus") === "1";
  const fresh = params.get("fresh") === "1";
  const sort = params.get("sort") || "";
  const dir = params.get("dir") === "asc" ? "asc" : "desc";

  const [overview, setOverview] = useState(null);
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
    qs.set("style", style);
    if (q) qs.set("q", q);
    if (side) qs.set("side", side);
    if (regime) qs.set("regime", regime);
    if (minScore) qs.set("minScore", minScore);
    if (consensus) qs.set("consensus", "1");
    if (fresh) qs.set("fresh", "1");
    if (sort) qs.set("sort", sort);
    if (dir) qs.set("dir", dir);
    const body = await api(`/api/market/symbols?${qs}`);
    setList(body);
  }, [style, q, side, regime, minScore, consensus, fresh, sort, dir]);

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([api("/api/market/overview"), loadList()])
      .then(([ov]) => {
        if (!cancelled) setOverview(ov);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Lỗi tải Thị trường");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  // Poll nhẹ khi còn symbol chưa chấm — bảng cập nhật dần, không phải chờ hết.
  useEffect(() => {
    const progress = overview?.progress;
    if (!progress || progress.complete) return undefined;
    const id = setInterval(() => {
      Promise.all([api("/api/market/overview"), loadList()])
        .then(([ov]) => setOverview(ov))
        .catch(() => {});
    }, 12_000);
    return () => clearInterval(id);
  }, [overview?.progress?.complete, overview?.progress?.scored, loadList]);

  useEffect(() => {
    if (!symbol) {
      setDetail(null);
      setHistory(null);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams({ style });
    if (timeframe) qs.set("timeframe", timeframe);
    Promise.all([
      api(`/api/market/symbols/${symbol}?${qs}`),
      api(`/api/market/symbols/${symbol}/scores?limit=30`),
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
  }, [symbol, style, timeframe]);

  const mobileTf = timeframe || "15m";

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
      await Promise.all([api("/api/market/overview").then(setOverview), loadList()]);
    } catch (err) {
      setError(err.message || "Refresh thất bại (cần market.manage)");
    } finally {
      setRefreshing(false);
    }
  }

  const breadth = overview?.breadth || {};
  const coverage = overview?.coverage || {};
  const progress = overview?.progress || {};

  return (
    <div className="mkt-page">
      <header className="mkt-header">
        <div>
          <h1>Thị trường · Top 50 Futures theo volume24h</h1>
          <p className="mkt-sub">
            Scoring Long/Short độc lập trên 5m–1d (chỉ nến đóng). Điểm là mức đáp ứng quy tắc market-v1,
            không phải xác suất thắng. Flow Smart Money giữ riêng.
          </p>
        </div>
        <div className="mkt-meta">
          <span>Universe v{overview?.universe?.version ?? "—"} · {when(overview?.universe?.refreshedAt)}</span>
          <span>Formula {overview?.formulaVersion || "market-v1"}</span>
          <span>Coverage {coverage.label || "—"}</span>
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

      <div className="mkt-summary">
        <span className="mkt-pill mkt-long">Thiên Long <strong>{breadth.leanLong ?? "—"}</strong></span>
        <span className="mkt-pill mkt-short">Thiên Short <strong>{breadth.leanShort ?? "—"}</strong></span>
        <span className="mkt-pill">Ứng viên <strong>{breadth.eligible ?? "—"}</strong></span>
        <span className="mkt-pill">Mâu thuẫn <strong>{breadth.conflict ?? "—"}</strong></span>
        <span className="mkt-pill">Trend/Range/Trans <strong>{breadth.trending ?? 0}/{breadth.ranging ?? 0}/{breadth.transitional ?? 0}</strong></span>
      </div>

      <div className="mkt-filters">
        <label>
          Symbol
          <input value={q} onChange={(e) => patchParams({ q: e.target.value }, { replace: true })} placeholder="BTC…" />
        </label>
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
      </div>

      {error ? <div className="mkt-banner">{error}</div> : null}
      {overview?.note ? <p className="muted mkt-sub">{overview.note}</p> : null}

      <div className={`mkt-layout ${symbol ? "has-detail" : ""}`}>
        <div className="mkt-table-wrap panel">
          {loading && !list ? (
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
                  <SortTh col="status">Trạng thái</SortTh>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => {
                  const selected = row.symbol === symbol;
                  return (
                    <tr
                      key={row.symbol}
                      className={selected ? "selected" : ""}
                      onClick={() => patchParams({ symbol: row.symbol })}
                    >
                      <td>
                        <strong>{row.symbol}</strong>
                        {!row.inTop ? <span className="muted"> · ngoài top</span> : null}
                      </td>
                      <td className="num">{fmt(row.price?.last)}</td>
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
                                patchParams({ symbol: row.symbol, tf });
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
                  <button type="button" className="ghost" onClick={() => patchParams({ symbol: null, tf: null })}>
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
                  <Link to={`/smart-money?symbol=${symbol}`}>Smart Money</Link>
                  <Link to={`/terminal?symbol=${symbol}`}>Terminal</Link>
                </div>

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
