import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const CONFIG_EDIT = "config.edit";
const USERS_MANAGE = "users.manage";

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

export default function BotDetailPage() {
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEditConfig = can(user, CONFIG_EDIT);
  const canManageUsers = can(user, USERS_MANAGE);
  const [bot, setBot] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editUserName, setEditUserName] = useState(username);
  const [draft, setDraft] = useState("");
  const [editEnv, setEditEnv] = useState(null);
  const [envDraft, setEnvDraft] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const accounts = bot?.accounts || [];
  const allPicked = accounts.length > 0 && accounts.every((account) => picked.has(account));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api("/api/bots")
      .then((data) => {
        if (cancelled) return;
        const found = (data.bots || []).find((item) => item.username === username) || null;
        setBot(found);
        setEditUserName(found?.username || username);
        if (!found) setError("Không tìm thấy user bot");
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
  }, [username]);

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
      <header className="page-head">
        <p>
          <Link to="/">← Danh sách user bot</Link>
        </p>
        <h1>{bot?.username || username}</h1>
        <p className="muted">Xem, sửa hoặc xoá config của user này.</p>
      </header>
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {bot ? (
        <article className="card bot-detail">
          {canManageUsers ? (
            <form
              className="inline-edit"
              onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  const data = await api(`/api/bots/${encodeURIComponent(bot.username)}`, {
                    method: "PATCH",
                    body: { username: editUserName },
                  });
                  const next = data.bot.username;
                  setBot(data.bot);
                  setEditUserName(next);
                  if (next !== bot.username) navigate(`/bots/${encodeURIComponent(next)}`, { replace: true });
                });
              }}
            >
              <input
                value={editUserName}
                onChange={(event) => setEditUserName(event.target.value)}
                aria-label="Tên user bot"
                required
              />
              <button type="submit" disabled={busy}>
                Đổi tên
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Xoá user bot ${bot.username}? Config và API key không bị xoá.`)) return;
                  run(async () => {
                    await api(`/api/bots/${encodeURIComponent(bot.username)}`, { method: "DELETE" });
                    navigate("/", { replace: true });
                  });
                }}
              >
                Xoá user
              </button>
            </form>
          ) : null}
          <div className="bulk-bar">
            <p className="muted">Config</p>
            {canEditConfig && picked.size > 0 ? (
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  const names = [...picked];
                  if (!window.confirm(`Xoá ${names.length} config khỏi ${bot.username}?`)) return;
                  run(async () => {
                    let latest = bot;
                    const removed = [];
                    try {
                      for (const account of names) {
                        const data = await api(
                          `/api/bots/${encodeURIComponent(bot.username)}/accounts/${encodeURIComponent(account)}`,
                          { method: "DELETE" }
                        );
                        latest = data.bot;
                        removed.push(account);
                      }
                    } finally {
                      setBot(latest);
                      if (removed.length) {
                        setPicked((prev) => {
                          const next = new Set(prev);
                          removed.forEach((account) => next.delete(account));
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
          {canEditConfig && accounts.length > 0 ? (
            <label className="check">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={() => {
                  setPicked(allPicked ? new Set() : new Set(accounts));
                }}
              />
              Chọn tất cả
            </label>
          ) : null}
          {(bot.accounts || []).length === 0 ? <p className="muted">Không có config</p> : null}
          {(bot.accounts || []).map((account) =>
            editEnv === account ? (
              <form
                className="inline-edit"
                key={account}
                onSubmit={(event) => {
                  event.preventDefault();
                  run(async () => {
                    const data = await api(
                      `/api/bots/${encodeURIComponent(bot.username)}/accounts/${encodeURIComponent(account)}`,
                      { method: "PATCH", body: { env: envDraft } }
                    );
                    setBot(data.bot);
                    setEditEnv(null);
                    setEnvDraft("");
                  });
                }}
              >
                <input value={envDraft} onChange={(event) => setEnvDraft(event.target.value)} required />
                <button type="submit" disabled={busy}>
                  Lưu
                </button>
                <button type="button" className="ghost" onClick={() => setEditEnv(null)}>
                  Huỷ
                </button>
              </form>
            ) : (
              <div className="account-row" key={account}>
                {canEditConfig ? (
                  <input
                    type="checkbox"
                    checked={picked.has(account)}
                    onChange={() => {
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(account)) next.delete(account);
                        else next.add(account);
                        return next;
                      });
                    }}
                    aria-label={`Chọn ${account}`}
                  />
                ) : null}
                <span className="chip">{account}</span>
                {canEditConfig ? (
                  <div className="row-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setEditEnv(account);
                        setEnvDraft(account);
                      }}
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Xoá config ${account} khỏi ${bot.username}?`)) return;
                        run(async () => {
                          const data = await api(
                            `/api/bots/${encodeURIComponent(bot.username)}/accounts/${encodeURIComponent(account)}`,
                            { method: "DELETE" }
                          );
                          setBot(data.bot);
                        });
                      }}
                    >
                      Xoá
                    </button>
                  </div>
                ) : null}
              </div>
            )
          )}
          {canEditConfig ? (
            <form
              className="inline-edit"
              onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  const data = await api(`/api/bots/${encodeURIComponent(bot.username)}/accounts`, {
                    method: "POST",
                    body: { env: draft },
                  });
                  setBot(data.bot);
                  setDraft("");
                });
              }}
            >
              <input
                value={draft}
                placeholder="Tên config"
                onChange={(event) => setDraft(event.target.value)}
                required
              />
              <button type="submit" disabled={busy}>
                Thêm
              </button>
            </form>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
