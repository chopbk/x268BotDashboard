import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import PeerProxyPanel from "../components/PeerProxyPanel";

function when(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN");
}

function driftLabel(drift) {
  if (drift === "ok") return "Khớp";
  if (drift === "mismatch") return "Lệch";
  if (drift === "stale") return "Stale";
  if (drift === "no_profile") return "Chưa profile";
  if (drift === "unknown") return "Chưa rev";
  return "—";
}

function revText(row) {
  const d = row.desiredRevision;
  const a = row.actualRevision;
  if (d == null && a == null) return "—";
  return `${d ?? "—"}→${a ?? "—"}`;
}

const ROLE_KEYS = new Set([
  "TRADER", "MONITOR", "LISTENER", "SIGNAL", "POSTER", "AI_SUMMARY",
  "DCA_MTF_BOT", "SERVER", "TRADINGVIEW_WEBHOOK", "WEBHOOK", "SCHEDULE_SIGNAL", "DEBUG",
]);

/** Nhóm env mặc định mở khi vào tab Env (còn lại thu gọn). */
const DEFAULT_OPEN_ENV_GROUPS = new Set(["Role", "Kết_nối"]);

function hasPerm(user, key) {
  return (user?.permissions || []).includes(key);
}

export default function SystemHealthPage() {
  const { user } = useAuth();
  // Admin luôn đủ quyền process (kể cả session/cache cũ thiếu processes.* trong mảng permissions).
  const isAdmin = user?.role === "admin";
  const canProcessView =
    isAdmin ||
    hasPerm(user, "processes.view") ||
    hasPerm(user, "processes.edit") ||
    hasPerm(user, "processes.restart");
  const canProcessEdit = isAdmin || hasPerm(user, "processes.edit");
  const canProcessRestart = isAdmin || hasPerm(user, "processes.restart");
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [busyHb, setBusyHb] = useState(false);
  const selectedProcess = searchParams.get("process") || "";

  const load = useCallback((signal, { bust } = {}) => {
    // bust: tránh api() dedupe trả GET đang pending (data trước khi xóa)
    const path = bust ? `/api/system-health?_=${Date.now()}` : "/api/system-health";
    return api(path, { signal })
      .then((result) => {
        setData(result);
        setError("");
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err.message || "Không tải được hệ thống");
      })
      .finally(() => setLoading(false));
  }, []);

  const staleRows = useMemo(
    () => (data?.processes || []).filter((r) => r.status === "down"),
    [data]
  );
  const staleCount = staleRows.length;

  async function clearStaleHeartbeats() {
    if (!canProcessEdit || busyHb) return;
    const keys = staleRows.map((r) => r.key).filter(Boolean);
    if (!keys.length) {
      setError("Không có dòng stale để xóa");
      return;
    }
    if (!window.confirm(`Xóa ${keys.length} heartbeat stale? Process đang chạy sẽ ghi lại.`)) return;
    setBusyHb(true);
    setError("");
    try {
      const res = await api("/api/system-health/heartbeats/purge", {
        method: "POST",
        body: { keys, stale: true },
      });
      // Optimistic: bỏ ngay khỏi UI
      setData((prev) =>
        prev
          ? {
              ...prev,
              processes: (prev.processes || []).filter((p) => p.status !== "down"),
              alerts: (prev.alerts || []).filter(
                (a) => a.code !== "listener" && a.code !== "monitor"
              ),
            }
          : prev
      );
      await load(undefined, { bust: true });
      if (!res.deletedCount) {
        setError("Server không xóa được bản ghi — kiểm tra quyền processes.edit / deploy API mới");
      }
    } catch (err) {
      setError(err.message || "Xóa heartbeat thất bại");
    } finally {
      setBusyHb(false);
    }
  }

  async function deleteHeartbeatRow(row) {
    if (!canProcessEdit || busyHb || !row?.key) return;
    if (!window.confirm(`Xóa heartbeat «${row.processName || row.key}»?`)) return;
    setBusyHb(true);
    setError("");
    try {
      const res = await api("/api/system-health/heartbeats/purge", {
        method: "POST",
        body: { keys: [row.key], stale: false },
      });
      setData((prev) =>
        prev
          ? { ...prev, processes: (prev.processes || []).filter((p) => p.key !== row.key) }
          : prev
      );
      await load(undefined, { bust: true });
      if (!res.deletedCount) setError(`Không tìm thấy key «${row.key}» trong Mongo`);
    } catch (err) {
      setError(err.message || "Xóa heartbeat thất bại");
    } finally {
      setBusyHb(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(), 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [load]);

  const rows = useMemo(() => {
    const list = data?.processes || [];
    if (filter === "all") return list;
    if (filter === "online") return list.filter((r) => r.status !== "down");
    if (filter === "stale") return list.filter((r) => r.status === "down" || r.drift === "stale");
    if (filter === "drift") return list.filter((r) => r.drift === "mismatch" || r.drift === "unknown");
    if (filter === "restarting") {
      return list.filter((r) => r.lastCommand && !["succeeded", "failed", "timed_out", "cancelled"].includes(r.lastCommand.status));
    }
    return list;
  }, [data, filter]);

  const selectedRow = useMemo(() => {
    if (!selectedProcess) return null;
    return (data?.processes || []).find(
      (r) =>
        String(r.processName).toLowerCase() === selectedProcess.toLowerCase() ||
        String(r.profileEnv || "").toLowerCase() === selectedProcess.toLowerCase()
    ) || { processName: selectedProcess, profileEnv: selectedProcess.toUpperCase() };
  }, [data, selectedProcess]);

  function openProcess(row) {
    const key = row.profileEnv || row.processName;
    if (!key) return;
    const next = new URLSearchParams(searchParams);
    next.set("process", key);
    setSearchParams(next);
  }

  function closeProcess() {
    const next = new URLSearchParams(searchParams);
    next.delete("process");
    setSearchParams(next);
  }

  return (
    <section>
      <header className="page-head">
        <h1>Hệ thống</h1>
        <p className="muted">
          Heartbeat process bot, MongoDB, Redis và snapshot. Quá 90 giây không có nhịp là mất kết nối.
          {canProcessView
            ? " Để sửa env / restart: bấm một dòng Process (hoặc nút Sửa) → tab Env → Preview / Lưu / Restart."
            : " Chỉ xem health. Cần processes.edit / processes.restart (hoặc role ops/admin) để sửa env."}
        </p>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="muted">Đang tải…</p> : null}
      {data ? (
        <>
          <p className="muted">Cập nhật {when(data.checkedAt)}</p>
          {data.alerts?.length ? (
            <ul className="health-alerts">
              {data.alerts.map((item) => (
                <li key={`${item.code}-${item.message}`}>{item.message}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Không có cảnh báo.</p>
          )}
          <div className="stats-grid summary-grid">
            {(data.services || []).map((item) => (
              <article key={item.id} className={`card health-${item.status}`}>
                <small>{item.label}</small>
                <strong>
                  {item.status === "ok"
                    ? "Ổn"
                    : item.status === "warn"
                      ? "Cảnh báo"
                      : item.status === "down"
                        ? "Mất"
                        : "Không chạy"}
                </strong>
                <span className="muted">{item.detail}</span>
              </article>
            ))}
          </div>

          <div className="page-head" style={{ marginTop: 24, alignItems: "center" }}>
            <h2 className="summary-section-title" style={{ margin: 0 }}>Process</h2>
            <div className="btn-row" style={{ gap: 8 }}>
              {[
                ["all", "Tất cả"],
                ["online", "Online"],
                ["stale", "Stale"],
                ["drift", "Drift"],
                ["restarting", "Đang restart"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={filter === id ? "" : "ghost"}
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
              {canProcessEdit && staleCount > 0 ? (
                <button type="button" className="ghost" disabled={busyHb} onClick={clearStaleHeartbeats}>
                  Xóa {staleCount} stale
                </button>
              ) : null}
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PM2</th>
                  <th>Role</th>
                  <th>RUN</th>
                  <th>NODE_ENV</th>
                  <th>MQTT</th>
                  <th>TELE_CLIENT</th>
                  <th>Profile</th>
                  <th>Rev</th>
                  <th>Drift</th>
                  <th>Host</th>
                  <th>Command</th>
                  <th>RAM</th>
                  <th>Heartbeat</th>
                  {canProcessView || canProcessEdit ? <th></th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    style={{ cursor: canProcessView ? "pointer" : undefined }}
                    onClick={() => canProcessView && openProcess(row)}
                  >
                    <td>
                      {row.processName}
                      {row.pmId ? ` #${row.pmId}` : ""}
                    </td>
                    <td>{(row.roles || []).join(", ") || "—"}</td>
                    <td>{(row.run || []).join(", ") || "—"}</td>
                    <td>{row.nodeEnv || "—"}</td>
                    <td>
                      {row.mqtt || "—"}
                      {row.mqttConnected === false ? " (đứt)" : row.mqttConnected ? " (nối)" : ""}
                    </td>
                    <td>
                      {row.teleClient ? `${row.teleClient} V${row.teleVersion || "1"}` : "—"}
                      {row.discord ? ` / ${row.discord}` : ""}
                    </td>
                    <td>{row.profileEnv || "—"}</td>
                    <td className={row.drift === "mismatch" ? "negative" : ""}>{revText(row)}</td>
                    <td className={row.drift === "mismatch" || row.drift === "stale" ? "negative" : ""}>
                      {driftLabel(row.drift)}
                    </td>
                    <td>{row.hostId || row.host || "—"}</td>
                    <td>{row.lastCommand ? `${row.lastCommand.kind}:${row.lastCommand.status}` : "—"}</td>
                    <td>{row.memoryMb == null ? "—" : `${row.memoryMb} MB`}</td>
                    <td className={row.status === "down" ? "negative" : ""}>{when(row.at)}</td>
                    {canProcessView || canProcessEdit ? (
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="btn-row" style={{ gap: 4, flexWrap: "nowrap" }}>
                          {canProcessView ? (
                            <button type="button" className="ghost" onClick={() => openProcess(row)}>
                              {canProcessEdit || canProcessRestart ? "Sửa" : "Xem"}
                            </button>
                          ) : null}
                          {canProcessEdit && row.status === "down" ? (
                            <button
                              type="button"
                              className="ghost"
                              disabled={busyHb}
                              onClick={() => deleteHeartbeatRow(row)}
                            >
                              Xóa
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length ? <p className="muted">Không có process khớp bộ lọc.</p> : null}

          {canProcessView ? (
            <PeerProxyPanel canEdit={canProcessEdit} />
          ) : null}
        </>
      ) : null}

      {selectedRow && canProcessView ? (
        <ProcessAdminPanel
          row={selectedRow}
          canEdit={canProcessEdit}
          canRestart={canProcessRestart}
          onClose={closeProcess}
          onChanged={() => load()}
        />
      ) : null}
    </section>
  );
}

function ProcessAdminPanel({ row, canEdit, canRestart, onClose, onChanged }) {
  const envKey = String(row.profileEnv || row.processName || "").toUpperCase();
  const [tab, setTab] = useState(canEdit || canRestart ? "env" : "overview");
  const [detail, setDetail] = useState(null);
  const [registry, setRegistry] = useState([]);
  const [references, setReferences] = useState({ mqtt: [], tele: [], teleClient: [] });
  const [revisions, setRevisions] = useState([]);
  const [commands, setCommands] = useState([]);
  const [draft, setDraft] = useState({});
  const [unset, setUnset] = useState(new Set());
  const [reason, setReason] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [rollbackTo, setRollbackTo] = useState("");
  const [openEnvGroups, setOpenEnvGroups] = useState(() => new Set(DEFAULT_OPEN_ENV_GROUPS));
  /** Key unset đang được mở để nhập (chưa có giá trị trong draft). */
  const [editingKeys, setEditingKeys] = useState(() => new Set());

  const loadDetail = useCallback(async () => {
    if (!envKey) return;
    setError("");
    try {
      const [d, reg, rev, cmds] = await Promise.all([
        api(`/api/admin/processes/${encodeURIComponent(envKey)}`),
        api("/api/admin/processes/registry"),
        api(`/api/admin/processes/${encodeURIComponent(envKey)}/revisions`),
        api(`/api/admin/processes/${encodeURIComponent(envKey)}/commands`),
      ]);
      setDetail(d);
      setDraft({ ...(d.variables || {}) });
      setUnset(new Set());
      setEditingKeys(new Set());
      setRegistry(reg.registry || []);
      setReferences(reg.references || { mqtt: [], tele: [], teleClient: [] });
      setRevisions(rev.revisions || []);
      setCommands(cmds.commands || []);
    } catch (err) {
      setError(err.message || "Không tải được profile");
      setDetail(null);
    }
  }, [envKey]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const active = commands.find((c) =>
      ["queued", "claimed", "restarting", "waiting_heartbeat"].includes(c.status)
    );
    if (!active || (!canEdit && !canRestart)) return undefined;
    const timer = setInterval(async () => {
      try {
        const cmd = await api(`/api/admin/processes/commands/${active.id}`);
        setCommands((prev) => prev.map((c) => (c.id === cmd.id ? cmd : c)));
        if (["succeeded", "failed", "timed_out", "cancelled"].includes(cmd.status)) {
          onChanged?.();
          loadDetail();
        }
      } catch {
        /* ignore poll errors */
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [commands, canEdit, canRestart, loadDetail, onChanged]);

  function setKey(key, value) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setUnset((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setEditingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }

  function clearKey(key) {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setUnset((prev) => new Set(prev).add(key));
    setEditingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function isKeyActive(key) {
    if (unset.has(key)) return false;
    if (editingKeys.has(key)) return true;
    const value = draft[key];
    return value != null && String(value) !== "";
  }

  function activateKey(entry) {
    if (!canEdit) return;
    const key = entry.key;
    if (entry.type === "role_flag" || ROLE_KEYS.has(key)) {
      setKey(key, "true");
      return;
    }
    setEditingKeys((prev) => new Set(prev).add(key));
    setUnset((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (draft[key] == null) {
      setDraft((prev) => ({ ...prev, [key]: "" }));
    }
  }

  function refOptionsFor(entry) {
    if (entry.ref === "mqtt-config") return references.mqtt;
    if (entry.ref === "telegram-config") return references.tele;
    if (entry.ref === "telegram-client") return references.teleClient;
    return null;
  }

  function buildPatch() {
    const patch = {};
    const base = detail?.variables || {};
    for (const [k, v] of Object.entries(draft)) {
      if (unset.has(k)) continue;
      if (String(base[k] ?? "") === String(v ?? "")) continue;
      patch[k] = v;
    }
    return { patch, unset: [...unset] };
  }

  function touchesHighRisk(patch, unsetKeys) {
    const risk = new Set(detail?.highRiskKeys || []);
    return Object.keys(patch).some((k) => risk.has(k)) || unsetKeys.some((k) => risk.has(k));
  }

  async function runPreview() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const { patch, unset: unsetKeys } = buildPatch();
      const result = await api(`/api/admin/processes/${encodeURIComponent(envKey)}`, {
        method: "PATCH",
        body: {
          expectedRevision: detail.revision,
          reason: reason || "preview",
          patch,
          unset: unsetKeys,
          dryRun: true,
        },
      });
      setPreview(result);
      if (!result.ok) setError((result.errors || []).join("; ") || "Validate thất bại");
      else setMessage(`Preview OK — sẽ lên revision ${result.nextRevision}, đổi ${result.diff?.length || 0} key`);
    } catch (err) {
      setError(err.message || "Preview lỗi");
    } finally {
      setBusy(false);
    }
  }

  async function runSave({ restart }) {
    if (!reason.trim()) {
      setError("Cần nhập reason");
      return;
    }
    const { patch, unset: unsetKeys } = buildPatch();
    if (touchesHighRisk(patch, unsetKeys) && confirmName.trim().toUpperCase() !== envKey) {
      setError(`Thay đổi high-risk: gõ lại tên process «${envKey}» để xác nhận`);
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await api(`/api/admin/processes/${encodeURIComponent(envKey)}`, {
        method: "PATCH",
        body: {
          expectedRevision: detail.revision,
          reason: reason.trim(),
          patch,
          unset: unsetKeys,
        },
      });
      setMessage(`Đã lưu revision ${saved.revision}`);
      setPreview(null);
      setReason("");
      setConfirmName("");
      await loadDetail();
      onChanged?.();
      if (restart) {
        try {
          const cmd = await api(`/api/admin/processes/${encodeURIComponent(envKey)}/commands`, {
            method: "POST",
            body: {
              kind: "restart",
              hostId: detail.status?.hostId || row.hostId || "",
              requestedRevision: saved.revision,
              reason: reason.trim() || `apply revision ${saved.revision}`,
            },
          });
          setMessage(`Đã lưu revision ${saved.revision}; restart ${cmd.status}`);
          setCommands((prev) => [cmd, ...prev]);
        } catch (err) {
          setMessage(`Đã lưu revision ${saved.revision}; chưa apply: ${err.message}`);
        }
      }
    } catch (err) {
      if (err.status === 409 || /conflict/i.test(err.message || "")) {
        setError(`Conflict revision — tải lại. ${err.message}`);
        loadDetail();
      } else {
        setError(err.message || "Lưu thất bại");
      }
    } finally {
      setBusy(false);
    }
  }

  async function runRestartOnly() {
    if (!reason.trim()) {
      setError("Cần nhập reason");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const cmd = await api(`/api/admin/processes/${encodeURIComponent(envKey)}/commands`, {
        method: "POST",
        body: {
          kind: "restart",
          hostId: detail?.status?.hostId || row.hostId || "",
          requestedRevision: detail?.revision,
          reason: reason.trim(),
        },
      });
      setMessage(`Restart queued: ${cmd.id}`);
      setCommands((prev) => [cmd, ...prev]);
      onChanged?.();
    } catch (err) {
      setError(err.message || "Restart thất bại");
    } finally {
      setBusy(false);
    }
  }

  async function runRollback() {
    if (!rollbackTo || !reason.trim()) {
      setError("Chọn revision và nhập reason");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api(`/api/admin/processes/${encodeURIComponent(envKey)}/rollback`, {
        method: "POST",
        body: {
          toRevision: Number(rollbackTo),
          expectedRevision: detail.revision,
          reason: reason.trim(),
        },
      });
      setMessage(`Rollback → revision ${result.revision}`);
      setRollbackTo("");
      await loadDetail();
      onChanged?.();
    } catch (err) {
      setError(err.message || "Rollback thất bại");
    } finally {
      setBusy(false);
    }
  }

  const grouped = useMemo(() => {
    const groups = {
      Role: [],
      Kết_nối: [],
      Signal: [],
      Listener: [],
      Exchange: [],
      Log: [],
      Khác: [],
    };
    for (const entry of registry) {
      const k = entry.key;
      if (ROLE_KEYS.has(k) || entry.type === "role_flag") groups.Role.push(entry);
      else if (["MQTT", "TELE", "TELE_CLIENT", "TELE_CLIENT_VERSION", "DISCORD", "UID_ENV", "HUB_SIGNAL"].includes(k)) {
        groups.Kết_nối.push(entry);
      } else if (k.startsWith("PUBLISH_") || k.startsWith("SAVE_") || k.startsWith("SIGNAL_") || k === "SCHEDULE_SIGNAL") {
        groups.Signal.push(entry);
      } else if (
        ["GET_CHANNEL", "GET_INTERVAL", "FWDUID", "NUMFWD", "ROSECHANNEL", "ROSECHAT", "CRISCHAT"].includes(k) ||
        k.startsWith("FORWARD_") ||
        k.startsWith("X268")
      ) {
        groups.Listener.push(entry);
      } else if (
        ["MULTI", "BYBIT", "OKEX", "BITGET", "BINGX", "ASTER", "SPOT_BINANCE", "UPDATE_MARKET", "BLACKLIST_SYMBOLS"].includes(k) ||
        k.startsWith("TOP_VOLUME_") ||
        k.startsWith("UNIVERSE_") ||
        k.startsWith("NUM_OF_") ||
        k.startsWith("DCA_MTF_") ||
        k.startsWith("BINANCE_PEER_") ||
        ["START_COIN", "END_COIN", "SYMBOL_START_INDEX", "PAPER"].includes(k)
      ) {
        groups.Exchange.push(entry);
      } else if (["LOG", "LOGGER", "DEBUG"].includes(k) || k.includes("WEBHOOK")) {
        groups.Log.push(entry);
      } else groups.Khác.push(entry);
    }
    return groups;
  }, [registry]);

  const groupNames = useMemo(
    () => Object.entries(grouped).filter(([, entries]) => entries.length).map(([name]) => name),
    [grouped]
  );

  function toggleEnvGroup(name) {
    setOpenEnvGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function setAllEnvGroups(open) {
    setOpenEnvGroups(open ? new Set(groupNames) : new Set());
  }

  function setDefaultEnvGroups() {
    setOpenEnvGroups(new Set(DEFAULT_OPEN_ENV_GROUPS));
  }

  function filledCount(entries) {
    return entries.filter((entry) => {
      if (unset.has(entry.key)) return false;
      const value = draft[entry.key];
      return value != null && String(value) !== "";
    }).length;
  }

  const showEnvFooter = tab === "env" && (canEdit || canRestart);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card process-admin-panel" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h2>{envKey}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {row.status === "down" ? "Stale" : "Online"} · host {detail?.status?.hostId || row.hostId || "—"} · PID{" "}
              {detail?.status?.pid || row.pid || "—"} · rev {detail?.revision ?? "—"}→
              {detail?.status?.actualRevision ?? row.actualRevision ?? "—"}
            </p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            Đóng
          </button>
        </header>

        <div className="btn-row process-admin-tabs">
          {[
            ["overview", "Tổng quan"],
            ["env", "Env"],
            ["history", "Lịch sử"],
            ["commands", "Commands"],
          ].map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? "" : "ghost"} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {!showEnvFooter && error ? <p className="form-error">{error}</p> : null}
        {!showEnvFooter && message ? <p className="muted">{message}</p> : null}

        <div className="process-admin-scroll">
        {!detail && !error ? <p className="muted">Đang tải profile…</p> : null}

        {detail && tab === "overview" ? (
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <div>Label: {detail.label || "—"}</div>
            <div>Active: {detail.active ? "yes" : "no"}</div>
            <div>Started: {when(detail.status?.startedAt)}</div>
            <div>Last startup error: {detail.status?.lastStartupError || "—"}</div>
            <div>MQTT connected: {String(detail.status?.mqttConnected ?? "—")}</div>
            <div>
              Keys chính: TELE_CLIENT={detail.variables?.TELE_CLIENT || "—"} · RUN={detail.variables?.RUN || "—"} ·
              TRADER={detail.variables?.TRADER || "unset"} · LISTENER={detail.variables?.LISTENER || "unset"}
            </div>
          </div>
        ) : null}

        {detail && tab === "env" ? (
          <div className="process-env-layout">
            <div className="btn-row process-env-toolbar">
              <button type="button" className="ghost" onClick={() => setAllEnvGroups(true)}>
                Mở tất cả
              </button>
              <button type="button" className="ghost" onClick={() => setAllEnvGroups(false)}>
                Đóng tất cả
              </button>
              <button type="button" className="ghost" onClick={setDefaultEnvGroups}>
                Chỉ Role + Kết nối
              </button>
            </div>
            {!canEdit && !canRestart ? (
              <p className="muted">Chỉ xem. Cần processes.edit để sửa env, processes.restart để restart.</p>
            ) : null}

            {Object.entries(grouped).map(([name, entries]) => {
              if (!entries.length) return null;
              const open = openEnvGroups.has(name);
              const setCount = filledCount(entries);
              const title = name.replace("_", " ");
              const activeEntries = entries.filter((entry) => isKeyActive(entry.key));
              const idleEntries = entries.filter((entry) => !isKeyActive(entry.key));
              return (
                <section key={name} className={`card process-env-section${open ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="process-env-section-toggle"
                    aria-expanded={open}
                    onClick={() => toggleEnvGroup(name)}
                  >
                    <span className="process-env-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                    <strong>{title}</strong>
                    <span className="muted">
                      {setCount}/{entries.length} đang set
                    </span>
                  </button>
                  {open ? (
                    <div className="process-env-section-body">
                      {activeEntries.length ? (
                        <div className="process-env-grid">
                          {activeEntries.map((entry) => {
                            const value = unset.has(entry.key) ? "" : draft[entry.key] ?? "";
                            const isRole = entry.type === "role_flag" || ROLE_KEYS.has(entry.key);
                            const refOptions = refOptionsFor(entry);
                            return (
                              <label key={entry.key} className="process-env-row">
                                <span className="process-env-key">
                                  {entry.key}
                                  {entry.risk === "high" ? " *" : ""}
                                </span>
                                {isRole ? (
                                  <select
                                    value={value === "true" ? "true" : "unset"}
                                    disabled={!canEdit}
                                    onChange={(e) => {
                                      if (e.target.value === "true") setKey(entry.key, "true");
                                      else clearKey(entry.key);
                                    }}
                                  >
                                    <option value="unset">unset (tắt)</option>
                                    <option value="true">true</option>
                                  </select>
                                ) : refOptions ? (
                                  <select
                                    value={value}
                                    disabled={!canEdit}
                                    onChange={(e) => {
                                      if (!e.target.value) clearKey(entry.key);
                                      else setKey(entry.key, e.target.value);
                                    }}
                                  >
                                    <option value="">— chọn —</option>
                                    {refOptions.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    value={value}
                                    disabled={!canEdit}
                                    onChange={(e) => setKey(entry.key, e.target.value)}
                                    placeholder={entry.help || "Nhập giá trị"}
                                    autoFocus={editingKeys.has(entry.key) && !value}
                                  />
                                )}
                                {canEdit ? (
                                  <button type="button" className="ghost process-env-unset" onClick={() => clearKey(entry.key)}>
                                    Bỏ
                                  </button>
                                ) : (
                                  <span />
                                )}
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="muted process-env-empty">Chưa set key nào trong nhóm này.</p>
                      )}
                      {canEdit && idleEntries.length ? (
                        <div className="process-env-add">
                          <span className="muted">Thêm:</span>
                          <div className="process-env-chips">
                            {idleEntries.map((entry) => (
                              <button
                                key={entry.key}
                                type="button"
                                className="ghost process-env-chip"
                                title={entry.help || entry.key}
                                onClick={() => activateKey(entry)}
                              >
                                + {entry.key}{entry.risk === "high" ? " *" : ""}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : null}

        {detail && tab === "history" ? (
          <div style={{ display: "grid", gap: 12 }}>
            {(revisions || []).map((r) => (
              <article key={r.revision} className="card">
                <strong>
                  #{r.revision} · {r.action}
                </strong>
                <div className="muted">
                  {when(r.createdAt)} · {r.actor?.email || r.actor?.userId || "—"} · {r.reason || ""}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                  {(r.diff || []).map((d) => `${d.key}: ${d.before ?? "∅"} → ${d.after ?? "∅"}`).join("\n") || "(no diff)"}
                </pre>
              </article>
            ))}
            {canEdit ? (
              <div className="card" style={{ display: "grid", gap: 8 }}>
                <label>
                  Rollback về revision
                  <select value={rollbackTo} onChange={(e) => setRollbackTo(e.target.value)}>
                    <option value="">—</option>
                    {revisions.map((r) => (
                      <option key={r.revision} value={r.revision}>
                        {r.revision}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reason
                  <input value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <button type="button" disabled={busy} onClick={runRollback}>
                  Rollback
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {detail && tab === "commands" ? (
          <div style={{ display: "grid", gap: 10 }}>
            {(commands || []).map((c) => (
              <article key={c.id} className="card">
                <strong>
                  {c.kind} · {c.status}
                </strong>
                <div className="muted">
                  {c.id} · rev {c.requestedRevision} · {when(c.createdAt)}
                  {c.statusReason ? ` · ${c.statusReason}` : ""}
                </div>
                <div className="muted">{c.reason}</div>
                {c.result?.error ? <div className="form-error">{c.result.error}</div> : null}
              </article>
            ))}
            {!commands?.length ? <p className="muted">Chưa có command.</p> : null}
          </div>
        ) : null}
        </div>

        {showEnvFooter ? (
          <footer className="process-admin-footer">
            {error ? <p className="form-error">{error}</p> : null}
            {message ? <p className="muted">{message}</p> : null}
            {preview?.diff?.length ? (
              <pre className="process-env-diff muted">
                {preview.diff.map((d) => `${d.key}: ${d.before ?? "∅"} → ${d.after ?? "∅"}`).join("\n")}
              </pre>
            ) : null}
            <div className="process-admin-footer-fields">
              <label>
                Lý do (bắt buộc khi lưu / restart)
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vì sao đổi" />
              </label>
              {canEdit ? (
                <label>
                  Confirm process (high-risk)
                  <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={envKey} />
                </label>
              ) : null}
            </div>
            <div className="modal-actions process-admin-footer-actions">
              {canEdit ? (
                <>
                  <button type="button" className="ghost" disabled={busy} onClick={runPreview}>
                    Preview
                  </button>
                  <button type="button" disabled={busy} onClick={() => runSave({ restart: false })}>
                    Lưu
                  </button>
                  {canRestart ? (
                    <button type="button" disabled={busy} onClick={() => runSave({ restart: true })}>
                      Lưu + Restart
                    </button>
                  ) : null}
                </>
              ) : null}
              {canRestart ? (
                <button type="button" className="ghost" disabled={busy} onClick={runRestartOnly}>
                  Restart
                </button>
              ) : null}
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
