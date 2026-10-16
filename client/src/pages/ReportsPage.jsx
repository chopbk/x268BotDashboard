import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import TradePerformancePage from "./TradePerformancePage";
import AccountLedgerPage from "./AccountLedgerPage";

const can = (user, permission) => (user?.permissions || []).includes(permission);

export default function ReportsPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const staticAllowed = can(user, "statistics.view");
  const requested = params.get("tab");
  const tab = requested === "ledger" ? "ledger" : "performance";

  function tabHref(nextTab) {
    const next = new URLSearchParams(params);
    next.set("tab", nextTab);
    if (nextTab === "performance") {
      next.delete("view");
      if (!next.get("analytics")) next.set("analytics", "1");
    }
    return `/reports?${next}`;
  }

  function staticsHref() {
    const next = new URLSearchParams();
    next.set("view", "statics");
    const username = params.get("username");
    if (username && username !== "__all__") next.set("username", username);
    const env = params.get("env");
    if (env) next.set("env", env);
    const from = params.get("from");
    const to = params.get("to");
    if (from) next.set("from", from);
    if (to) next.set("to", to);
    return `/signals?${next}`;
  }

  return (
    <section className="signals-shell">
      <div className="history-tabs" role="tablist" aria-label="Báo cáo">
        <Link
          role="tab"
          aria-selected={tab === "performance"}
          className={tab === "performance" ? "active link-btn" : "link-btn"}
          to={tabHref("performance")}
        >
          Hiệu quả lệnh
        </Link>
        <Link
          role="tab"
          aria-selected={tab === "ledger"}
          className={tab === "ledger" ? "active link-btn" : "link-btn"}
          to={tabHref("ledger")}
        >
          Ví & dòng tiền
        </Link>
        {staticAllowed ? (
          <Link className="link-btn muted" to={staticsHref()} title="Giao diện Account Static cũ — đối chiếu khi cần">
            Báo cáo cũ
          </Link>
        ) : null}
      </div>
      {tab === "ledger" ? <AccountLedgerPage /> : <TradePerformancePage />}
    </section>
  );
}
