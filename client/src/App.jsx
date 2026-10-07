import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import HomePage from "./pages/HomePage";
import BotDetailPage from "./pages/BotDetailPage";
import AccountConfigPage from "./pages/AccountConfigPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import UserApisPage from "./pages/UserApisPage";
import UserApiDetailPage from "./pages/UserApiDetailPage";
import PendingPage from "./pages/PendingPage";
import AuditLogsPage from "./pages/AuditLogsPage";
import SummaryPage from "./pages/SummaryPage";
import SignalHistoryPage from "./pages/SignalHistoryPage";

const USERS_MANAGE = "users.view";
const BOTS_VIEW = "bots.view";
const CONFIG_VIEW = "config.view";
const CREDENTIALS_VIEW = "credentials.view";
const LOGS_VIEW = "logs.view";
const SUMMARY_VIEW = "summary.view";
const SIGNALS_HISTORY = "signals.history";
const STATISTICS_VIEW = "statistics.view";

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
  const onBots = location.pathname === "/" || location.pathname.startsWith("/bots/");
  const onApis = location.pathname.startsWith("/user-apis");

  async function onLogout() {
    try {
      await logout();
    } catch (error) {
      console.error("[logout]", error);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <NavLink to="/">Web Bot</NavLink>
          <nav>
            {hasPermission(user, BOTS_VIEW) ? (
              <NavLink to="/" className={onBots ? "active" : ""}>
                Bot
              </NavLink>
            ) : null}
            {hasPermission(user, SUMMARY_VIEW) ? <NavLink to="/summary">Tổng kết</NavLink> : null}
            {hasPermission(user, SIGNALS_HISTORY) || hasPermission(user, STATISTICS_VIEW) ? <NavLink to="/signals">Signal & Static</NavLink> : null}
            {hasPermission(user, CREDENTIALS_VIEW) ? (
              <NavLink to="/user-apis" className={onApis ? "active" : ""}>
                User API
              </NavLink>
            ) : null}
            {hasPermission(user, USERS_MANAGE) ? <NavLink to="/admin/users">User</NavLink> : null}
            {hasPermission(user, LOGS_VIEW) ? <NavLink to="/logs">Lịch sử</NavLink> : null}
          </nav>
        </div>
        <div className="who">
          <span>{user?.name}</span>
          <span className="role">{user?.role}</span>
          <button type="button" className="ghost" onClick={onLogout}>
            Đăng xuất
          </button>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

function AppRoutes() {
  return (
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
          <Protected permission={SUMMARY_VIEW}>
            <Shell>
              <SummaryPage />
            </Shell>
          </Protected>
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
  );
}

function AccessHome() {
  const { user } = useAuth();
  if (hasPermission(user, BOTS_VIEW)) return <HomePage />;
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
