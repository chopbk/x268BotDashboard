import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

const fmtTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${n > 0 ? "+" : ""}${text}$`.replace("+-", "-");
}

function pct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

function FindButton({ name, onFindConfig }) {
  if (!onFindConfig || !name) return null;
  return <button type="button" className="ghost" onClick={() => onFindConfig(name)}>Tìm config</button>;
}

function namesOf(value) {
  return new Set(String(value || "").split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean));
}

export default function SignalStatsPanel({ onFindConfig }) {
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState(null);
  const fromUser = params.get("fromUser") || "";
  const fromEnv = params.get("fromEnv") || "";
  const signalSet = namesOf(params.get("signals") || params.get("signal"));

  useEffect(() => {
    const controller = new AbortController();
    const query = fromUser ? `?username=${encodeURIComponent(fromUser)}` : "";
    api(`/api/signal-config${query}`, { signal: controller.signal })
      .then((next) => {
        setData(next);
        setLoadedAt(new Date().toISOString());
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message || "Không tải được thống kê signal");
      });
    return () => controller.abort();
  }, [fromUser]);

  const summary = data?.summary || {};
  const wanted = (row) => !signalSet.size || signalSet.has(String(row.signal || "").toUpperCase());
  const usage = (data?.usage || []).filter(wanted);
  const performance = data?.performance || null;
  const accountLosses = (performance?.accountLosses || []).filter((row) => !fromEnv || (row.signals || []).some((item) => item.env === fromEnv) || row.env === fromEnv);
  const todayLosing = (performance?.todayLosing || []).filter((row) => wanted(row) && (!fromEnv || row.env === fromEnv));
  const losingSignals = (performance?.losingSignals || []).filter((row) => wanted(row) && (!fromEnv || row.env === fromEnv));
  const lowWinRate = (performance?.lowWinRate || []).filter((row) => wanted(row) && (!fromEnv || row.env === fromEnv));
  const channels = data?.channels || [];
  const orphanChannels = data?.orphanChannels || [];
  const parseErrors = (data?.parseErrors || []).filter(wanted);
  const removed = (data?.removed || []).filter((row) => wanted(row) && (!fromEnv || row.env === fromEnv));
  const historyHref = (() => {
    const next = new URLSearchParams(params);
    next.set("tab", "history");
    return `/signal-search?${next}`;
  })();

  return (
    <div className="signal-setup">
      {error ? <p className="form-error">{error}</p> : null}
      {fromUser && fromEnv ? (
        <p className="trail-note muted">
          <span>Lý do của config {fromUser}/{fromEnv}. Lỗi parse là 7 ngày, signal bị gỡ là 14 ngày{loadedAt ? `, tải lúc ${fmtTime(loadedAt)}` : ""}.</span>
          <Link className="trail-link" to={`/bots/${encodeURIComponent(fromUser)}/accounts/${encodeURIComponent(fromEnv)}`}>Mở config</Link>
          <Link className="trail-link" to={historyHref}>Lịch sử signal</Link>
        </p>
      ) : <p className="muted">Nguồn: log parse 7 ngày và log tự gỡ 14 ngày{loadedAt ? `. Tải lúc ${fmtTime(loadedAt)}` : ""}.</p>}
      <section className="card">
        <h2>Tổng quan</h2>
        <p className="muted">
          {summary.channels || 0} channel
          {" · "}{summary.signals || 0} signal đang dùng
          {" · "}{summary.withoutChannel || 0} signal chưa có channel
          {" · "}{summary.parseErrors || 0} lỗi parse trong 7 ngày
          {" · "}{summary.removed || 0} lần bị gỡ trong 14 ngày
        </p>
        <p className="muted">Bảng phía dưới lấy account bạn sở hữu hoặc được gán. Phần lỗ lãi gồm mọi user bạn được xem, ngày UTC cùng sổ /income. Lỗi parse và lần bị gỡ chỉ có sau khi listener và monitor chạy bản mới.</p>
        {performance ? (
          <>
            <p>Tài khoản lỗ hôm nay</p>
            {accountLosses.length ? accountLosses.map((row) => (
              <p key={`acct-${row.username}`}>{row.username} lỗ {money(row.profit)} trên tài khoản. {row.signals?.length ? `Signal lỗ: ${row.signals.map((item) => `${item.env} · ${item.signal} ${money(item.profit)} · ${item.count} lệnh · win rate ${pct(item.winRate)}`).join("; ")}.` : "Chưa có signal live lỗ trong ngày này, cần xem income của tài khoản."}</p>
            )) : <p className="muted">Hôm nay chưa có tài khoản lỗ trên sổ income.</p>}
            <p>Signal lỗ theo user, hôm nay (UTC)</p>
            {todayLosing.length ? todayLosing.map((row) => (
              <p key={`today-${row.username}-${row.env}-${row.signal}`}>{row.username} · {row.env} · {row.signal} {money(row.profit)} · {row.count} lệnh · win rate {pct(row.winRate)}</p>
            )) : <p className="muted">Hôm nay chưa có signal lỗ.</p>}
            <p>Signal lỗ theo user, 7 ngày</p>
            {losingSignals.length ? losingSignals.map((row) => (
              <p key={`week-${row.username}-${row.env}-${row.signal}`}>{row.username} · {row.env} · {row.signal} {money(row.profit)} · {row.count} lệnh · win rate {pct(row.winRate)}</p>
            )) : <p className="muted">7 ngày chưa có signal lỗ.</p>}
            <p>Win rate thấp theo user, 7 ngày, từ 3 lệnh</p>
            {lowWinRate.length ? lowWinRate.map((row) => (
              <p key={`wr-${row.username}-${row.env}-${row.signal}`}>{row.username} · {row.env} · {row.signal} win rate {pct(row.winRate)} · {row.count} lệnh · {money(row.profit)}</p>
            )) : <p className="muted">Không có signal dưới 50% trong 7 ngày.</p>}
          </>
        ) : <p className="muted">Cần quyền xem thống kê để thấy signal lỗ và win rate.</p>}
        {signalSet.size || fromEnv ? <p className="muted">Số tổng phía trên là cả user. Các bảng bên dưới chỉ giữ signal và config đang xem.</p> : null}
      </section>
      <section className="card">
        <h2>Signal đang chạy</h2>
        <p className="muted">Mỗi dòng là một signal trên config của bạn. Đang bật là config On. Tự gỡ là config bật autoremove. Channel là listener có channel cùng tên.</p>
        {usage.length === 0 ? <p className="muted">{signalSet.size ? "Config này không có signal trong phạm vi đang xem." : "Chưa có signal trên account bạn sở hữu hoặc được gán."}</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th>Config</th>
                  <th>Đang bật</th>
                  <th>Tự gỡ</th>
                  <th>Channel</th>
                  <th>Lỗi parse</th>
                  <th>Bị gỡ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={row.signal}>
                    <td>{row.signal}</td>
                    <td>{row.configs}</td>
                    <td>{row.on}</td>
                    <td>{row.autoRemove}</td>
                    <td>{row.channel ? "Có" : "Không"}</td>
                    <td>{row.parseErrors}</td>
                    <td>{row.removed}</td>
                    <td><FindButton name={row.signal} onFindConfig={onFindConfig} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Channel</h2>
        <p className="muted">Tên channel listener đang theo. Không gồm session hay API hash.</p>
        {channels.length === 0 ? <p className="muted">Không có channel trong phạm vi bạn được xem.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Channel</th><th>OCR</th><th>Ảnh</th><th>Gắn config</th><th></th></tr></thead>
              <tbody>
                {channels.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.ocr ? "Có" : "Không"}</td>
                    <td>{row.photoFomo ? "Có" : "Không"}</td>
                    <td>{orphanChannels.some((item) => item.name === row.name) ? "Chưa" : "Có"}</td>
                    <td><FindButton name={row.name} onFindConfig={onFindConfig} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Lỗi parse</h2>
        <p className="muted">7 ngày gần nhất. Tin có LONG, SHORT, BUY, SELL hoặc ENTRY nhưng không ra được side và symbol.</p>
        {parseErrors.length === 0 ? <p className="muted">{signalSet.size ? "Các signal này chưa có lỗi parse trong 7 ngày." : "Chưa có lỗi parse."}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Signal</th><th>Số lần</th><th>Gần nhất</th><th>Mẫu</th><th></th></tr></thead>
              <tbody>
                {parseErrors.map((row) => (
                  <tr key={row.signal || row.sample}>
                    <td>{row.signal || "—"}</td>
                    <td>{row.count}</td>
                    <td>{fmtTime(row.lastAt)}</td>
                    <td>{row.sample}</td>
                    <td><FindButton name={row.signal} onFindConfig={onFindConfig} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card">
        <h2>Bị gỡ vì chuỗi thua</h2>
        <p className="muted">14 ngày gần nhất. Config bật autoremove, chuỗi thua và win rate thấp thì bot gỡ signal, hoặc tắt config nếu đó là signal cuối. ROSE không bị gỡ.</p>
        {removed.length === 0 ? <p className="muted">{fromEnv ? `Config ${fromEnv} chưa có signal bị gỡ trong 14 ngày.` : "Chưa có signal bị gỡ."}</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Thời gian</th><th>Config</th><th>Signal</th><th>Lý do</th><th></th></tr></thead>
              <tbody>
                {removed.map((row, index) => (
                  <tr key={`${row.env}-${row.signal}-${index}`}>
                    <td>{fmtTime(row.at)}</td>
                    <td>{row.env}</td>
                    <td>{row.signal}</td>
                    <td>{row.message}</td>
                    <td><FindButton name={row.signal} onFindConfig={onFindConfig} /></td>
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
