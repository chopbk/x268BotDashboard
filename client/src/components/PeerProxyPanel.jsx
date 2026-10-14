import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

function when(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN");
}

function emptyPeer() {
  return { ip: "", port: 13128, enabled: true, label: "" };
}

export default function PeerProxyPanel({ canEdit }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [data, setData] = useState(null);
  const [showPoolEdit, setShowPoolEdit] = useState(false);
  const [authPass, setAuthPass] = useState("");
  const [draftPeers, setDraftPeers] = useState([]);
  const [authUser, setAuthUser] = useState("botpeer");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api("/api/admin/peer-proxy");
      setData(res);
      setDraftPeers(res.config?.peers?.length ? res.config.peers.map((p) => ({ ...p })) : []);
      setAuthUser(res.config?.authUser || res.authUser || "botpeer");
    } catch (err) {
      setError(err.message || "Không tải được peer proxy");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runProbe() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await api("/api/admin/peer-proxy/probe", { method: "POST", body: {} });
      setMessage(`Probe: ${res.ok} ok / ${res.fail} lỗi`);
      await load();
    } catch (err) {
      setError(err.message || "Probe thất bại");
    } finally {
      setBusy(false);
    }
  }

  async function savePool() {
    if (!canEdit) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body = {
        peers: draftPeers.filter((p) => p.ip),
        authUser: authUser || "botpeer",
      };
      if (authPass.trim()) body.authPass = authPass.trim();
      await api("/api/admin/peer-proxy/config", { method: "PUT", body });
      setAuthPass("");
      setMessage("Đã lưu pool (chỉ cho probe / hydrate web)");
      setShowPoolEdit(false);
      await load();
    } catch (err) {
      setError(err.message || "Lưu pool thất bại");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Đang tải peer proxy…</p>;
  if (!data) return <p className="form-error">{error || "Không có dữ liệu"}</p>;

  const peers = data.peers || [];
  const last = data.lastProbe;
  const okCount = peers.filter((p) => p.lastOk === true).length;
  const failCount = peers.filter((p) => p.lastOk === false).length;
  const unknown = peers.filter((p) => p.lastOk == null).length;

  return (
    <section className="card" style={{ marginTop: 24 }}>
      <div className="page-head" style={{ alignItems: "center", marginBottom: 12 }}>
        <h2 className="summary-section-title" style={{ margin: 0 }}>
          Peer proxy — sức khỏe
        </h2>
        <span className="muted">
          Web runtime: {data.runtime?.activeCount ?? 0} peer ({data.runtime?.source || "none"})
          {data.runtime?.selfIp ? ` · self ${data.runtime.selfIp}` : ""}
        </span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Kiểm tra tinyproxy còn CONNECT được tới fapi không. Env process bot (<code>BINANCE_PEER_*</code>) sửa ở
        panel Env từng process — không gắn từ đây.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      {message ? <p className="muted">{message}</p> : null}

      <div className="btn-row" style={{ gap: 8, marginBottom: 12 }}>
        <button type="button" disabled={busy || !peers.length} onClick={runProbe}>
          {busy ? "Đang probe…" : "Kiểm tra tất cả peer"}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={load}>
          Tải lại
        </button>
        {canEdit ? (
          <button type="button" className="ghost" disabled={busy} onClick={() => setShowPoolEdit((v) => !v)}>
            {showPoolEdit ? "Ẩn sửa pool" : "Sửa pool (probe)"}
          </button>
        ) : null}
      </div>

      {last ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Lần probe gần nhất: {when(last.at)} · {last.ok}/{last.total} ok
          {last.fail ? ` · ${last.fail} lỗi` : ""}
          {last.probedBy ? ` · ${last.probedBy}` : ""}
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          Chưa probe. Nguồn list: {data.peerSource || "none"}
          {okCount || failCount || unknown
            ? ` · bảng ${okCount} ok / ${failCount} lỗi / ${unknown} chưa check`
            : ""}
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Peer IP</th>
              <th>Port</th>
              <th>Label</th>
              <th>Trạng thái</th>
              <th>Latency</th>
              <th>Lỗi</th>
              <th>Checked</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => (
              <tr key={p.ip}>
                <td>{p.ip}</td>
                <td>{p.port || 13128}</td>
                <td>{p.label || "—"}</td>
                <td className={p.lastOk === false ? "negative" : ""}>
                  {p.lastOk === true ? "OK" : p.lastOk === false ? "Lỗi" : "Chưa check"}
                </td>
                <td>{p.lastMs != null ? `${p.lastMs} ms` : "—"}</td>
                <td className="muted" style={{ maxWidth: 220 }}>
                  {p.lastError || "—"}
                </td>
                <td>{when(p.lastCheckedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!peers.length ? (
        <p className="muted">
          Chưa có peer. Set <code>BINANCE_PEER_PROXIES</code> trên web hoặc mở «Sửa pool» rồi probe.
        </p>
      ) : null}

      {showPoolEdit && canEdit ? (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Pool dùng để probe / hydrate web</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Không ghi vào bot_profile. Nếu web đã có env <code>BINANCE_PEER_PROXIES</code> thì env thắng.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>IP</th>
                  <th>Port</th>
                  <th>Label</th>
                  <th>Bật</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {draftPeers.map((p, idx) => (
                  <tr key={`draft-${idx}`}>
                    <td>
                      <input
                        value={p.ip}
                        disabled={busy}
                        onChange={(e) => {
                          const next = [...draftPeers];
                          next[idx] = { ...next[idx], ip: e.target.value };
                          setDraftPeers(next);
                        }}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={p.port || 13128}
                        disabled={busy}
                        onChange={(e) => {
                          const next = [...draftPeers];
                          next[idx] = { ...next[idx], port: Number(e.target.value) || 13128 };
                          setDraftPeers(next);
                        }}
                        style={{ width: 80 }}
                      />
                    </td>
                    <td>
                      <input
                        value={p.label || ""}
                        disabled={busy}
                        onChange={(e) => {
                          const next = [...draftPeers];
                          next[idx] = { ...next[idx], label: e.target.value };
                          setDraftPeers(next);
                        }}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={p.enabled !== false}
                        disabled={busy}
                        onChange={(e) => {
                          const next = [...draftPeers];
                          next[idx] = { ...next[idx], enabled: e.target.checked };
                          setDraftPeers(next);
                        }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy}
                        onClick={() => setDraftPeers(draftPeers.filter((_, i) => i !== idx))}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="btn-row" style={{ gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => setDraftPeers([...draftPeers, emptyPeer()])}
            >
              Thêm peer
            </button>
          </div>
          <div className="stats-grid" style={{ marginTop: 12, gridTemplateColumns: "1fr 1fr" }}>
            <label>
              Auth user
              <input value={authUser} disabled={busy} onChange={(e) => setAuthUser(e.target.value)} />
            </label>
            <label>
              Auth pass {data.passwordSet || data.config?.passwordSet ? "(đã có)" : "(chưa đặt)"}
              <input
                type="password"
                autoComplete="new-password"
                value={authPass}
                disabled={busy}
                onChange={(e) => setAuthPass(e.target.value)}
                placeholder="Chỉ nhập khi đổi"
              />
            </label>
          </div>
          <div className="btn-row" style={{ gap: 8, marginTop: 12 }}>
            <button type="button" disabled={busy} onClick={savePool}>
              Lưu pool
            </button>
          </div>
        </div>
      ) : null}

      <h3 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Lịch sử probe</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>OK</th>
              <th>Lỗi</th>
              <th>Ai</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {(data.probeHistory || []).map((h, i) => (
              <tr key={`${h.at}-${i}`}>
                <td>{when(h.at)}</td>
                <td>{h.ok}</td>
                <td className={h.fail ? "negative" : ""}>{h.fail}</td>
                <td>{h.probedBy || "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {h.summary || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.probeHistory?.length ? <p className="muted">Chưa có lịch sử probe.</p> : null}

      <h3 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Log liên quan (runtime)</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Process</th>
              <th>Host</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {(data.relatedLogs || []).map((row, i) => (
              <tr key={`${row.at}-${i}`}>
                <td>{when(row.at)}</td>
                <td>
                  {row.processName || "—"}
                  {row.env ? <span className="muted"> · {row.env}</span> : null}
                </td>
                <td>{row.host || "—"}</td>
                <td style={{ fontSize: 12, maxWidth: 480 }}>{row.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.relatedLogs?.length ? (
        <p className="muted">Không có runtime log khớp peer IP / peer-proxy gần đây.</p>
      ) : null}
    </section>
  );
}
