import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Pager from "../components/Pager";

const CREDENTIALS_MANAGE = "credentials.manage";

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function matchesQuery(row, query) {
  if (!query) return true;
  return [row.username, row.exchange, row.subAccount].some((value) =>
    String(value || "").toLowerCase().includes(query)
  );
}

function yesNo(value) {
  return value ? "Có" : "Chưa";
}

export default function UserApisPage() {
  const { user } = useAuth();
  const canManage = can(user, CREDENTIALS_MANAGE);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageLimit = 50;

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(
    () => rows.filter((row) => matchesQuery(row, normalizedQuery)),
    [rows, normalizedQuery]
  );
  const visibleNames = visible.map((row) => row.username);
  const allVisiblePicked = visibleNames.length > 0 && visibleNames.every((name) => picked.has(name));

  function togglePicked(username) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  }

  function toggleVisible() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allVisiblePicked) visibleNames.forEach((name) => next.delete(name));
      else visibleNames.forEach((name) => next.add(name));
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(pageLimit) });
    if (query.trim()) params.set("q", query.trim());
    api(`/api/user-apis?${params}`)
      .then((data) => {
        if (!cancelled) { setRows(data.apis || []); setTotal(data.total || 0); }
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
  }, [page, query]);

  async function run(action) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message || "Thao tác thất bại");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header className="page-head user-list-head">
        <div>
          <h1>User API</h1>
          <p className="muted">
            Key sàn của từng user bot. Danh sách chỉ hiện đã có key hay chưa. Bot đọc key mới sau khi restart.
          </p>
        </div>
        <input
          className="user-search"
          value={query}
          placeholder="Tên user, sàn hoặc sub account"
          onChange={(event) => { setQuery(event.target.value); setPage(1); }}
        />
      </header>
      {canManage ? (
        <p>
          <Link className="link-btn" to="/user-apis/new">
            Thêm User API
          </Link>
        </p>
      ) : null}
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {!loading && rows.length === 0 ? <div className="card empty">Chưa có User API.</div> : null}
      {!loading && rows.length > 0 && visible.length === 0 ? (
        <div className="card empty">Không có User API khớp bộ lọc.</div>
      ) : null}
      {canManage && picked.size > 0 ? (
        <div className="bulk-bar">
          <span className="muted">Đã chọn {picked.size} User API</span>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              const names = [...picked];
              if (
                !window.confirm(
                  `Xoá ${names.length} User API? Chỉ xoá bản ghi key, không xoá user bot hay config.`
                )
              ) {
                return;
              }
              run(async () => {
                const removed = [];
                try {
                  for (const name of names) {
                    await api(`/api/user-apis/${encodeURIComponent(name)}`, { method: "DELETE" });
                    removed.push(name);
                  }
                } finally {
                  if (removed.length) {
                    setRows((prev) => prev.filter((item) => !removed.includes(item.username)));
                    setPicked((prev) => {
                      const next = new Set(prev);
                      removed.forEach((name) => next.delete(name));
                      return next;
                    });
                  }
                }
              });
            }}
          >
            Xoá đã chọn
          </button>
        </div>
      ) : null}
      {visible.length > 0 ? (
        <div className="table-wrap bot-list">
          <table>
            <thead>
              <tr>
                {canManage ? (
                  <th className="check-col">
                    <input
                      type="checkbox"
                      checked={allVisiblePicked}
                      onChange={toggleVisible}
                      aria-label="Chọn tất cả User API đang hiện"
                    />
                  </th>
                ) : null}
                <th>User</th>
                <th>Sàn</th>
                <th>API key</th>
                <th>Secret</th>
                <th>Passphrase</th>
                <th>Hedge</th>
                <th>Test</th>
                <th>Sub account</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.username}>
                  {canManage ? (
                    <td className="check-col">
                      <input
                        type="checkbox"
                        checked={picked.has(row.username)}
                        onChange={() => togglePicked(row.username)}
                        aria-label={`Chọn ${row.username}`}
                      />
                    </td>
                  ) : null}
                  <td>{row.username}</td>
                  <td>{row.exchange || "—"}</td>
                  <td>{yesNo(row.hasApiKey)}</td>
                  <td>{yesNo(row.hasApiSecret)}</td>
                  <td>{yesNo(row.hasPassword)}</td>
                  <td>{row.hedgeMode ? "Bật" : "Tắt"}</td>
                  <td>{row.test ? "Bật" : "Tắt"}</td>
                  <td className="muted">{row.subAccount || "—"}</td>
                  <td>
                    <div className="row-actions">
                      <Link className="ghost link-btn" to={`/user-apis/${encodeURIComponent(row.username)}`}>
                        {canManage ? "Sửa" : "Xem"}
                      </Link>
                      {canManage ? (
                        <button
                          type="button"
                          className="danger"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Xoá User API ${row.username}? User bot và config không bị xoá.`
                              )
                            ) {
                              return;
                            }
                            run(async () => {
                              await api(`/api/user-apis/${encodeURIComponent(row.username)}`, {
                                method: "DELETE",
                              });
                              setRows((prev) => prev.filter((item) => item.username !== row.username));
                              setPicked((prev) => {
                                const next = new Set(prev);
                                next.delete(row.username);
                                return next;
                              });
                            });
                          }}
                        >
                          Xoá
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <Pager page={page} total={total} limit={pageLimit} onChange={setPage} />
    </section>
  );
}
