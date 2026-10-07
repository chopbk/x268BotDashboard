import { useEffect, useState } from "react";
import { api } from "../api";

const ACTION_LABELS = {
  "user.registered": "Đăng ký user",
  "user.created": "Tạo user",
  "user.updated": "Cập nhật user",
  "user.username_linked": "Gắn username",
  "bot.created": "Tạo bot",
  "bot.renamed": "Đổi tên bot",
  "bot.deleted": "Xóa bot",
  "bot.account_added": "Thêm config vào bot",
  "bot.account_renamed": "Đổi tên config",
  "bot.account_deleted": "Xóa config khỏi bot",
  "credential.created": "Tạo API/credential",
  "credential.updated": "Cập nhật API/credential",
  "credential.deleted": "Xóa API/credential",
};

function identityLabel(identity) {
  return identity?.name || identity?.username || identity?.email || "System";
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ChangeDetails({ changes }) {
  const entries = Object.entries(changes || {});
  if (entries.length === 0) return <span className="muted">Không có thay đổi field</span>;
  return (
    <details className="audit-details">
      <summary>{entries.length} thay đổi</summary>
      <ul>
        {entries.map(([field, change]) => (
          <li key={field}>
            <strong>{field}</strong>: {change?.changed ? "đã thay đổi" : `${formatValue(change?.from)} → ${formatValue(change?.to)}`}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 50;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (appliedQuery) params.set("q", appliedQuery);
    api(`/api/audit-logs?${params}`)
      .then((data) => {
        if (cancelled) return;
        setLogs(data.logs || []);
        setTotal(data.total || 0);
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
  }, [appliedQuery, page]);

  function onSearch(event) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <section>
      <header className="page-head audit-head">
        <div>
          <h1>Lịch sử chỉnh sửa</h1>
          <p className="muted">Audit log được ghi ở server và không chứa mật khẩu hoặc secret.</p>
        </div>
        <form className="audit-search" onSubmit={onSearch}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Action, người sửa, user…"
          />
          <button type="submit">Tìm</button>
        </form>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="table-wrap audit-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Hành động</th>
              <th>Người thực hiện</th>
              <th>Đối tượng</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString("vi-VN")}</td>
                <td>{ACTION_LABELS[log.action] || log.action}</td>
                <td>{identityLabel(log.actor)}</td>
                <td>{identityLabel(log.target)}</td>
                <td><ChangeDetails changes={log.changes} /></td>
              </tr>
            ))}
            {!loading && logs.length === 0 ? (
              <tr><td colSpan="5" className="empty">Chưa có lịch sử phù hợp.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="audit-pagination">
        <span className="muted">{total} bản ghi · Trang {page}/{totalPages}</span>
        <div>
          <button type="button" className="ghost" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Trước</button>
          <button type="button" className="ghost" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Sau</button>
        </div>
      </div>
    </section>
  );
}
