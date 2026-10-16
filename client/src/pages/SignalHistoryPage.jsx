import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import AccountStaticLegacyPage from "./AccountStaticLegacyPage";

const can = (user, permission) => (user?.permissions || []).includes(permission);

/** Legacy `/signals`: statics giữ nguyên; performance → `/reports`. */
export default function SignalHistoryPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const signalAllowed = can(user, "signals.history");
  const staticAllowed = can(user, "statistics.view");
  const requested = params.get("view");

  if (requested === "signals" && signalAllowed) {
    return <Navigate to="/signal-search?tab=history" replace />;
  }

  if (requested === "statics") {
    if (!staticAllowed) {
      return <Navigate to={signalAllowed ? "/signal-search?tab=history" : "/"} replace />;
    }
    return (
      <section className="signals-shell">
        <AccountStaticLegacyPage />
      </section>
    );
  }

  if (!staticAllowed) {
    return <Navigate to={signalAllowed ? "/signal-search?tab=history" : "/"} replace />;
  }

  const next = new URLSearchParams(params);
  next.delete("view");
  next.set("tab", "performance");
  if (!next.get("analytics")) next.set("analytics", "1");
  const username = params.get("user");
  if (username && !next.get("username")) {
    next.set("username", username);
    next.delete("user");
  }
  return <Navigate to={`/reports?${next}`} replace />;
}
