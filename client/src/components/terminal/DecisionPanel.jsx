import { useEffect, useState } from "react";
import { api } from "../../api";
import { fmt, when } from "./format.js";
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

export default function DecisionPanel({ row }) {
  const [reportPack, setReportPack] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [profileConfigured, setProfileConfigured] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    setReportPack(null);
    setError("");
    loadProfile();
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

  async function run(useAi) {
    if (!row || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/terminal/decision/position", {
        method: "POST",
        body: { position: factorsPayload(row), ai: useAi },
        timeoutMs: 45000,
      });
      setReportPack(data);
    } catch (err) {
      setError(err.message || "Không phân tích được");
    } finally {
      setBusy(false);
    }
  }

  if (!row) return <p className="muted">Chọn vị thế để xem AI phân tích.</p>;

  const report = reportPack?.report;
  const snap = reportPack?.snapshot;

  return (
    <section className="term-panel-section stack term-decision">
      <div className="term-journal-actions">
        <button type="button" className="ghost" disabled={busy} onClick={() => run(false)}>Phân tích rule</button>
        <button type="button" className="term-primary" disabled={busy} onClick={() => run(true)}>AI phân tích</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setShowProfile((v) => !v)}>
          Hồ sơ rủi ro{profileConfigured ? "" : " *"}
        </button>
      </div>
      <p className="muted">
        Phase 1 chỉ đọc: số do code tính, AI giải thích. Không tự đặt SL/TP.
        {!profileConfigured ? " · Chưa có ngân sách rủi ro cá nhân." : ""}
      </p>

      {showProfile ? (
        <div className="term-risk-profile stack">
          <label>Phong cách
            <select
              value={profileForm.style}
              onChange={(e) => setProfileForm({ ...profileForm, style: e.target.value })}
            >
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
                placeholder="50"
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
          <label>Max loss / ngày
            <div className="term-inline">
              <input
                value={profileForm.maxLossDay.value}
                onChange={(e) => setProfileForm({
                  ...profileForm,
                  maxLossDay: { ...profileForm.maxLossDay, value: e.target.value },
                })}
              />
              <select
                value={profileForm.maxLossDay.unit}
                onChange={(e) => setProfileForm({
                  ...profileForm,
                  maxLossDay: { ...profileForm.maxLossDay, unit: e.target.value },
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
              placeholder="40"
            />
          </label>
          <label>Cho phép DCA
            <select
              value={profileForm.allowDca}
              onChange={(e) => setProfileForm({ ...profileForm, allowDca: e.target.value })}
            >
              <option value="">—</option>
              <option value="true">Có</option>
              <option value="false">Không</option>
            </select>
          </label>
          <button type="button" className="term-primary" disabled={busy} onClick={saveProfile}>Lưu hồ sơ</button>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {report ? (
        <div className="term-coach stack">
          <div className={`term-risk-badge ${riskClass(report.riskLevel)}`}>
            <strong>{riskLabel(report.riskLevel)}</strong>
            <span className="muted"> · {report.meta?.source || "—"} · {when(report.asOf)}</span>
          </div>
          <p>{report.summary}</p>

          {report.priorities?.length ? (
            <div className="stack">
              <strong>Ưu tiên</strong>
              <ol className="term-priority-list">
                {report.priorities.map((p, i) => (
                  <li key={`${p.action}-${i}`}>
                    <strong>{p.action}</strong>
                    {p.why ? <span className="muted"> — {p.why}</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <details open>
            <summary>Bằng chứng / phát hiện</summary>
            <ul className="term-coach-list">
              {(report.findings || []).map((f, i) => (
                <li key={`${f.title}-${i}`} className={`term-coach-item term-coach-${f.severity === "critical" ? "risk" : "market"}`}>
                  <strong>{f.title}</strong>
                  {f.detail ? <p className="muted">{f.detail}</p> : null}
                  {f.evidence ? <p className="muted">Evidence: {f.evidence}</p> : null}
                </li>
              ))}
              {!report.findings?.length ? <li className="muted">Không có phát hiện nổi bật.</li> : null}
            </ul>
          </details>

          <details open>
            <summary>Phương án (≤3)</summary>
            <ul className="term-coach-list">
              {(report.scenarios || []).map((s) => (
                <li key={s.id} className="term-coach-item">
                  <strong>{s.title}</strong>
                  {s.rationale ? <p className="muted">{s.rationale}</p> : null}
                  {s.candidateLevels ? (
                    <p className="muted">
                      Mức: {Object.entries(s.candidateLevels)
                        .filter(([, v]) => typeof v === "number")
                        .map(([k, v]) => `${k}=${fmt(v)}`)
                        .join(" · ") || "—"}
                    </p>
                  ) : null}
                  {s.riskFromMarkToSl != null ? (
                    <p className="muted">Rủi ro mark→SL ≈ {fmt(s.riskFromMarkToSl)}
                      {s.rrRemaining != null ? ` · R:R còn lại ${s.rrRemaining}` : ""}
                    </p>
                  ) : null}
                  {s.invalidation ? <p className="muted">Invalidation: {s.invalidation}</p> : null}
                </li>
              ))}
            </ul>
          </details>

          <details>
            <summary>Giả định / thiếu dữ liệu</summary>
            <p className="muted">
              missing: {(report.missingData || []).join(", ") || "không"}
            </p>
            {(report.invalidationConditions || []).length ? (
              <ul>
                {report.invalidationConditions.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            ) : null}
            {snap?.metrics ? (
              <dl className="term-kv term-kv-compact">
                <div><span>uPnL</span><strong>{snap.metrics.unrealized ?? "—"}</strong></div>
                <div><span>Notional</span><strong>{snap.metrics.notional ?? "—"}</strong></div>
                <div><span>Risk mark→SL</span><strong>{snap.metrics.riskMarkToSl ?? "—"}</strong></div>
                <div><span>R:R còn lại</span><strong>{snap.metrics.rrRemaining ?? "—"}</strong></div>
                <div><span>SL/TP</span><strong>{snap.metrics.sl ?? "—"} / {snap.metrics.tp ?? "—"}</strong></div>
                <div><span>MultiTF</span><strong>{snap.market?.multiTf ?? "—"}</strong></div>
              </dl>
            ) : null}
          </details>
        </div>
      ) : null}
    </section>
  );
}

export { riskClass, riskLabel, profileToForm, formToBody, EMPTY_PROFILE };
