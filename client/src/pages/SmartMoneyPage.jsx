import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import SmOverviewPanel, { SmLsMiniBar } from "../components/smart-money/SmOverviewPanel";
import SmHistoryCharts from "../components/smart-money/SmHistoryCharts";
import "./smart-money.css";

const TABS = [
  { id: "market", label: "Thị trường" },
  { id: "notable", label: "Đáng chú ý" },
  { id: "watchlist", label: "Watchlist" },
];

const BIAS_OPTS = [
  { id: "all", label: "Mọi hướng" },
  { id: "long", label: "Long" },
  { id: "short", label: "Short" },
  { id: "both", label: "Hai chiều" },
  { id: "unclear", label: "Chưa rõ" },
];

function fmt(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function fmtSigned(value, digits = 2, suffix = "") {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US", { maximumFractionDigits: digits })}${suffix}`;
}

function tone(value) {
  if (value == null || !Number.isFinite(Number(value))) return "";
  const n = Number(value);
  if (n > 0) return "sm-pos";
  if (n < 0) return "sm-neg";
  return "";
}

function biasLabel(bias) {
  if (bias === "long") return "Long";
  if (bias === "short") return "Short";
  if (bias === "both") return "Hai chiều";
  return "Chưa rõ";
}

function qualityLabel(q) {
  if (!q) return "Đang tích lũy";
  if (q.overall === "ok") return "Đủ";
  if (q.overall === "warming") return "Đang tích lũy";
  if (q.stale || q.overall === "stale") return "Dữ liệu cũ";
  if (q.overall === "partial") return "Thiếu nguồn";
  return q.overall || "—";
}

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("vi-VN");
}

export default function SmartMoneyPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "market";
  const symbol = (params.get("symbol") || "").toUpperCase();
  const q = params.get("q") || "";
  const top = params.get("top") || "10";
  const bias = params.get("bias") || "all";
  const freshness = params.get("freshness") || "";
  const anomaly = params.get("anomaly") === "1";

  const [status, setStatus] = useState(null);
  const [list, setList] = useState(null);
  const [detail, setDetail] = useState(null);
  const [candidates, setCandidates] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [marketAi, setMarketAi] = useState(null);
  const [marketAiBusy, setMarketAiBusy] = useState(false);
  const [marketAiError, setMarketAiError] = useState("");
  const [symbolAi, setSymbolAi] = useState(null);
  const [symbolAiBusy, setSymbolAiBusy] = useState(false);
  const [symbolAiError, setSymbolAiError] = useState("");
  const [historyPoints, setHistoryPoints] = useState(null);

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
    if (q) qs.set("q", q);
    qs.set("top", top);
    if (bias && bias !== "all") qs.set("bias", bias);
    if (freshness) qs.set("freshness", freshness);
    if (anomaly) qs.set("anomaly", "1");
    const body = await api(`/api/smart-money/symbols?${qs}`);
    setList(body);
  }, [q, top, bias, freshness, anomaly]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api("/api/smart-money/status"),
      loadList(),
      api("/api/smart-money/candidates"),
      api("/api/smart-money/watchlist"),
    ])
      .then(([st, , cand, wl]) => {
        if (cancelled) return;
        setStatus(st);
        setCandidates(cand);
        setWatchlist(wl.symbols || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Lỗi tải Smart Money");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  useEffect(() => {
    if (!symbol) {
      setDetail(null);
      setSymbolAi(null);
      setSymbolAiError("");
      setHistoryPoints(null);
      return undefined;
    }
    let cancelled = false;
    setSymbolAi(null);
    setSymbolAiError("");
    setHistoryPoints(null);
    api(`/api/smart-money/symbols/${encodeURIComponent(symbol)}`)
      .then((body) => {
        if (!cancelled) setDetail(body);
      })
      .catch((err) => {
        if (!cancelled) setDetail({ error: err.message });
      });
    api(`/api/smart-money/symbols/${encodeURIComponent(symbol)}/history?limit=120`)
      .then((body) => {
        if (!cancelled) setHistoryPoints(body.points || []);
      })
      .catch(() => {
        if (!cancelled) setHistoryPoints([]);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  async function runMarketAi() {
    setMarketAiBusy(true);
    setMarketAiError("");
    try {
      const body = await api("/api/smart-money/ai/overview", {
        method: "POST",
        body: { top: Number(top) || 10 },
        timeoutMs: 35_000,
      });
      setMarketAi(body);
    } catch (err) {
      setMarketAiError(err.message || "AI không soạn được tổng quan");
    } finally {
      setMarketAiBusy(false);
    }
  }

  async function runSymbolAi() {
    if (!symbol) return;
    setSymbolAiBusy(true);
    setSymbolAiError("");
    try {
      const body = await api("/api/smart-money/ai/symbol", {
        method: "POST",
        body: { symbol },
        timeoutMs: 35_000,
      });
      setSymbolAi(body);
    } catch (err) {
      setSymbolAiError(err.message || "AI không soạn được kết luận symbol");
    } finally {
      setSymbolAiBusy(false);
    }
  }

  const rows = list?.rows || [];
  const watchRows = useMemo(() => {
    const set = new Set(watchlist);
    return rows.filter((r) => set.has(r.symbol));
  }, [rows, watchlist]);

  async function toggleWatch(sym) {
    const next = watchlist.includes(sym) ? watchlist.filter((s) => s !== sym) : [...watchlist, sym].slice(0, 50);
    const body = await api("/api/smart-money/watchlist", { method: "PUT", body: { symbols: next } });
    setWatchlist(body.symbols || []);
  }

  async function requestRefresh() {
    setRefreshing(true);
    setError("");
    try {
      await api("/api/smart-money/refresh", { method: "POST", body: { symbols: symbol ? [symbol] : [] } });
      await loadList();
      const st = await api("/api/smart-money/status");
      setStatus(st);
    } finally {
      setRefreshing(false);
    }
  }

  const snapCount = status?.universe?.withSnapshot ?? 0;
  const universeSize = status?.universe?.size ?? list?.count ?? 0;

  return (
    <div className="sm-page">
      <header className="sm-header">
        <div>
          <h1>Smart Money</h1>
          <p className="muted">Theo dõi vị thế tổng hợp, dòng giao dịch và biến động thị trường.</p>
        </div>
        <div className="sm-status muted">
          <div>
            Độ phủ: {snapCount}/{universeSize || "—"} snapshot
          </div>
          <div>Collector: {status?.state?.status || (status?.enabled ? "idle/warm-up" : "tắt")}</div>
          <div>Cập nhật: {when(status?.state?.lastSuccessAt || status?.universe?.refreshedAt)}</div>
          <button
            type="button"
            className="ghost"
            disabled={refreshing}
            onClick={() => requestRefresh().catch((e) => setError(e.message))}
          >
            {refreshing ? "Đang seed…" : "Làm mới dữ liệu"}
          </button>
        </div>
      </header>

      {status?.cooldowns?.bapiMs > 0 ? (
        <p className="form-error sm-banner">
          Binance bapi đang cooldown ~{Math.ceil(status.cooldowns.bapiMs / 60000)} phút (418/429 WAF) — cột Smart
          Money tạm thiếu; OI/funding/taker vẫn chạy. Cùng API 0xBennie; IP VPS dễ bị chặn hơn máy local. Peer proxy:{" "}
          {status.cooldowns.peerProxies || 0}.
        </p>
      ) : null}
      {status?.warming || snapCount === 0 ? (
        <p className="muted sm-banner">
          Đang seed: giá/volume từ ticker; OI/funding trước, SM sau khi hết cooldown. Smart Money{" "}
          <strong>không có API lịch sử quá khứ</strong>. Bấm «Làm mới dữ liệu» sau restart nếu bảng trống.
        </p>
      ) : null}
      {(status?.hints || []).length ? (
        <ul className="muted sm-hints">
          {status.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="muted">Đang tải…</p> : null}

      <nav className="history-tabs sm-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            onClick={() => patchParams({ tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "market" || tab === "watchlist" ? (
        <div className="sm-filters">
          <label>
            Symbol
            <input
              value={q}
              placeholder="BTC…"
              onChange={(e) => patchParams({ q: e.target.value.toUpperCase() }, { replace: true })}
            />
          </label>
          <label>
            Top
            <select value={top} onChange={(e) => patchParams({ top: e.target.value })}>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="30">30</option>
            </select>
          </label>
          <label>
            Hướng
            <select value={bias} onChange={(e) => patchParams({ bias: e.target.value === "all" ? "" : e.target.value })}>
              {BIAS_OPTS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Độ mới
            <select value={freshness} onChange={(e) => patchParams({ freshness: e.target.value })}>
              <option value="">Mọi trạng thái</option>
              <option value="ok">Dữ liệu đủ</option>
              <option value="warming">Đang tích lũy</option>
              <option value="stale">Dữ liệu cũ</option>
            </select>
          </label>
          <label className="sm-check">
            <input type="checkbox" checked={anomaly} onChange={(e) => patchParams({ anomaly: e.target.checked ? "1" : "" })} />
            Có bất thường / mâu thuẫn
          </label>
        </div>
      ) : null}

      {tab === "market" || tab === "watchlist" ? (
        <AiBriefPanel
          title="Kết luận tổng quan thị trường (AI)"
          brief={marketAi}
          busy={marketAiBusy}
          error={marketAiError}
          onRun={() => runMarketAi()}
          runLabel={marketAi ? "Chạy lại AI" : "Phân tích AI"}
          emptyHint="Gọi AI để tóm tắt bias / OI / funding trên top symbol đang theo dõi. Không phải tín hiệu vào lệnh."
        />
      ) : null}

      <div className={`sm-layout ${symbol ? "has-detail" : ""}`}>
        <div className="sm-main">
          {tab === "notable" ? (
            <CandidatesPanel candidates={candidates} onOpen={(sym) => patchParams({ tab: "market", symbol: sym })} />
          ) : (
            <MarketTable
              rows={tab === "watchlist" ? watchRows : rows}
              selected={symbol}
              watchlist={watchlist}
              onOpen={(sym) => patchParams({ symbol: sym })}
              onToggleWatch={(sym) => toggleWatch(sym).catch((e) => setError(e.message))}
              emptyNote={
                tab === "watchlist"
                  ? "Watchlist trống — thêm từ bảng Thị trường."
                  : "Chưa có snapshot — collector đang warm-up."
              }
            />
          )}
        </div>
        {symbol ? (
          <aside className="sm-detail card">
            <header className="sm-detail-head">
              <h2>{symbol}</h2>
              <button type="button" className="ghost" onClick={() => patchParams({ symbol: "" })}>
                Đóng
              </button>
            </header>
            <AiBriefPanel
              title={`Kết luận AI · ${symbol}`}
              brief={symbolAi}
              busy={symbolAiBusy}
              error={symbolAiError}
              onRun={() => runSymbolAi()}
              runLabel={symbolAi ? "Chạy lại AI" : "Phân tích AI"}
              emptyHint="AI diễn giải snapshot symbol này (SM / whale / OI / funding / taker)."
              compact
            />
            <SymbolDetail detail={detail} historyPoints={historyPoints} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function MarketTable({ rows, selected, watchlist, onOpen, onToggleWatch, emptyNote }) {
  if (!rows?.length) return <p className="muted">{emptyNote}</p>;
  return (
    <div className="table-wrap sm-table-wrap">
      <table className="sm-table">
        <thead>
          <tr>
            <th title="Hợp đồng USDT perpetual đang theo dõi">Symbol</th>
            <th className="num" title="Giá mark và % đổi 24h">
              Giá & %24h
            </th>
            <th className="num" title="Quote volume 24h (USDT)">
              Vol24h
            </th>
            <th className="num" title="Delta open interest % gần nhất">
              OI Δ
            </th>
            <th title="Smart Money quantity Long / Short (nhóm được theo dõi)">SM L/S</th>
            <th title="Tỷ trọng notional Long vs Short">L|S</th>
            <th className="num" title="Delta quantity whale Long (chỉ khi cùng cohort)">
              Whale ΔL
            </th>
            <th className="num" title="Taker buy/sell ratio">
              Taker
            </th>
            <th className="num" title="Funding rate hiện tại / kỳ">
              Funding
            </th>
            <th title="Nhận định bias theo quantity">Nhận định</th>
            <th title="Chất lượng / độ mới snapshot">Độ mới</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className={selected === r.symbol ? "selected" : ""} onClick={() => onOpen(r.symbol)}>
              <td>
                <strong>{r.symbol}</strong>
                {r.tracking?.label ? <div className="muted sm-tiny">{r.tracking.label}</div> : null}
              </td>
              <td className="num">
                <div>{fmt(r.price?.mark)}</div>
                <div className={tone(r.price?.changePct24h)}>{fmtSigned(r.price?.changePct24h, 2, "%")}</div>
              </td>
              <td className="num">{r.price?.quoteVolume24h != null ? fmt(r.price.quoteVolume24h, 0) : "—"}</td>
              <td className={`num ${tone(r.openInterest?.deltaPct)}`}>{fmtSigned(r.openInterest?.deltaPct, 2, "%")}</td>
              <td className="num">
                {fmt(r.smartMoney?.tradersLongQty, 2)} / {fmt(r.smartMoney?.tradersShortQty, 2)}
              </td>
              <td>
                <SmLsMiniBar longQty={r.smartMoney?.tradersLongQty} shortQty={r.smartMoney?.tradersShortQty} />
              </td>
              <td className={`num ${tone(r.smartMoney?.whalesLongDelta)}`}>
                {r.smartMoney?.comparable === false || r.smartMoney?.cohortReset
                  ? "n/c"
                  : fmtSigned(r.smartMoney?.whalesLongDelta, 2)}
              </td>
              <td className="num">{fmt(r.taker?.buySellRatio, 3)}</td>
              <td className={`num ${tone(r.funding?.currentRate)}`}>
                {r.funding?.currentRate != null ? fmtSigned(r.funding.currentRate * 100, 4, "%") : "—"}
              </td>
              <td>{biasLabel(r.derived?.bias)}</td>
              <td>{qualityLabel(r.quality)}</td>
              <td>
                <button
                  type="button"
                  className="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleWatch(r.symbol);
                  }}
                >
                  {watchlist.includes(r.symbol) ? "★" : "☆"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function stanceLabel(stance) {
  if (stance === "risk_on" || stance === "long") return "Thiên Long / risk-on";
  if (stance === "risk_off" || stance === "short") return "Thiên Short / risk-off";
  if (stance === "both" || stance === "mixed") return "Hai chiều / lẫn";
  return "Chưa rõ";
}

function AiBriefPanel({ title, brief, busy, error, onRun, runLabel, emptyHint, compact }) {
  return (
    <section className={`sm-ai card ${compact ? "sm-ai-compact" : ""}`}>
      <header className="sm-ai-head">
        <h2>{title}</h2>
        <button type="button" className="ghost" disabled={busy} onClick={onRun}>
          {busy ? "Đang hỏi AI…" : runLabel}
        </button>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {!brief && !error ? <p className="muted sm-tiny">{emptyHint}</p> : null}
      {brief ? (
        <div className="sm-ai-body">
          <p className="sm-ai-headline">
            <strong>{brief.headline}</strong>
            <span className="muted"> · {stanceLabel(brief.stance)}</span>
          </p>
          <p className="sm-ai-summary">{brief.summary}</p>
          {(brief.bullets || []).length ? (
            <ul className="sm-ai-bullets">
              {brief.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
          {(brief.watch || []).length ? (
            <p className="sm-tiny">
              <strong>Đáng xem:</strong> {brief.watch.join(", ")}
            </p>
          ) : null}
          {(brief.risks || []).length ? (
            <ul className="sm-ai-risks">
              {brief.risks.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
          <p className="muted sm-tiny">
            {brief.provider || "AI"} · {when(brief.generatedAt)} · {brief.promptVersion || "sm-ai"}
            {brief.coverage
              ? ` · ${brief.coverage.withSmOk || 0}/${brief.coverage.symbols || 0} có SM`
              : ""}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function CandidatesPanel({ candidates, onOpen }) {
  const items = candidates?.items || [];
  if (!items.length) {
    return (
      <p className="muted">
        Chưa có ứng viên đủ điều kiện (hoặc đang warm-up). Danh sách có thể rỗng — điểm không phải xác suất thắng.
      </p>
    );
  }
  const groups = {
    lean_long: "Thiên Long",
    lean_short: "Thiên Short",
    anomaly: "Biến động bất thường",
    contradiction: "Dữ kiện mâu thuẫn / nên chờ",
  };
  return (
    <div className="sm-candidates stack">
      <p className="muted">
        Ứng viên cần xem xét · version {candidates?.version || "—"} · {when(candidates?.generatedAt)}
      </p>
      {Object.entries(groups).map(([bucket, title]) => {
        const rows = items.filter((i) => i.bucket === bucket);
        if (!rows.length) return null;
        return (
          <section key={bucket}>
            <h3>{title}</h3>
            <ul className="sm-cand-list">
              {rows.map((item) => (
                <li key={item.symbol}>
                  <button type="button" className="ghost sm-cand-open" onClick={() => onOpen(item.symbol)}>
                    <strong>{item.symbol}</strong>
                    <span className="muted">điểm {item.score}</span>
                    <span className="muted">coverage {(item.coverage?.score * 100).toFixed(0)}%</span>
                  </button>
                  <div className="sm-tiny">{(item.reasons || []).join(" · ")}</div>
                  {(item.risks || []).length ? <div className="form-error sm-tiny">{item.risks.join(" · ")}</div> : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SymbolDetail({ detail, historyPoints }) {
  if (!detail) return <p className="muted">Đang tải chi tiết…</p>;
  if (detail.error) return <p className="form-error">{detail.error}</p>;
  if (detail.warming && !detail.snapshot) {
    return <p className="muted">{detail.message || "Đang tích lũy dữ liệu."}</p>;
  }
  const snap = detail.snapshot;
  if (!snap) return <p className="muted">Không có snapshot.</p>;
  const sm = snap.smartMoney || {};
  const traders = sm.traders || {};
  const whales = sm.whales || {};

  return (
    <div className="stack sm-detail-body">
      {detail.tracking?.label ? <p className="muted">{detail.tracking.label}</p> : null}
      <p>
        <strong>Kết luận:</strong> nhóm {biasLabel(snap.derived?.bias)}; whale {biasLabel(snap.derived?.whaleBias)}.
        {snap.derived?.deltas?.cohortReset ? " Cohort đã đổi — không so delta." : ""}
      </p>
      <p className="muted sm-tiny">
        collectedAt {when(snap.collectedAt)} · cohort {sm.cohortId || "—"} · quality {snap.quality?.overall}
      </p>

      <SmOverviewPanel snapshot={snap} />

      <h3>Biểu đồ theo thời gian</h3>
      {historyPoints == null ? (
        <p className="muted sm-tiny">Đang tải lịch sử…</p>
      ) : (
        <SmHistoryCharts points={historyPoints} />
      )}

      <h3>Trader được theo dõi</h3>
      <SideTable side={traders} mark={snap.price?.mark} dist={snap.derived?.distanceToTraderEntryPct} />

      <h3>Whale</h3>
      <SideTable side={whales} mark={snap.price?.mark} dist={snap.derived?.distanceToWhaleEntryPct} />

      <h3>Thị trường</h3>
      <div className="term-kv">
        <div>
          <span>OI qty</span>
          <strong className="term-num">{fmt(snap.openInterest?.qty)}</strong>
        </div>
        <div>
          <span>OI Δ%</span>
          <strong className={`term-num ${tone(snap.openInterest?.deltaPct)}`}>{fmtSigned(snap.openInterest?.deltaPct, 2, "%")}</strong>
        </div>
        <div>
          <span>Taker</span>
          <strong className="term-num">{fmt(snap.taker?.buySellRatio, 3)}</strong>
        </div>
        <div>
          <span>Funding</span>
          <strong className={`term-num ${tone(snap.funding?.currentRate)}`}>
            {snap.funding?.currentRate != null ? fmtSigned(snap.funding.currentRate * 100, 4, "%") : "—"}
            {snap.funding?.intervalHours != null ? ` /${snap.funding.intervalHours}h` : ""}
          </strong>
        </div>
      </div>

      <h3>Timeline bất thường</h3>
      {(detail.events || []).length ? (
        <ul className="sm-event-list">
          {detail.events.map((e) => (
            <li key={e.dedupeKey || `${e.type}-${e.at}`}>
              <strong>{e.type}</strong> {e.direction} · z={fmt(e.zScore, 2)}
              <div className="muted sm-tiny">
                {when(e.at)} · {e.message}
                {e.smallSample ? " · mẫu nhỏ" : ""}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Chưa có sự kiện (hoặc đang warm-up).</p>
      )}

      <p className="muted sm-tiny">
        Phân tích kỹ thuật: dùng pipeline Terminal/AI hiện có —{" "}
        <Link to={`/terminal?symbol=${encodeURIComponent(snap.symbol)}`}>mở Terminal</Link>.
      </p>
    </div>
  );
}

function SideTable({ side, dist }) {
  return (
    <table className="sm-side-table">
      <thead>
        <tr>
          <th />
          <th className="num">Long</th>
          <th className="num">Short</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Số lượng</td>
          <td className="num">{fmt(side.longCount, 0)}</td>
          <td className="num">{fmt(side.shortCount, 0)}</td>
        </tr>
        <tr>
          <td>Quantity</td>
          <td className="num">{fmt(side.longQty)}</td>
          <td className="num">{fmt(side.shortQty)}</td>
        </tr>
        <tr>
          <td>Notional ước tính</td>
          <td className="num">{fmt(side.longNotional, 0)}</td>
          <td className="num">{fmt(side.shortNotional, 0)}</td>
        </tr>
        <tr>
          <td>Entry TB</td>
          <td className="num">{fmt(side.longAvgEntry)}</td>
          <td className="num">{fmt(side.shortAvgEntry)}</td>
        </tr>
        <tr>
          <td>Cách entry (theo side)</td>
          <td className={`num ${tone(dist?.long)}`}>{fmtSigned(dist?.long, 2, "%")}</td>
          <td className={`num ${tone(dist?.short)}`}>{fmtSigned(dist?.short, 2, "%")}</td>
        </tr>
        <tr>
          <td>% đang lãi</td>
          <td className="num">{fmt(side.longProfitRatioPct, 1)}</td>
          <td className="num">{fmt(side.shortProfitRatioPct, 1)}</td>
        </tr>
      </tbody>
    </table>
  );
}
