import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Pager from "../components/Pager";
import { canEditResource, ownsBot } from "../access";

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function matchesQuery(bot, query) {
  if (!query) return true;
  const name = bot.username.toLowerCase();
  if (name.includes(query)) return true;
  return (bot.accounts || []).some((account) => account.toLowerCase().includes(query));
}

function isActive(bot) {
  return bot?.active !== false;
}

function draftFrom(bot) {
  return {
    visibility: bot?.visibility || "public",
    ownerUserId: bot?.ownerUserId || "",
    active: isActive(bot),
  };
}

export default function HomePage() {
  const { user } = useAuth();
  const canCreateBot = can(user, "bots.create");
  const canEditBot = can(user, "bots.edit");
  const canDeleteBot = can(user, "bots.delete");
  const isAdmin = user?.role === "admin";
  const canPick = canEditBot || canDeleteBot;
  const [bots, setBots] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [webUsers, setWebUsers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [newUser, setNewUser] = useState("");
  const [newBotVisibility, setNewBotVisibility] = useState("public");
  const [newBotActive, setNewBotActive] = useState(true);
  const [scope, setScope] = useState("");
  const [activity, setActivity] = useState("on");
  const [audience, setAudience] = useState("mine");
  const [signalQuery, setSignalQuery] = useState("");
  const [signalRows, setSignalRows] = useState(null);
  const [signalError, setSignalError] = useState("");
  const [signalBusy, setSignalBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageLimit = 50;

  const normalizedQuery = query.trim().toLowerCase();
  const visibleBots = useMemo(
    () =>
      bots.filter((bot) => {
        if (!isAdmin) {
          if (audience === "all") {
            if (!isActive(bot) || (bot.visibility || "public") === "private") return false;
          } else if (!ownsBot(user, bot)) return false;
        }
        if (isAdmin || audience !== "all") {
          if (scope && (bot.visibility || "public") !== scope) return false;
          if (activity === "on" && !isActive(bot)) return false;
          if (activity === "off" && isActive(bot)) return false;
        }
        return matchesQuery(bot, normalizedQuery);
      }),
    [activity, audience, bots, isAdmin, normalizedQuery, scope, user]
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

  function draftOf(bot) {
    return drafts[bot.username] || draftFrom(bot);
  }

  function isDirty(bot) {
    const draft = draftOf(bot);
    if ((draft.visibility || "public") !== (bot.visibility || "public")) return true;
    if (isActive(draft) !== isActive(bot)) return true;
    return isAdmin && (draft.ownerUserId || "") !== (bot.ownerUserId || "");
  }

  function patchDraft(names, values) {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const name of names) {
        const bot = bots.find((item) => item.username === name);
        const current = next[name] || draftFrom(bot);
        next[name] = { ...current, ...values };
      }
      return next;
    });
  }

  function rememberBots(rows) {
    setBots(rows);
    setDrafts(Object.fromEntries(rows.map((bot) => [bot.username, draftFrom(bot)])));
  }

  function ownerLabel(id) {
    if (!id) return "Chưa có";
    const row = webUsers.find((item) => item.id === id);
    return row ? `${row.name} (${row.username || row.email})` : "Đã gán";
  }

  const dirtyBots = bots.filter(isDirty);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(pageLimit) });
    if (query.trim()) params.set("q", query.trim());
    if (scope) params.set("visibility", scope);
    if (activity) params.set("active", activity === "on" ? "true" : "false");
    api(`/api/bots?${params}`)
      .then((data) => {
        if (!cancelled) { rememberBots(data.bots || []); setTotal(data.total || 0); }
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
  }, [page, query, scope, activity]);

  useEffect(() => {
    if (!isAdmin) return;
    api("/api/admin/users?limit=100")
      .then((data) => setWebUsers(data.users || []))
      .catch(() => setWebUsers([]));
  }, [isAdmin]);

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
          <p className="muted">{isAdmin ? "Đổi phạm vi, chủ sở hữu và cờ Active ngay trên danh sách, rồi bấm Lưu." : "Mặc định chỉ hiện user của bạn. Chọn Tất cả để xem user đang active và công khai."}</p>
        </div>
        <div className="bot-list-tools">
          {!isAdmin ? (
            <select value={audience} onChange={(event) => setAudience(event.target.value)} aria-label="Phạm vi danh sách">
              <option value="mine">Của tôi</option>
              <option value="all">Tất cả</option>
            </select>
          ) : null}
          {isAdmin || audience !== "all" ? (
            <>
          <select value={activity} onChange={(event) => { setActivity(event.target.value); setPage(1); }} aria-label="Lọc active">
                <option value="on">Đang active</option>
                <option value="off">Không active</option>
                <option value="">Mọi trạng thái</option>
              </select>
          <select value={scope} onChange={(event) => { setScope(event.target.value); setPage(1); }} aria-label="Lọc phạm vi">
                <option value="">Mọi phạm vi</option>
                <option value="public">Công khai</option>
                <option value="private">Riêng tư</option>
              </select>
            </>
          ) : null}
          <input
            className="user-search"
            value={query}
            placeholder="Tên user hoặc config"
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          />
        </div>
      </header>
      {can(user, "config.view") ? (
        <form
          className="card signal-search"
          onSubmit={(event) => {
            event.preventDefault();
            const signal = signalQuery.trim();
            if (!signal) return;
            setSignalBusy(true);
            setSignalError("");
            api(`/api/bots/config-search?signal=${encodeURIComponent(signal)}`)
              .then((data) => setSignalRows(data.rows || []))
              .catch((err) => setSignalError(err.message || "Không tìm được signal"))
              .finally(() => setSignalBusy(false));
          }}
        >
          <label>
            Tìm signal
            <input value={signalQuery} placeholder="ROSE, BULL" onChange={(event) => setSignalQuery(event.target.value)} />
          </label>
          <button type="submit" disabled={signalBusy || !signalQuery.trim()}>Tìm</button>
          {signalError ? <p className="form-error">{signalError}</p> : null}
          {signalRows ? (
            signalRows.length === 0 ? <p className="muted">Không có config khớp.</p> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Config</th>
                      <th>Signal</th>
                      <th>Lệnh 30 ngày</th>
                      <th>Profit</th>
                      <th>Gần nhất</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {signalRows.map((row) => (
                      <tr key={`${row.username}/${row.env}`}>
                        <td>{row.username}</td>
                        <td>{row.env}</td>
                        <td>{row.matched.join(", ")}</td>
                        <td>{row.trades}</td>
                        <td>{Number(row.profit || 0).toFixed(2)}$</td>
                        <td>{row.lastTime ? new Date(row.lastTime).toLocaleString("vi-VN") : "—"}</td>
                        <td>
                          <div className="row-actions">
                            <Link className="ghost link-btn" to={`/bots/${encodeURIComponent(row.username)}/accounts/${encodeURIComponent(row.env)}`}>
                              {row.canEdit ? "Sửa" : "Xem"}
                            </Link>
                            {can(user, "statistics.view") ? (
                              <Link className="ghost link-btn" to={`/signals?view=statics&username=${encodeURIComponent(row.username)}&env=${encodeURIComponent(row.env)}&signal=${encodeURIComponent(row.matched[0] || "")}`}>
                                Static
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </form>
      ) : null}
      {canCreateBot ? (
        <form
          className="card inline-create"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              const data = await api("/api/bots", {
                method: "POST",
                body: { username: newUser, visibility: newBotVisibility, active: newBotActive },
              });
              setBots((prev) => {
                const next = [...prev.filter((bot) => bot.username !== data.bot.username), data.bot].sort((a, b) =>
                  a.username.localeCompare(b.username)
                );
                setDrafts((current) => ({
                  ...current,
                  [data.bot.username]: draftFrom(data.bot),
                }));
                return next;
              });
              setNewUser("");
              setNewBotVisibility("public");
              setNewBotActive(true);
            });
          }}
        >
          <label>
            User bot mới
            <input value={newUser} onChange={(event) => setNewUser(event.target.value)} required />
          </label>
          <label>
            Phạm vi
            <select value={newBotVisibility} onChange={(event) => setNewBotVisibility(event.target.value)} aria-label="Phạm vi bot mới">
              <option value="public">Công khai</option>
              <option value="private">Riêng tư</option>
            </select>
            <small className="muted">
              {newBotVisibility === "private"
                ? "Chỉ chủ sở hữu, admin và người được gán."
                : "Người có quyền xem tất cả vẫn thấy."}
            </small>
          </label>
          <label className="check">
            <input type="checkbox" checked={newBotActive} onChange={(event) => setNewBotActive(event.target.checked)} />
            <span>Active</span>
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
      {visibleBots.length > 0 && (canEditBot || canDeleteBot) ? (
        <div className="bulk-bar bot-access-bar">
          <div className="history-range">
            <button type="button" className="ghost" onClick={() => setPicked(new Set(visibleNames))}>Chọn đang hiện</button>
            <button type="button" className="ghost" onClick={() => setPicked(new Set(visibleBots.filter((bot) => (bot.visibility || "public") === "public").map((bot) => bot.username)))}>Chọn công khai</button>
            <button type="button" className="ghost" onClick={() => setPicked(new Set(visibleBots.filter((bot) => bot.visibility === "private").map((bot) => bot.username)))}>Chọn riêng tư</button>
            <button type="button" className="ghost" onClick={() => setPicked(new Set(visibleBots.filter((bot) => isActive(bot)).map((bot) => bot.username)))}>Chọn active</button>
            <button type="button" className="ghost" onClick={() => setPicked(new Set(visibleBots.filter((bot) => !isActive(bot)).map((bot) => bot.username)))}>Chọn không active</button>
            <button type="button" className="ghost" disabled={!picked.size} onClick={() => setPicked(new Set())}>Bỏ chọn</button>
            <span className="muted">Đã chọn {picked.size}</span>
          </div>
          {canEditBot ? (
            <div className="history-range">
              <label>
                Đặt phạm vi
                <select
                  value=""
                  disabled={busy || !picked.size}
                  aria-label="Đặt phạm vi cho user đã chọn"
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value) patchDraft([...picked], { visibility: value });
                  }}
                >
                  <option value="">Giữ nguyên</option>
                  <option value="public">Công khai</option>
                  <option value="private">Riêng tư</option>
                </select>
              </label>
              <label>
                Đặt active
                <select
                  value=""
                  disabled={busy || !picked.size}
                  aria-label="Đặt active cho user đã chọn"
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value) patchDraft([...picked], { active: value === "on" });
                  }}
                >
                  <option value="">Giữ nguyên</option>
                  <option value="on">Active</option>
                  <option value="off">Không active</option>
                </select>
              </label>
              {isAdmin ? (
                <label>
                  Đặt chủ
                  <select
                    value=""
                    disabled={busy || !picked.size}
                    aria-label="Đặt chủ sở hữu cho user đã chọn"
                    onChange={(event) => {
                      const value = event.target.value;
                      if (!value) return;
                      patchDraft([...picked], { ownerUserId: value === "none" ? "" : value });
                    }}
                  >
                    <option value="">Giữ nguyên</option>
                    <option value="none">Bỏ chủ sở hữu</option>
                    {webUsers.map((row) => (
                      <option key={row.id} value={row.id}>{row.name} ({row.username || row.email})</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                type="button"
                disabled={busy || dirtyBots.length === 0}
                onClick={() => {
                  run(async () => {
                    const saved = [];
                    try {
                      for (const bot of dirtyBots) {
                        const draft = draftOf(bot);
                        const body = {};
                        if ((draft.visibility || "public") !== (bot.visibility || "public")) body.visibility = draft.visibility;
                        if (isActive(draft) !== isActive(bot)) body.active = isActive(draft);
                        if (isAdmin && (draft.ownerUserId || "") !== (bot.ownerUserId || "")) body.ownerUserId = draft.ownerUserId || null;
                        if (!Object.keys(body).length) continue;
                        const data = await api(`/api/bots/${encodeURIComponent(bot.username)}`, { method: "PATCH", body });
                        saved.push(data.bot);
                      }
                    } finally {
                      if (saved.length) {
                        setBots((prev) => prev.map((item) => saved.find((bot) => bot.username === item.username) || item));
                        setDrafts((prev) => {
                          const next = { ...prev };
                          for (const bot of saved) next[bot.username] = draftFrom(bot);
                          return next;
                        });
                      }
                    }
                  });
                }}
              >
                Lưu{dirtyBots.length ? ` (${dirtyBots.length})` : ""}
              </button>
            </div>
          ) : null}
          {canDeleteBot && picked.size > 0 ? (
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
                      setDrafts((prev) => {
                        const next = { ...prev };
                        removed.forEach((name) => delete next[name]);
                        return next;
                      });
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
          ) : null}
        </div>
      ) : null}
      {visibleBots.length > 0 ? (
        <div className="table-wrap bot-list">
          <table>
            <thead>
              <tr>
                {canPick ? (
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
                <th>Active</th>
                <th>Phạm vi</th>
                <th>Chủ sở hữu</th>
                <th>Số config</th>
                <th>Khớp</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleBots.map((bot) => {
                const draft = draftOf(bot);
                const matchedAccounts = normalizedQuery
                  ? (bot.accounts || []).filter((account) => account.toLowerCase().includes(normalizedQuery))
                  : [];
                return (
                  <tr key={bot.username} className={[isDirty(bot) ? "row-dirty" : "", draft.active === false ? "row-off" : ""].filter(Boolean).join(" ") || undefined}>
                    {canPick ? (
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
                    <td>
                      {canEditBot ? (
                        <input
                          type="checkbox"
                          checked={draft.active !== false}
                          disabled={busy}
                          aria-label={`Active ${bot.username}`}
                          onChange={(event) => patchDraft([bot.username], { active: event.target.checked })}
                        />
                      ) : isActive(bot) ? "Bật" : "Tắt"}
                    </td>
                    <td>
                      {canEditBot ? (
                        <select
                          value={draft.visibility === "private" ? "private" : "public"}
                          disabled={busy}
                          aria-label={`Phạm vi ${bot.username}`}
                          onChange={(event) => patchDraft([bot.username], { visibility: event.target.value })}
                        >
                          <option value="public">Công khai</option>
                          <option value="private">Riêng tư</option>
                        </select>
                      ) : draft.visibility === "private" ? "Riêng tư" : "Công khai"}
                    </td>
                    <td>
                      {isAdmin ? (
                        <select
                          value={draft.ownerUserId || ""}
                          disabled={busy}
                          aria-label={`Chủ sở hữu ${bot.username}`}
                          onChange={(event) => patchDraft([bot.username], { ownerUserId: event.target.value })}
                        >
                          <option value="">Chưa có chủ sở hữu</option>
                          {draft.ownerUserId && !webUsers.some((row) => row.id === draft.ownerUserId) ? (
                            <option value={draft.ownerUserId}>Đã gán</option>
                          ) : null}
                          {webUsers.map((row) => (
                            <option key={row.id} value={row.id}>{row.name} ({row.username || row.email})</option>
                          ))}
                        </select>
                      ) : ownerLabel(bot.ownerUserId)}
                    </td>
                    <td>{(bot.accounts || []).length}</td>
                    <td className="muted">{matchedAccounts.join(", ")}</td>
                    <td>
                      <div className="row-actions">
                        <Link className="ghost link-btn" to={`/bots/${encodeURIComponent(bot.username)}`}>
                          {canEditResource(user, "config.edit", bot) ? "Sửa" : "Xem"}
                        </Link>
                        {canDeleteBot ? (
                          <button
                            type="button"
                            className="danger"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(`Xoá user bot ${bot.username}? Config và API key không bị xoá.`)) return;
                              run(async () => {
                                await api(`/api/bots/${encodeURIComponent(bot.username)}`, { method: "DELETE" });
                                setBots((prev) => prev.filter((item) => item.username !== bot.username));
                                setDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[bot.username];
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
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <Pager page={page} total={total} limit={pageLimit} onChange={setPage} />
    </section>
  );
}
