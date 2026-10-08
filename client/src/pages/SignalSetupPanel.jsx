import { useEffect, useState } from "react";
import { api } from "../api";

const fmtTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

export default function SignalSetupPanel({ onFindConfig }) {
  const [data, setData] = useState(null);
  const [username, setUsername] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [names, setNames] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = username ? `?username=${encodeURIComponent(username)}` : "";
    api(`/api/signal-config${query}`, { signal: controller.signal })
      .then((next) => {
        setData(next);
        setError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message || "Không tải được cấu hình signal");
      });
    return () => controller.abort();
  }, [username]);

  function toggle(env) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(env)) next.delete(env);
      else next.add(env);
      return next;
    });
  }

  async function apply(action) {
    const signals = names.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
    const envs = [...picked];
    if (!username || !envs.length || !signals.length) {
      setError("Chọn user, ít nhất một config và tên signal.");
      return;
    }
    const verb = action === "add" ? "Thêm" : "Xoá";
    if (!window.confirm(`${verb} ${signals.join(", ")} trên ${envs.length} config của ${username}?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("/api/signal-config", {
        method: "POST",
        body: { username, envs, signals, action },
      });
      const changed = (result.updated || []).filter((row) => row.changed).map((row) => row.env);
      const skipped = (result.updated || []).filter((row) => !row.changed).map((row) => row.env);
      const failed = result.failed || [];
      setNotice([
        changed.length ? `Đã ${action === "add" ? "thêm" : "xoá"} trên ${changed.join(", ")}` : "",
        skipped.length ? `Giữ nguyên ${skipped.join(", ")}` : "",
        failed.length ? failed.map((row) => `${row.env}: ${row.error}`).join("; ") : "",
        "Bot nhận bản mới sau khi restart.",
      ].filter(Boolean).join(". "));
      const fresh = await api(`/api/signal-config?username=${encodeURIComponent(username)}`);
      setData(fresh);
    } catch (err) {
      setError(err.message || "Không sửa được signal");
    } finally {
      setBusy(false);
    }
  }

  const accounts = data?.accounts || [];
  const allPicked = accounts.length > 0 && accounts.every((row) => picked.has(row.env));

  return (
    <div className="signal-setup">
      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}
      <section className="card">
        <h2>Thêm hoặc xoá signal</h2>
        <p className="muted">Thêm giữ các signal đang có. Xoá chỉ gỡ đúng tên đã nhập. Ô signal nhận nhiều tên, cách nhau bởi dấu phẩy.</p>
        <form className="account-filters" onSubmit={(event) => event.preventDefault()}>
          <label>
            User bot
            <select value={username} onChange={(event) => { setUsername(event.target.value); setPicked(new Set()); }}>
              <option value="">Chọn user</option>
              {(data?.bots || []).map((bot) => <option key={bot.username} value={bot.username}>{bot.username} ({bot.accounts})</option>)}
            </select>
          </label>
          <label>
            Signal
            <span className="volume-filter-row">
              <input value={names} placeholder="ROSE, TAM" onChange={(event) => setNames(event.target.value)} />
              {onFindConfig && names.trim() ? <button type="button" className="ghost" onClick={() => onFindConfig(names.trim())}>Tìm config</button> : null}
            </span>
          </label>
          {data?.editable ? <button type="button" disabled={busy} onClick={() => apply("add")}>Thêm</button> : null}
          {data?.editable ? <button type="button" className="danger" disabled={busy} onClick={() => apply("remove")}>Xoá</button> : null}
        </form>
        {username && accounts.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(accounts.map((row) => row.env)))} />
                  </th>
                  <th>Config</th>
                  <th>On</th>
                  <th>Tự gỡ</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((row) => (
                  <tr key={row.env}>
                    <td><input type="checkbox" checked={picked.has(row.env)} onChange={() => toggle(row.env)} /></td>
                    <td>{row.env}</td>
                    <td>{row.on ? "Bật" : "Tắt"}</td>
                    <td>{row.autoRemove ? "Bật" : "Tắt"}</td>
                    <td>{row.signals.length ? row.signals.join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : username ? <p className="muted">User này chưa có config.</p> : <p className="muted">Chọn user bot để xem và sửa signal trên từng config.</p>}
      </section>
      <section className="card">
        <h2>Signal đang dùng</h2>
        <p className="muted">Chỉ signal trên account bạn sở hữu hoặc được gán. Bấm tên để điền vào ô signal, rồi bấm Tìm config cạnh ô đó.</p>
        <div className="signal-chips">
          {(data?.catalog || []).map((row) => (
            <button type="button" className={names.trim().toUpperCase() === row.signal ? "symbol-chip active" : "ghost"} key={row.signal} onClick={() => setNames(row.signal)}>{row.signal} · {row.configs}</button>
          ))}
        </div>
        {(data?.catalog || []).length === 0 ? <p className="muted">Chưa có signal trên account bạn sở hữu hoặc được gán.</p> : null}
      </section>
      <section className="card">
        <h2>Channel</h2>
        <p className="muted">Tên channel listener đang theo. Không gồm session hay API hash.</p>
        <div className="signal-chips">
          {(data?.channels || []).map((row) => (
            <button type="button" key={row.name} className="ghost" onClick={() => setNames(row.name)}>
              {row.name}{row.ocr ? " · OCR" : ""}{row.photoFomo ? " · ảnh" : ""}
            </button>
          ))}
        </div>
        {(data?.channels || []).length === 0 ? <p className="muted">Không có channel trong phạm vi bạn được xem.</p> : null}
      </section>
      <section className="card">
        <h2>Lỗi parse</h2>
        <p className="muted">7 ngày gần nhất. Tin có LONG, SHORT, BUY, SELL hoặc ENTRY nhưng không ra được side và symbol. Số này có sau khi listener chạy bản mới.</p>
        {(data?.parseErrors || []).length === 0 ? <p className="muted">Chưa có lỗi parse.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Signal</th><th>Số lần</th><th>Gần nhất</th><th>Mẫu</th></tr></thead>
              <tbody>
                {data.parseErrors.map((row) => (
                  <tr key={row.signal}>
                    <td>{row.signal || "—"}</td>
                    <td>{row.count}</td>
                    <td>{fmtTime(row.lastAt)}</td>
                    <td>{row.sample}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Bị gỡ vì chuỗi thua</h2>
        <p className="muted">14 ngày gần nhất. Config bật autoremove, chuỗi thua và win rate thấp thì bot gỡ signal, hoặc tắt config nếu đó là signal cuối. ROSE không bị gỡ. Log có sau khi monitor chạy bản mới.</p>
        {(data?.removed || []).length === 0 ? <p className="muted">Chưa có signal bị gỡ.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Thời gian</th><th>Config</th><th>Signal</th><th>Lý do</th></tr></thead>
              <tbody>
                {data.removed.map((row, index) => (
                  <tr key={`${row.env}-${row.signal}-${index}`}>
                    <td>{fmtTime(row.at)}</td>
                    <td>{row.env}</td>
                    <td>{row.signal}</td>
                    <td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
