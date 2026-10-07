import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <div className="screen muted">Đang tải…</div>;
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(identifier, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Đăng nhập thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="screen login-screen">
      <form className="card login-card" onSubmit={onSubmit}>
        <p className="eyebrow">Web Bot</p>
        <h1>Đăng nhập</h1>
        <p className="muted">Đăng nhập để xem và vận hành các bot được cấp quyền.</p>
        <label>
          Email hoặc username
          <input
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            required
          />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
        </button>
        <p className="auth-switch muted">
          Chưa có tài khoản? <Link to="/register">Đăng ký</Link>
        </p>
      </form>
    </div>
  );
}
