import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

function money(value) {
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(value) || 0)} $`;
}

function promptText(ai, guide) {
  return ["Hướng dẫn:", guide || ai?.instructions || "", "Dữ liệu:", JSON.stringify(ai?.data || {})].join("\n\n");
}

export default function DashboardPage() {
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
          <p className="muted">Bot bạn sở hữu hoặc được gán. Profit hôm nay là lệnh đóng, không tính paper. Lãi lỗ ví là income trong ngày UTC.</p>
        </div>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {!data && !error ? <p className="muted">Đang tải…</p> : null}
      {data ? (
        <>
          <div className="stats-grid">
            <article className="card">
              <span className="muted">Bot đang active</span>
              <strong>{bots ? `${bots.active}/${bots.total}` : "—"}</strong>
            </article>
            <article className="card">
              <span className="muted">Config đang bật</span>
              <strong>{configs ? `${configs.on}/${configs.total}` : "—"}</strong>
            </article>
            <article className="card">
              <span className="muted">Profit hôm nay</span>
              <strong>{data.profitToday == null ? "—" : money(data.profitToday)}</strong>
            </article>
            <article className="card">
              <span className="muted">Lãi lỗ ví hôm nay</span>
              <strong>{data.incomeToday == null ? "—" : money(data.incomeToday)}</strong>
            </article>
          </div>
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
                  <li key={`${item.type}-${item.title}`}>
                    <Link to={item.href}>{item.title}</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Không có việc cần xử lý.</p>}
          </section>
          <section className="card dash-block">
            <h2>Bot của tôi</h2>
            {data.mine?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Bot</th>
                      <th>Trạng thái</th>
                      <th>Config bật</th>
                      <th>Profit hôm nay</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mine.map((row) => (
                      <tr key={row.username}>
                        <td>{row.username}</td>
                        <td>{row.active ? "Đang chạy" : "Tắt"}</td>
                        <td>{row.on == null ? "—" : `${row.on}/${row.configs}`}</td>
                        <td>{row.profitToday == null ? "—" : money(row.profitToday)}</td>
                        <td><Link className="ghost link-btn" to={`/bots/${encodeURIComponent(row.username)}`}>Mở</Link></td>
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
