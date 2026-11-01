import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

export default function InboxPage() {
  const { user } = useAuth();
  const can = (user?.permissions || []).includes("market.view");
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");

  async function load() {
    try {
      const data = await api("/api/research/inbox?unread=0");
      setItems(data.items || []);
      setUnread(data.unread || 0);
      setError("");
    } catch (err) {
      setError(err.message || "Không tải inbox");
    }
  }

  useEffect(() => {
    if (!can) return undefined;
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => clearInterval(t);
  }, [can]);

  async function markRead(id) {
    try {
      await api(`/api/research/inbox/${id}/read`, { method: "PATCH", body: {} });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!can) return <p className="muted">Cần quyền market.view.</p>;

  return (
    <section className="stack">
      <header>
        <h1>Inbox</h1>
        <p className="muted">Chưa đọc: {unread}. Không gửi Telegram/email. entry_touched ≠ fill.</p>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      <ul className="stack">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            <span className="muted"> · {item.kind}</span>
            {!item.readAt ? (
              <button type="button" className="ghost" onClick={() => markRead(item.id)}>Đánh dấu đã đọc</button>
            ) : null}
            <p className="muted">{item.body}</p>
          </li>
        ))}
      </ul>
      {!items.length ? <p className="muted">Trống.</p> : null}
    </section>
  );
}
