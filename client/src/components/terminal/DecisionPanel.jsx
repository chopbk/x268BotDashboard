import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { fmt, fmtPrice, when } from "./format.js";
import { ownershipView } from "./summary.js";
import { protectionStatus } from "./protection.js";
import { qtyOf } from "../../position-sort";

function factorsPayload(row) {
  if (!row) return null;
  const own = ownershipView(row);
  const protect = protectionStatus(row);
  return {
    account: row.account,
    symbol: row.symbol,
    side: row.side,
    book: row.book,
    entry: row.entry,
    mark: row.mark,
    size: qtyOf(row),
    exchangeQty: row.exchangeQty ?? qtyOf(row),
    unrealized: row.unrealized,
    leverage: row.leverage,
    liquidation: row.liquidation,
    exchangeSl: protect.exchange?.sl ?? row.exchangeSl,
    exchangeTp: protect.exchange?.tp ?? row.exchangeTp,
    ownership: own.allocation,
    monitors: row.monitors,
  };
}

function riskClass(level) {
  if (level === "high") return "term-risk-high";
  if (level === "attention") return "term-risk-attention";
  if (level === "insufficient_data") return "term-risk-low";
  return "term-risk-normal";
}

function riskLabel(level) {
  if (level === "high") return "Cao";
  if (level === "attention") return "Cần chú ý";
  if (level === "insufficient_data") return "Thiếu dữ liệu";
  return "Bình thường";
}

function sourceLabel(source) {
  if (source === "ai") return "AI";
  if (source === "rules") return "Quy tắc";
  return source || "—";
}

function primaryAdvice(report) {
  if (report?.riskLevel === "insufficient_data" && !report?.priorities?.[0]?.action) {
    return {
      action: "Chưa đủ dữ liệu để đề xuất",
      why: report.summary || "Thiếu mark, equity hoặc dữ liệu thị trường.",
      impact: "",
    };
  }
  const first = report?.priorities?.[0];
  if (first?.action) {
    return { action: first.action, why: first.why || "", impact: first.impact || "" };
  }
  if (report?.riskLevel === "high") {
    return { action: "Giảm rủi ro trước khi giữ thêm", why: "", impact: "" };
  }
  if (report?.riskLevel === "attention") {
    return { action: "Rà soát stop-loss và quy mô", why: "", impact: "" };
  }
  return { action: "Theo dõi theo kế hoạch hiện tại", why: "", impact: "" };
}

function positionFingerprint(row) {
  if (!row) return "";
  const protect = protectionStatus(row);
  const tradeKey = `${row.account}|${String(row.symbol || "").toUpperCase()}|${String(row.side || "").toUpperCase()}`;
  return [
    tradeKey,
    row.mark,
    row.entry,
    qtyOf(row),
    row.unrealized,
    protect.exchange?.sl ?? row.exchangeSl,
    protect.exchange?.tp ?? row.exchangeTp,
    row.liquidation,
  ].join("|");
}

function levelOf(levels, keys) {
  if (!levels) return null;
  for (const key of keys) {
    const n = Number(levels[key]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function qtyImpactText(impact) {
  if (!impact) return "—";
  const pct = impact.reducePct != null ? Math.round(Number(impact.reducePct) * 100) : null;
  if (pct === 0) return "Giữ nguyên";
  if (pct === 100) return "Đóng hết";
  if (pct != null) return `Giảm ~${pct}% (${fmt(impact.closeQty, 4)})`;
  if (impact.closeQty != null) return `Đóng ${fmt(impact.closeQty, 4)}`;
  return "—";
}

function conditionsText(conditions) {
  if (!Array.isArray(conditions) || !conditions.length) return "—";
  return conditions.slice(0, 2).join("; ");
}

function splitFindings(findings = []) {
  const critical = [];
  const rest = [];
  for (const f of findings) {
    if (f.severity === "critical" || f.severity === "warn") critical.push(f);
    else rest.push(f);
  }
  return { critical, rest };
}

function tfRows(tech, market) {
  const t = tech || {};
  const m = market || {};
  return [
    {
      tf: "15m",
      trend: t.structure15 || m.tf15?.trendVsEma || "—",
      structure: t.structure15 || m.tf15?.structure?.label || "—",
      rsi: t.rsi15 ?? m.tf15?.rsi14 ?? "—",
    },
    {
      tf: "1h",
      trend: m.tf1h?.trendVsEma || "—",
      structure: t.structure1h || m.tf1h?.structure?.label || "—",
      rsi: t.rsi1h ?? m.tf1h?.rsi14 ?? "—",
    },
    {
      tf: "4h",
      trend: t.trend4h || m.tf4h?.trendVsEma || "—",
      structure: t.structure4h || m.tf4h?.structure?.label || "—",
      rsi: m.tf4h?.rsi14 ?? "—",
    },
  ];
}

const EMPTY_PROFILE = {
  style: "",
  maxLossPerTrade: { value: "", unit: "usdt" },
  maxLossDay: { value: "", unit: "usdt" },
  maxSymbolConcentrationPct: "",
  allowDca: "",
};

function profileToForm(profile) {
  if (!profile) return { ...EMPTY_PROFILE };
  return {
    style: profile.style || "",
    maxLossPerTrade: {
      value: profile.maxLossPerTrade?.value ?? "",
      unit: profile.maxLossPerTrade?.unit || "usdt",
    },
    maxLossDay: {
      value: profile.maxLossDay?.value ?? "",
      unit: profile.maxLossDay?.unit || "usdt",
    },
    maxSymbolConcentrationPct: profile.maxSymbolConcentrationPct ?? "",
    allowDca: profile.allowDca === true ? "true" : profile.allowDca === false ? "false" : "",
  };
}

function formToBody(form) {
  const body = {};
  if (form.style) body.style = form.style;
  else body.style = null;
  if (form.maxLossPerTrade.value !== "" && form.maxLossPerTrade.value != null) {
    body.maxLossPerTrade = {
      value: Number(form.maxLossPerTrade.value),
      unit: form.maxLossPerTrade.unit,
    };
  } else body.maxLossPerTrade = null;
  if (form.maxLossDay.value !== "" && form.maxLossDay.value != null) {
    body.maxLossDay = {
      value: Number(form.maxLossDay.value),
      unit: form.maxLossDay.unit,
    };
  } else body.maxLossDay = null;
  if (form.maxSymbolConcentrationPct !== "" && form.maxSymbolConcentrationPct != null) {
    body.maxSymbolConcentrationPct = Number(form.maxSymbolConcentrationPct);
  } else body.maxSymbolConcentrationPct = null;
  if (form.allowDca === "true") body.allowDca = true;
  else if (form.allowDca === "false") body.allowDca = false;
  else body.allowDca = null;
  return body;
}

function ScenarioCompare({ scenarios, metrics, mobileTab, onMobileTab }) {
  const cols = [
    {
      id: "current",
      title: "Hiện tại",
      sl: metrics?.sl,
      tp: metrics?.tp,
      qty: "Giữ nguyên",
      risk: metrics?.riskMarkToSl,
      rr: metrics?.rrRemaining,
      conditions: "Theo SL/TP sàn đang có",
      invalidation: metrics?.sl != null ? `Chạm SL ${fmtPrice(metrics.sl)}` : "Chưa có SL",
    },
    ...scenarios.slice(0, 2).map((s, idx) => ({
      id: s.id || `s${idx}`,
      title: s.title || `Phương án ${idx + 1}`,
      sl: levelOf(s.candidateLevels, ["sl", "exit", "invalidation"]),
      tp: levelOf(s.candidateLevels, ["tp"]),
      qty: qtyImpactText(s.qtyImpact),
      risk: s.riskFromMarkToSl,
      rr: s.rrRemaining,
      conditions: conditionsText(s.conditions),
      invalidation: s.invalidation || "—",
      rationale: s.rationale || "",
    })),
  ];

  const active = cols.find((c) => c.id === mobileTab) || cols[0];

  return (
    <div className="term-decision-group">
      <div className="term-decision-group-head">
        <strong>Phương án</strong>
      </div>

      <div className="term-scenario-tabs" role="tablist">
        {cols.map((col) => (
          <button
            key={col.id}
            type="button"
            role="tab"
            className={active.id === col.id ? "active" : ""}
            aria-selected={active.id === col.id}
            onClick={() => onMobileTab(col.id)}
          >
            {col.title}
          </button>
        ))}
      </div>

      <div className="term-scenario-mobile cardish">
        <dl className="term-scenario-dl">
          <div><span>SL</span><strong className="term-num">{fmtPrice(active.sl)}</strong></div>
          <div><span>TP</span><strong className="term-num">{fmtPrice(active.tp)}</strong></div>
          <div><span>Qty tác động</span><strong>{active.qty}</strong></div>
          <div><span>Rủi ro thêm (USDT, toàn vị thế)</span><strong className="term-num">{fmt(active.risk, 2)}</strong></div>
          <div><span>R:R còn lại</span><strong>{active.rr == null ? "—" : fmt(active.rr, 2)}</strong></div>
          <div><span>Điều kiện</span><strong>{active.conditions}</strong></div>
          <div><span>Hủy luận điểm</span><strong>{active.invalidation}</strong></div>
        </dl>
        {active.rationale ? <p className="muted term-scenario-note">{active.rationale}</p> : null}
      </div>

      <div className="term-scenario-table-wrap">
        <table className="term-scenario-table">
          <thead>
            <tr>
              <th> </th>
              {cols.map((col) => <th key={col.id}>{col.title}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">SL</th>
              {cols.map((col) => <td key={col.id} className="term-num">{fmtPrice(col.sl)}</td>)}
            </tr>
            <tr>
              <th scope="row">TP</th>
              {cols.map((col) => <td key={col.id} className="term-num">{fmtPrice(col.tp)}</td>)}
            </tr>
            <tr>
              <th scope="row">Qty tác động</th>
              {cols.map((col) => <td key={col.id}>{col.qty}</td>)}
            </tr>
            <tr>
              <th scope="row">Rủi ro thêm<br /><span className="muted">USDT · toàn vị thế</span></th>
              {cols.map((col) => <td key={col.id} className="term-num">{fmt(col.risk, 2)}</td>)}
            </tr>
            <tr>
              <th scope="row">R:R còn lại</th>
              {cols.map((col) => <td key={col.id}>{col.rr == null ? "—" : fmt(col.rr, 2)}</td>)}
            </tr>
            <tr>
              <th scope="row">Điều kiện</th>
              {cols.map((col) => <td key={col.id}>{col.conditions}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function DecisionPanel({ row }) {
  const [reportPack, setReportPack] = useState(null);
  const [reportFp, setReportFp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [profileConfigured, setProfileConfigured] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showRulesMenu, setShowRulesMenu] = useState(false);
  const [scenarioTab, setScenarioTab] = useState("current");

  const fingerprint = useMemo(() => positionFingerprint(row), [row]);
  const stale = Boolean(reportPack && reportFp && fingerprint && reportFp !== fingerprint);

  useEffect(() => {
    setError("");
    setShowProfile(false);
    setShowRulesMenu(false);
    setScenarioTab("current");
    loadProfile();
    loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.key]);

  async function loadProfile() {
    try {
      const data = await api("/api/auth/me/risk-profile");
      setProfileForm(profileToForm(data.profile));
      setProfileConfigured(Boolean(data.configured));
    } catch (err) {
      console.warn("[DecisionPanel] profile", err.message);
    }
  }

  async function loadLatest() {
    if (!row?.account || !row?.symbol || !row?.side) {
      setReportPack(null);
      setReportFp("");
      return;
    }
    try {
      const tradeKey = `${row.account}|${String(row.symbol).toUpperCase()}|${String(row.side).toUpperCase()}`;
      const data = await api(`/api/terminal/decision/reports?scope=position&tradeKey=${encodeURIComponent(tradeKey)}&limit=1`);
      const item = data.items?.[0];
      if (item?.report) {
        const protect = protectionStatus(row);
        setReportPack({
          report: item.report,
          snapshot: {
            asOf: item.asOf || item.report.asOf,
            metrics: {
              sl: protect.exchange?.sl ?? row.exchangeSl,
              tp: protect.exchange?.tp ?? row.exchangeTp,
              entry: row.entry,
              mark: row.mark,
              riskMarkToSl: null,
              rrRemaining: null,
              unrealized: row.unrealized,
            },
            technical: null,
            market: null,
            missingData: item.report.missingData || [],
            fromCache: true,
          },
          saved: { id: item.id, createdAt: item.createdAt },
          configured: true,
        });
        setReportFp(item.report?.meta?.positionFingerprint || "");
      } else {
        setReportPack(null);
        setReportFp("");
      }
    } catch (err) {
      console.warn("[DecisionPanel] latest", err.message);
    }
  }

  async function saveProfile() {
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/auth/me/risk-profile", {
        method: "PUT",
        body: formToBody(profileForm),
      });
      setProfileForm(profileToForm(data.profile));
      setProfileConfigured(Boolean(data.configured));
      setShowProfile(false);
    } catch (err) {
      setError(err.message || "Không lưu hồ sơ rủi ro");
    } finally {
      setBusy(false);
    }
  }

  async function run(useAi = true) {
    if (!row || busy) return;
    setBusy(true);
    setError("");
    setShowRulesMenu(false);
    try {
      const data = await api("/api/terminal/decision/position", {
        method: "POST",
        body: { position: factorsPayload(row), ai: useAi },
        timeoutMs: 45000,
      });
      setReportPack(data);
      setReportFp(data.snapshot?.positionFingerprint || fingerprint);
      const firstAlt = data.report?.scenarios?.[0]?.id;
      setScenarioTab(firstAlt || "current");
    } catch (err) {
      setError(err.message || "Không phân tích được");
    } finally {
      setBusy(false);
    }
  }

  if (!row) return <p className="muted">Chọn vị thế để xem AI phân tích.</p>;

  const report = reportPack?.report;
  const snap = reportPack?.snapshot;
  const advice = report ? primaryAdvice(report) : null;
  const { critical, rest } = splitFindings(report?.findings || []);
  const tech = snap?.technical;
  const market = snap?.market;
  const frames = tfRows(tech, market);
  const missing = (report?.missingData || []).filter((x) => x !== "risk_profile");
  const fromCache = Boolean(snap?.fromCache);
  const needRefresh = fromCache || stale || !report;

  return (
    <section className="term-decision-tool">
      <header className="term-decision-toolbar">
        <div className="term-decision-toolbar-id">
          <strong>{row.symbol} · {row.side}</strong>
          <span className="muted">{row.account}</span>
        </div>
        <div className="term-decision-toolbar-actions">
          {report ? (
            <span className={`term-risk-chip ${riskClass(report.riskLevel)}`}>{riskLabel(report.riskLevel)}</span>
          ) : null}
          <div className="term-analyze-split">
            <button type="button" className="term-primary" disabled={busy} onClick={() => run(true)}>
              {busy ? "Đang phân tích…" : report ? "Phân tích lại" : "Phân tích"}
            </button>
            <button
              type="button"
              className="ghost term-analyze-more"
              disabled={busy}
              aria-expanded={showRulesMenu}
              onClick={() => setShowRulesMenu((v) => !v)}
            >
              ▾
            </button>
            {showRulesMenu ? (
              <div className="term-analyze-menu">
                <button type="button" disabled={busy} onClick={() => run(false)}>Chỉ kiểm tra bằng quy tắc</button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="ghost term-icon-btn"
            disabled={busy}
            title="Hồ sơ rủi ro"
            onClick={() => setShowProfile((v) => !v)}
          >
            ⚙{!profileConfigured ? "*" : ""}
          </button>
        </div>
      </header>

      {!profileConfigured && !showProfile ? (
        <p className="muted term-decision-once">Chưa có ngân sách rủi ro cá nhân — mở ⚙ để khai báo.</p>
      ) : null}

      {showProfile ? (
        <div className="term-risk-profile stack">
          <label>Phong cách
            <select value={profileForm.style} onChange={(e) => setProfileForm({ ...profileForm, style: e.target.value })}>
              <option value="">—</option>
              <option value="scalp">Scalp</option>
              <option value="intraday">Intraday</option>
              <option value="swing">Swing</option>
            </select>
          </label>
          <label>Max loss / lệnh
            <div className="term-inline">
              <input
                value={profileForm.maxLossPerTrade.value}
                onChange={(e) => setProfileForm({
                  ...profileForm,
                  maxLossPerTrade: { ...profileForm.maxLossPerTrade, value: e.target.value },
                })}
              />
              <select
                value={profileForm.maxLossPerTrade.unit}
                onChange={(e) => setProfileForm({
                  ...profileForm,
                  maxLossPerTrade: { ...profileForm.maxLossPerTrade, unit: e.target.value },
                })}
              >
                <option value="usdt">USDT</option>
                <option value="pct_equity">% equity</option>
              </select>
            </div>
          </label>
          <label>Max tập trung symbol %
            <input
              value={profileForm.maxSymbolConcentrationPct}
              onChange={(e) => setProfileForm({ ...profileForm, maxSymbolConcentrationPct: e.target.value })}
            />
          </label>
          <button type="button" className="term-primary" disabled={busy} onClick={saveProfile}>Lưu hồ sơ</button>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {!report ? (
        <p className="muted term-decision-empty">Chưa có báo cáo. Bấm Phân tích để đánh giá lệnh này.</p>
      ) : (
        <div className="term-decision-layout">
          <div className="term-decision-main stack">
            {(fromCache || stale) ? (
              <p className="term-stale-banner">
                {stale
                  ? "Dữ liệu vị thế/bảo vệ đã đổi — cần phân tích lại."
                  : "Đang hiện báo cáo gần nhất — bấm Phân tích lại để lấy dữ liệu mới."}
              </p>
            ) : null}

            <div className={`term-decision-group term-verdict-block ${riskClass(report.riskLevel)}`}>
              <div className="term-verdict-meta">
                <span className="term-verdict-risk">{riskLabel(report.riskLevel)}</span>
                <span className="muted">
                  {sourceLabel(report.meta?.source)} · {when(report.asOf || snap?.asOf)}
                </span>
              </div>
              <p className="term-verdict-label">Kết luận</p>
              <h3 className="term-verdict-action">{advice?.action}</h3>
              {advice?.why ? <p className="term-verdict-why">{advice.why}</p> : null}
              {report.summary && report.summary !== advice?.why && !advice?.why ? (
                <p className="term-verdict-why">{report.summary}</p>
              ) : null}
            </div>

            {critical.length ? (
              <ul className="term-critical-list">
                {critical.map((f, i) => (
                  <li key={`c-${f.title}-${i}`} className={f.severity === "critical" ? "is-critical" : "is-warn"}>
                    <strong>{f.title}</strong>
                    {f.detail ? <span> — {f.detail}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="term-kpi-row">
              <div>
                <span>SL hiện tại</span>
                <strong className="term-num term-level-sl">{fmtPrice(snap?.metrics?.sl)}</strong>
              </div>
              <div>
                <span>TP hiện tại</span>
                <strong className="term-num term-level-tp">{fmtPrice(snap?.metrics?.tp)}</strong>
              </div>
              <div>
                <span>Mất thêm tới SL</span>
                <strong className="term-num">{fmt(snap?.metrics?.riskMarkToSl, 2)} <small>USDT</small></strong>
                <em className="muted">toàn vị thế · từ mark</em>
              </div>
              <div>
                <span>R:R còn lại</span>
                <strong>{snap?.metrics?.rrRemaining == null ? "—" : fmt(snap.metrics.rrRemaining, 2)}</strong>
              </div>
            </div>

            <ScenarioCompare
              scenarios={report.scenarios || []}
              metrics={snap?.metrics}
              mobileTab={scenarioTab}
              onMobileTab={setScenarioTab}
            />
          </div>

          <aside className="term-decision-side stack">
            {!fromCache && (tech || (market && !market.error)) ? (
              <div className="term-decision-group">
                <div className="term-decision-group-head">
                  <strong>Bối cảnh thị trường</strong>
                </div>
                <p className="term-side-align muted">
                  Side so với xu hướng: <strong>{tech?.alignmentLabel || market?.alignment || "—"}</strong>
                  {tech?.multiTfLabel ? ` · ${tech.multiTfLabel}` : ""}
                </p>
                <table className="term-tf-table">
                  <thead>
                    <tr>
                      <th>Khung</th>
                      <th>Xu hướng</th>
                      <th>Cấu trúc</th>
                      <th>RSI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frames.map((f) => (
                      <tr key={f.tf}>
                        <th scope="row">{f.tf}</th>
                        <td>{f.trend}</td>
                        <td>{f.structure}</td>
                        <td className="term-num">{f.rsi}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="term-price-line">
                  Hỗ trợ <strong className="term-num">{fmtPrice(tech?.support ?? market?.tf15?.support)}</strong>
                  <span className="dot">·</span>
                  Kháng cự <strong className="term-num">{fmtPrice(tech?.resistance ?? market?.tf15?.resistance)}</strong>
                  <span className="dot">·</span>
                  ATR <strong className="term-num">{fmtPrice(tech?.atr14 ?? market?.atr14)}</strong>
                  {tech?.atrPct != null ? ` (${tech.atrPct}%)` : ""}
                </p>
                {tech?.invalidation != null ? (
                  <p className="term-price-line">
                    Mức hủy luận điểm <strong className="term-num">{fmtPrice(tech.invalidation)}</strong>
                  </p>
                ) : null}
                {tech?.forming?.length ? (
                  <p className="muted">Nến đang chạy: {tech.forming.join(", ")}</p>
                ) : null}
              </div>
            ) : null}
            {market?.error ? <p className="form-error">Nến: {market.error}</p> : null}

            <details className="term-decision-details">
              <summary>Bằng chứng chi tiết ({rest.length + critical.length})</summary>
              <ul className="term-evidence-list">
                {[...critical, ...rest].map((f, i) => (
                  <li key={`e-${f.title}-${i}`} className={f.severity === "critical" ? "is-critical" : f.severity === "warn" ? "is-warn" : ""}>
                    <strong>{f.title}</strong>
                    {f.detail ? <p>{f.detail}</p> : null}
                  </li>
                ))}
                {!report.findings?.length ? <li className="muted">Không có phát hiện.</li> : null}
              </ul>
            </details>

            <details className="term-decision-details">
              <summary>Nguồn & dữ liệu thiếu</summary>
              <p className="muted">
                Nguồn: {sourceLabel(report.meta?.source)}
                {report.meta?.model ? ` · ${report.meta.model}` : ""}
              </p>
              <p className="muted">Thiếu: {missing.length ? missing.join(", ") : "không"}</p>
              {(report.invalidationConditions || []).length ? (
                <ul className="term-evidence-list">
                  {report.invalidationConditions.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              ) : null}
            </details>

            {needRefresh ? (
              <button type="button" className="term-primary" disabled={busy} onClick={() => run(true)}>
                {busy ? "Đang phân tích…" : "Phân tích lại"}
              </button>
            ) : null}
          </aside>
        </div>
      )}
    </section>
  );
}

export { riskClass, riskLabel, profileToForm, formToBody, EMPTY_PROFILE };
