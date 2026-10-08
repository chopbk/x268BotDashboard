import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import Pager from "../components/Pager";
import { canEditResource, ownsBot } from "../access";
import useDebouncedValue from "../hooks/useDebouncedValue";
import { useEscape, useLeaveGuard } from "../navigation";

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function money(value, signed = true) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (!signed) return `${text}$`;
  return `${n > 0 ? "+" : ""}${text}$`.replace("+-", "-");
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

function when(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN");
}

function todayWindow() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  to.setMilliseconds(-1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function onOff(value) {
  if (value == null) return "—";
  return value ? "bật" : "tắt";
}

function signalText(signals) {
  return Array.isArray(signals) && signals.length ? `Theo ${signals.join(", ")}` : "Chưa theo signal nào";
}

function peekTitle(peek) {
  if (peek.kind === "static") return `Static trong ngày · ${peek.username}`;
  if (peek.kind === "static-all") return "Static trong ngày · bot được phép xem";
  if (peek.kind === "profit") return `Lãi lỗ trong ngày · ${peek.username}`;
  if (peek.kind === "profit-all") return "Lãi lỗ trong ngày · bot được phép xem";
  if (peek.kind === "account-all") return "Config · bot được phép xem";
  return `Config · ${peek.username}`;
}

function incomeDay(data) {
  const series = data?.series || [];
  return series.find((row) => row.ymd === data?.to) || series[series.length - 1] || null;
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

function readList(params) {
  const active = params.get("active");
  return {
    q: params.get("q") || "",
    page: Math.max(1, Number(params.get("page")) || 1),
    activity: active === "off" ? "off" : active === "all" ? "" : "on",
    scope: params.get("visibility") || "",
    audience: params.get("audience") === "all" ? "all" : "mine",
  };
}

function writeList(current, partial) {
  const next = { ...readList(current), ...partial };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.activity === "off") params.set("active", "off");
  if (next.activity === "") params.set("active", "all");
  if (next.scope) params.set("visibility", next.scope);
  if (next.audience === "all") params.set("audience", "all");
  return params;
}

export default function HomePage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const list = readList(params);
  const canCreateBot = can(user, "bots.create");
  const canEditBot = can(user, "bots.edit");
  const canDeleteBot = can(user, "bots.delete");
  const canViewConfig = can(user, "config.view");
  const canViewStatistics = can(user, "statistics.view");
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
  const [query, setQuery] = useState(list.q);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const [peek, setPeek] = useState(null);
  const [peekData, setPeekData] = useState(null);
  const [peekError, setPeekError] = useState("");
  const [peekBusy, setPeekBusy] = useState(false);
  useEscape(Boolean(peek), () => setPeek(null));
  const pageLimit = 50;
  const dropDrafts = useRef(false);
  const debouncedQuery = useDebouncedValue(query);
  const { scope, activity, audience, page } = list;

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
    setDrafts((prev) => {
      if (dropDrafts.current) {
        dropDrafts.current = false;
        return Object.fromEntries(rows.map((bot) => [bot.username, draftFrom(bot)]));
      }
      return Object.fromEntries(rows.map((bot) => {
        const old = prev[bot.username];
        if (!old) return [bot.username, draftFrom(bot)];
        const dirty = (old.visibility || "public") !== (bot.visibility || "public")
          || isActive(old) !== isActive(bot)
          || (isAdmin && (old.ownerUserId || "") !== (bot.ownerUserId || ""));
        return [bot.username, dirty ? old : draftFrom(bot)];
      }));
    });
  }

  function resetDrafts() {
    setDrafts(Object.fromEntries(bots.map((bot) => [bot.username, draftFrom(bot)])));
  }

  function ownerLabel(id) {
    if (!id) return "Chưa có";
    const row = webUsers.find((item) => item.id === id);
    return row ? `${row.name} (${row.username || row.email})` : "Đã gán";
  }

  const dirtyBots = bots.filter(isDirty);
  const guard = useLeaveGuard(dirtyBots.length > 0, `Đang sửa ${dirtyBots.length} user.`);

  async function commitList(partial) {
    if (dirtyBots.length && guard) {
      const ok = await guard.confirmLeave();
      if (!ok) {
        setQuery(list.q);
        return;
      }
      dropDrafts.current = true;
      resetDrafts();
    }
    const next = writeList(params, partial);
    navigate({ pathname: location.pathname, search: next.toString() ? `?${next}` : "" }, { state: location.state });
  }

  useEffect(() => {
    if (debouncedQuery.trim() === list.q) return;
    commitList({ q: debouncedQuery.trim(), page: 1 });
  }, [debouncedQuery]);

  useEffect(() => {
    setQuery(list.q);
  }, [list.q]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), limit: String(pageLimit) });
    if (list.q) params.set("q", list.q);
    if (scope) params.set("visibility", scope);
    if (activity === "on") params.set("active", "true");
    if (activity === "off") params.set("active", "false");
    const controller = new AbortController();
    api(`/api/bots?${params}`, { signal: controller.signal })
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
      controller.abort();
    };
  }, [page, list.q, scope, activity]);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    api("/api/admin/users?limit=100", { signal: controller.signal })
      .then((data) => setWebUsers(data.users || []))
      .catch(() => setWebUsers([]));
    return () => controller.abort();
  }, [isAdmin]);

  useEffect(() => {
    if (!peek) return undefined;
    if (peek.kind === "account" && !canViewConfig) {
      setPeekBusy(false);
      return undefined;
    }
    const controller = new AbortController();
    let cancelled = false;
    const staticQuery = new URLSearchParams({ from: peek.from, to: peek.to });
    if (peek.kind === "static") {
      staticQuery.set("username", peek.username);
      staticQuery.set("limit", "10");
    } else if (peek.kind === "static-all") staticQuery.set("scope", "assigned");
    const path = peek.kind === "static" || peek.kind === "static-all"
      ? `/api/account-statics?${staticQuery}`
      : peek.kind === "profit"
        ? `/api/account-ledger?username=${encodeURIComponent(peek.username)}&days=1`
        : peek.kind === "profit-all"
          ? "/api/account-ledger?scope=assigned&days=1"
          : peek.kind === "account-all"
            ? "/api/bots/assigned-configs"
            : `/api/bots/${encodeURIComponent(peek.username)}/configs`;
    api(path, { signal: controller.signal })
      .then((data) => {
        if (!cancelled) setPeekData(data);
      })
      .catch((err) => {
        if (!cancelled) setPeekError(err.message || "Không tải được");
      })
      .finally(() => {
        if (!cancelled) setPeekBusy(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [peek, canViewConfig]);

  function openPeek(kind, username) {
    const day = todayWindow();
    setPeekBusy(!(kind === "account" && !canViewConfig));
    setPeekError("");
    setPeekData(null);
    setPeek({ kind, username, from: day.from, to: day.to });
  }

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
          <p className="muted">{isAdmin ? "Đổi phạm vi, chủ sở hữu và cờ Active ngay trên danh sách, rồi bấm Lưu." : "Mặc định chỉ hiện user của bạn. Chọn Tất cả để xem user đang active và công khai."} {canViewStatistics ? "Trước tên user: Static theo signal của từng config, Lãi lỗ là income của user. Static tất cả, Config tất cả và Lãi lỗ tất cả cộng các bot được phép xem." : "Trước tên user, bấm Account để xem config đang theo signal nào. Config tất cả cộng các bot được phép xem."}</p>
          {canViewStatistics || canViewConfig ? (
            <div className="history-range">
              {canViewStatistics ? <button type="button" className="ghost" onClick={() => openPeek("static-all")}>Static tất cả</button> : null}
              {canViewConfig ? <button type="button" className="ghost" onClick={() => openPeek("account-all")}>Config tất cả</button> : null}
              {canViewStatistics ? <button type="button" className="ghost" onClick={() => openPeek("profit-all")}>Lãi lỗ tất cả</button> : null}
            </div>
          ) : null}
        </div>
        <div className="bot-list-tools">
          {!isAdmin ? (
            <select value={audience} onChange={(event) => commitList({ audience: event.target.value, page: 1 })} aria-label="Phạm vi danh sách">
              <option value="mine">Của tôi</option>
              <option value="all">Tất cả</option>
            </select>
          ) : null}
          {isAdmin || audience !== "all" ? (
            <>
          <select value={activity} onChange={(event) => commitList({ activity: event.target.value, page: 1 })} aria-label="Lọc active">
                <option value="on">Đang active</option>
                <option value="off">Không active</option>
                <option value="">Mọi trạng thái</option>
              </select>
          <select value={scope} onChange={(event) => commitList({ scope: event.target.value, page: 1 })} aria-label="Lọc phạm vi">
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
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </header>
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
              {dirtyBots.length ? (
                <button type="button" className="ghost" disabled={busy} onClick={resetDrafts}>Huỷ thay đổi</button>
              ) : null}
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
                    <td>
                      <div className="account-title">
                        {canViewStatistics ? (
                          <button type="button" className="ghost" onClick={() => openPeek("static", bot.username)}>Static</button>
                        ) : null}
                        <button type="button" className="ghost" onClick={() => openPeek("account", bot.username)}>Account</button>
                        {canViewStatistics ? (
                          <button type="button" className="ghost" onClick={() => openPeek("profit", bot.username)}>Lãi lỗ</button>
                        ) : null}
                        <span>{bot.username}</span>
                      </div>
                    </td>
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
                        <Link className="ghost link-btn" to={`/bots/${encodeURIComponent(bot.username)}`} state={{ returnTo: `${location.pathname}${location.search}` }}>
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
      {dirtyBots.length ? <p className="dirty-note muted">Đang sửa {dirtyBots.length} user. Đổi bộ lọc hoặc rời trang sẽ hỏi trước khi bỏ các bản nháp.</p> : null}
      <Pager page={page} total={total} limit={pageLimit} onChange={(next) => commitList({ page: next })} />
      {peek ? (
        <div className="modal-backdrop" onClick={() => setPeek(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="bot-peek-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="bot-peek-title">{peekTitle(peek)}</h2>
              <button type="button" className="ghost" onClick={() => setPeek(null)}>Đóng</button>
            </header>
            {peekError ? <p className="form-error">{peekError}</p> : null}
            {peekBusy ? <p className="muted">Đang tải…</p> : null}
            {(peek.kind === "static" || peek.kind === "static-all") && peekData?.stats ? (
              <>
                <p>
                  {peekData.stats.total} lệnh · lãi {money(peekData.stats.profit)} · win rate {pct(peekData.stats.winRate)}
                  {` · openTime ${when(peek.from)} → ${when(peek.to)}`}
                  {peekData.book ? ` · sổ ${peekData.book}` : ""}
                </p>
                {peekData.stats.byConfigSignal?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {peek.kind === "static-all" ? <th>User</th> : null}
                          <th>Config</th>
                          <th>Signal</th>
                          <th>Lệnh</th>
                          <th>Win rate</th>
                          <th>Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peekData.stats.byConfigSignal.map((row) => (
                          <tr key={`${row.username || peek.username}:${row.env}:${row.signal}`}>
                            {peek.kind === "static-all" ? <td>{row.username}</td> : null}
                            <td>{row.env}</td>
                            <td>{row.signal}</td>
                            <td>{row.count}</td>
                            <td>{pct(row.winRate)}</td>
                            <td className={tone(row.profit)}>{money(row.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="muted">Không có lệnh trong ngày này.</p>}
                {peek.kind === "static" ? (
                  <p>
                    <Link className="link-btn" to={`/signals?view=statics&username=${encodeURIComponent(peek.username)}&from=${encodeURIComponent(peek.from)}&to=${encodeURIComponent(peek.to)}`}>
                      Mở Account Static
                    </Link>
                  </p>
                ) : null}
              </>
            ) : null}
            {peek.kind === "account" && !peekBusy ? (
              <>
                {canViewConfig && peekData?.configs?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Config</th><th>On</th><th>Signal</th><th>Mode</th><th></th></tr></thead>
                      <tbody>
                        {peekData.configs.map((row) => (
                          <tr key={row.env}>
                            <td>{row.env}</td>
                            <td>{row.missing ? "chưa có bản ghi" : onOff(row.on)}</td>
                            <td>{row.missing ? "—" : signalText(row.signals)}</td>
                            <td>{row.missing ? "—" : row.mode || "—"}</td>
                            <td>
                              {canViewConfig ? (
                                <Link className="ghost link-btn" to={`/bots/${encodeURIComponent(peek.username)}/accounts/${encodeURIComponent(row.env)}`} state={{ returnTo: `${location.pathname}${location.search}` }}>
                                  {canEditResource(user, "config.edit", bots.find((item) => item.username === peek.username)) ? "Sửa" : "Xem"}
                                </Link>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {!canViewConfig ? (
                  (bots.find((item) => item.username === peek.username)?.accounts || []).length ? (
                    <ul>
                      {(bots.find((item) => item.username === peek.username)?.accounts || []).map((env) => <li key={env}>{env}</li>)}
                    </ul>
                  ) : <p className="muted">User này chưa có config.</p>
                ) : null}
                {canViewConfig && peekData && !peekData.configs?.length ? <p className="muted">User này chưa có config.</p> : null}
                <p>
                  <Link className="link-btn" to={`/bots/${encodeURIComponent(peek.username)}`} state={{ returnTo: `${location.pathname}${location.search}` }}>
                    Mở user
                  </Link>
                </p>
              </>
            ) : null}
            {peek.kind === "account-all" && !peekBusy && peekData ? (
              <>
                {(peekData.users || []).length ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>User</th><th>Config</th><th>Signal</th><th>On</th></tr></thead>
                      <tbody>
                        {(peekData.users || []).flatMap((item) => (item.configs?.length ? item.configs : [{ env: "", missing: true }]).map((row) => (
                          <tr key={`${item.username}:${row.env || "none"}`}>
                            <td>{item.username}</td>
                            <td>{row.env || "—"}</td>
                            <td>{row.missing ? "—" : signalText(row.signals)}</td>
                            <td>{row.env ? (row.missing ? "chưa có bản ghi" : onOff(row.on)) : "chưa có config"}</td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="muted">Không có bot nào trong phạm vi xem.</p>}
              </>
            ) : null}
            {peek.kind === "profit" && peekData ? (
              <>
                <p className="muted">Income của user {peekData.username || peek.username}, ví {peekData.env || "—"}. Ngày UTC {peekData.to || peekData.from}. Cùng nguồn lệnh /income, không tách theo account-config.</p>
                {incomeDay(peekData) ? (
                  <p>
                    Profit {money(incomeDay(peekData).profit)} · fee {money(incomeDay(peekData).fee)} · funding {money(incomeDay(peekData).funding)} · ref {money(incomeDay(peekData).rebate)}
                    {` · số dư ${money(incomeDay(peekData).balance, false)}`}
                    {peekData.live?.unrealized != null ? ` · chưa chốt ${money(peekData.live.unrealized)}` : ""}
                  </p>
                ) : <p className="muted">Chưa có income của user này trong ngày UTC.</p>}
                <p>
                  <Link className="link-btn" to={`/ledger?username=${encodeURIComponent(peek.username)}`}>Mở lãi lỗ</Link>
                </p>
              </>
            ) : null}
            {peek.kind === "profit-all" && peekData ? (
              <>
                <p className="muted">Income từng bot được phép xem, ngày UTC {peekData.from}. Mỗi user một ví, cùng lệnh /income.</p>
                {(peekData.rows || []).length ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>User</th><th>Ví</th><th>Profit</th><th>Fee</th><th>Funding</th><th>Ref</th><th>Số dư</th></tr></thead>
                      <tbody>
                        {peekData.rows.map((row) => (
                          <tr key={row.username}>
                            <td><Link to={`/ledger?username=${encodeURIComponent(row.username)}`}>{row.username}</Link></td>
                            <td>{row.env}</td>
                            <td className={tone(row.profit)}>{money(row.profit)}</td>
                            <td className={tone(row.fee)}>{money(row.fee)}</td>
                            <td className={tone(row.funding)}>{money(row.funding)}</td>
                            <td className={tone(row.rebate)}>{money(row.rebate)}</td>
                            <td>{money(row.balance, false)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="muted">Không có bot nào trong phạm vi xem.</p>}
                {peekData.totals ? <p>Tổng profit {money(peekData.totals.profit)} · fee {money(peekData.totals.fee)} · funding {money(peekData.totals.funding)} · ref {money(peekData.totals.rebate)}</p> : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
