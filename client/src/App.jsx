import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import { GuardProvider } from "./navigation";
import { AuthProvider, useAuth } from "./auth";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import HomePage from "./pages/HomePage";
import OverviewPage from "./pages/OverviewPage";
import AccountConfigPage from "./pages/AccountConfigPage";
import ConfigLabPage from "./pages/ConfigLabPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import UserApisPage from "./pages/UserApisPage";
import UserApiDetailPage from "./pages/UserApiDetailPage";
import PendingPage from "./pages/PendingPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import SignalHistoryPage from "./pages/SignalHistoryPage";
import SignalSearchPage from "./pages/SignalSearchPage";
import ProfilePage from "./pages/ProfilePage";
import ReportsPage from "./pages/ReportsPage";
import SystemHealthPage from "./pages/SystemHealthPage";
import TerminalPage from "./pages/TerminalPage";
import MarketHubPage from "./pages/MarketHubPage";
import { buildSmartMoneyRedirectPath } from "./lib/market-hub";

const USERS_MANAGE = "users.view";
const BOTS_VIEW = "bots.view";
const CONFIG_VIEW = "config.view";
const CREDENTIALS_VIEW = "credentials.view";
const LOGS_VIEW = "logs.view";
const USERS_EDIT = "users.edit";
const SUMMARY_VIEW = "summary.view";
const SIGNALS_HISTORY = "signals.history";
const STATISTICS_VIEW = "statistics.view";
const POSITIONS_VIEW = "positions.view";
const ORDERS_VIEW = "orders.view";
const MARKET_VIEW = "market.view";
const SMART_MONEY_VIEW = "smart_money.view";

function hasPermission(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function Protected({ children, permission }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="screen muted">Đang tải…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(user, permission)) return <Navigate to="/" replace />;
  return children;
}

function RedirectBotToConfig() {
  const { username = "" } = useParams();
  return <Navigate to={`/config-lab?user=${encodeURIComponent(username)}`} replace />;
}

function RedirectLegacyConfig() {
  const { username = "", env = "" } = useParams();
  return <Navigate to={`/config-lab/${encodeURIComponent(username)}/${encodeURIComponent(env)}`} replace />;
}

/** Bookmark / deep-link cũ `/positions` → Terminal. */
function RedirectPositionsToTerminal() {
  const location = useLocation();
  return <Navigate to={`/terminal${location.search || ""}`} replace />;
}

/** `/summary` → `/?tab=summary`, giữ query. */
function RedirectSummaryToOverview() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("tab", "summary");
  return <Navigate to={`/?${params}`} replace />;
}

/** `/ledger` → `/reports?tab=ledger`, giữ query. */
function RedirectLedgerToReports() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set("tab", "ledger");
  return <Navigate to={`/reports?${params}`} replace />;
}

/** Bookmark `/smart-money` → hub Dòng tiền (trước khi mount trang cũ). */
function RedirectSmartMoneyToMarketHub() {
  const location = useLocation();
  return <Navigate to={buildSmartMoneyRedirectPath(location.search, location.hash)} replace />;
}

function ProtectedAny({ children, permissions }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="screen muted">Đang tải…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!permissions.some((permission) => hasPermission(user, permission))) return <Navigate to="/" replace />;
  return children;
}

function Shell({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const canTerminal =
    hasPermission(user, POSITIONS_VIEW) || hasPermission(user, ORDERS_VIEW) || hasPermission(user, STATISTICS_VIEW);
  const canTechnical = canTerminal || hasPermission(user, MARKET_VIEW);
  const canFlow = canTerminal || hasPermission(user, SMART_MONEY_VIEW);
  const canMarketHub = canTechnical || canFlow;
  const canOverview =
    hasPermission(user, BOTS_VIEW) || hasPermission(user, SUMMARY_VIEW) || hasPermission(user, STATISTICS_VIEW);
  const showNumbers =
    hasPermission(user, STATISTICS_VIEW) ||
    hasPermission(user, SUMMARY_VIEW) ||
    hasPermission(user, BOTS_VIEW) ||
    canTerminal ||
    canMarketHub;
  const showOps = hasPermission(user, LOGS_VIEW);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  async function onLogout() {
    try {
      await logout();
    } catch (error) {
      console.error("[logout]", error);
    }
  }

  return (
    <div className="app">
      <button type="button" className="nav-toggle" onClick={() => setMenuOpen((open) => !open)}>Menu</button>
      {menuOpen ? <button type="button" className="nav-backdrop" aria-label="Đóng menu" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={menuOpen ? "sidenav open" : "sidenav"}>
        <NavLink to="/" className="brand-link">Web Bot</NavLink>
        <nav>
          {canOverview ? <NavLink to="/" end>Tổng quan</NavLink> : null}
          {hasPermission(user, BOTS_VIEW) || hasPermission(user, CREDENTIALS_VIEW) ? <p className="nav-label">Bot</p> : null}
          {hasPermission(user, BOTS_VIEW) ? <NavLink to="/bots">Danh sách</NavLink> : null}
          {hasPermission(user, CONFIG_VIEW) ? <NavLink to="/config-lab">Config</NavLink> : null}
          {hasPermission(user, CREDENTIALS_VIEW) ? <NavLink to="/user-apis">User API</NavLink> : null}
          {hasPermission(user, CONFIG_VIEW) || hasPermission(user, SIGNALS_HISTORY) ? <NavLink to="/signal-search">Signal</NavLink> : null}
          {canTerminal ? <NavLink to="/terminal">Terminal</NavLink> : null}
          {showNumbers ? <p className="nav-label">Số liệu</p> : null}
          {canMarketHub ? <NavLink to="/market">Thị trường</NavLink> : null}
          {hasPermission(user, STATISTICS_VIEW) ? <NavLink to="/reports">Báo cáo</NavLink> : null}
          {showOps ? <p className="nav-label">Vận hành</p> : null}
          {hasPermission(user, LOGS_VIEW) ? <NavLink to="/logs">Lịch sử</NavLink> : null}
          {hasPermission(user, LOGS_VIEW) && user?.scopes?.[LOGS_VIEW] === "all" ? <NavLink to="/system">Hệ thống</NavLink> : null}
          {hasPermission(user, USERS_MANAGE) ? <p className="nav-label">Quản trị</p> : null}
          {hasPermission(user, USERS_MANAGE) ? <NavLink to="/admin/users">User</NavLink> : null}
        </nav>
        <div className="who">
          {hasPermission(user, USERS_EDIT) ? <NavLink to="/profile">{user?.name}</NavLink> : <span>{user?.name}</span>}
          <span className="role">{user?.role}</span>
          <button type="button" className="ghost" onClick={onLogout}>Đăng xuất</button>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}

function AppRoutes() {
  return (
    <GuardProvider>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Shell>
              <AccessHome />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/bots"
        element={
          <Protected permission={BOTS_VIEW}>
            <Shell>
              <HomePage />
            </Shell>
          </Protected>
        }
      />
      <Route path="/config-lab" element={<Protected permission={CONFIG_VIEW}><Shell><ConfigLabPage /></Shell></Protected>} />
      <Route path="/config-lab/:username/:env" element={<Protected permission={CONFIG_VIEW}><Shell><AccountConfigPage experimental /></Shell></Protected>} />
      <Route path="/bots/:username/accounts/:env" element={<Protected permission={CONFIG_VIEW}><RedirectLegacyConfig /></Protected>} />
      <Route
        path="/summary"
        element={
          <ProtectedAny permissions={[SUMMARY_VIEW, BOTS_VIEW, STATISTICS_VIEW]}>
            <RedirectSummaryToOverview />
          </ProtectedAny>
        }
      />
      <Route path="/bots/:username" element={<Protected permission={BOTS_VIEW}><RedirectBotToConfig /></Protected>} />
      <Route
        path="/positions"
        element={
          <ProtectedAny permissions={[POSITIONS_VIEW, ORDERS_VIEW, STATISTICS_VIEW]}>
            <RedirectPositionsToTerminal />
          </ProtectedAny>
        }
      />
      <Route
        path="/terminal"
        element={
          <ProtectedAny permissions={[POSITIONS_VIEW, ORDERS_VIEW, STATISTICS_VIEW]}>
            <Shell>
              <TerminalPage />
            </Shell>
          </ProtectedAny>
        }
      />
      <Route
        path="/market"
        element={
          <ProtectedAny
            permissions={[POSITIONS_VIEW, ORDERS_VIEW, STATISTICS_VIEW, MARKET_VIEW, SMART_MONEY_VIEW]}
          >
            <Shell>
              <MarketHubPage />
            </Shell>
          </ProtectedAny>
        }
      />
      <Route
        path="/smart-money"
        element={
          <ProtectedAny
            permissions={[POSITIONS_VIEW, ORDERS_VIEW, STATISTICS_VIEW, MARKET_VIEW, SMART_MONEY_VIEW]}
          >
            <RedirectSmartMoneyToMarketHub />
          </ProtectedAny>
        }
      />
      <Route
        path="/signal-search"
        element={
          <ProtectedAny permissions={[CONFIG_VIEW, SIGNALS_HISTORY]}>
            <Shell>
              <SignalSearchPage />
            </Shell>
          </ProtectedAny>
        }
      />
      <Route
        path="/ledger"
        element={
          <Protected permission={STATISTICS_VIEW}>
            <RedirectLedgerToReports />
          </Protected>
        }
      />
      <Route
        path="/reports"
        element={
          <Protected permission={STATISTICS_VIEW}>
            <Shell>
              <ReportsPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/signals"
        element={<ProtectedAny permissions={[SIGNALS_HISTORY, STATISTICS_VIEW]}><Shell><SignalHistoryPage /></Shell></ProtectedAny>}
      />
      <Route
        path="/user-apis"
        element={
          <Protected permission={CREDENTIALS_VIEW}>
            <Shell>
              <UserApisPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/user-apis/new"
        element={
          <Protected permission={CREDENTIALS_VIEW}>
            <Shell>
              <UserApiDetailPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/user-apis/:username"
        element={
          <Protected permission={CREDENTIALS_VIEW}>
            <Shell>
              <UserApiDetailPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/admin/users"
        element={
          <Protected permission={USERS_MANAGE}>
            <Shell>
              <AdminUsersPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected permission={USERS_EDIT}>
            <Shell>
              <ProfilePage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/system"
        element={
          <Protected permission={LOGS_VIEW}>
            <Shell>
              <SystemHealthPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/logs"
        element={
          <Protected permission={LOGS_VIEW}>
            <Shell>
              <AuditLogsPage />
            </Shell>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </GuardProvider>
  );
}

function AccessHome() {
  const { user } = useAuth();
  const canOverview =
    hasPermission(user, BOTS_VIEW) || hasPermission(user, SUMMARY_VIEW) || hasPermission(user, STATISTICS_VIEW);
  if (canOverview) return <OverviewPage />;
  return <PendingPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
