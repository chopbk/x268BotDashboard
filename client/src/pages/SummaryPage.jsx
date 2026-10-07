import { useEffect, useState } from "react";
import { api } from "../api";

export default function SummaryPage() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api("/api/summary").then(setSummary).catch((err) => setError(err.message));
  }, []);

  return (
    <section>
      <header className="page-head"><div><h1>Tổng kết hệ thống</h1><p className="muted">Chỉ hiển thị số liệu tổng hợp, không lộ user, bot hay config chi tiết.</p></div></header>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="stats-grid">
        <article className="card"><span className="muted">User bot</span><strong>{summary?.botCount ?? "—"}</strong></article>
        <article className="card"><span className="muted">Config</span><strong>{summary?.configCount ?? "—"}</strong></article>
      </div>
    </section>
  );
}
