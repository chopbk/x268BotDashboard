import { useEffect, useState } from "react";
import { api } from "../api";

function when(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN");
}

export default function SystemHealthPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    function load() {
      api("/api/system-health", { signal: controller.signal })
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setError("");
        })
        .catch((err) => {
          if (!cancelled) setError(err.message || "Không tải được hệ thống");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    load();
    const timer = setInterval(load, 30000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  return (
    <section>
      <header className="page-head">
        <h1>Hệ thống</h1>
        <p className="muted">Heartbeat của process bot, MongoDB, Redis và snapshot. Quá 90 giây không có nhịp là mất kết nối. Process binance-bot cần chạy bản có heartbeat.</p>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? <p className="muted">Đang tải…</p> : null}
      {data ? (
        <>
          <p className="muted">Cập nhật {when(data.checkedAt)}</p>
          {data.alerts?.length ? (
            <ul className="health-alerts">
              {data.alerts.map((item) => <li key={`${item.code}-${item.message}`}>{item.message}</li>)}
            </ul>
          ) : <p className="muted">Không có cảnh báo.</p>}
          <div className="stats-grid summary-grid">
            {(data.services || []).map((item) => (
              <article key={item.id} className={`card health-${item.status}`}>
                <small>{item.label}</small>
                <strong>{item.status === "ok" ? "Ổn" : item.status === "warn" ? "Cảnh báo" : item.status === "down" ? "Mất" : "Không chạy"}</strong>
                <span className="muted">{item.detail}</span>
              </article>
            ))}
          </div>
          <h2 className="summary-section-title">Process</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PM2</th><th>Role</th><th>RUN</th><th>NODE_ENV</th><th>MQTT</th><th>TELE_CLIENT</th>
                  <th>RAM</th><th>CPU</th><th>Restart</th><th>Heartbeat</th>
                </tr>
              </thead>
              <tbody>
                {(data.processes || []).map((row) => (
                  <tr key={row.key}>
                    <td>{row.processName}{row.pmId ? ` #${row.pmId}` : ""}</td>
                    <td>{(row.roles || []).join(", ") || "—"}</td>
                    <td>{(row.run || []).join(", ") || "—"}</td>
                    <td>{row.nodeEnv || "—"}</td>
                    <td>{row.mqtt || "—"}{row.mqttConnected === false ? " (đứt)" : row.mqttConnected ? " (nối)" : ""}</td>
                    <td>{row.teleClient ? `${row.teleClient} V${row.teleVersion || "1"}` : "—"}{row.discord ? ` / ${row.discord}` : ""}</td>
                    <td>{row.memoryMb == null ? "—" : `${row.memoryMb} MB`}</td>
                    <td>{row.cpuPercent == null ? "—" : `${row.cpuPercent}%`}</td>
                    <td>{row.restarts ?? "—"}</td>
                    <td className={row.status === "down" ? "negative" : ""}>{when(row.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.processes?.length ? <p className="muted">Chưa có process nào ghi heartbeat.</p> : null}
        </>
      ) : null}
    </section>
  );
}
