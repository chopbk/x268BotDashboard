import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import HorizontalPnlBars from "../components/charts/HorizontalPnlBars.jsx";
import BubbleCompare from "../components/charts/BubbleCompare.jsx";
import "../components/charts/charts.css";

const STATISTICS_VIEW = "statistics.view";
const SIGNALS_HISTORY = "signals.history";
const CONFIG_VIEW = "config.view";
const can = (user, permission) => (user?.permissions || []).includes(permission);

const DAY_MS = 24 * 60 * 60 * 1000;
const LOW = 20;

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n > 0) return `+${text}$`;
  if (n < 0) return `−${text}$`;
  return `${text}$`;
}

function pct(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n * 10) / 10}%`;
}

function fmtTime(value) {
  return value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC" : "—";
}

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function applyDatePick(currentIso, localValue) {
  if (!localValue) return "";
  const next = new Date(localValue);
  if (Number.isNaN(next.getTime())) return "";
  const prev = currentIso ? new Date(currentIso) : null;
  const sameDay = prev && !Number.isNaN(prev.getTime())
    && prev.getFullYear() === next.getFullYear()
    && prev.getMonth() === next.getMonth()
    && prev.getDate() === next.getDate();
  if (!sameDay) next.setHours(0, 0, 0, 0);
  else next.setMinutes(0, 0, 0);
  return next.toISOString();
}

export default function SignalScorecardPanel({ onFindConfig }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const scope = params.get("scope") === "all" ? "all" : "mine";
  const book = ["live", "paper", "all"].includes(params.get("book")) ? params.get("book") : "live";
  const sort = ["profit", "winRate", "trades", "feed", "volume"].includes(params.get("sort")) ? params.get("sort") : "profit";
  const minTrades = params.get("minTrades") || "";
  const q = params.get("q") || "";
  const chartMode = params.get("scoreChart") === "bubble" ? "bubble" : "rank";
  const selected = params.get("scoreSelect") || "";

  const historyAllowed = can(user, SIGNALS_HISTORY);
  const staticAllowed = can(user, STATISTICS_VIEW);
  const searchAllowed = can(user, CONFIG_VIEW);

  function update(patch) {
    const next = new URLSearchParams(params);
    next.set("tab", "scorecard");
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    setParams(next, { replace: true });
  }

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    query.set("scope", scope);
    query.set("book", book);
    query.set("sort", sort);
    if (minTrades) query.set("minTrades", minTrades);
    if (q) query.set("q", q);
    api(`/api/provider-scorecard?${query}`, { signal: controller.signal })
      .then((result) => setData(result))
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message || "Không tải được scorecard");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [from, to, scope, book, sort, minTrades, q]);

  const rows = data?.rows || [];
  const summary = data?.summary || {};
  const formula = data?.formula || {};
  const tradedRows = rows.filter((row) => (Number(row.trades) || 0) > 0);
  const selectedRow = rows.find((row) => row.signal === selected) || null;

  function hrefFor(signal, tab) {
    const next = new URLSearchParams();
    next.set("tab", tab);
    next.set("signal", signal);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    return `/signal-search?${next}`;
  }

  function staticHref(signal) {
    const next = new URLSearchParams();
    next.set("view", "statics");
    next.set("signal", signal);
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    return `/signals?${next}`;
  }

  function selectSignal(name) {
    update({ scoreSelect: selected === name ? "" : name });
  }

  return (
    <div className="signal-setup">
      <form
        className="card signal-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          update({
            from: applyDatePick(from, form.get("fromLocal")) || "",
            to: applyDatePick(to, form.get("toLocal")) || "",
            scope: form.get("scope") || "mine",
            book: form.get("book") || "live",
            sort: form.get("sort") || "profit",
            minTrades: String(form.get("minTrades") || "").trim(),
            q: String(form.get("q") || "").trim(),
            scoreSelect: "",
          });
        }}
      >
        <label>
          Từ
          <input name="fromLocal" type="datetime-local" defaultValue={toLocalInput(from || (data?.from ? data.from : new Date(Date.now() - 3 * DAY_MS).toISOString()))} key={`from-${from || data?.from || "d"}`} />
        </label>
        <label>
          Đến
          <input name="toLocal" type="datetime-local" defaultValue={toLocalInput(to || data?.to || "")} key={`to-${to || data?.to || "d"}`} />
        </label>
        <label>
          Phạm vi lệnh
          <select name="scope" defaultValue={scope} key={`scope-${scope}`}>
            <option value="mine">Của mình / được gán</option>
            <option value="all">Mọi bot được xem</option>
          </select>
        </label>
        <label>
          Sổ
          <select name="book" defaultValue={book} key={`book-${book}`}>
            <option value="live">Live</option>
            <option value="paper">Paper</option>
            <option value="all">Tất cả</option>
          </select>
        </label>
        <label>
          Sắp xếp
          <select name="sort" defaultValue={sort} key={`sort-${sort}`}>
            <option value="profit">Profit</option>
            <option value="winRate">Win rate</option>
            <option value="trades">Số lệnh</option>
            <option value="feed">Số tin feed</option>
            <option value="volume">Volume</option>
          </select>
        </label>
        <label>
          Tối thiểu lệnh
          <input name="minTrades" type="number" min="0" defaultValue={minTrades} key={`min-${minTrades}`} placeholder="0" />
        </label>
        <label>
          Tìm channel
          <input name="q" defaultValue={q} key={`q-${q}`} placeholder="SIGNAL_A" />
        </label>
        <button type="submit" disabled={busy}>{busy ? "Đang tải…" : "Áp dụng"}</button>
      </form>

      {error ? <p className="form-error">{error}</p> : null}

      <section className="card">
        <h2>Provider Scorecard</h2>
        <p className="muted">
          Xếp hạng channel bằng số thật: feed từ signal_infos, lệnh/PnL từ account_statics.
          {data?.from ? ` Từ ${fmtTime(data.from)}` : ""}{data?.to ? ` đến ${fmtTime(data.to)}` : ""}.
        </p>
        <p className="muted">{formula.feed}. {formula.trades}. {formula.win}. {formula.pnl}.</p>
        {!data?.canSeeFeed ? <p className="muted">Thiếu signals.history — cột Feed = 0.</p> : null}
        {!data?.canSeeTrades ? <p className="muted">Thiếu statistics.view — cột lệnh/profit = 0.</p> : null}
        <p>
          {summary.providers || 0} channel
          {" · "}feed {summary.feed || 0}
          {" · "}lệnh {summary.trades || 0}
          {" · "}profit {money(summary.profit)}
          {" · "}win rate {pct(summary.winRate)}
        </p>
      </section>

      <div className="dv-mode-tabs" role="group" aria-label="Chế độ scorecard chart">
        <button type="button" className={chartMode === "rank" ? "active" : "ghost"} aria-pressed={chartMode === "rank"} onClick={() => update({ scoreChart: "rank" })}>
          Xếp hạng
        </button>
        <button type="button" className={chartMode === "bubble" ? "active" : "ghost"} aria-pressed={chartMode === "bubble"} onClick={() => update({ scoreChart: "bubble" })}>
          So sánh (bubble)
        </button>
      </div>

      {chartMode === "bubble" ? (
        <BubbleCompare
          rows={rows}
          selected={selected}
          onSelect={selectSignal}
          loading={busy && !data}
          error=""
          subtitle={`USDT · sổ ${book} · openTime · UTC · diện tích = số lệnh`}
        />
      ) : (
        <HorizontalPnlBars
          title="Channel nào lời/lỗ nhiều nhất?"
          subtitle={`USDT · sổ ${book} · openTime · UTC · top theo trị tuyệt đối PnL`}
          rows={tradedRows}
          nameKey="signal"
          selected={selected}
          onSelect={selectSignal}
          loading={busy && !data}
          empty={busy ? "" : "Không có channel có lệnh trong kỳ."}
        />
      )}

      {selected ? (
        <div className="dv-selection-bar card">
          <span className="muted">Đang chọn:</span>
          <span className="perf-chip">
            {selected}
            <button type="button" aria-label="Bỏ chọn channel" onClick={() => update({ scoreSelect: "" })}>×</button>
          </span>
          <button type="button" className="ghost" onClick={() => update({ scoreSelect: "" })}>Bỏ chọn biểu đồ</button>
          {selectedRow ? (
            <span className="muted">
              profit {money(selectedRow.profit)} · win rate {pct(selectedRow.winRate)} · {selectedRow.trades || 0} lệnh
              {(selectedRow.trades || 0) > 0 && (selectedRow.trades || 0) < LOW ? " · Ít dữ liệu" : ""}
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="card">
        <h2>Bảng xếp hạng</h2>
        {rows.length === 0 ? <p className="muted">{busy ? "Đang tải…" : "Không có channel trong khoảng này."}</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Channel</th>
                  <th>Listener</th>
                  <th>Feed</th>
                  <th>Lệnh</th>
                  <th>Win rate</th>
                  <th>Profit</th>
                  <th>Volume</th>
                  <th>Config</th>
                  <th>Account</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.signal} className={selected === row.signal ? "trade-row active" : undefined}>
                    <td>{index + 1}</td>
                    <td>
                      <button type="button" className="perf-linkish" onClick={() => selectSignal(row.signal)}>{row.signal}</button>
                      {(row.trades || 0) > 0 && (row.trades || 0) < LOW ? <span className="dv-badge warn">Ít dữ liệu</span> : null}
                      {(row.trades || 0) === 0 ? <span className="dv-badge">Chưa có lệnh</span> : null}
                    </td>
                    <td>{row.channel ? "Có" : "Không"}</td>
                    <td>{row.feed}{row.feed ? ` · ${row.feedLong}L/${row.feedShort}S` : ""}</td>
                    <td>{row.wins}/{row.trades}</td>
                    <td>{pct(row.winRate)}</td>
                    <td>{money(row.profit)}</td>
                    <td>{money(row.volume)}</td>
                    <td>{row.configs}</td>
                    <td>{row.accounts}</td>
                    <td className="trail-note">
                      {searchAllowed && onFindConfig ? <button type="button" className="ghost" onClick={() => onFindConfig(row.signal)}>Tìm config</button> : null}
                      {historyAllowed ? <Link className="trail-link" to={hrefFor(row.signal, "history")}>Lịch sử</Link> : null}
                      {staticAllowed ? <Link className="trail-link" to={staticHref(row.signal)}>Static</Link> : null}
                    </td>
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
