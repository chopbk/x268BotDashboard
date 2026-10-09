import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { GuardProvider } from "./navigation";
import { AuthProvider, useAuth } from "./auth";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";
import BotDetailPage from "./pages/BotDetailPage";
import AccountConfigPage from "./pages/AccountConfigPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import UserApisPage from "./pages/UserApisPage";
import UserApiDetailPage from "./pages/UserApiDetailPage";
import PendingPage from "./pages/PendingPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import SummaryPage from "./pages/SummaryPage";
import SignalHistoryPage from "./pages/SignalHistoryPage";
import SignalSearchPage from "./pages/SignalSearchPage";
import ProfilePage from "./pages/ProfilePage";
import AccountLedgerPage from "./pages/AccountLedgerPage";
import SystemHealthPage from "./pages/SystemHealthPage";
import PositionsPage from "./pages/PositionsPage";

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
  const showNumbers = hasPermission(user, STATISTICS_VIEW) || hasPermission(user, SUMMARY_VIEW) || hasPermission(user, BOTS_VIEW);
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
          {hasPermission(user, BOTS_VIEW) ? <NavLink to="/" end>Tổng quan</NavLink> : null}
          {hasPermission(user, BOTS_VIEW) || hasPermission(user, CREDENTIALS_VIEW) ? <p className="nav-label">Bot</p> : null}
          {hasPermission(user, BOTS_VIEW) ? <NavLink to="/bots">Danh sách</NavLink> : null}
          {hasPermission(user, CREDENTIALS_VIEW) ? <NavLink to="/user-apis">User API</NavLink> : null}
          {hasPermission(user, CONFIG_VIEW) || hasPermission(user, SIGNALS_HISTORY) ? <NavLink to="/signal-search">Signal</NavLink> : null}
          {hasPermission(user, POSITIONS_VIEW) || hasPermission(user, STATISTICS_VIEW) ? <NavLink to="/positions">Position</NavLink> : null}
          {showNumbers ? <p className="nav-label">Số liệu</p> : null}
          {hasPermission(user, STATISTICS_VIEW) ? <NavLink to="/signals">Account Static</NavLink> : null}
          {hasPermission(user, STATISTICS_VIEW) ? <NavLink to="/ledger">Lãi lỗ</NavLink> : null}
          {hasPermission(user, SUMMARY_VIEW) || hasPermission(user, BOTS_VIEW) || hasPermission(user, STATISTICS_VIEW) ? <NavLink to="/summary">Tổng kết</NavLink> : null}
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
      <Route
        path="/bots/:username/accounts/:env"
        element={
          <Protected permission={CONFIG_VIEW}>
            <Shell>
              <AccountConfigPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/summary"
        element={
          <ProtectedAny permissions={[SUMMARY_VIEW, BOTS_VIEW, STATISTICS_VIEW]}>
            <Shell>
              <SummaryPage />
            </Shell>
          </ProtectedAny>
        }
      />
      <Route
        path="/bots/:username"
        element={
          <Protected permission={BOTS_VIEW}>
            <Shell>
              <BotDetailPage />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/positions"
        element={
          <ProtectedAny permissions={[POSITIONS_VIEW, STATISTICS_VIEW]}>
            <Shell>
              <PositionsPage />
            </Shell>
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
            <Shell>
              <AccountLedgerPage />
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
  if (hasPermission(user, BOTS_VIEW)) return <DashboardPage />;
  if (hasPermission(user, SUMMARY_VIEW)) return <Navigate to="/summary" replace />;
  return <PendingPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
