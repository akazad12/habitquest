import { RewardsPage, RewardForm } from "@/pages/rewards";
import { ProgressionProvider, ProgressionBar } from "@/progression";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  NavLink,
  Routes,
  Route,
  Link,
  Navigate,
  Outlet,
  useLocation,
} from "react-router-dom";
import {
  Zap,
  Sun,
  Repeat2,
  ChartNoAxesCombined,
  Gift,
  UserRound,
  ShieldCheck,
  ChevronRight,
} from "lucide-react";
import { AuthProvider, useAuth } from "@/auth";
import { AuthPage } from "@/pages/auth-page";
import { TodayPage } from "@/pages/today";
import { HabitsPage, HabitForm } from "@/pages/habits";
import { ProfilePage } from "@/pages/profile";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/forms";
import "./index.css";
const navigation = [
  { path: "/", title: "Today", icon: Sun },
  { path: "/habits", title: "Habits", icon: Repeat2 },
  { path: "/analytics", title: "Analytics", icon: ChartNoAxesCombined },
  { path: "/rewards", title: "Rewards", icon: Gift },
  { path: "/profile", title: "Profile", icon: UserRound },
];
function Shell() {
  const { user } = useAuth();
  return user ? (
    <ProgressionProvider>
      <Workspace />
    </ProgressionProvider>
  ) : (
    <Navigate to="/login" replace />
  );
}
function Workspace() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  React.useEffect(() => {
    document.getElementById("main")?.focus();
    const page = navigation.find((n) =>
      n.path === "/" ? pathname === "/" : pathname.startsWith(n.path),
    );
    document.title = `${page?.title ?? "Workspace"} · HabitQuest`;
  }, [pathname]);
  if (!user) return null;
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="HabitQuest home">
          <span>
            <Zap fill="currentColor" size={22} />
          </span>
          HabitQuest<span className="brand-dot">.</span>
        </Link>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {navigation.map(({ path, title, icon: Icon }) => (
            <NavLink end={path === "/"} key={path} to={path}>
              <Icon size={20} />
              <span>{title}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="foundation">
            <ShieldCheck size={20} />
            <strong>Built for consistency</strong>
            <p>Your next level starts with showing up.</p>
          </div>
          <Link className="guest" to="/profile">
            <span className="avatar">
              <UserRound size={20} />
            </span>
            <div>
              <strong>{user.displayName}</strong>
              <small>{user.timezone}</small>
            </div>
          </Link>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <span className="breadcrumb">
            Workspace <ChevronRight size={13} />
            HabitQuest
          </span>
          <Link className="header-account" to="/profile">
            <UserRound size={15} />
            {user.displayName}
          </Link>
        </header>
        <main id="main" tabIndex={-1}>
          <ProgressionBar />
          <Outlet />
          <footer>
            <span>Make today a step forward.</span>
            <span>HabitQuest · Build your momentum</span>
          </footer>
        </main>
      </div>
    </>
  );
}
const AnalyticsPage = React.lazy(() =>
  import("@/pages/analytics").then((module) => ({
    default: module.AnalyticsPage,
  })),
);
function App() {
  const auth = useAuth();
  if (auth.loading)
    return (
      <div className="boot-screen" role="status">
        <Zap size={32} />
        <p>Opening your workspace…</p>
      </div>
    );
  if (auth.error)
    return (
      <div className="boot-screen">
        <ErrorNotice message={auth.error} />
        <Button onClick={() => void auth.refresh()}>Try again</Button>
      </div>
    );
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage register />} />
      <Route element={<Shell />}>
        <Route index element={<TodayPage />} />
        <Route path="habits" element={<HabitsPage />} />
        <Route path="habits/new" element={<HabitForm key="new" />} />
        <Route path="habits/:id/edit" element={<HabitForm />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route
          path="analytics"
          element={
            <React.Suspense
              fallback={
                <section className="panel loading-panel" role="status">
                  Loading analytics…
                </section>
              }
            >
              <AnalyticsPage />
            </React.Suspense>
          }
        />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="rewards/new" element={<RewardForm key="new-reward" />} />
        <Route path="rewards/:id/edit" element={<RewardForm />} />
        <Route
          path="*"
          element={
            <section className="panel future">
              <h1>Page not found</h1>
              <Link to="/">Return to Today</Link>
            </section>
          }
        />
      </Route>
    </Routes>
  );
}
// Vite may reevaluate the entry after a context export invalidates Fast Refresh.
// Keep one root for that DOM node across development-only reevaluations.
const root =
  (import.meta.hot?.data.root as
    ReturnType<typeof ReactDOM.createRoot> | undefined) ??
  ReactDOM.createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
