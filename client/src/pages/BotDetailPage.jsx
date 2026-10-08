import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Crumbs, useEscape, useLeaveGuard } from "../navigation";
import useDebouncedValue from "../hooks/useDebouncedValue";
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

function showList(value) {
  return Array.isArray(value) && value.length ? value.join(", ") : "—";
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

function when(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("vi-VN");
}

function capitalLine(config) {
  const mode = config?.mode || "FIX";
  if (mode === "RATIO") return `RATIO: size theo ví × ratio ${config.ratio ?? "—"}.`;
  if (mode === "LOSS" || mode === "RR") return `${mode}: size để chạm SL lỗ khoảng ${money(config.fixloss)}. Để 0 thì lấy max loss ${config.maxLoss ?? "—"}.`;
  if (mode === "RISK") return `RISK: size = cost ${money(config.cost)} × (risk của signal / 5).`;
  return `FIX: volume = cost ${money(config.cost)} × đòn bẩy long ${config.leverage ?? "—"} = ${money(config.volume)}.`;
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
  const location = useLocation();
  const [params] = useSearchParams();
  const filters = {
    signal: params.get("signal") || "",
    long: params.get("long") || "",
    on: params.get("on") || "",
    volume: params.get("volume") || "",
    volumeOp: params.get("op") === "lt" ? "lt" : "gt",
    mode: params.get("mode") || "",
    type: params.get("type") || "",
  };
  const [volumeText, setVolumeText] = useState(filters.volume);
  const debouncedVolume = useDebouncedValue(volumeText);
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
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState({ on: "", long: "", short: "", paper: "", monitor: "", mode: "", cost: "", leverage: "", signals: "" });
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [summaries, setSummaries] = useState({});
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState(null);
  const [peekData, setPeekData] = useState(null);
  const [peekError, setPeekError] = useState("");
  const [peekBusy, setPeekBusy] = useState(false);
  useEscape(Boolean(peek), () => setPeek(null));
  const quickDirty = Object.values(quick).some((value) => String(value || "").trim() !== "");
  const metaDirty = Boolean(bot) && (
    editUserName !== (bot.username || "")
    || (visibility || "public") !== (bot.visibility || "public")
    || (user?.role === "admin" && (ownerUserId || "") !== (bot.ownerUserId || ""))
  );
  const pendingCount = (editEnv ? 1 : 0) + (quickDirty ? 1 : 0) + (metaDirty ? 1 : 0);
  const guard = useLeaveGuard(pendingCount > 0, pendingCount > 1 ? `Đang sửa ${pendingCount} mục.` : editEnv ? "Đang đổi tên 1 config." : quickDirty ? "Config nhanh chưa được áp dụng." : "Thông tin bot chưa được lưu.");
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
    setPeek(null);
    api(`/api/bots/${encodeURIComponent(username)}`, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        const found = data.bot || null;
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
  }, [canViewConfig, bot, accountKey, summaryVersion]);

  useEffect(() => {
    if (!peek || !bot?.username) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setPeekBusy(true);
    setPeekError("");
    setPeekData(null);
    const path = peek.kind === "static"
      ? `/api/account-statics?username=${encodeURIComponent(bot.username)}&env=${encodeURIComponent(peek.env)}&limit=20`
      : `/api/bots/${encodeURIComponent(bot.username)}/configs/${encodeURIComponent(peek.env)}`;
    api(path, { signal: controller.signal })
      .then((data) => {
        if (!cancelled) setPeekData(peek.kind === "static" ? data : data.config);
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
  }, [peek, bot?.username]);

  useEffect(() => {
    setVolumeText(filters.volume);
  }, [filters.volume]);

  useEffect(() => {
    if (debouncedVolume === filters.volume) return;
    commitFilters({ volume: debouncedVolume });
  }, [debouncedVolume]);

  async function commitFilters(partial) {
    if (pendingCount > 0 && guard) {
      const ok = await guard.confirmLeave();
      if (!ok) {
        setVolumeText(filters.volume);
        return;
      }
      setEditEnv(null);
      setEnvDraft("");
      setQuick({ on: "", long: "", short: "", paper: "", monitor: "", mode: "", cost: "", leverage: "", signals: "" });
      setQuickOpen(false);
      if (bot) {
        setEditUserName(bot.username || "");
        setVisibility(bot.visibility || "public");
        setOwnerUserId(bot.ownerUserId || "");
      }
    }
    const next = new URLSearchParams(params);
    const values = { ...filters, ...partial };
    const write = {
      signal: values.signal,
      long: values.long,
      on: values.on,
      volume: values.volume,
      op: values.volumeOp === "lt" ? "lt" : "",
      mode: values.mode,
      type: values.type,
    };
    for (const [key, value] of Object.entries(write)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const search = next.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { state: location.state });
  }

  function clearQuick() {
    setQuick({ on: "", long: "", short: "", paper: "", monitor: "", mode: "", cost: "", leverage: "", signals: "" });
    setQuickOpen(false);
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
      <header className="page-head">
        <Crumbs
          items={[{ label: "Bot", to: location.state?.returnTo || "/bots" }, { label: bot?.username || username }]}
          returnTo={location.state?.returnTo || ""}
        />
        <h1>{bot?.username || username}</h1>
        {pendingCount > 0 ? (
          <p className="dirty-note muted">
            Đang sửa {pendingCount} mục.
            <button type="button" className="ghost" onClick={() => {
              setEditEnv(null);
              setEnvDraft("");
              clearQuick();
              if (bot) {
                setEditUserName(bot.username || "");
                setVisibility(bot.visibility || "public");
                setOwnerUserId(bot.ownerUserId || "");
              }
            }}>Huỷ thay đổi</button>
          </p>
        ) : null}
        <p className="muted">Bấm Cấu hình hoặc Static trước tên config để xem nhanh trong popup. Sửa vẫn mở đủ mục.</p>
        {canViewSignalHistory ? <p><Link to="/signal-search?tab=history">Xem lịch sử signal hệ thống</Link></p> : null}
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
                    navigate("/bots", { replace: true });
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
              <button type="button" disabled={busy} onClick={() => setQuickOpen((open) => !open)}>
                Config nhanh
              </button>
            ) : null}
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
          {canEditConfig && quickOpen && picked.size > 0 ? (
            <form
              className="account-filters"
              onSubmit={(event) => {
                event.preventDefault();
                const names = [...picked];
                const body = { envs: names };
                for (const key of ["on", "long", "short", "paper", "monitor"]) {
                  if (quick[key] === "on") body[key] = true;
                  if (quick[key] === "off") body[key] = false;
                }
                if (quick.mode) body.mode = quick.mode;
                if (quick.cost !== "") body.cost = Number(quick.cost);
                if (quick.leverage !== "") {
                  body.leverage = Number(quick.leverage);
                  body.shortLeverage = Number(quick.leverage);
                }
                if (quick.signals.trim()) {
                  body.signals = quick.signals.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
                }
                if (Object.keys(body).length === 1) {
                  setError("Chọn ít nhất một mục để sửa. Ô để trống sẽ giữ nguyên.");
                  return;
                }
                if (!window.confirm(`Áp config nhanh cho ${names.length} account?`)) return;
                run(async () => {
                  const data = await api(`/api/bots/${encodeURIComponent(bot.username)}/configs/bulk`, {
                    method: "POST",
                    body,
                  });
                  setSummaryVersion((version) => version + 1);
                  setQuickOpen(false);
                  if (data.failed?.length) {
                    setError(data.failed.map((row) => `${row.env}: ${row.error}`).join("; "));
                  }
                });
              }}
            >
              {[
                ["on", "On"],
                ["long", "Long"],
                ["short", "Short"],
                ["paper", "Paper"],
                ["monitor", "Monitor"],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select value={quick[key]} onChange={(event) => setQuick((prev) => ({ ...prev, [key]: event.target.value }))}>
                    <option value="">Giữ nguyên</option>
                    <option value="on">Bật</option>
                    <option value="off">Tắt</option>
                  </select>
                </label>
              ))}
              <label>
                Mode
                <select value={quick.mode} onChange={(event) => setQuick((prev) => ({ ...prev, mode: event.target.value }))}>
                  <option value="">Giữ nguyên</option>
                  {["FIX", "RATIO", "RISK", "RR", "LOSS"].map((mode) => <option key={mode} value={mode}>{mode}</option>)}
                </select>
              </label>
              <label>
                Cost
                <input value={quick.cost} inputMode="decimal" placeholder="Giữ nguyên" onChange={(event) => setQuick((prev) => ({ ...prev, cost: event.target.value }))} />
              </label>
              <label>
                Đòn bẩy
                <input value={quick.leverage} inputMode="decimal" placeholder="Giữ nguyên" onChange={(event) => setQuick((prev) => ({ ...prev, leverage: event.target.value }))} />
              </label>
              <label>
                Signal
                <input value={quick.signals} placeholder="Giữ nguyên" onChange={(event) => setQuick((prev) => ({ ...prev, signals: event.target.value }))} />
              </label>
              <button type="submit" disabled={busy}>Áp dụng {picked.size} config</button>
              <p className="muted">Ô để trống giữ nguyên. Signal điền vào sẽ thay cả danh sách signal. Bot nhận bản mới sau khi restart.</p>
            </form>
          ) : null}
          {accounts.length > 0 ? (
            <div className="account-filters">
              <label>
                Signal
                <select value={filters.signal} onChange={(event) => commitFilters({ signal: event.target.value })}>
                  <option value="">Tất cả</option>
                  {signalOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label>
                Long
                <select value={filters.long} onChange={(event) => commitFilters({ long: event.target.value })}>
                  <option value="">Tất cả</option>
                  <option value="on">Bật</option>
                  <option value="off">Tắt</option>
                </select>
              </label>
              <label>
                On
                <select value={filters.on} onChange={(event) => commitFilters({ on: event.target.value })}>
                  <option value="">Tất cả</option>
                  <option value="on">Bật</option>
                  <option value="off">Tắt</option>
                </select>
              </label>
              <label className="volume-filter">
                Volume
                <span className="volume-filter-row">
                  <select aria-label="So với volume" value={filters.volumeOp === "lt" ? "lt" : "gt"} onChange={(event) => commitFilters({ volumeOp: event.target.value })}>
                    <option value="gt">Lớn hơn</option>
                    <option value="lt">Bé hơn</option>
                  </select>
                  <input
                    type="number"
                    step="any"
                    value={volumeText}
                    placeholder="Nhập số"
                    aria-label="Ngưỡng volume"
                    onChange={(event) => setVolumeText(event.target.value)}
                  />
                </span>
              </label>
              <label>
                Mode
                <select value={filters.mode} onChange={(event) => commitFilters({ mode: event.target.value })}>
                  <option value="">Tất cả</option>
                  {modeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label>
                Type
                <select aria-label="Lọc theo open type" value={filters.type} onChange={(event) => commitFilters({ type: event.target.value })}>
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
                  <div className="account-title">
                    {canViewConfig ? (
                      <button type="button" className="ghost" onClick={() => { setPeekBusy(true); setPeekError(""); setPeekData(null); setPeek({ kind: "config", env: account }); }}>
                        Cấu hình
                      </button>
                    ) : null}
                    {canViewStatistics ? (
                      <button type="button" className="ghost" onClick={() => { setPeekBusy(true); setPeekError(""); setPeekData(null); setPeek({ kind: "static", env: account }); }}>
                        Static
                      </button>
                    ) : null}
                    <span className="chip">{account}</span>
                  </div>
                  {canViewConfig ? <span className="account-meta">{summaryText(summaries[account])}</span> : null}
                </div>
                {canViewConfig || canEditConfig ? (
                  <div className="row-actions">
                    <Link
                      className="ghost link-btn"
                      to={`/bots/${encodeURIComponent(bot.username)}/accounts/${encodeURIComponent(account)}`}
                      state={{ listTo: `${location.pathname}${location.search}`, returnTo: location.state?.returnTo || "" }}
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
      {peek && bot ? (
        <div className="modal-backdrop" onClick={() => setPeek(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="peek-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="peek-title">{peek.kind === "static" ? "Static signal" : "Cấu hình"} · {bot.username} · {peek.env}</h2>
              <button type="button" className="ghost" onClick={() => setPeek(null)}>Đóng</button>
            </header>
            {peekError ? <p className="form-error">{peekError}</p> : null}
            {peekBusy ? <p className="muted">Đang tải…</p> : null}
            {peek.kind === "config" && peekData ? (
              <div className="config-glance">
                <section>
                  <h3>Chạy</h3>
                  <p>{peekData.paper ? "Paper" : "Live"} · On {onOff(peekData.on)} · Long {onOff(peekData.long)} · Short {onOff(peekData.short)} · Invert {onOff(peekData.invert)} · Monitor {onOff(peekData.monitor)}</p>
                </section>
                <section>
                  <h3>Signal</h3>
                  <p>{showList(peekData.signals)}</p>
                </section>
                <section>
                  <h3>Vốn</h3>
                  <p>{capitalLine(peekData)}</p>
                  <p className="muted">Đòn bẩy long {peekData.leverage ?? "—"} · short {peekData.shortLeverage ?? "—"} · level {peekData.level ?? "—"}</p>
                </section>
                <section>
                  <h3>SL / TP</h3>
                  <p>SL {peekData.slType || "—"} {peekData.sl ?? "—"} · nến {peekData.slCandle || "—"} · max loss {peekData.maxLoss ?? "—"}</p>
                  <p>TP {peekData.tpType || "—"} {showList(peekData.tpPercent)} · close {peekData.tpClose ?? "—"} · hold {onOff(peekData.tpHold)}</p>
                </section>
                <p className="row-actions">
                  <Link className="link-btn" to={`/bots/${encodeURIComponent(bot.username)}/accounts/${encodeURIComponent(peek.env)}`} state={{ listTo: `${location.pathname}${location.search}`, returnTo: location.state?.returnTo || "" }}>
                    Mở đủ config
                  </Link>
                </p>
              </div>
            ) : null}
            {peek.kind === "static" && peekData?.stats ? (
              <>
                <p className="muted">
                  {peekData.stats.total} lệnh · lãi {money(peekData.stats.profit)} · win rate {pct(peekData.stats.winRate)}
                  {peekData.from ? ` · openTime ${when(peekData.from)}` : ""}
                  {peekData.to ? ` → ${when(peekData.to)}` : " → nay"}
                  {peekData.book ? ` · sổ ${peekData.book}` : ""}
                </p>
                {peekData.stats.bySignal?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Signal</th>
                          <th>Lệnh</th>
                          <th>Win rate</th>
                          <th>Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peekData.stats.bySignal.map((row) => (
                          <tr key={row.signal}>
                            <td>{row.signal}</td>
                            <td>{row.count}</td>
                            <td>{pct(row.winRate)}</td>
                            <td>{money(row.profit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="muted">Không có lệnh trong khoảng này.</p>}
                <p className="row-actions">
                  <Link className="link-btn" to={`/signals?view=statics&username=${encodeURIComponent(bot.username)}&env=${encodeURIComponent(peek.env)}`}>
                    Mở Account Static
                  </Link>
                </p>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
