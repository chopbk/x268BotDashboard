import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const LOGS_VIEW = "logs.view";

function money(value) {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(value) || 0)} $`;
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}

function processLabel(value) {
  if (value === "ok") return "OK";
  if (value === "stale") return "Stale";
  if (value === "degraded") return "Cảnh báo";
  if (value === "off") return "Tắt hiển thị";
  return "Không rõ";
}

function severityLabel(value) {
  if (value === "critical") return "Gấp";
  if (value === "high") return "Cao";
  if (value === "medium") return "Vừa";
  if (value === "low") return "Thấp";
  return "";
}

function promptText(ai, guide) {
  return ["Hướng dẫn:", guide || ai?.instructions || "", "Dữ liệu:", JSON.stringify(ai?.data || {})].join("\n\n");
}

export default function DashboardPage() {
  const { user } = useAuth();
  const canSystem = (user?.permissions || []).includes(LOGS_VIEW) && user?.scopes?.[LOGS_VIEW] === "all";
  const healthHref = canSystem ? "/system" : "/logs?kind=runtime";
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [guide, setGuide] = useState("");
  const [showGuide, setShowGuide] = useState(false);
  const [aiItems, setAiItems] = useState(null);
  const [aiError, setAiError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api("/api/dashboard", { signal: controller.signal })
      .then((next) => {
        setData(next);
        setGuide(next?.ai?.instructions || "");
        setAiItems(null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message || "Không tải được tổng quan");
      });
    return () => controller.abort();
  }, []);

  const bots = data?.bots;
  const configs = data?.configs;
  const health = data?.health;
  const openRisk = data?.openRisk;
  const closedToday = data?.closedToday;
  const ai = data?.ai;

  async function sendToAi() {
    if (!ai?.configured) {
      try {
        await navigator.clipboard.writeText(promptText(ai, guide));
        setCopied(true);
        setAiError("");
      } catch {
        setAiError("Chưa có API key AI và trình duyệt không chép được prompt.");
      }
      return;
    }
    setAiBusy(true);
    setAiError("");
    setCopied(false);
    try {
      const next = await api("/api/dashboard/attention", { method: "POST", body: { instructions: guide }, timeoutMs: 28000 });
      setAiItems(next.items || []);
    } catch (err) {
      setAiError(err.message || "AI không soạn được");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Tổng quan</h1>
          <p className="muted">
            Bot bạn sở hữu hoặc được gán · ngày UTC. Đã chốt ≠ lãi lỗ ví ≠ chưa chốt.
            Chi tiết vị thế / hệ thống / tổng kết mở tab tương ứng.
          </p>
        </div>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {!data && !error ? <p className="muted">Đang tải…</p> : null}
      {data ? (
        <>
          {health ? (
            <section className="card dash-block dash-health">
              <div className="dash-health-head">
                <h2>Process</h2>
                <Link className="ghost link-btn" to={healthHref}>{canSystem ? "Hệ thống" : "Lịch sử"}</Link>
              </div>
              <p className="muted">Heartbeat trader/monitor trong ~{Math.round((health.thresholdMs || 90000) / 1000)}s. Hiển thị bật ≠ process đang chạy.</p>
              <div className="dash-chips">
                <span className="dash-chip health-ok">OK {health.ok}</span>
                <span className="dash-chip health-warn">Stale {health.stale}</span>
                <span className="dash-chip health-off">Tắt {health.off}</span>
                <span className="dash-chip">Không rõ {health.unknown}</span>
              </div>
            </section>
          ) : null}

          <div className="stats-grid">
            <article className="card">
              <span className="muted">Bot hiển thị bật</span>
              <strong>{bots ? `${bots.active}/${bots.total}` : "—"}</strong>
            </article>
            <article className="card">
              <span className="muted">Config đang bật</span>
              <strong>{configs ? `${configs.on}/${configs.total}` : "—"}</strong>
            </article>
            <article className={`card summary-stat ${tone(data.profitToday)}`}>
              <span className="muted">Đã chốt hôm nay</span>
              <strong>{money(data.profitToday)}</strong>
              {closedToday ? (
                <small className="muted">
                  {closedToday.trades} lệnh
                  {closedToday.winRate != null ? ` · thắng ${closedToday.winRate}%` : ""}
                  {" · "}
                  <Link to="/signals">Account Static</Link>
                </small>
              ) : null}
            </article>
            <article className={`card summary-stat ${tone(data.incomeToday)}`}>
              <span className="muted">Lãi lỗ ví hôm nay</span>
              <strong>{money(data.incomeToday)}</strong>
              <small className="muted"><Link to="/ledger">Mở Lãi lỗ</Link></small>
            </article>
            {openRisk !== undefined && openRisk !== null ? (
              <article className={`card summary-stat ${tone(openRisk.unrealized)}`}>
                <span className="muted">Chưa chốt (uPnL)</span>
                <strong>{openRisk.available ? money(openRisk.unrealized) : "—"}</strong>
                <small className="muted">
                  {openRisk.available
                    ? `${openRisk.positions} vị thế${openRisk.staleBook ? " · sổ cũ" : ""}`
                    : "Chưa có sổ Redis"}
                  {" · "}
                  <Link to="/positions">Position</Link>
                </small>
              </article>
            ) : null}
            {openRisk !== undefined && openRisk !== null ? (
              <article className="card">
                <span className="muted">Vị thế mở</span>
                <strong>{openRisk.available ? openRisk.positions : "—"}</strong>
                <small className="muted"><Link to="/positions">Xem / đồng bộ sàn</Link></small>
              </article>
            ) : null}
          </div>

          {openRisk?.available && openRisk.top?.length ? (
            <section className="card dash-block">
              <div className="dash-health-head">
                <h2>Rủi ro đang mở</h2>
                <Link className="ghost link-btn" to="/positions">Position</Link>
              </div>
              <p className="muted">Top theo |uPnL| từ sổ Redis — không gọi sàn tại đây. Cần sổ mới thì mở Position.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Bot</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>uPnL</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {openRisk.top.map((row) => (
                      <tr key={`${row.username}-${row.symbol}-${row.side}`}>
                        <td>{row.username}</td>
                        <td>{row.symbol}</td>
                        <td>{row.side}</td>
                        <td className={tone(row.unrealized)}>{money(row.unrealized)}</td>
                        <td><Link className="ghost link-btn" to={row.href || "/positions"}>Mở</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="card dash-block">
            <h2>Việc cần xử lý</h2>
            <p className="muted">{ai?.configured ? `Đang dùng ${ai.provider}${ai.model ? ` / ${ai.model}` : ""}. ` : "Chưa có key Gemini, OpenAI, DeepSeek hoặc Claude. "}Bấm gửi để AI đọc dữ liệu hôm nay và hướng dẫn, rồi viết lại danh sách. Ngày là ngày UTC, cùng sổ /income.</p>
            <div className="row-actions">
              <button type="button" onClick={sendToAi} disabled={aiBusy}>{aiBusy ? "Đang gửi…" : ai?.configured ? "Gửi cho AI" : "Sao chép prompt"}</button>
              <button type="button" className="ghost" onClick={() => setShowGuide((open) => !open)}>{showGuide ? "Ẩn hướng dẫn" : "Hướng dẫn"}</button>
            </div>
            {aiError ? <p className="form-error">{aiError}</p> : null}
            {copied ? <p className="muted">Đã chép dữ liệu, hướng dẫn và prompt. Đặt AI_PROVIDER cùng GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY hoặc CLAUDE_API_KEY trong .env rồi khởi động lại server.</p> : null}
            {showGuide ? (
              <>
                <textarea className="dash-guide" value={guide} onChange={(event) => setGuide(event.target.value)} maxLength={2000} />
                <pre className="dash-data">{JSON.stringify(ai?.data || {}, null, 2)}</pre>
              </>
            ) : null}
            {aiItems ? (
              aiItems.length ? (
                <ul className="dash-list">
                  {aiItems.map((item) => (
                    <li key={`${item.href}-${item.title}`}>
                      <Link to={item.href}>{item.title}</Link>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">AI không chọn việc nào từ dữ liệu này.</p>
            ) : data.attention?.length ? (
              <ul className="dash-list">
                {data.attention.map((item) => (
                  <li key={`${item.type}-${item.title}`} className={`dash-attn dash-attn-${item.severity || "low"}`}>
                    {item.severity ? <span className="dash-sev">{severityLabel(item.severity)}</span> : null}
                    <Link to={item.href}>{item.title}</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Không có việc cần xử lý.</p>}
          </section>

          <section className="card dash-block">
            <div className="dash-health-head">
              <h2>Bot của tôi</h2>
              <Link className="ghost link-btn" to="/bots">Danh sách</Link>
            </div>
            {data.mine?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Bot</th>
                      <th>Hiển thị</th>
                      <th>Process</th>
                      <th>Config bật</th>
                      <th>Đã chốt</th>
                      <th>uPnL</th>
                      <th>Vị thế</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mine.map((row) => (
                      <tr key={row.username}>
                        <td>{row.username}</td>
                        <td>{row.active ? "Bật" : "Tắt"}</td>
                        <td className={row.process === "stale" || row.process === "degraded" ? "negative" : ""}>
                          {processLabel(row.process)}
                        </td>
                        <td>{row.on == null ? "—" : `${row.on}/${row.configs}`}</td>
                        <td className={tone(row.profitToday)}>{money(row.profitToday)}</td>
                        <td className={tone(row.unrealized)}>{money(row.unrealized)}</td>
                        <td>{row.positions == null ? "—" : row.positions}</td>
                        <td className="dash-row-actions">
                          <Link className="ghost link-btn" to={`/config-lab?user=${encodeURIComponent(row.username)}`}>Config</Link>
                          <Link className="ghost link-btn" to={`/positions?account=${encodeURIComponent(row.username)}`}>Position</Link>
                          <Link className="ghost link-btn" to={`/ledger?username=${encodeURIComponent(row.username)}`}>Lãi lỗ</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">Bạn chưa sở hữu hoặc được gán bot nào.</p>}
            {bots && bots.total > data.mine.length ? <p><Link to="/bots">Xem hết danh sách bot</Link></p> : null}
          </section>
        </>
      ) : null}
    </section>
  );
}
