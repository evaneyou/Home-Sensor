import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import IssueDetailPage from "./pages/IssueDetailPage";
import IssuesPage from "./pages/IssuesPage";
import OverviewPage from "./pages/OverviewPage";
import SensorPage from "./pages/SensorPage";
import TestPage from "./pages/TestPage";
import type { User } from "./types";

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("hns-theme");
    return saved === "light" ? "light" : "dark";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hns-theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
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
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Home Network Sensor</h1>
        <p>Sign in to view sensor health and staged test results.</p>
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

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  const links = [
    { to: "/", label: "Overview" },
    { to: "/issues", label: "Issues" },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Home Network Sensor
        </Link>
        <nav className="nav">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className={loc.pathname === l.to ? "active" : ""}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-actions">
          <span>
            {user.username} · {user.role}
          </span>
          <button className="btn" type="button" onClick={toggle}>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button className="btn" type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/sensors/:id" element={<SensorPage />} />
          <Route path="/tests/:id" element={<TestPage />} />
          <Route path="/issues" element={<IssuesPage />} />
          <Route path="/issues/:id" element={<IssueDetailPage />} />
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
      user={me.data}
      onLogout={() => {
        void api.logout().finally(() => {
          qc.setQueryData(["me"], null);
          void qc.invalidateQueries();
        });
      }}
    />
  );
}
