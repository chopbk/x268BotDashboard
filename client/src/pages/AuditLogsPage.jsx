import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import LogHistogram from "../components/charts/LogHistogram.jsx";
import "../components/charts/charts.css";

const ACTION_LABELS = {
  "user.registered": "Đăng ký user",
  "user.created": "Tạo user",
  "user.updated": "Cập nhật user",
  "user.username_linked": "Gắn username",
  "bot.created": "Tạo bot",
  "bot.renamed": "Đổi tên bot",
  "bot.deleted": "Xóa bot",
  "bot.account_added": "Thêm config vào bot",
  "bot.account_renamed": "Đổi tên config",
  "bot.account_deleted": "Xóa config khỏi bot",
  "config.updated": "Sửa On/signal/volume",
  "config.copied": "Copy account config",
  "credential.created": "Tạo API/credential",
  "credential.updated": "Cập nhật API/credential",
  "credential.deleted": "Xóa API/credential",
};

function identityLabel(identity) {
  return identity?.name || identity?.username || identity?.email || "System";
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const RUNTIME_LABELS = {
  open: "Mở lệnh",
  exchange: "API sàn",
  monitor: "Monitor",
  tpsl: "TP/SL",
  listener: "Listener",
  mqtt: "MQTT",
  signal: "Signal bỏ qua",
  process: "PM2 process",
};

function defaultRuntimeWindow() {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function bucketRange(bucketKey, grain) {
  if (!bucketKey) return { from: "", to: "" };
  if (grain === "hour" || String(bucketKey).includes("T")) {
    const start = new Date(bucketKey);
    if (Number.isNaN(start.getTime())) return { from: "", to: "" };
    return { from: start.toISOString(), to: new Date(start.getTime() + 60 * 60 * 1000).toISOString() };
  }
  const start = new Date(`${String(bucketKey).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return { from: "", to: "" };
  return { from: start.toISOString(), to: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString() };
}

function toDatetimeLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function fromDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(`${value}:00.000Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function RuntimeLogs({ initialCategory = "" }) {
  const initial = useMemo(() => defaultRuntimeWindow(), []);
  const [logs, setLogs] = useState([]);
  const [histogram, setHistogram] = useState(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [category, setCategory] = useState(initialCategory);
  const [level, setLevel] = useState("");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chartError, setChartError] = useState("");
  const limit = 50;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setChartError("");
    const params = new URLSearchParams({ page: String(page), limit: String(limit), histogram: "1" });
    if (appliedQuery) params.set("q", appliedQuery);
    if (category) params.set("category", category);
    if (level) params.set("level", level);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (selectedBucket) {
      const range = bucketRange(selectedBucket);
      if (range.from) params.set("bucketFrom", range.from);
      if (range.to) params.set("bucketTo", range.to);
    }
    api(`/api/runtime-logs?${params}`, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        setLogs(data.logs || []);
        setTotal(data.total || 0);
        setHistogram(data.histogram || null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setChartError(err.message || "Không tải histogram");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [appliedQuery, category, level, page, from, to, selectedBucket]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / limit));
  return (
    <>
      <p className="muted">Lỗi runtime của binance-bot, giữ 30 ngày. Kỳ mặc định 24 giờ UTC; histogram aggregate toàn query (không lấy từ trang bảng).</p>
      <form
        className="audit-search ledger-tools"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSelectedBucket("");
          setAppliedQuery(query.trim());
        }}
      >
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nội dung, config, symbol, signal…" />
        <label>
          Từ (UTC)
          <input
            type="datetime-local"
            value={toDatetimeLocal(from)}
            onChange={(event) => {
              setFrom(fromDatetimeLocal(event.target.value));
              setSelectedBucket("");
              setPage(1);
            }}
          />
        </label>
        <label>
          Đến (UTC)
          <input
            type="datetime-local"
            value={toDatetimeLocal(to)}
            onChange={(event) => {
              setTo(fromDatetimeLocal(event.target.value));
              setSelectedBucket("");
              setPage(1);
            }}
          />
        </label>
        <button type="button" className="ghost" onClick={() => {
          const next = defaultRuntimeWindow();
          setFrom(next.from);
          setTo(next.to);
          setSelectedBucket("");
          setPage(1);
        }}>
          24 giờ
        </button>
        <button type="submit">Tìm</button>
      </form>
      <div className="chips signal-chips">
        <button type="button" className={category === "" ? "symbol-chip active" : "symbol-chip"} onClick={() => { setCategory(""); setPage(1); setSelectedBucket(""); }}>Tất cả</button>
        {Object.entries(RUNTIME_LABELS).map(([id, label]) => (
          <button type="button" className={category === id ? "symbol-chip active" : "symbol-chip"} key={id} onClick={() => { setCategory(id); setPage(1); setSelectedBucket(""); }}>{label}</button>
        ))}
      </div>

      <div style={{ margin: "12px 0" }}>
        <LogHistogram
          subtitle={`${histogram?.from || from || "?"} → ${histogram?.to || to || "?"} UTC · bucket ${histogram?.bucket === "day" ? "ngày" : "1 giờ"} · ${histogram?.note || "Số log đã ghi nhận"}`}
          points={histogram?.points || []}
          bucket={histogram?.bucket || "hour"}
          total={histogram?.total}
          selectedBucket={selectedBucket}
          selectedLevel={level}
          onSelectBucket={(bucket) => {
            setSelectedBucket(bucket);
            setPage(1);
          }}
          onSelectLevel={(next) => {
            setLevel(next);
            setPage(1);
          }}
          loading={loading && !histogram}
          error={chartError}
        />
      </div>
      {(selectedBucket || level) ? (
        <div className="dv-selection-bar card" style={{ marginBottom: 12 }}>
          <span className="muted">Chi tiết theo chart:</span>
          {selectedBucket ? (
            <span className="perf-chip">
              Bucket {selectedBucket}
              <button type="button" aria-label="Bỏ chọn bucket" onClick={() => { setSelectedBucket(""); setPage(1); }}>×</button>
            </span>
          ) : null}
          {level ? (
            <span className="perf-chip">
              Mức {level}
              <button type="button" aria-label="Bỏ chọn mức" onClick={() => { setLevel(""); setPage(1); }}>×</button>
            </span>
          ) : null}
          <button type="button" className="ghost" onClick={() => { setSelectedBucket(""); setLevel(""); setPage(1); }}>Bỏ chọn biểu đồ</button>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}
      <div className="table-wrap audit-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Nhóm</th>
              <th>Mức</th>
              <th>Process</th>
              <th>Config</th>
              <th>Nội dung</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{log.at ? new Date(log.at).toLocaleString("vi-VN") : "—"}</td>
                <td>{RUNTIME_LABELS[log.category] || log.category}</td>
                <td>{log.level}</td>
                <td>{log.processName || log.role || "—"}{log.pmId ? ` #${log.pmId}` : ""}</td>
                <td>{[log.env, log.signal, log.symbol].filter(Boolean).join(" · ") || (log.usernames || []).join(", ") || "—"}</td>
                <td>{log.message}</td>
              </tr>
            ))}
            {!loading && logs.length === 0 ? <tr><td colSpan="6" className="empty">Chưa có log runtime phù hợp.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="audit-pagination">
        <span className="muted">{total} bản ghi · Trang {page}/{totalPages}</span>
        <div>
          <button type="button" className="ghost" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Trước</button>
          <button type="button" className="ghost" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Sau</button>
        </div>
      </div>
    </>
  );
}

function ChangeDetails({ changes }) {
  const entries = Object.entries(changes || {});
  if (entries.length === 0) return <span className="muted">Không có thay đổi field</span>;
  return (
    <details className="audit-details">
      <summary>{entries.length} thay đổi</summary>
      <ul>
        {entries.map(([field, change]) => (
          <li key={field}>
            <strong>{field}</strong>: {change?.changed ? "đã thay đổi" : `${formatValue(change?.from)} → ${formatValue(change?.to)}`}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function AuditLogsPage() {
  const [params] = useSearchParams();
  const [kind, setKind] = useState(params.get("kind") === "runtime" ? "runtime" : "audit");
  const [logs, setLogs] = useState([]);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const limit = 50;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (appliedQuery) params.set("q", appliedQuery);
    api(`/api/audit-logs?${params}`, { signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        setLogs(data.logs || []);
        setTotal(data.total || 0);
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
  }, [appliedQuery, page]);

  function onSearch(event) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <section>
      <header className="page-head audit-head">
        <div>
          <h1>Log</h1>
          <p className="muted">{kind === "runtime" ? "Lỗi vận hành của bot." : "Lịch sử chỉnh sửa trên web, không chứa mật khẩu hoặc secret."}</p>
        </div>
      </header>
      <div className="history-tabs">
        <button type="button" className={kind === "audit" ? "active" : "ghost"} onClick={() => setKind("audit")}>Sửa trên web</button>
        <button type="button" className={kind === "runtime" ? "active" : "ghost"} onClick={() => setKind("runtime")}>Runtime bot</button>
      </div>
      {kind === "runtime" ? <RuntimeLogs initialCategory={params.get("category") || ""} /> : (
      <>
        <form className="audit-search" onSubmit={onSearch}>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Action, người sửa, user…"
          />
          <button type="submit">Tìm</button>
        </form>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="table-wrap audit-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Hành động</th>
              <th>Người thực hiện</th>
              <th>Đối tượng</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{new Date(log.createdAt).toLocaleString("vi-VN")}</td>
                <td>{ACTION_LABELS[log.action] || log.action}</td>
                <td>{identityLabel(log.actor)}</td>
                <td>{identityLabel(log.target)}</td>
                <td><ChangeDetails changes={log.changes} /></td>
              </tr>
            ))}
            {!loading && logs.length === 0 ? (
              <tr><td colSpan="5" className="empty">Chưa có lịch sử phù hợp.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="audit-pagination">
        <span className="muted">{total} bản ghi · Trang {page}/{totalPages}</span>
        <div>
          <button type="button" className="ghost" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Trước</button>
          <button type="button" className="ghost" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Sau</button>
        </div>
      </div>
      </>
      )}
    </section>
  );
}
