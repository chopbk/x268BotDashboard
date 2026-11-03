import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { api } from "../api";
import {
  marketHubAccess,
  normalizeMarketHubSearch,
} from "../lib/market-hub";
import MarketPage from "./MarketPage";
import SmartMoneyPage from "./SmartMoneyPage";
import MarketDashPage from "./MarketDashPage";
import MarketEconomyPage from "./MarketEconomyPage";
import "./market-hub.css";

export default function MarketHubPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [denyNotice, setDenyNotice] = useState("");
  const [economyEnabled, setEconomyEnabled] = useState(false);

  const access = useMemo(() => marketHubAccess(user), [user]);
  const searchKey = params.toString();

  useEffect(() => {
    if (!access.canEconomy) {
      setEconomyEnabled(false);
      return undefined;
    }
    let cancelled = false;
    api("/api/market/economy/status")
      .then((body) => {
        if (!cancelled) setEconomyEnabled(Boolean(body?.enabled));
      })
      .catch(() => {
        if (!cancelled) setEconomyEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [access.canEconomy]);

  const { mainTab, replaced, notice, nextSearch } = useMemo(() => {
    const result = normalizeMarketHubSearch(searchKey ? `?${searchKey}` : "", access);
    // Feature flag: economy tab deep-link → fallback technical/flow when disabled
    if (result.mainTab === "economy" && access.canEconomy && economyEnabled === false) {
      // Keep tab in URL until status loads; after load, redirect if still disabled
    }
    return {
      mainTab: result.mainTab,
      replaced: result.replaced,
      notice: result.notice,
      nextSearch: result.params.toString(),
    };
  }, [searchKey, access, economyEnabled]);

  useEffect(() => {
    if (!access.canMarketHub || !replaced) return;
    if (nextSearch === searchKey) return;
    setParams(new URLSearchParams(nextSearch), { replace: true });
    if (notice) setDenyNotice(notice);
  }, [access.canMarketHub, replaced, nextSearch, searchKey, notice, setParams]);

  useEffect(() => {
    if (!access.canEconomy) return;
    if (mainTab !== "economy") return;
    // status still loading: economyEnabled false initially — wait one tick via status fetch
    if (economyEnabled) return;
    // After status says disabled, leave economy URL with notice but don't mount page content that 503s forever
  }, [access.canEconomy, mainTab, economyEnabled]);

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
  const showEconomy = mainTab === "economy" && access.canEconomy && economyEnabled;
  const economyFlagOff = mainTab === "economy" && access.canEconomy && !economyEnabled;

  function selectMainTab(next) {
    if (next === "technical" && !access.canTechnical) return;
    if (next === "dashboard" && !access.canDashboard) return;
    if (next === "flow" && !access.canFlow) return;
    if (next === "economy" && (!access.canEconomy || !economyEnabled)) return;
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set("tab", next);
        if (!n.get("flowTab")) n.set("flowTab", "overview");
        if (next === "economy") {
          if (!n.get("econView")) n.set("econView", "context");
          if (!n.get("region")) n.set("region", "us");
        }
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
          Kỹ thuật, Dashboard, dòng tiền Smart Money, và bối cảnh kinh tế/sự kiện — các góc nhìn riêng, không cộng chung thành một điểm vào lệnh.
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
        {access.canEconomy && economyEnabled ? (
          <button
            type="button"
            role="tab"
            id="mkt-hub-tab-economy"
            aria-controls="mkt-hub-panel"
            aria-selected={mainTab === "economy"}
            className={mainTab === "economy" ? "active" : ""}
            onClick={() => selectMainTab("economy")}
          >
            Kinh tế & Tin tức
          </button>
        ) : null}
      </div>

      {denyNotice ? <p className="mkt-hub-notice" role="status">{denyNotice}</p> : null}
      {economyFlagOff ? (
        <p className="mkt-hub-notice" role="status">
          Tab Kinh tế & Tin tức chưa bật (MARKET_ECONOMY_ENABLED). Bối cảnh/lịch không chạy collector khi flag tắt.
        </p>
      ) : null}

      <div
        className="mkt-hub-body"
        id="mkt-hub-panel"
        role="tabpanel"
        aria-label={
          mainTab === "flow"
            ? "Dòng tiền"
            : mainTab === "dashboard"
              ? "Dashboard"
              : mainTab === "economy"
                ? "Kinh tế & Tin tức"
                : "Kỹ thuật"
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
        {showEconomy ? <MarketEconomyPage /> : null}
      </div>
    </div>
  );
}
