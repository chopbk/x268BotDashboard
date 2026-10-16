import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import DashboardPage from "./DashboardPage";
import SummaryPage from "./SummaryPage";

const BOTS_VIEW = "bots.view";
const SUMMARY_VIEW = "summary.view";
const STATISTICS_VIEW = "statistics.view";

const can = (user, permission) => (user?.permissions || []).includes(permission);

export default function OverviewPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const canOverview = can(user, BOTS_VIEW);
  const canSummary = can(user, SUMMARY_VIEW) || can(user, BOTS_VIEW) || can(user, STATISTICS_VIEW);

  if (!canOverview && !canSummary) {
    return <Navigate to="/" replace />;
  }

  const requested = params.get("tab");
  let tab = requested === "summary" ? "summary" : "overview";
  if (tab === "overview" && !canOverview) tab = "summary";
  if (tab === "summary" && !canSummary) tab = "overview";
  if (requested === "summary" && !canSummary && canOverview) {
    const next = new URLSearchParams(params);
    next.set("tab", "overview");
    return <Navigate to={`/?${next}`} replace />;
  }
  if ((requested === "overview" || !requested) && !canOverview && canSummary) {
    const next = new URLSearchParams(params);
    next.set("tab", "summary");
    return <Navigate to={`/?${next}`} replace />;
  }

  function tabHref(nextTab) {
    const next = new URLSearchParams(params);
    next.set("tab", nextTab);
    const query = next.toString();
    return query ? `/?${query}` : `/?tab=${nextTab}`;
  }

  return (
    <section className="signals-shell">
      <div className="history-tabs" role="tablist" aria-label="Tổng quan">
        {canOverview ? (
          <Link
            role="tab"
            aria-selected={tab === "overview"}
            className={tab === "overview" ? "active link-btn" : "link-btn"}
            to={tabHref("overview")}
          >
            Tổng quan
          </Link>
        ) : null}
        {canSummary ? (
          <Link
            role="tab"
            aria-selected={tab === "summary"}
            className={tab === "summary" ? "active link-btn" : "link-btn"}
            to={tabHref("summary")}
          >
            Thống kê tổng hợp
          </Link>
        ) : null}
      </div>
      {tab === "summary" ? <SummaryPage /> : <DashboardPage />}
    </section>
  );
}
