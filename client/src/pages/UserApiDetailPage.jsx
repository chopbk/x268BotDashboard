import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const CREDENTIALS_MANAGE = "credentials.manage";
const EXCHANGES = [
  "binance",
  "kucoin",
  "huobi",
  "okex",
  "bybit",
  "bitget",
  "bybitv5",
  "bingx",
  "aster",
  "spot",
];

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

const emptyForm = {
  username: "",
  exchange: "binance",
  hedgeMode: true,
  test: false,
  subAccount: "",
  apiKey: "",
  apiSecret: "",
  password: "",
};

export default function UserApiDetailPage() {
  const { username = "" } = useParams();
  const isNew = !username || username === "new";
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = can(user, CREDENTIALS_MANAGE);
  const [form, setForm] = useState(emptyForm);
  const [flags, setFlags] = useState({ hasApiKey: false, hasApiSecret: false, hasPassword: false });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    api(`/api/user-apis/${encodeURIComponent(username)}`, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        const row = data.api;
        setForm({
          username: row.username || username,
          exchange: row.exchange || "binance",
          hedgeMode: row.hedgeMode !== false,
          test: !!row.test,
          subAccount: row.subAccount || "",
          apiKey: "",
          apiSecret: "",
          password: "",
        });
        setFlags({
          hasApiKey: !!row.hasApiKey,
          hasApiSecret: !!row.hasApiSecret,
          hasPassword: !!row.hasPassword,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isNew, username]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!canManage) return;
    setBusy(true);
    setError("");
    try {
      if (isNew) {
        const data = await api("/api/user-apis", {
          method: "POST",
          body: {
            username: form.username,
            exchange: form.exchange,
            hedgeMode: form.hedgeMode,
            test: form.test,
            subAccount: form.subAccount,
            apiKey: form.apiKey,
            apiSecret: form.apiSecret,
            password: form.password,
          },
        });
        navigate(`/user-apis/${encodeURIComponent(data.api.username)}`, { replace: true });
        return;
      }
      const body = {
        username: form.username,
        exchange: form.exchange,
        hedgeMode: form.hedgeMode,
        test: form.test,
        subAccount: form.subAccount,
      };
      if (form.apiKey.trim()) body.apiKey = form.apiKey;
      if (form.apiSecret.trim()) body.apiSecret = form.apiSecret;
      if (form.password.trim()) body.password = form.password;
      const data = await api(`/api/user-apis/${encodeURIComponent(username)}`, {
        method: "PATCH",
        body,
      });
      const next = data.api.username;
      if (next !== username) {
        navigate(`/user-apis/${encodeURIComponent(next)}`, { replace: true });
        return;
      }
      setFlags({
        hasApiKey: !!data.api.hasApiKey,
        hasApiSecret: !!data.api.hasApiSecret,
        hasPassword: !!data.api.hasPassword,
      });
      setForm((prev) => ({ ...prev, apiKey: "", apiSecret: "", password: "" }));
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!canManage || isNew) return;
    if (!window.confirm(`Xoá User API ${username}? User bot và config không bị xoá.`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/user-apis/${encodeURIComponent(username)}`, { method: "DELETE" });
      navigate("/user-apis", { replace: true });
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
      setBusy(false);
    }
  }

  return (
    <section className="bot-detail">
      <p>
        <Link to="/user-apis">← User API</Link>
      </p>
      <header className="page-head">
        <h1>{isNew ? "Thêm User API" : username}</h1>
        <p className="muted">
          Key không được hiện lại. Khi sửa, để trống API key, secret hoặc passphrase nghĩa là giữ giá trị cũ.
          Tên user phải trùng user bot trong RUN. Bot chỉ nhận key mới sau khi restart.
        </p>
      </header>
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {!loading && (isNew || form.username) ? (
        <form className="card admin-form" onSubmit={onSubmit}>
          <label>
            User bot
            <input
              value={form.username}
              onChange={(event) => setField("username", event.target.value)}
              required
              disabled={!canManage || busy}
            />
          </label>
          <label>
            Sàn
            <select
              value={form.exchange}
              onChange={(event) => setField("exchange", event.target.value)}
              disabled={!canManage || busy}
            >
              {EXCHANGES.map((exchange) => (
                <option key={exchange} value={exchange}>
                  {exchange}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sub account
            <input
              value={form.subAccount}
              onChange={(event) => setField("subAccount", event.target.value)}
              disabled={!canManage || busy}
            />
          </label>
          <label>
            API key {isNew ? "" : flags.hasApiKey ? "(đã có, để trống nếu giữ)" : "(chưa có)"}
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => setField("apiKey", event.target.value)}
              autoComplete="new-password"
              required={isNew}
              disabled={!canManage || busy}
            />
          </label>
          <label>
            API secret {isNew ? "" : flags.hasApiSecret ? "(đã có, để trống nếu giữ)" : "(chưa có)"}
            <input
              type="password"
              value={form.apiSecret}
              onChange={(event) => setField("apiSecret", event.target.value)}
              autoComplete="new-password"
              required={isNew}
              disabled={!canManage || busy}
            />
          </label>
          <label>
            Passphrase {isNew ? "(nếu sàn yêu cầu)" : flags.hasPassword ? "(đã có, để trống nếu giữ)" : "(chưa có)"}
            <input
              type="password"
              value={form.password}
              onChange={(event) => setField("password", event.target.value)}
              autoComplete="new-password"
              disabled={!canManage || busy}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.hedgeMode}
              onChange={(event) => setField("hedgeMode", event.target.checked)}
              disabled={!canManage || busy}
            />
            <span>Hedge mode</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.test}
              onChange={(event) => setField("test", event.target.checked)}
              disabled={!canManage || busy}
            />
            <span>Tài khoản test</span>
          </label>
          {canManage ? (
            <div className="form-title">
              <button type="submit" disabled={busy}>
                {isNew ? "Tạo" : "Lưu"}
              </button>
              {isNew ? null : (
                <button type="button" className="danger" disabled={busy} onClick={onDelete}>
                  Xoá
                </button>
              )}
            </div>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
