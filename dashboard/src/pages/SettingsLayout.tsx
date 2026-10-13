import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet } from "react-router-dom";
import { api } from "../api";
import type { User } from "../types";

const PAGES = [
  { to: "/settings/onboarding", label: "Remote Agent Onboarding" },
  { to: "/settings/internet-service", label: "Internet Service" },
  { to: "/settings/synthetic", label: "Real-Time Application Health" },
  { to: "/settings/web-services", label: "Web Services" },
];

export default function SettingsLayout() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const pages = me.data?.role === "admin" ? [...PAGES, { to: "/settings/guest-visits", label: "Guest visits" }] : PAGES;
  return (
    <div className="settings-layout">
      <aside>
        <h1 className="page-title">Settings</h1>
        <nav className="settings-nav" aria-label="Configuration">
          {pages.map((page) => (
            <NavLink key={page.to} to={page.to}>
              {page.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="settings-content">
        <Outlet />
      </div>
    </div>
  );
}
