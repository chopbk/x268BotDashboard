import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEditResource } from "../access";
import { filterConfigs } from "../configDraft";
import { journeyPaths } from "../components/config-lab/ConfigLabEditor";
import { applyStatusLabel, summarizeApplies, waitForApply, waitForApplies } from "../applyStatus";
import "../components/config-lab/config-lab.css";

const CONFIG_EDIT = "config.edit";
const STATISTICS_VIEW = "statistics.view";
const POSITIONS_VIEW = "positions.view";
const EMPTY_QUICK = { on: "", long: "", short: "", paper: "", monitor: "", mode: "", cost: "", leverage: "", signals: "" };

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function cardKey(row) {
  return `${row.username}/${row.env}`;
}

export default function ConfigLabPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = can(user, CONFIG_EDIT);
  const canStatistics = can(user, STATISTICS_VIEW);
  const canPositions = can(user, POSITIONS_VIEW);
  const [users, setUsers] = useState([]);
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState(EMPTY_QUICK);
  const [newUser, setNewUser] = useState("");
  const [newEnv, setNewEnv] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const scope = params.get("scope") === "all" ? "all" : "mine";
  const filters = { q: params.get("q") || "", username: params.get("user") || "", status: params.get("status") || "", book: params.get("book") || "" };

  useEffect(() => {
    const controller = new AbortController();
    let gone = false;
    setLoading(true); setError(""); setUsers([]);
    api(`/api/bots/assigned-configs?scope=${scope}`, { signal: controller.signal })
      .then((data) => { if (!gone) setUsers(data.users || []); })
      .catch((err) => { if (!gone) setError(err.message || "Không tải được danh sách config"); })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; controller.abort(); };
  }, [scope, retry]);

  useEffect(() => {
    if (!canEdit) { setBots([]); return undefined; }
    const controller = new AbortController();
    let gone = false;
    api("/api/bots?active=true", { signal: controller.signal })
      .then((data) => {
        if (gone) return;
        const editable = (data.bots || []).filter((bot) => canEditResource(user, CONFIG_EDIT, bot));
        setBots(editable);
        setNewUser((prev) => {
          if (filters.username && editable.some((bot) => bot.username === filters.username)) return filters.username;
          if (prev && editable.some((bot) => bot.username === prev)) return prev;
          return editable[0]?.username || "";
        });
      })
      .catch(() => { if (!gone) setBots([]); });
    return () => { gone = true; controller.abort(); };
  }, [canEdit, user, filters.username]);

  const all = useMemo(() => users.flatMap((row) => (row.configs || []).map((cfg) => ({ ...cfg, username: row.username }))), [users]);
  const copyOptions = useMemo(() => {
    const rows = all.map((row) => ({ username: row.username, env: row.env })).filter((row) => row.env);
    rows.sort((a, b) => a.env.localeCompare(b.env) || a.username.localeCompare(b.username));
    return rows;
  }, [all]);
  const rows = filterConfigs(all, filters);
  const page = Math.max(1, Math.min(Number(params.get("page")) || 1, Math.ceil(rows.length / 24) || 1));
  const visible = rows.slice((page - 1) * 24, page * 24);
  const visibleKeys = visible.map(cardKey);
  const filterKeys = rows.map(cardKey);
  const allVisiblePicked = visibleKeys.length > 0 && visibleKeys.every((key) => picked.has(key));
  const allFilteredPicked = filterKeys.length > 0 && filterKeys.every((key) => picked.has(key));
  const pickedRows = all.filter((row) => picked.has(cardKey(row)));
  const bulkUsers = [...new Set(pickedRows.map((row) => row.username))];
  const bulkReady = canEdit && pickedRows.length > 0 && bulkUsers.length === 1;

  function filter(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    if (key === "scope") next.delete("user");
    setParams(next, { replace: true });
  }

  function togglePick(row, checked) {
    setPicked((prev) => {
      const next = new Set(prev);
      const key = cardKey(row);
      if (checked) next.add(key); else next.delete(key);
      return next;
    });
  }

  function toggleKeys(keys, select) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (select) keys.forEach((key) => next.add(key));
      else keys.forEach((key) => next.delete(key));
      return next;
    });
  }

  function toggleVisible() {
    toggleKeys(visibleKeys, !allVisiblePicked);
  }

  function toggleFiltered() {
    toggleKeys(filterKeys, !allFilteredPicked);
  }

  async function createAccount(event) {
    event.preventDefault();
    if (!canEdit || !newUser || !newEnv.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const env = newEnv.trim().toUpperCase();
      const body = { env };
      if (copyFrom.trim()) body.copyFrom = copyFrom.trim().toUpperCase();
      const data = await api(`/api/bots/${encodeURIComponent(newUser)}/accounts`, { method: "POST", body });
      let apply = data.apply || null;
      if (apply?.requestId && !apply.terminal) apply = await waitForApply(newUser, apply.requestId);
      setNotice(apply ? `${applyStatusLabel(apply)}${body.copyFrom ? ` · copy từ ${body.copyFrom}` : ""}` : "Đã thêm config");
      setNewEnv(""); setCopyFrom("");
      navigate(`/config-lab/${encodeURIComponent(newUser)}/${encodeURIComponent(env)}`, { state: { labReturnTo: location.pathname + location.search } });
    } catch (err) {
      setError(err.message || "Không thêm được config");
      setBusy(false);
    }
  }

  async function runBulk(patch, label) {
    if (!bulkReady) return;
    const username = bulkUsers[0];
    const envs = pickedRows.map((row) => row.env);
    if (!window.confirm(`${label} trên ${envs.length} config của ${username}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await api(`/api/bots/${encodeURIComponent(username)}/configs/bulk`, {
        method: "POST",
        body: { envs, ...patch },
      });
      let applies = data.applies || [];
      if (applies.some((a) => a?.requestId && !a.terminal)) {
        applies = await waitForApplies(username, applies);
      }
      const failed = data.failed || [];
      setNotice([
        data.updated?.length ? `Đã cập nhật ${data.updated.length} config` : "",
        failed.length ? failed.map((row) => `${row.env}: ${row.error}`).join("; ") : "",
        summarizeApplies(applies),
      ].filter(Boolean).join(". "));
      setPicked(new Set());
      setQuickOpen(false);
      setQuick(EMPTY_QUICK);
      setRetry((value) => value + 1);
    } catch (err) {
      setError(err.message || "Bulk thất bại");
    } finally {
      setBusy(false);
    }
  }

  async function applyQuick(event) {
    event.preventDefault();
    if (!bulkReady) return;
    const body = {};
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
    if (!Object.keys(body).length) {
      setError("Chọn ít nhất một mục để sửa. Ô để trống sẽ giữ nguyên.");
      return;
    }
    await runBulk(body, "Áp config nhanh");
  }

  async function deletePicked() {
    if (!bulkReady) return;
    const username = bulkUsers[0];
    const envs = pickedRows.map((row) => row.env);
    if (!window.confirm(`Xoá ${envs.length} config khỏi ${username}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const applies = [];
      for (const env of envs) {
        const data = await api(`/api/bots/${encodeURIComponent(username)}/accounts/${encodeURIComponent(env)}`, { method: "DELETE" });
        if (data.apply) applies.push(data.apply);
      }
      let done = applies;
      if (done.some((a) => a?.requestId && !a.terminal)) {
        done = await waitForApplies(username, done);
      }
      setNotice(summarizeApplies(done) || "Đã gỡ config");
      setPicked(new Set());
      setQuickOpen(false);
      setRetry((value) => value + 1);
    } catch (err) {
      setError(err.message || "Không xoá được config");
    } finally {
      setBusy(false);
    }
  }

  return <section className="config-lab lab-directory">
    <header className="lab-heading">
      <div className="lab-heading-top">
        <p className="lab-kicker">CẤU HÌNH GIAO DỊCH</p>
        <Link className="ghost link-btn" to="/bots">← Danh sách bot</Link>
      </div>
      <h1>Config</h1>
      <p className="lab-intro">Tạo, sửa, copy/sync và bulk config. Active / phạm vi / chủ sở hữu bot nằm ở Danh sách. Lưu ở đây ghi Mongo và đồng bộ bot qua MQTT.</p>
    </header>

    {canEdit && bots.length ? <form className="lab-create" onSubmit={createAccount}>
      <div className="lab-title-row"><h2>Tạo config</h2><span className="lab-caption">Tên env luôn viết hoa · có thể copy từ config được xem</span></div>
      <div className="lab-create-fields">
        <label>User bot<select value={newUser} onChange={(event) => setNewUser(event.target.value)} disabled={busy} required>
          {bots.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}
        </select></label>
        <label>Tên config<input value={newEnv} onChange={(event) => setNewEnv(event.target.value.toUpperCase())} placeholder="VD: MY1" required disabled={busy} title="Lưu dạng chữ hoa" /></label>
        <label className="lab-copy-from">Copy từ
          <input list="lab-copy-from-envs" value={copyFrom} placeholder="Gõ hoặc chọn env" disabled={busy} autoComplete="off"
            onChange={(event) => setCopyFrom(event.target.value.toUpperCase())} />
          <datalist id="lab-copy-from-envs">{copyOptions.map((row) => <option key={`${row.username}/${row.env}`} value={row.env}>{row.username}/{row.env}</option>)}</datalist>
        </label>
        <label>Chọn nhanh<select value={copyOptions.some((row) => row.env === copyFrom) ? copyFrom : ""} onChange={(event) => setCopyFrom(event.target.value)} disabled={busy} aria-label="Chọn config copy">
          <option value="">Không copy</option>
          {copyOptions.map((row) => <option key={`pick-${row.username}/${row.env}`} value={row.env}>{row.username}/{row.env}</option>)}
        </select></label>
        <button type="submit" disabled={busy || !newUser}>Thêm</button>
      </div>
    </form> : null}

    <div className="lab-directory-stats">
      <div><strong>{all.length}</strong><span>Config trong phạm vi</span></div>
      <div><strong>{all.filter((row) => row.on).length}</strong><span>Bật nhận signal</span></div>
      <div><strong>{all.filter((row) => row.paper).length}</strong><span>Paper</span></div>
    </div>

    <form className="lab-filterbar" onSubmit={(event) => event.preventDefault()}>
      <label className="lab-search">Tìm cấu hình<input type="search" value={filters.q} placeholder="Config, tài khoản hoặc signal…" onChange={(event) => filter("q", event.target.value)} /></label>
      <label>Phạm vi<select value={scope} onChange={(event) => filter("scope", event.target.value)}><option value="mine">Của tôi / được gán</option><option value="all">Tất cả được phép xem</option></select></label>
      <label>Tài khoản<select value={filters.username} onChange={(event) => filter("user", event.target.value)}><option value="">Tất cả</option>{users.map((row) => <option key={row.username} value={row.username}>{row.username}</option>)}</select></label>
      <label>Nhận signal<select value={filters.status} onChange={(event) => filter("status", event.target.value)}><option value="">Tất cả</option><option value="on">Bật</option><option value="off">Tắt</option></select></label>
      <label>Live / Paper<select value={filters.book} onChange={(event) => filter("book", event.target.value)}><option value="">Tất cả</option><option value="live">Live</option><option value="paper">Paper</option></select></label>
    </form>

    {notice ? <p className="lab-notice-banner" role="status">{notice}</p> : null}
    {error && !loading ? <p className="form-error" role="alert">{error}</p> : null}

    {canEdit && picked.size > 0 ? <div className="lab-bulk-bar lab-bulk-stack">
      <div className="lab-bulk-tools">
        <span>Đã chọn {picked.size}{bulkUsers.length > 1 ? " · chọn cùng một user để bulk" : ` · ${bulkUsers[0] || ""}`}</span>
        <button type="button" className="ghost" disabled={!bulkReady || busy} onClick={() => setQuickOpen((open) => !open)}>{quickOpen ? "Ẩn config nhanh" : "Config nhanh"}</button>
        <button type="button" className="danger" disabled={!bulkReady || busy} onClick={deletePicked}>Xoá đã chọn</button>
        <button type="button" className="ghost" disabled={busy} onClick={() => { setPicked(new Set()); setQuickOpen(false); }}>Bỏ chọn</button>
      </div>
      {quickOpen && bulkReady ? <form className="lab-quick-form" onSubmit={applyQuick}>
        {[["on", "On"], ["long", "Long"], ["short", "Short"], ["paper", "Paper"], ["monitor", "Monitor"]].map(([key, label]) => (
          <label key={key}>{label}
            <select value={quick[key]} onChange={(event) => setQuick((prev) => ({ ...prev, [key]: event.target.value }))} disabled={busy}>
              <option value="">Giữ nguyên</option>
              <option value="on">Bật</option>
              <option value="off">Tắt</option>
            </select>
          </label>
        ))}
        <label>Mode
          <select value={quick.mode} onChange={(event) => setQuick((prev) => ({ ...prev, mode: event.target.value }))} disabled={busy}>
            <option value="">Giữ nguyên</option>
            {["FIX", "RATIO", "RISK", "RR", "LOSS"].map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
        <label>Cost<input value={quick.cost} inputMode="decimal" placeholder="Giữ nguyên" disabled={busy} onChange={(event) => setQuick((prev) => ({ ...prev, cost: event.target.value }))} /></label>
        <label>Đòn bẩy<input value={quick.leverage} inputMode="decimal" placeholder="Giữ nguyên" disabled={busy} onChange={(event) => setQuick((prev) => ({ ...prev, leverage: event.target.value }))} /></label>
        <label className="lab-quick-signals">Signal<input value={quick.signals} placeholder="Giữ nguyên · điền sẽ thay cả list" disabled={busy} onChange={(event) => setQuick((prev) => ({ ...prev, signals: event.target.value }))} /></label>
        <button type="submit" disabled={busy}>Áp dụng {picked.size} config</button>
        <p className="lab-caption span-all">Ô trống giữ nguyên. Signal điền vào thay cả danh sách. Lưu xong đồng bộ MQTT.</p>
      </form> : null}
    </div> : null}

    {loading ? <p className="lab-empty" role="status">Đang tải cấu hình…</p> : error && !all.length ? <div className="lab-empty" role="alert"><p>{error}</p><button type="button" className="ghost" onClick={() => setRetry((value) => value + 1)}>Thử lại</button></div> : <>
      <div className="lab-list-heading">
        <h2>{rows.length} cấu hình</h2>
        {canEdit && rows.length ? (
          <div className="lab-select-tools">
            <label className="lab-pick">
              <input type="checkbox" checked={allVisiblePicked} onChange={toggleVisible} disabled={busy || !visible.length} aria-label="Chọn tất cả config trên trang này" />
              Chọn trang này ({visible.length})
            </label>
            {rows.length > visible.length ? (
              <button type="button" className="ghost" disabled={busy} onClick={toggleFiltered}>
                {allFilteredPicked ? "Bỏ chọn hết lọc" : `Chọn hết lọc (${rows.length})`}
              </button>
            ) : null}
            {picked.size > 0 ? (
              <button type="button" className="ghost" disabled={busy} onClick={() => { setPicked(new Set()); setQuickOpen(false); }}>Bỏ chọn</button>
            ) : null}
            <span className="lab-caption">Cùng một user mới Config nhanh / xoá được</span>
          </div>
        ) : (
          <span className="lab-caption">Chọn config để xem chi tiết →</span>
        )}
      </div>
      {!rows.length ? <div className="lab-empty">
        <h2>{all.length ? "Không có config khớp bộ lọc" : "Chưa có config trong phạm vi này"}</h2>
        <p>{all.length ? "Thử đổi tài khoản, trạng thái hoặc từ khóa." : canEdit && bots.length ? "Tạo config ở form phía trên, hoặc kiểm tra user bot được gán và API key ở User API." : "Chọn Tất cả được phép xem hoặc kiểm tra tài khoản được gán."}</p>
        {all.length ? <button type="button" className="ghost" onClick={() => setParams(scope === "all" ? { scope: "all" } : {}, { replace: true })}>Xóa bộ lọc</button> : null}
      </div> : null}
      <div className="lab-config-grid">{visible.map((row) => {
        const paths = journeyPaths(row.username, row.env, (row.signals || []).join(","));
        const key = cardKey(row);
        const checked = picked.has(key);
        return <article key={key} className={`lab-config-card${checked ? " is-picked" : ""}`}>
          <div className="lab-heading-top">
            <span className="lab-caption">{row.username}</span>
            <div className="lab-card-tools">
              {canEdit ? <label className="lab-pick"><input type="checkbox" checked={checked} onChange={(event) => togglePick(row, event.target.checked)} /> Chọn</label> : null}
              <span className={`lab-badge ${row.paper === true ? "paper" : row.paper === false ? "live" : ""}`}>{row.paper === true ? "Paper" : row.paper === false ? "Live" : "Chưa có cấu hình"}</span>
            </div>
          </div>
          <Link className="lab-card-main" to={`/config-lab/${encodeURIComponent(row.username)}/${encodeURIComponent(row.env)}`} state={{ labReturnTo: location.pathname + location.search }}>
            <h3>{row.env}</h3>
            <div className="lab-card-meta"><span className={row.on ? "lab-dot-on" : "lab-dot-off"}>{row.on == null ? "Chưa xác định" : row.on ? "Nhận signal" : "Tắt nhận signal"}</span><span>{row.mode || "—"} · {[row.long && "Long", row.short && "Short"].filter(Boolean).join(" / ") || "—"}</span></div>
            <div className="lab-card-signals">{row.signals?.length ? row.signals.slice(0, 3).map((name) => <span className="lab-tag" key={name}>{name}</span>) : <span className="lab-caption">Chưa chọn signal</span>}{row.signals?.length > 3 ? <span className="lab-tag">+{row.signals.length - 3}</span> : null}</div>
          </Link>
          <div className="lab-card-footer">
            <span>{row.missing ? "Cần kiểm tra dữ liệu" : `Vào lệnh ${row.openType || "—"}`}</span>
            <span className="lab-card-links">
              {canPositions ? <Link to={paths.positions}>Position</Link> : null}
              {canStatistics ? <Link to={paths.statics}>Static</Link> : null}
              <Link to={`/config-lab/${encodeURIComponent(row.username)}/${encodeURIComponent(row.env)}`} state={{ labReturnTo: location.pathname + location.search }}>Sửa ↗</Link>
            </span>
          </div>
        </article>;
      })}</div>
      {rows.length > 24 ? <nav className="lab-pagination" aria-label="Phân trang cấu hình"><button className="ghost" disabled={page === 1} onClick={() => filter("page", String(page - 1))}>Trước</button><span>{page} / {Math.ceil(rows.length / 24)}</span><button className="ghost" disabled={page * 24 >= rows.length} onClick={() => filter("page", String(page + 1))}>Sau</button></nav> : null}
    </>}
  </section>;
}
