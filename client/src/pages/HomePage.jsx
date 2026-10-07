import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function matchesQuery(bot, query) {
  if (!query) return true;
  const name = bot.username.toLowerCase();
  if (name.includes(query)) return true;
  return (bot.accounts || []).some((account) => account.toLowerCase().includes(query));
}

export default function HomePage() {
  const { user } = useAuth();
  const canCreateBot = can(user, "bots.create");
  const canDeleteBot = can(user, "bots.delete");
  const [bots, setBots] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState("");
  const [newBotPrivate, setNewBotPrivate] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleBots = useMemo(
    () => bots.filter((bot) => matchesQuery(bot, normalizedQuery)),
    [bots, normalizedQuery]
  );
  const visibleNames = visibleBots.map((bot) => bot.username);
  const allVisiblePicked =
    visibleNames.length > 0 && visibleNames.every((name) => picked.has(name));

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
    api("/api/bots")
      .then((data) => {
        if (!cancelled) setBots(data.bots || []);
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
  }, []);

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
          <h1>Bot được phép xem</h1>
          <p className="muted">Tìm theo tên user bot hoặc tên config. Bấm Sửa để mở trang config.</p>
        </div>
        <input
          className="user-search"
          value={query}
          placeholder="Tên user hoặc config"
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>
      {canCreateBot ? (
        <form
          className="card inline-create"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              const data = await api("/api/bots", {
                method: "POST",
                body: { username: newUser, visibility: newBotPrivate ? "private" : "public" },
              });
              setBots((prev) =>
                [...prev.filter((bot) => bot.username !== data.bot.username), data.bot].sort((a, b) =>
                  a.username.localeCompare(b.username)
                )
              );
              setNewUser("");
              setNewBotPrivate(false);
            });
          }}
        >
          <label>
            User bot mới
            <input value={newUser} onChange={(event) => setNewUser(event.target.value)} required />
          </label>
          <label className="check">
            <input type="checkbox" checked={newBotPrivate} onChange={(event) => setNewBotPrivate(event.target.checked)} />
            Riêng tư — chỉ chủ sở hữu, admin và người được gán
          </label>
          <button type="submit" disabled={busy}>
            Thêm
          </button>
        </form>
      ) : null}
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {!loading && bots.length === 0 ? <div className="card empty">Chưa được gán bot nào.</div> : null}
      {!loading && bots.length > 0 && visibleBots.length === 0 ? (
        <div className="card empty">Không có user khớp bộ lọc.</div>
      ) : null}
      {canDeleteBot && picked.size > 0 ? (
        <div className="bulk-bar">
          <span className="muted">Đã chọn {picked.size} user</span>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              const names = [...picked];
              if (!window.confirm(`Xoá ${names.length} user bot? Config và API key không bị xoá.`)) return;
              run(async () => {
                const removed = [];
                try {
                  for (const name of names) {
                    await api(`/api/bots/${encodeURIComponent(name)}`, { method: "DELETE" });
                    removed.push(name);
                  }
                } finally {
                  if (removed.length) {
                    setBots((prev) => prev.filter((item) => !removed.includes(item.username)));
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
      {visibleBots.length > 0 ? (
        <div className="table-wrap bot-list">
          <table>
            <thead>
              <tr>
                {canDeleteBot ? (
                  <th className="check-col">
                    <input
                      type="checkbox"
                      checked={allVisiblePicked}
                      onChange={toggleVisible}
                      aria-label="Chọn tất cả user đang hiện"
                    />
                  </th>
                ) : null}
                <th>User bot</th>
                <th>Phạm vi</th>
                <th>Số config</th>
                <th>Khớp</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleBots.map((bot) => {
                const matchedAccounts = normalizedQuery
                  ? (bot.accounts || []).filter((account) => account.toLowerCase().includes(normalizedQuery))
                  : [];
                return (
                  <tr key={bot.username}>
                    {canDeleteBot ? (
                      <td className="check-col">
                        <input
                          type="checkbox"
                          checked={picked.has(bot.username)}
                          onChange={() => togglePicked(bot.username)}
                          aria-label={`Chọn ${bot.username}`}
                        />
                      </td>
                    ) : null}
                    <td>{bot.username}</td>
                    <td>{bot.visibility === "private" ? "Riêng tư" : "Công khai"}</td>
                    <td>{(bot.accounts || []).length}</td>
                    <td className="muted">{matchedAccounts.join(", ")}</td>
                    <td>
                      <div className="row-actions">
                        <Link className="ghost link-btn" to={`/bots/${encodeURIComponent(bot.username)}`}>
                          Sửa
                        </Link>
                        {canDeleteBot ? (
                          <button
                            type="button"
                            className="danger"
                            disabled={busy}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Xoá user bot ${bot.username}? Config và API key không bị xoá.`
                                )
                              ) {
                                return;
                              }
                              run(async () => {
                                await api(`/api/bots/${encodeURIComponent(bot.username)}`, {
                                  method: "DELETE",
                                });
                                setBots((prev) => prev.filter((item) => item.username !== bot.username));
                              });
                            }}
                          >
                            Xoá
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
