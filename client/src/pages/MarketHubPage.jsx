import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import {
  marketHubAccess,
  normalizeMarketHubSearch,
} from "../lib/market-hub";
import MarketPage from "./MarketPage";
import SmartMoneyPage from "./SmartMoneyPage";
import MarketDashPage from "./MarketDashPage";
import "./market-hub.css";

export default function MarketHubPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [denyNotice, setDenyNotice] = useState("");

  const access = useMemo(() => marketHubAccess(user), [user]);
  const searchKey = params.toString();

  const { mainTab, replaced, notice, nextSearch } = useMemo(() => {
    const result = normalizeMarketHubSearch(searchKey ? `?${searchKey}` : "", access);
    return {
      mainTab: result.mainTab,
      replaced: result.replaced,
      notice: result.notice,
      nextSearch: result.params.toString(),
    };
  }, [searchKey, access]);

  useEffect(() => {
    if (!access.canMarketHub || !replaced) return;
    if (nextSearch === searchKey) return;
    setParams(new URLSearchParams(nextSearch), { replace: true });
    if (notice) setDenyNotice(notice);
  }, [access.canMarketHub, replaced, nextSearch, searchKey, notice, setParams]);

  useEffect(() => {
    if (!denyNotice) return undefined;
    const t = setTimeout(() => setDenyNotice(""), 5000);
    return () => clearTimeout(t);
  }, [denyNotice]);

  if (!access.canMarketHub) {
    return <div className="screen muted">Không có quyền xem Thị trường.</div>;
  }

  const showTechnical = mainTab === "technical" && access.canTechnical;
  const showDashboard = mainTab === "dashboard" && access.canDashboard;
  const showFlow = mainTab === "flow" && access.canFlow;

  function selectMainTab(next) {
    if (next === "technical" && !access.canTechnical) return;
    if (next === "dashboard" && !access.canDashboard) return;
    if (next === "flow" && !access.canFlow) return;
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("tab", next);
        if (!n.get("flowTab")) n.set("flowTab", "overview");
        return n;
      },
      { replace: false }
    );
    setDenyNotice("");
  }

  return (
    <div className="mkt-hub">
      <header className="mkt-hub-header">
        <h1>Thị trường</h1>
        <p className="mkt-hub-sub muted">
          Kỹ thuật (market-v1), Dashboard (Pulse/Heatmap/Scanner), và dòng tiền Smart Money — các góc nhìn riêng, không cộng chung thành một điểm vào lệnh.
        </p>
      </header>

      <div className="mkt-hub-tabs" role="tablist" aria-label="Tab chính Thị trường">
        {access.canTechnical ? (
          <button
            type="button"
            role="tab"
            id="mkt-hub-tab-technical"
            aria-controls="mkt-hub-panel"
            aria-selected={mainTab === "technical"}
            className={mainTab === "technical" ? "active" : ""}
            onClick={() => selectMainTab("technical")}
          >
            Kỹ thuật
          </button>
        ) : null}
        {access.canDashboard ? (
          <button
            type="button"
            role="tab"
            id="mkt-hub-tab-dashboard"
            aria-controls="mkt-hub-panel"
            aria-selected={mainTab === "dashboard"}
            className={mainTab === "dashboard" ? "active" : ""}
            onClick={() => selectMainTab("dashboard")}
          >
            Dashboard
          </button>
        ) : null}
        {access.canFlow ? (
          <button
            type="button"
            role="tab"
            id="mkt-hub-tab-flow"
            aria-controls="mkt-hub-panel"
            aria-selected={mainTab === "flow"}
            className={mainTab === "flow" ? "active" : ""}
            onClick={() => selectMainTab("flow")}
          >
            Dòng tiền
          </button>
        ) : null}
      </div>

      {denyNotice ? <p className="mkt-hub-notice" role="status">{denyNotice}</p> : null}

      <div
        className="mkt-hub-body"
        id="mkt-hub-panel"
        role="tabpanel"
        aria-label={
          mainTab === "flow" ? "Dòng tiền" : mainTab === "dashboard" ? "Dashboard" : "Kỹ thuật"
        }
      >
        {showTechnical ? (
          <MarketPage
            embedded
            canFlow={access.canFlow}
            canTerminal={access.canTerminal}
          />
        ) : null}
        {showDashboard ? <MarketDashPage /> : null}
        {showFlow ? (
          <SmartMoneyPage
            embedded
            canTechnical={access.canTechnical}
            canTerminal={access.canTerminal}
          />
        ) : null}
      </div>
    </div>
  );
}
