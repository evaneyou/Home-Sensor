import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import type { User } from "../types";

type GuestVisit = {
  created_at: string;
  address: string;
  country: string;
  country_code: string;
  region: string;
  city: string;
};

type GuestSummary = {
  total: number;
  unique_addresses: number;
  countries: number;
  first_at: string | null;
  last_at: string | null;
  by_day: { date: string; count: number }[];
  by_country: { country: string; country_code: string; count: number }[];
  located: boolean;
};

/** "2026-10-14" as "Oct 14", without the time zone shifting the day. */
function dayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function place(visit: GuestVisit): string {
  return [visit.city, visit.region].filter(Boolean).join(", ");
}

function Card({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="gv-card">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {note ? <span className="n">{note}</span> : null}
    </div>
  );
}

export default function GuestVisitsPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const admin = me.data?.role === "admin";
  const visits = useQuery({
    queryKey: ["guest-visits"],
    queryFn: () => api.guestVisits() as Promise<GuestVisit[]>,
    enabled: admin,
  });
  const summary = useQuery({
    queryKey: ["guest-visits-summary"],
    queryFn: () => api.guestVisitSummary() as Promise<GuestSummary>,
    enabled: admin,
  });

  if (me.isLoading) return <div className="state-box">Loading…</div>;
  if (!admin) return <Navigate to="/settings/onboarding" replace />;
  if (visits.isLoading || summary.isLoading) return <div className="state-box">Loading guest visits…</div>;
  if (visits.isError || summary.isError || !summary.data) return <div className="state-box">Could not load guest visits.</div>;

  const rows = visits.data ?? [];
  const stats = summary.data;
  const top = stats.by_country[0]?.count ?? 1;
  const days = stats.by_day.map((item) => ({ ...item, label: dayLabel(item.date) }));
  const busiest = stats.by_day.reduce((best, item) => (item.count > best.count ? item : best), { date: "", count: 0 });

  return (
    <div className="gv">
      <h2 className="page-title">Guest visits</h2>
      <p className="page-sub">
        Each time someone signs in as guest, the address they connected from is listed here, with where it is on the map.
        Days are in UTC.
      </p>

      <div className="gv-cards">
        <Card label="Sign-ins so far" value={String(stats.total)} note={stats.first_at ? `since ${new Date(stats.first_at).toLocaleDateString()}` : undefined} />
        <Card label="Different addresses" value={String(stats.unique_addresses)} />
        <Card label="Countries" value={String(stats.countries)} />
        <Card
          label="Latest sign-in"
          value={stats.last_at ? new Date(stats.last_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
          note={stats.last_at ? new Date(stats.last_at).toLocaleTimeString() : undefined}
        />
        <Card label="Busiest day" value={busiest.count ? String(busiest.count) : "—"} note={busiest.date ? dayLabel(busiest.date) : undefined} />
      </div>

      {stats.total === 0 ? (
        <p className="muted">No guest logins yet.</p>
      ) : (
        <>
          <div className="gv-grid">
            <section className="panel gv-panel">
              <h3>Sign-ins per day</h3>
              <div className="gv-chart">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--muted)" tick={{ fontSize: 11 }} minTickGap={16} />
                    <YAxis stroke="var(--muted)" allowDecimals={false} width={32} tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: "color-mix(in srgb, var(--accent) 12%, transparent)" }} formatter={(value) => [String(value), "Sign-ins"]} />
                    <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel gv-panel">
              <h3>Where visitors come from</h3>
              {stats.located ? null : (
                <p className="muted">No location database is installed yet. Run scripts/update-geoip.sh on the server.</p>
              )}
              <ul className="gv-countries">
                {stats.by_country.slice(0, 10).map((item) => (
                  <li key={`${item.country}-${item.country_code}`}>
                    <span className="gv-code">{item.country_code || "--"}</span>
                    <span className="gv-name">{item.country}</span>
                    <span className="gv-bar">
                      <i style={{ width: `${Math.max(4, Math.round((item.count / top) * 100))}%` }} />
                    </span>
                    <span className="gv-count">{item.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="panel gv-panel">
            <h3>Latest sign-ins</h3>
            <div className="gv-table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Country</th>
                    <th>City</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={`${row.created_at}-${row.address}-${index}`}>
                      <td>{new Date(row.created_at).toLocaleString()}</td>
                      <td>{row.country || "Unknown"}</td>
                      <td>{place(row) || "—"}</td>
                      <td className="mono">{row.address}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <p className="muted gv-credit">
        Locations are approximate. IP geolocation by <a href="https://db-ip.com" target="_blank" rel="noopener noreferrer">DB-IP</a>, licensed CC BY 4.0.
      </p>
    </div>
  );
}
