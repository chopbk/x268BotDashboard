import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const CONFIG_EDIT = "config.edit";
const MODES = ["FIX", "RATIO", "RISK", "RR", "LOSS"];

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  return `${text}$`;
}

export default function AccountConfigPage() {
  const { username = "", env = "" } = useParams();
  const { user } = useAuth();
  const canEdit = can(user, CONFIG_EDIT);
  const [form, setForm] = useState(null);
  const [signalsText, setSignalsText] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api(`/api/bots/${encodeURIComponent(username)}/configs/${encodeURIComponent(env)}`)
      .then((data) => {
        if (cancelled) return;
        setForm(data.config);
        setSignalsText((data.config?.signals || []).join(", "));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username, env]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved("");
  }

  const volume =
    form && Number.isFinite(Number(form.cost)) && Number.isFinite(Number(form.leverage))
      ? Number(form.cost) * Number(form.leverage)
      : null;

  async function onSubmit(event) {
    event.preventDefault();
    if (!canEdit || !form) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const signals = signalsText
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const optionalNumber = (value) => (value === "" || value == null ? undefined : Number(value));
      const data = await api(`/api/bots/${encodeURIComponent(username)}/configs/${encodeURIComponent(env)}`, {
        method: "PATCH",
        body: {
          on: form.on,
          long: form.long,
          short: form.short,
          signals,
          mode: form.mode,
          cost: Number(form.cost),
          leverage: Number(form.leverage),
          ratio: optionalNumber(form.ratio),
          fixloss: optionalNumber(form.fixloss),
          risk: optionalNumber(form.risk),
        },
      });
      setForm(data.config);
      setSignalsText((data.config?.signals || []).join(", "));
      setSaved("Đã lưu. Bot đang chạy chỉ nhận config mới sau khi restart.");
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="page-head">
        <p>
          <Link to={`/bots/${encodeURIComponent(username)}`}>← {username}</Link>
        </p>
        <h1>{env}</h1>
        <p className="muted">
          Volume vào lệnh = cost × đòn bẩy long. Mode RATIO/LOSS/RR còn phụ thuộc số dư lúc vào lệnh.
        </p>
      </header>
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {saved ? <p className="muted">{saved}</p> : null}
      {form ? (
        <form className="card admin-form" onSubmit={onSubmit}>
          <label className="check">
            <input
              type="checkbox"
              checked={!!form.on}
              onChange={(event) => setField("on", event.target.checked)}
              disabled={!canEdit || busy}
            />
            <span>On</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!form.long}
              onChange={(event) => setField("long", event.target.checked)}
              disabled={!canEdit || busy}
            />
            <span>Long</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={!!form.short}
              onChange={(event) => setField("short", event.target.checked)}
              disabled={!canEdit || busy}
            />
            <span>Short</span>
          </label>
          <label>
            Signal
            <input
              value={signalsText}
              onChange={(event) => {
                setSignalsText(event.target.value);
                setSaved("");
              }}
              placeholder="ROSE, BULL"
              disabled={!canEdit || busy}
            />
          </label>
          <label>
            Mode
            <select
              value={MODES.includes(form.mode) ? form.mode : ""}
              onChange={(event) => setField("mode", event.target.value)}
              disabled={!canEdit || busy}
            >
              {MODES.includes(form.mode) ? null : <option value="">{form.mode || "Chọn mode"}</option>}
              {MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cost ($)
            <input
              type="number"
              min="0"
              step="any"
              value={form.cost ?? ""}
              onChange={(event) => setField("cost", event.target.value)}
              disabled={!canEdit || busy}
              required
            />
          </label>
          <label>
            Đòn bẩy long
            <input
              type="number"
              min="1"
              max="125"
              step="any"
              value={form.leverage ?? ""}
              onChange={(event) => setField("leverage", event.target.value)}
              disabled={!canEdit || busy}
              required
            />
          </label>
          <p className="muted">Volume vào lệnh: {money(volume)}</p>
          <label>
            Ratio
            <input
              type="number"
              min="0"
              step="any"
              value={form.ratio ?? ""}
              onChange={(event) => setField("ratio", event.target.value)}
              disabled={!canEdit || busy}
            />
          </label>
          <label>
            Fix loss ($)
            <input
              type="number"
              min="0"
              step="any"
              value={form.fixloss ?? ""}
              onChange={(event) => setField("fixloss", event.target.value)}
              disabled={!canEdit || busy}
            />
          </label>
          <label>
            Risk
            <input
              type="number"
              min="0"
              step="any"
              value={form.risk ?? ""}
              onChange={(event) => setField("risk", event.target.value)}
              disabled={!canEdit || busy}
            />
          </label>
          {canEdit ? (
            <button type="submit" disabled={busy}>
              Lưu
            </button>
          ) : (
            <p className="muted">Bạn chỉ được xem config này.</p>
          )}
        </form>
      ) : null}
    </section>
  );
}
