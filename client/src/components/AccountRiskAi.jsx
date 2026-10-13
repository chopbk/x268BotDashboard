import { useEffect, useState } from "react";
import { api } from "../api";
import { riskClass, riskLabel, profileToForm, formToBody, EMPTY_PROFILE } from "./terminal/DecisionPanel.jsx";
import { when } from "./terminal/format.js";

/**
 * Khối AI đánh giá rủi ro trên Ledger — username đang chọn.
 */
export default function AccountRiskAi({ username }) {
  const [reportPack, setReportPack] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE);
  const [profileConfigured, setProfileConfigured] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  useEffect(() => {
    setReportPack(null);
    setError("");
    api("/api/auth/me/risk-profile")
      .then((data) => {
        setProfileForm(profileToForm(data.profile));
        setProfileConfigured(Boolean(data.configured));
      })
      .catch(() => {});
  }, [username]);

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
      setError(err.message || "Không lưu hồ sơ");
    } finally {
      setBusy(false);
    }
  }

  async function run(useAi) {
    if (!username || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api("/api/terminal/decision/account", {
        method: "POST",
        body: { username, ai: useAi },
        timeoutMs: 60000,
      });
      setReportPack(data);
    } catch (err) {
      setError(err.message || "Không phân tích được");
    } finally {
      setBusy(false);
    }
  }

  if (!username || username === "__all__") return null;

  const report = reportPack?.report;
  const snap = reportPack?.snapshot;

  return (
    <section className="ledger-ai-risk stack">
      <h2 className="summary-section-title">AI đánh giá rủi ro</h2>
      <p className="muted">
        Phân tích exposure, thiếu SL, tập trung symbol cho <strong>{username}</strong>.
        Phase 1 chỉ đọc — không tự sửa lệnh.
        {!profileConfigured ? " · Chưa có ngân sách rủi ro cá nhân." : ""}
      </p>
      <div className="ledger-tools">
        <button type="button" className="ghost" disabled={busy} onClick={() => run(false)}>Rule</button>
        <button type="button" disabled={busy} onClick={() => run(true)}>{busy ? "Đang phân tích…" : "AI đánh giá"}</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setShowProfile((v) => !v)}>
          Hồ sơ rủi ro{profileConfigured ? "" : " *"}
        </button>
      </div>

      {showProfile ? (
        <div className="term-risk-profile stack card" style={{ padding: "1rem" }}>
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
          <button type="button" disabled={busy} onClick={saveProfile}>Lưu hồ sơ</button>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {report ? (
        <div className="card stack" style={{ padding: "1rem" }}>
          <div className={`term-risk-badge ${riskClass(report.riskLevel)}`}>
            <strong>{riskLabel(report.riskLevel)}</strong>
            <span className="muted"> · {report.meta?.source} · {when(report.asOf)}</span>
          </div>
          <p>{report.summary}</p>
          {report.priorities?.length ? (
            <ol>
              {report.priorities.map((p, i) => (
                <li key={i}><strong>{p.action}</strong>{p.why ? ` — ${p.why}` : ""}</li>
              ))}
            </ol>
          ) : null}
          <details>
            <summary>Chi tiết ({(report.findings || []).length} phát hiện)</summary>
            <ul>
              {(report.findings || []).map((f, i) => (
                <li key={i}><strong>{f.title}</strong> — {f.detail}</li>
              ))}
            </ul>
            {snap?.accountMetrics ? (
              <p className="muted">
                Equity {snap.accountMetrics.equity ?? "—"} · Exposure {snap.accountMetrics.exposurePct ?? "—"}% ·
                Thiếu SL {snap.accountMetrics.missingSlCount ?? 0} · Vị thế {snap.accountMetrics.positionCount ?? 0}
              </p>
            ) : null}
          </details>
        </div>
      ) : null}
    </section>
  );
}
