import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";

function emptyPeer() {
  return { ip: "", port: 13128, enabled: true, label: "" };
}

export default function PeerProxyPanel({ canEdit, canRestart }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [config, setConfig] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [authPass, setAuthPass] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [selfIpDraft, setSelfIpDraft] = useState({});
  const [hostMapText, setHostMapText] = useState("");
  const [restartOnApply, setRestartOnApply] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/admin/peer-proxy");
      setConfig(data.config);
      setProcesses(data.processes || []);
      const map = data.config?.hostSelfIp || {};
      setHostMapText(
        Object.entries(map)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      );
      setSelfIpDraft({});
      setSelected(new Set());
    } catch (err) {
      setError(err.message || "Không tải được peer proxy");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const peers = config?.peers || [];

  function updatePeer(idx, patch) {
    setConfig((prev) => {
      const next = { ...prev, peers: [...(prev.peers || [])] };
      next.peers[idx] = { ...next.peers[idx], ...patch };
      return next;
    });
  }

  function addPeer() {
    setConfig((prev) => ({ ...prev, peers: [...(prev.peers || []), emptyPeer()] }));
  }

  function removePeer(idx) {
    setConfig((prev) => ({
      ...prev,
      peers: (prev.peers || []).filter((_, i) => i !== idx),
    }));
  }

  function parseHostMap(text) {
    const out = {};
    for (const line of String(text || "").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^([^=:\s]+)[=:\s]+(\d+\.\d+\.\d+\.\d+)\s*$/);
      if (!m) continue;
      out[m[1].trim()] = m[2].trim();
    }
    return out;
  }

  async function saveConfig() {
    if (!canEdit) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = {
        peers: (config.peers || []).filter((p) => p.ip),
        authUser: config.authUser || "botpeer",
        hostSelfIp: parseHostMap(hostMapText),
      };
      if (authPass.trim()) body.authPass = authPass.trim();
      const res = await api("/api/admin/peer-proxy/config", { method: "PUT", body });
      setConfig(res.config);
      setAuthPass("");
      setMessage("Đã lưu cấu hình peer proxy");
      await load();
    } catch (err) {
      setError(err.message || "Lưu thất bại");
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(processes.map((p) => p.processName)));
  }

  async function apply(kind) {
    if (!canEdit) return;
    const names = [...selected];
    if (!names.length) {
      setError("Chọn ít nhất một process");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = {
        processNames: names,
        restart: Boolean(restartOnApply && canRestart),
        reason: `peer-proxy ${kind} from web-bot`,
        selfIpByProcess: selfIpDraft,
      };
      const path = kind === "enable" ? "/api/admin/peer-proxy/enable" : "/api/admin/peer-proxy/disable";
      const res = await api(path, { method: "POST", body });
      const ok = (res.results || []).filter((r) => r.ok).length;
      const fail = (res.results || []).filter((r) => !r.ok);
      setMessage(
        `${kind === "enable" ? "Bật" : "Tắt"}: ${ok} ok` +
          (fail.length ? `; lỗi: ${fail.map((f) => `${f.processName}(${f.error})`).join(", ")}` : "")
      );
      await load();
    } catch (err) {
      setError(err.message || "Apply thất bại");
    } finally {
      setBusy(false);
    }
  }

  const enabledCount = useMemo(() => processes.filter((p) => p.enabled).length, [processes]);

  if (loading) return <p className="muted">Đang tải peer proxy…</p>;
  if (!config) return <p className="form-error">{error || "Không có dữ liệu"}</p>;

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <div className="page-head" style={{ alignItems: "center", marginBottom: 12 }}>
        <h2 className="summary-section-title" style={{ margin: 0 }}>
          Peer proxy (Binance GET)
        </h2>
        <span className="muted">
          {enabledCount}/{processes.length} process đang bật · pool {peers.filter((p) => p.enabled !== false).length} IP
        </span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Tinyproxy trên VPS: GET REST xoay peer, TRADE đi thẳng. Map <code>hostId → IP public</code> rồi bật theo process.
        Mật khẩu chỉ ghi khi đổi (không hiện lại).
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <h3 style={{ fontSize: 15, marginBottom: 8 }}>Pool peer</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>IP</th>
              <th>Port</th>
              <th>Label</th>
              <th>Bật</th>
              {canEdit ? <th></th> : null}
            </tr>
          </thead>
          <tbody>
            {peers.map((p, idx) => (
              <tr key={`${p.ip}-${idx}`}>
                <td>
                  <input
                    value={p.ip}
                    disabled={!canEdit || busy}
                    onChange={(e) => updatePeer(idx, { ip: e.target.value })}
                    placeholder="45.x.x.x"
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={p.port || 13128}
                    disabled={!canEdit || busy}
                    onChange={(e) => updatePeer(idx, { port: Number(e.target.value) || 13128 })}
                    style={{ width: 80 }}
                  />
                </td>
                <td>
                  <input
                    value={p.label || ""}
                    disabled={!canEdit || busy}
                    onChange={(e) => updatePeer(idx, { label: e.target.value })}
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={p.enabled !== false}
                    disabled={!canEdit || busy}
                    onChange={(e) => updatePeer(idx, { enabled: e.target.checked })}
                  />
                </td>
                {canEdit ? (
                  <td>
                    <button type="button" className="ghost" disabled={busy} onClick={() => removePeer(idx)}>
                      Xóa
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="btn-row" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" className="ghost" disabled={busy} onClick={addPeer}>
            Thêm peer
          </button>
        </div>
      ) : null}

      <div className="stats-grid" style={{ marginTop: 16, gridTemplateColumns: "1fr 1fr" }}>
        <label>
          Auth user
          <input
            value={config.authUser || "botpeer"}
            disabled={!canEdit || busy}
            onChange={(e) => setConfig((c) => ({ ...c, authUser: e.target.value }))}
          />
        </label>
        <label>
          Auth pass {config.passwordSet ? "(đã có — để trống nếu không đổi)" : "(chưa đặt)"}
          <input
            type="password"
            autoComplete="new-password"
            value={authPass}
            disabled={!canEdit || busy}
            onChange={(e) => setAuthPass(e.target.value)}
            placeholder={config.passwordSet ? "••••••••" : "Nhập mật khẩu tinyproxy"}
          />
        </label>
      </div>

      <label style={{ display: "block", marginTop: 12 }}>
        Map hostId → IP public (mỗi dòng: <code>hostId=45.x.x.x</code>)
        <textarea
          rows={4}
          value={hostMapText}
          disabled={!canEdit || busy}
          onChange={(e) => setHostMapText(e.target.value)}
          style={{ width: "100%", fontFamily: "monospace" }}
          placeholder={"sgp-1=45.32.252.50\nvultr-2=45.76.149.189"}
        />
      </label>

      {canEdit ? (
        <div className="btn-row" style={{ gap: 8, marginTop: 12 }}>
          <button type="button" disabled={busy} onClick={saveConfig}>
            Lưu cấu hình pool
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={load}>
            Tải lại
          </button>
        </div>
      ) : null}

      <h3 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Process</h3>
      <div className="btn-row" style={{ gap: 8, marginBottom: 8 }}>
        <button type="button" className="ghost" disabled={busy} onClick={selectAll}>
          Chọn tất cả
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setSelected(new Set())}>
          Bỏ chọn
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={restartOnApply}
            disabled={!canRestart || busy}
            onChange={(e) => setRestartOnApply(e.target.checked)}
          />
          Restart PM2 sau khi bật/tắt
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>PM2</th>
              <th>Profile</th>
              <th>Host</th>
              <th>Self IP</th>
              <th>Proxy</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((row) => (
              <tr key={row.processName}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(row.processName)}
                    disabled={busy}
                    onChange={() => toggleSelect(row.processName)}
                  />
                </td>
                <td>{row.processName}</td>
                <td>
                  {row.profileEnv || "—"}
                  {!row.hasProfile ? <span className="negative"> (chưa profile)</span> : null}
                </td>
                <td>{row.hostId || "—"}</td>
                <td>
                  <input
                    value={selfIpDraft[row.processName] ?? row.mappedSelfIp ?? row.selfIp ?? ""}
                    disabled={!canEdit || busy}
                    placeholder="45.x.x.x"
                    onChange={(e) =>
                      setSelfIpDraft((prev) => ({ ...prev, [row.processName]: e.target.value }))
                    }
                    style={{ width: 140 }}
                  />
                </td>
                <td className={row.enabled ? "" : "muted"}>
                  {row.enabled ? `ON (${row.proxyCount})` : "OFF"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!processes.length ? <p className="muted">Chưa có heartbeat process.</p> : null}

      {canEdit ? (
        <div className="btn-row" style={{ gap: 8, marginTop: 12 }}>
          <button type="button" disabled={busy} onClick={() => apply("enable")}>
            Bật proxy (đã chọn)
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => apply("disable")}>
            Tắt proxy (đã chọn)
          </button>
        </div>
      ) : null}
    </section>
  );
}
