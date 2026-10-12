import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import AccountStaticLegacyPage from "./AccountStaticLegacyPage";
import TradePerformancePage from "./TradePerformancePage";

const can = (user, permission) => (user?.permissions || []).includes(permission);

export default function SignalHistoryPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const signalAllowed = can(user, "signals.history");
  const staticAllowed = can(user, "statistics.view");
  const requested = params.get("view");

  if (requested === "signals" && signalAllowed) {
    return <Navigate to="/signal-search?tab=history" replace />;
  }
  if (!staticAllowed) {
    return <Navigate to={signalAllowed ? "/signal-search?tab=history" : "/"} replace />;
  }

  const tab = requested === "statics" ? "statics" : "performance";
  const q = new URLSearchParams(params);
  q.set("view", "performance");
  const performanceHref = `/signals?${q}`;
  const legacy = new URLSearchParams(params);
  legacy.set("view", "statics");
  legacy.delete("analytics");
  legacy.delete("range");
  legacy.delete("time");
  legacy.delete("listDay");
  const staticsHref = `/signals?${legacy}`;

  return (
    <section className="signals-shell">
      <div className="history-tabs" role="tablist" aria-label="Số liệu lệnh">
        <Link
          role="tab"
          aria-selected={tab === "performance"}
          className={tab === "performance" ? "active link-btn" : "link-btn"}
          to={performanceHref}
        >
          Hiệu quả giao dịch
        </Link>
        <Link
          role="tab"
          aria-selected={tab === "statics"}
          className={tab === "statics" ? "active link-btn" : "link-btn"}
          to={staticsHref}
        >
          Account Static
        </Link>
      </div>
      {tab === "statics" ? <AccountStaticLegacyPage embedded /> : <TradePerformancePage embedded />}
    </section>
  );
}
