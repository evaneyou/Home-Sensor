import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "./api";
import IssueDetailPage from "./pages/IssueDetailPage";
import IssuesPage from "./pages/IssuesPage";
import MonitorOnboardingPage from "./pages/MonitorOnboardingPage";
import RemoteAgentPage from "./pages/RemoteAgentPage";
import OverviewPage from "./pages/OverviewPage";
import MonitorLogPage from "./pages/MonitorLogPage";
import MonitorPage from "./pages/MonitorPage";
import SettingsLayout from "./pages/SettingsLayout";
import PathPage from "./pages/PathPage";
import AirwavesLayout from "./pages/airwaves/shared";
import AirwavesOverview from "./pages/airwaves/OverviewPage";
import AirwavesNetworks from "./pages/airwaves/NetworksPage";
import AirwavesChannels from "./pages/airwaves/ChannelsPage";
import AirwavesClients from "./pages/airwaves/ClientsPage";
import InternetServicePage from "./pages/InternetServicePage";
import SyntheticPage from "./pages/SyntheticPage";
import WebServicesPage from "./pages/WebServicesPage";
import TestPage from "./pages/TestPage";
import type { User } from "./types";

function useDarkTheme() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.style.colorScheme = "dark";
    localStorage.removeItem("hns-theme");
  }, []);
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin-change-me");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => api.login(username, password) as Promise<User>,
    onSuccess: () => onSuccess(),
    onError: (e: Error) => setError(e.message || "Login failed"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <div className="login-wrap ui-compact">
      <form className="login-card" onSubmit={submit}>
        <h1>Home Network User Experience</h1>
        <p>Sign in to view remote agent health and staged test results.</p>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label htmlFor="username">Username</label>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

function LegacyMonitorRedirect({ log = false }: { log?: boolean }) {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const query = params.toString();
  const path = `/monitors/${id}${log ? "/log" : ""}`;
  return <Navigate to={query ? `${path}?${query}` : path} replace />;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useDarkTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const links = [
    { to: "/", label: "Overview" },
    { to: "/airwaves", label: "Airwaves" },
    { to: "/issues", label: "Issues" },
    { to: "/settings/onboarding", label: "Settings" },
  ];

  useEffect(() => {
    setMenuOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const showBack = loc.pathname !== "/";
  const monitorId = loc.pathname.match(/^\/monitors\/([^/]+)$/)?.[1] ?? null;
  const pathLink = params.get("link") === "wireless" ? "wireless" : params.get("link") === "wired" ? "wired" : null;
  const pathQuery = new URLSearchParams();
  if (monitorId) pathQuery.set("agent", monitorId);
  if (pathLink) pathQuery.set("link", pathLink);
  else if (monitorId) pathQuery.set("link", "wired");
  const pathTo = pathQuery.toString() ? `/path?${pathQuery.toString()}` : "/path";

  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/");
  }

  return (
      <div className={loc.pathname === "/" ? "app-shell dash-shell" : "app-shell ui-compact"}>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="HomeNetWatch">
          <img src="/homenetwatch.png" alt="HomeNetWatch" />
        </Link>
        <div className="topbar-actions">
          {showBack ? (
            <button className="btn icon-button" type="button" aria-label="Go back" onClick={goBack}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M15.5 4 8.5 12l7 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="icon-tip">Go back</span>
            </button>
          ) : null}
          {showBack ? (
            <Link className="btn icon-button" to="/" aria-label="Home">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M4 11 12 4l8 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M7 10.25V20h10V10.25"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="icon-tip">Home</span>
            </Link>
          ) : null}
          <div className="menu" ref={menuRef}>
          <button
            className="btn icon-button menu-button"
            type="button"
            aria-label="Show more"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="4.725" r="1.6" fill="currentColor" />
              <circle cx="12" cy="12" r="1.6" fill="currentColor" />
              <circle cx="12" cy="19.275" r="1.6" fill="currentColor" />
            </svg>
          </button>
          {menuOpen ? (
            <div className="menu-panel" role="menu">
              {links.map((l) => {
                const active =
                  l.to === "/"
                    ? loc.pathname === "/"
                    : l.to.startsWith("/settings")
                      ? loc.pathname.startsWith("/settings")
                      : loc.pathname.startsWith(l.to);
                return (
                  <Link key={l.to} to={l.to} role="menuitem" className={active ? "active" : ""}>
                    {l.label}
                  </Link>
                );
              })}
              <Link to={pathTo} role="menuitem" className={loc.pathname === "/path" ? "active" : ""}>
                Path View
              </Link>
              <button className="menu-item" type="button" role="menuitem" onClick={onLogout}>
                Log out
              </button>
            </div>
          ) : null}
          </div>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/path" element={<PathPage />} />
          <Route path="/airwaves" element={<AirwavesLayout />}>
            <Route index element={<AirwavesOverview />} />
            <Route path="networks" element={<AirwavesNetworks />} />
            <Route path="clients" element={<AirwavesClients />} />
            <Route path="channels" element={<AirwavesChannels />} />
          </Route>
          <Route path="/monitors/:id" element={<MonitorPage />} />
          <Route path="/monitors/:id/log" element={<MonitorLogPage />} />
          <Route path="/sensors/:id/log" element={<LegacyMonitorRedirect log />} />
          <Route path="/sensors/:id" element={<LegacyMonitorRedirect />} />
          <Route path="/tests/:id" element={<TestPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/issues/:id" element={<IssueDetailPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="onboarding" replace />} />
            <Route path="onboarding" element={<MonitorOnboardingPage />} />
            <Route path="internet-service" element={<InternetServicePage />} />
            <Route path="synthetic" element={<SyntheticPage />} />
            <Route path="web-services" element={<WebServicesPage />} />
            <Route path="agents/:id" element={<RemoteAgentPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api.me() as Promise<User>,
    retry: false,
    refetchInterval: false,
  });

  if (me.isLoading) {
    return <div className="state-box">Loading session…</div>;
  }

  if (me.isError || !me.data) {
    return (
      <Login
        onSuccess={() => {
          void qc.invalidateQueries({ queryKey: ["me"] });
        }}
      />
    );
  }

  return (
    <Shell
      onLogout={() => {
        void api.logout().finally(() => {
          qc.setQueryData(["me"], null);
          void qc.invalidateQueries();
        });
      }}
    />
  );
}
