import { useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";

export default function RegisterPage() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  if (loading) return <div className="screen muted">Đang tải…</div>;
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await register(name, username, email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Đăng ký thất bại");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="screen login-screen">
      <form className="card login-card" onSubmit={onSubmit}>
        <p className="eyebrow">Web Bot</p>
        <h1>Đăng ký</h1>
        <p className="muted">Tài khoản cần được admin cấp quyền trước khi sử dụng bot.</p>
        <label>
          Tên
          <input
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label>
          Username
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
            minLength={3}
            maxLength={32}
            pattern="[a-z0-9][a-z0-9._-]{2,31}"
            title="3-32 ký tự: chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang"
            required
          />
        </label>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Mật khẩu
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "Đang đăng ký…" : "Đăng ký"}
        </button>
        <p className="auth-switch muted">
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </p>
      </form>
    </div>
  );
}
