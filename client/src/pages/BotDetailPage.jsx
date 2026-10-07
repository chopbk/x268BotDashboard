import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEditResource } from "../access";

const CONFIG_VIEW = "config.view";
const CONFIG_EDIT = "config.edit";
const BOTS_EDIT = "bots.edit";
const BOTS_DELETE = "bots.delete";
const SIGNALS_HISTORY = "signals.history";
const STATISTICS_VIEW = "statistics.view";

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function onOff(value) {
  if (value == null) return "?";
  return value ? "bật" : "tắt";
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  return `${text}$`;
}

function summaryText(row) {
  if (!row) return "Đang tải…";
  if (row.missing) return "Chưa có bản ghi config";
  const signals = row.signals?.length ? row.signals.join(", ") : "không signal";
  const parts = [
    `On=${onOff(row.on)}`,
    `Long=${onOff(row.long)}`,
    `Short=${onOff(row.short)}`,
    signals,
    row.mode || "—",
  ];
  if (row.mode === "RATIO" && row.ratio != null) parts.push(`ratio ${row.ratio}`);
  if ((row.mode === "LOSS" || row.mode === "RR") && row.fixloss != null) parts.push(`fixloss ${money(row.fixloss)}`);
  if (row.mode === "RISK" && row.risk != null) parts.push(`risk ${row.risk}`);
  parts.push(`vol ${money(row.volume)}`);
  if (row.openType) parts.push(row.openType);
  return parts.join(" · ");
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))].sort((a, b) => String(a).localeCompare(String(b)));
}

function volumeLimit(filters) {
  if (filters.volume === "" || filters.volume == null) return null;
  const n = Number(filters.volume);
  return Number.isFinite(n) ? n : null;
}

function matchesConfig(row, filters) {
  const limit = volumeLimit(filters);
  const active = filters.signal || filters.long || filters.on || limit != null || filters.mode || filters.type;
  if (!row || row.missing) return !active;
  if (filters.signal && !(row.signals || []).some((name) => String(name).toUpperCase() === filters.signal.toUpperCase())) return false;
  if (filters.long === "on" && row.long !== true) return false;
  if (filters.long === "off" && row.long !== false) return false;
  if (filters.on === "on" && row.on !== true) return false;
  if (filters.on === "off" && row.on !== false) return false;
  if (limit != null) {
    const volume = Number(row.volume);
    if (!Number.isFinite(volume)) return false;
    if (filters.volumeOp === "lt" ? volume >= limit : volume <= limit) return false;
  }
  if (filters.mode && row.mode !== filters.mode) return false;
  if (filters.type && row.openType !== filters.type) return false;
  return true;
}

export default function BotDetailPage() {
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canViewConfig = can(user, CONFIG_VIEW);
  const canEditBot = can(user, BOTS_EDIT);
  const canDeleteBot = can(user, BOTS_DELETE);
  const canViewSignalHistory = can(user, SIGNALS_HISTORY);
  const canViewStatistics = can(user, STATISTICS_VIEW);
  const [bot, setBot] = useState(null);
  const canEditConfig = canEditResource(user, CONFIG_EDIT, bot);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editUserName, setEditUserName] = useState(username);
  const [visibility, setVisibility] = useState("public");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [webUsers, setWebUsers] = useState([]);
  const [draft, setDraft] = useState("");
  const [editEnv, setEditEnv] = useState(null);
  const [envDraft, setEnvDraft] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [summaries, setSummaries] = useState({});
  const [filters, setFilters] = useState({ signal: "", long: "", on: "", volume: "", volumeOp: "gt", mode: "", type: "" });
  const [busy, setBusy] = useState(false);
  const accounts = bot?.accounts || [];
  const visibleAccounts = accounts.filter((account) => account === editEnv || matchesConfig(summaries[account], filters));
  const allPicked = visibleAccounts.length > 0 && visibleAccounts.every((account) => picked.has(account));
  const signalOptions = uniqueSorted(accounts.flatMap((account) => summaries[account]?.signals || []));
  const modeOptions = uniqueSorted(accounts.map((account) => summaries[account]?.mode));
  const typeOptions = uniqueSorted(accounts.map((account) => summaries[account]?.openType));

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    api("/api/bots", { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        const found = (data.bots || []).find((item) => item.username === username) || null;
        setBot(found);
        setEditUserName(found?.username || username);
        setVisibility(found?.visibility || "public");
        setOwnerUserId(found?.ownerUserId || "");
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
      controller.abort();
    };
  }, [username]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    const controller = new AbortController();
    api("/api/admin/users", { signal: controller.signal }).then((data) => setWebUsers(data.users || [])).catch(() => {});
    return () => controller.abort();
  }, [user?.role]);

  const accountKey = accounts.join("|");
  useEffect(() => {
    if (!canViewConfig || !bot) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    api(`/api/bots/${encodeURIComponent(bot.username)}/configs`, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        const next = {};
        for (const row of data.configs || []) next[row.env] = row;
        setSummaries(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canViewConfig, bot, accountKey]);

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
        <p className="muted">Mỗi config hiện On, Long/Short, signal, mode và volume. Bấm Sửa để đổi các mục đó.</p>
        {canViewSignalHistory ? <p><Link to="/signals?view=signals">Xem lịch sử signal hệ thống</Link></p> : null}
        {canViewStatistics ? <p><Link to={`/signals?view=statics&username=${encodeURIComponent(username)}`}>Xem Account Static của User bot</Link></p> : null}
      </header>
      {loading ? <p className="muted">Đang tải…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {bot ? (
        <article className="card bot-detail">
          {canEditBot ? (
            <form
              className="inline-edit"
              onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  const data = await api(`/api/bots/${encodeURIComponent(bot.username)}`, {
                    method: "PATCH",
                    body: { username: editUserName, visibility, ...(user?.role === "admin" ? { ownerUserId: ownerUserId || null } : {}) },
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
                Lưu thông tin bot
              </button>
              <label>
                Phạm vi
                <select value={visibility === "private" ? "private" : "public"} onChange={(event) => setVisibility(event.target.value)} aria-label="Phạm vi bot">
                  <option value="public">Công khai</option>
                  <option value="private">Riêng tư</option>
                </select>
              </label>
              {user?.role === "admin" ? (
                <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)} aria-label="Chủ sở hữu bot">
                  <option value="">Chưa có chủ sở hữu</option>
                  {webUsers.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.username || row.email})</option>)}
                </select>
              ) : null}
              {canDeleteBot ? (
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
              ) : null}
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
          {accounts.length > 0 ? (
            <div className="account-filters">
              <label>
                Signal
                <select value={filters.signal} onChange={(event) => setFilters((prev) => ({ ...prev, signal: event.target.value }))}>
                  <option value="">Tất cả</option>
                  {signalOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label>
                Long
                <select value={filters.long} onChange={(event) => setFilters((prev) => ({ ...prev, long: event.target.value }))}>
                  <option value="">Tất cả</option>
                  <option value="on">Bật</option>
                  <option value="off">Tắt</option>
                </select>
              </label>
              <label>
                On
                <select value={filters.on} onChange={(event) => setFilters((prev) => ({ ...prev, on: event.target.value }))}>
                  <option value="">Tất cả</option>
                  <option value="on">Bật</option>
                  <option value="off">Tắt</option>
                </select>
              </label>
              <label className="volume-filter">
                Volume
                <span className="volume-filter-row">
                  <select aria-label="So với volume" value={filters.volumeOp === "lt" ? "lt" : "gt"} onChange={(event) => setFilters((prev) => ({ ...prev, volumeOp: event.target.value }))}>
                    <option value="gt">Lớn hơn</option>
                    <option value="lt">Bé hơn</option>
                  </select>
                  <input
                    type="number"
                    step="any"
                    value={filters.volume}
                    placeholder="Nhập số"
                    aria-label="Ngưỡng volume"
                    onChange={(event) => setFilters((prev) => ({ ...prev, volume: event.target.value }))}
                  />
                </span>
              </label>
              <label>
                Mode
                <select value={filters.mode} onChange={(event) => setFilters((prev) => ({ ...prev, mode: event.target.value }))}>
                  <option value="">Tất cả</option>
                  {modeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label>
                Type
                <select aria-label="Lọc theo open type" value={filters.type} onChange={(event) => setFilters((prev) => ({ ...prev, type: event.target.value }))}>
                  <option value="">Tất cả</option>
                  {typeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>
          ) : null}
          {canEditConfig && visibleAccounts.length > 0 ? (
            <label className="check">
              <input
                type="checkbox"
                checked={allPicked}
                onChange={() => {
                  setPicked(allPicked ? new Set() : new Set(visibleAccounts));
                }}
              />
              Chọn tất cả
            </label>
          ) : null}
          {(bot.accounts || []).length === 0 ? <p className="muted">Không có config</p> : null}
          {accounts.length > 0 && visibleAccounts.length === 0 ? <p className="muted">Không có config khớp bộ lọc.</p> : null}
          {visibleAccounts.map((account) =>
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
                <div className="account-main">
                  <span className="chip">{account}</span>
                  {canViewConfig ? <span className="account-meta">{summaryText(summaries[account])}</span> : null}
                </div>
                {canViewConfig || canEditConfig ? (
                  <div className="row-actions">
                    <Link
                      className="ghost link-btn"
                      to={`/bots/${encodeURIComponent(bot.username)}/accounts/${encodeURIComponent(account)}`}
                    >
                      {canEditConfig ? "Sửa" : "Xem"}
                    </Link>
                    {canEditConfig ? (
                      <>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setEditEnv(account);
                            setEnvDraft(account);
                          }}
                        >
                          Đổi tên
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
                      </>
                    ) : null}
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
