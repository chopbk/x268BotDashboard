import { useState } from "react";
import { useAuth } from "../auth";

export default function ProfilePage() {
  const { user, saveProfile } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [telegramUsername, setTelegramUsername] = useState(user?.telegramUsername || "");
  const [telegramId, setTelegramId] = useState(user?.telegramId || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (password && password !== confirmPassword) {
      setError("Mật khẩu mới không khớp");
      return;
    }
    if (password && !currentPassword) {
      setError("Nhập mật khẩu hiện tại để đổi mật khẩu");
      return;
    }
    setBusy(true);
    setError("");
    setSaved("");
    const body = { name, telegramUsername, telegramId, phone };
    if (password) {
      body.currentPassword = currentPassword;
      body.password = password;
    }
    try {
      await saveProfile(body);
      setCurrentPassword("");
      setPassword("");
      setConfirmPassword("");
      setSaved("Đã lưu. Đổi mật khẩu thì dùng mật khẩu mới ở lần đăng nhập sau.");
    } catch (err) {
      setError(err.message || "Không lưu được hồ sơ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Hồ sơ</h1>
          <p className="muted">Sửa tên, Telegram, số điện thoại hoặc mật khẩu của chính bạn. Email và username đăng nhập không đổi tại đây.</p>
        </div>
      </header>
      <form className="card action-form" onSubmit={onSubmit}>
        <label>
          Email
          <input value={user?.email || ""} readOnly />
        </label>
        <label>
          Username
          <input value={user?.username || ""} readOnly />
        </label>
        <label>
          Tên
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Telegram username
          <input value={telegramUsername} placeholder="khong co @" onChange={(event) => setTelegramUsername(event.target.value)} />
        </label>
        <label>
          Telegram ID
          <input value={telegramId} inputMode="numeric" onChange={(event) => setTelegramId(event.target.value)} />
        </label>
        <label>
          Số điện thoại
          <input value={phone} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label>
          Mật khẩu hiện tại
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label>
          Mật khẩu mới
          <input type="password" autoComplete="new-password" value={password} minLength={password ? 8 : undefined} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label>
          Nhập lại mật khẩu mới
          <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        {saved ? <p className="muted">{saved}</p> : null}
        <button type="submit" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </form>
    </section>
  );
}
