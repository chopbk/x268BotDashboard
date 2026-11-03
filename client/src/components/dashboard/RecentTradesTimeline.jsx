import { Link } from "react-router-dom";
import "./dashboard-panels.css";

function moneyPnl(value) {
  if (value == null || value === "") return "Chưa có PnL";
  const n = Number(value);
  if (!Number.isFinite(n)) return "Chưa có PnL";
  const sign = n > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n)} USDT`;
}

function utcStamp(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function kindLabel(kind) {
  if (kind === "open") return "Mở";
  if (kind === "close") return "Đóng";
  return kind || "?";
}

function sideLabel(side) {
  if (side === "LONG" || side === "SHORT") return side;
  return "Chưa rõ side";
}

function pnlClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}

export default function RecentTradesTimeline({
  recentTrades,
  tradeKind,
  onTradeKindChange,
  loadingKind = false,
}) {
  if (recentTrades == null) return null;

  const items = Array.isArray(recentTrades.items) ? recentTrades.items : [];
  const openSupported = recentTrades.openSupported === true;

  return (
    <section className="card dash-panel" aria-labelledby="dash-trades-title">
      <div className="dash-health-head">
        <div>
          <h2 id="dash-trades-title">Giao dịch gần đây</h2>
          <p className="muted dash-panel-sub">
            Lệnh bot · {recentTrades.lookbackDays || 7} ngày UTC · không phải toàn bộ fill sàn
          </p>
        </div>
        <Link className="ghost link-btn" to="/reports?tab=performance&book=live&range=7&analytics=1">
          Xem lịch sử
        </Link>
      </div>

      <div className="dv-mode-tabs" role="tablist" aria-label="Loại sự kiện giao dịch">
        {[
          ["all", "Tất cả"],
          ["open", "Mở"],
          ["close", "Đóng"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tradeKind === key}
            className={tradeKind === key ? "active" : "ghost"}
            onClick={() => onTradeKindChange?.(key)}
            disabled={loadingKind && tradeKind !== key}
          >
            {label}
          </button>
        ))}
      </div>

      {!openSupported ? (
        <p className="muted dash-panel-note">
          {recentTrades.openLimitation
            || "Chưa có nguồn mở lệnh đã xác minh — chỉ hiển thị Đóng từ account_statics Live."}
          {tradeKind === "open" ? " Tab Mở trống cho đến khi openSupported." : ""}
        </p>
      ) : null}

      {loadingKind ? <p className="muted">Đang tải…</p> : null}

      {!loadingKind && !items.length ? (
        <p className="muted">
          {tradeKind === "open" && !openSupported
            ? "Chưa hỗ trợ sự kiện Mở."
            : "Không có giao dịch bot trong cửa sổ này."}
        </p>
      ) : null}

      {items.length ? (
        <ol className="dash-timeline">
          {items.map((item, index) => (
            <li key={item.id || `${item.kind}-${item.at}-${index}`} className="dash-timeline-item">
              <span className={`dash-timeline-dot kind-${item.kind}`} aria-hidden />
              {index < items.length - 1 ? <span className="dash-timeline-line" aria-hidden /> : null}
              <div className="dash-timeline-body">
                <Link className="dash-timeline-main" to={item.href || "/reports?tab=performance&book=live"}>
                  <span className={`dash-timeline-kind kind-${item.kind}`}>{kindLabel(item.kind)}</span>
                  {" "}
                  <span className="dash-timeline-side">{sideLabel(item.side)}</span>
                  {" "}
                  <span className="dash-timeline-symbol">{item.symbol || item.instrumentId || "?"}</span>
                  {item.kind === "close" ? (
                    <>
                      {" · "}
                      <span className={pnlClass(item.profit)}>{moneyPnl(item.profit)}</span>
                    </>
                  ) : null}
                </Link>
                <div className="muted dash-timeline-meta">
                  {[item.username, item.env, item.signal, utcStamp(item.at)].filter(Boolean).join(" · ")}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
