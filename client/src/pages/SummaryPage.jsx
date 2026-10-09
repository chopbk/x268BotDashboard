import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const RANGES = new Set(["today", "3d", "7d", "30d", "90d", "all"]);
const can = (user, permission) => (user?.permissions || []).includes(permission);

function number(value, digits = 0) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function money(value) {
  return `${number(value, 2)} $`;
}

function Stat({ label, value, note, tone = "", rank = false, href }) {
  const body = href ? <Link className="trail-link" to={href}>{value}</Link> : value;
  return <article className={`card summary-stat ${tone} ${rank ? "summary-rank" : ""}`}><span className="muted">{label}</span><strong>{body}</strong>{note ? <small className="muted">{note}</small> : null}</article>;
}

function stamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function periodQuery(summary) {
  const query = new URLSearchParams();
  const from = stamp(summary?.from);
  const to = stamp(summary?.to);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  return query;
}

function rankValue(item) {
  return item?.name || "—";
}

function rankNote(item) {
  if (!item) return "Chưa có lệnh trong kỳ";
  return `${money(item.profit)} · ${number(item.trades)} lệnh · WR ${number(item.winRate, 1)}%`;
}

function rankTone(item) {
  if (!item) return "";
  return item.profit < 0 ? "negative" : "positive";
}

const SORT_COLUMNS = [
  { id: "name", label: "User" },
  { id: "profit", label: "Profit" },
  { id: "balance", label: "Balance" },
  { id: "roi", label: "ROI" },
  { id: "volume", label: "Volume" },
  { id: "trades", label: "Số lệnh" },
  { id: "winRate", label: "Win rate" },
  { id: "wins", label: "Thắng" },
  { id: "losses", label: "Thua" },
];

function sortedUsers(rows, key, dir) {
  const sign = dir === "asc" ? 1 : -1;
  return [...(rows || [])].sort((a, b) => {
    const av = a?.[key];
    const bv = b?.[key];
    const missingA = av == null || av === "";
    const missingB = bv == null || bv === "";
    if (missingA || missingB) return missingA === missingB ? String(a.name).localeCompare(String(b.name)) : missingA ? 1 : -1;
    if (key === "name") return String(av).localeCompare(String(bv)) * sign;
    return ((Number(av) || 0) - (Number(bv) || 0)) * sign || String(a.name).localeCompare(String(b.name));
  });
}

export default function SummaryPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const range = RANGES.has(params.get("range")) ? params.get("range") : "today";
  const audience = params.get("audience") === "mine" || params.get("audience") === "system"
    ? params.get("audience")
    : (user?.role === "admin" || user?.role === "summary_viewer" ? "system" : "mine");
  const [sort, setSort] = useState({ key: "profit", dir: "desc" });
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const staticAllowed = can(user, "statistics.view");
  const searchAllowed = can(user, "config.view");
  const historyAllowed = can(user, "signals.history");
  const botAllowed = can(user, "bots.view");

  function setQuery(patch) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([key, value]) => next.set(key, value));
    setParams(next);
  }

  function toggleSort(key) {
    setSort((current) => current.key === key
      ? { key, dir: current.dir === "desc" ? "asc" : "desc" }
      : { key, dir: key === "name" ? "asc" : "desc" });
  }

  function userHref(name) {
    if (!name) return "";
    if (staticAllowed) {
      const query = periodQuery(summary);
      query.set("view", "statics");
      query.set("username", name);
      query.set("book", "live");
      query.set("closed", "closed");
      query.set("src", "summary");
      return `/signals?${query}`;
    }
    if (botAllowed) return `/bots/${encodeURIComponent(name)}`;
    return "";
  }

  function signalHref(name) {
    if (!name) return "";
    const query = periodQuery(summary);
    query.set("signal", name);
    query.set("src", "summary");
    if (searchAllowed) {
      query.set("tab", "search");
      return `/signal-search?${query}`;
    }
    if (historyAllowed) {
      query.set("tab", "history");
      return `/signal-search?${query}`;
    }
    return "";
  }

  function symbolHref(name) {
    if (!name || !historyAllowed) return "";
    const query = periodQuery(summary);
    query.set("tab", "history");
    query.set("symbol", name);
    query.set("src", "summary");
    return `/signal-search?${query}`;
  }

  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      const data = await api(`/api/summary/refresh?range=${encodeURIComponent(range)}&audience=${encodeURIComponent(audience)}`, { method: "POST" });
      setSummary(data);
    } catch (err) {
      setError(err.message || "Không cập nhật được tổng kết");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setSummary(null);
    setError("");
    api(`/api/summary?range=${encodeURIComponent(range)}&audience=${encodeURIComponent(audience)}`, { signal: controller.signal }).then((data) => active && setSummary(data)).catch((err) => active && setError(err.message));
    return () => { active = false; controller.abort(); };
  }, [range, audience]);

  return (
    <section>
      <header className="page-head summary-head">
        <div>
          <h1>Tổng kết hệ thống</h1>
          <p className="muted">{audience === "mine" ? "Đang xem user bot bạn sở hữu hoặc được gán." : "Đang xem user bot mà quyền Bot hoặc Account Static của bạn cho phép. Bot private chỉ hiện khi bạn sở hữu hoặc được gán."} Cột profit, balance và ROI lấy futures_profits. Volume, số lệnh và win rate vẫn là lệnh đóng Account Static. Hôm nay tính theo ngày UTC.</p>
        </div>
        <div className="ledger-tools">
          <label>Phạm vi<select value={audience} onChange={(event) => setQuery({ audience: event.target.value })}><option value="mine">User của tôi</option><option value="system">Toàn hệ thống</option></select></label>
          <label>Khoảng thời gian<select value={range} onChange={(event) => setQuery({ range: event.target.value })}><option value="today">Hôm nay</option><option value="3d">3 ngày gần nhất</option><option value="7d">7 ngày gần nhất</option><option value="30d">30 ngày gần nhất</option><option value="90d">90 ngày gần nhất</option><option value="all">Toàn thời gian</option></select></label>
          <button type="button" disabled={refreshing} onClick={refresh}>{refreshing ? "Đang cập nhật…" : "Cập nhật"}</button>
        </div>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      {!summary && !error ? <p className="muted">Đang tải số liệu…</p> : null}
      {summary ? <>
        <h2 className="summary-section-title">Hệ thống</h2>
        <div className="stats-grid summary-grid">
          <Stat label="User bot" value={number(summary.botCount)} note={`${number(summary.publicBotCount)} public · ${number(summary.privateBotCount)} private`} />
          <Stat label="Account config" value={number(summary.configCount)} note={`${number(summary.activeConfigCount)} đang bật · ${number(summary.inactiveConfigCount)} đang tắt`} />
          <Stat label="Signal trong kỳ" value={number(summary.signalCount)} note={`Signal đã vào lệnh của user trong phạm vi, theo openTime, không paper · ${number(summary.signalCount24h)} signal trong 24 giờ`} />
          <Stat label="Position đang mở" value={number(summary.openPositionCount)} note="Monitor Position đang mở, không paper, không cắt theo kỳ" />
        </div>
        <h2 className="summary-section-title">Hiệu suất giao dịch</h2>
        <p className="muted">Nguồn: Account Static, lệnh đã đóng, không paper, theo closeTime. Kỳ {summary.from ? when(summary.from) : "toàn bộ"} → {when(summary.to)}. Tính lúc {when(summary.snapshot?.generatedAt || summary.generatedAt)}{summary.snapshot?.status === "refreshing" ? " · đang làm mới nền" : summary.cached ? " · snapshot MongoDB" : ""}.</p>
        <div className="stats-grid summary-grid">
          <Stat label="Tổng giao dịch" value={number(summary.tradeCount)} note={`${number(summary.wins)} thắng · ${number(summary.losses)} thua`} />
          <Stat label="Win rate" value={`${number(summary.winRate, 1)}%`} note="Account Static, không gồm paper" />
          <Stat label="Profit hôm nay" value={money(summary.profitToday)} tone={summary.profitToday < 0 ? "negative" : "positive"} note="Account Static, lệnh đóng hôm nay theo UTC" />
          <Stat label="Profit trong kỳ" value={money(summary.profit)} tone={summary.profit < 0 ? "negative" : "positive"} note="Account Static, cùng kỳ closeTime ở trên" />
          <Stat label="Volume trong kỳ" value={money(summary.volume)} note="Account Static, không lấy từ signal_infos" />
          <Stat label="Profit Long" value={money(summary.longProfit)} tone={summary.longProfit < 0 ? "negative" : "positive"} note="Cùng nguồn và kỳ" />
          <Stat label="Profit Short" value={money(summary.shortProfit)} tone={summary.shortProfit < 0 ? "negative" : "positive"} note="Cùng nguồn và kỳ" />
        </div>
        <h2 className="summary-section-title">Xếp hạng trong kỳ</h2>
        <p className="muted">Thẻ tín hiệu và symbol theo Account Static. Bảng user lấy một ví futures_profits cho mỗi user, không cộng các config. Profit là tổng ngày trong kỳ, balance là số dư ngày cuối, ROI là profit kỳ chia số dư đầu kỳ. Bấm tên để mở giao dịch, config hoặc lịch sử signal của đúng kỳ.</p>
        <div className="stats-grid summary-grid">
          <Stat rank label="Tín hiệu tốt nhất" value={rankValue(summary.bestSignal)} href={signalHref(summary.bestSignal?.name)} note={rankNote(summary.bestSignal)} tone={rankTone(summary.bestSignal)} />
          <Stat rank label="Tín hiệu kém nhất" value={rankValue(summary.worstSignal)} href={signalHref(summary.worstSignal?.name)} note={rankNote(summary.worstSignal)} tone={rankTone(summary.worstSignal)} />
          <Stat rank label="User hiệu suất tốt nhất" value={rankValue(summary.bestUser)} href={userHref(summary.bestUser?.name)} note={rankNote(summary.bestUser)} tone={rankTone(summary.bestUser)} />
          <Stat rank label="Symbol lãi nhất" value={rankValue(summary.bestSymbol)} href={symbolHref(summary.bestSymbol?.name)} note={rankNote(summary.bestSymbol)} tone={rankTone(summary.bestSymbol)} />
        </div>
        <h2 className="summary-section-title">Bảng xếp hạng user</h2>
        <p className="muted">Bấm tiêu đề cột để sắp xếp. Bấm lại để đảo chiều.</p>
        {sortedUsers(summary.userRanks, sort.key, sort.dir).length ? (
          <div className="table-wrap signal-table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  {SORT_COLUMNS.map((column) => (
                    <th key={column.id} aria-sort={sort.key === column.id ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" className="sort-col" onClick={() => toggleSort(column.id)}>
                        {column.label}{sort.key === column.id ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedUsers(summary.userRanks, sort.key, sort.dir).map((row, index) => (
                  <tr key={row.name}>
                    <td>{index + 1}</td>
                    <td>{userHref(row.name) ? <Link className="trail-link" to={userHref(row.name)}>{row.name}</Link> : row.name}</td>
                    <td>{money(row.profit)}</td>
                    <td>{row.balance == null ? "—" : money(row.balance)}</td>
                    <td>{row.roi == null ? "—" : `${number(row.roi, 2)}%`}</td>
                    <td>{money(row.volume)}</td>
                    <td>{number(row.trades)}</td>
                    <td>{number(row.winRate, 1)}%</td>
                    <td>{number(row.wins)}</td>
                    <td>{number(row.losses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="card empty">Chưa có user active có lệnh trong kỳ.</div>}
        <p className="summary-updated muted">Mốc tính: {when(summary.snapshot?.generatedAt || summary.generatedAt)}. Cột profit, balance và ROI là một ví futures_profits mỗi user. Các thẻ profit phía trên vẫn là Account Static.</p>
      </> : null}
    </section>
  );
}
