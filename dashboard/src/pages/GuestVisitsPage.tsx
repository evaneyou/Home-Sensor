import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, type UIEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
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

type Period = { date: string; count: number };

type GuestSummary = {
  range: string;
  days: number;
  bucket: "day" | "week";
  total: number;
  previous_total: number;
  unique_addresses: number;
  previous_unique: number;
  countries: number;
  first_at: string | null;
  last_at: string | null;
  busiest: Period | null;
  by_period: Period[];
  by_country: { country: string; country_code: string; count: number; unique: number }[];
  by_city: { city: string; region: string; country: string; count: number }[];
  retention_days: number;
  located: boolean;
};

const RANGES = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "1y", label: "1 year" },
] as const;
const PAGE = 50;

/** "2026-10-14" as "Oct 14", without the time zone shifting the day. */
function dayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function place(visit: GuestVisit): string {
  return [visit.city, visit.region].filter(Boolean).join(", ");
}

/** "+12% vs previous" or "-5% vs previous", or nothing when there is no earlier data to compare. */
function change(now: number, before: number): string | undefined {
  if (before === 0) return now === 0 ? undefined : "nothing before";
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct > 0 ? "+" : ""}${pct}% vs previous`;
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
  const [params, setParams] = useSearchParams();
  const range = RANGES.find((item) => item.key === params.get("range"))?.key ?? "30d";
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const admin = me.data?.role === "admin";
  const summary = useQuery({
    queryKey: ["guest-visits-summary", range],
    queryFn: () => api.guestVisitSummary(range) as Promise<GuestSummary>,
    enabled: admin,
    placeholderData: (previous) => previous,
  });
  const list = useInfiniteQuery({
    queryKey: ["guest-visits", range],
    queryFn: ({ pageParam }) => api.guestVisits({ limit: PAGE, before: pageParam, range }) as Promise<GuestVisit[]>,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].created_at : undefined),
    enabled: admin,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const box = event.currentTarget;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 80 && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  if (me.isLoading) return <div className="state-box">Loading…</div>;
  if (!admin) return <Navigate to="/settings/onboarding" replace />;
  if (summary.isLoading || list.isLoading) return <div className="state-box">Loading guest visits…</div>;
  if (summary.isError || list.isError || !summary.data) return <div className="state-box">Could not load guest visits.</div>;

  const rows = (list.data?.pages ?? []).flat();
  const stats = summary.data;
  const top = stats.by_country[0]?.count ?? 1;
  const topCity = stats.by_city[0]?.count ?? 1;
  const series = stats.by_period.map((item) => ({ ...item, label: dayLabel(item.date) }));
  const unit = stats.bucket === "week" ? "week of" : "day";

  return (
    <div className="gv">
      <div className="gv-head">
        <div>
          <h2 className="page-title">Guest visits</h2>
          <p className="page-sub">
            Each time someone signs in as guest, the address they connected from is listed here, with where it is on the map.
            Days are in UTC. Visits are kept for {stats.retention_days === 365 ? "a year" : `${stats.retention_days} days`}, and visits from
            the Pi&apos;s own address are left out.
          </p>
        </div>
        <div className="gv-ranges" role="group" aria-label="Time range">
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={item.key === range ? "gv-range active" : "gv-range"}
              aria-pressed={item.key === range}
              onClick={() => setParams({ range: item.key }, { replace: true })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="gv-cards">
        <Card label="Sign-ins" value={String(stats.total)} note={change(stats.total, stats.previous_total)} />
        <Card label="Different addresses" value={String(stats.unique_addresses)} note={change(stats.unique_addresses, stats.previous_unique)} />
        <Card label="Countries" value={String(stats.countries)} />
        <Card
          label={stats.bucket === "week" ? "Busiest week" : "Busiest day"}
          value={stats.busiest ? String(stats.busiest.count) : "—"}
          note={stats.busiest ? `${stats.bucket === "week" ? "week of " : ""}${dayLabel(stats.busiest.date)}` : undefined}
        />
        <Card
          label="Latest sign-in"
          value={stats.last_at ? new Date(stats.last_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
          note={stats.last_at ? new Date(stats.last_at).toLocaleTimeString() : undefined}
        />
      </div>

      {stats.total === 0 ? (
        <p className="muted">No guest sign-ins in this range.</p>
      ) : (
        <>
          <div className="gv-grid">
            <section className="panel gv-panel">
              <h3>Sign-ins per {stats.bucket}</h3>
              <div className="gv-chart">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="label" stroke="var(--muted)" tick={{ fontSize: 11 }} minTickGap={16} />
                    <YAxis stroke="var(--muted)" allowDecimals={false} width={32} tick={{ fontSize: 11 }} />
                    <Tooltip
                      cursor={{ fill: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
                      labelFormatter={(label) => `${unit} ${String(label)}`}
                      formatter={(value) => [String(value), "Sign-ins"]}
                    />
                    <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel gv-panel">
              <h3>Where visitors come from</h3>
              {stats.located ? null : <p className="muted">No location database is installed yet. Run scripts/update-geoip.sh on the server.</p>}
              <ul className="gv-countries">
                {stats.by_country.slice(0, 10).map((item) => (
                  <li key={`${item.country}-${item.country_code}`}>
                    <span className="gv-code">{item.country_code || "--"}</span>
                    <span className="gv-name">{item.country}</span>
                    <span className="gv-bar">
                      <i style={{ width: `${Math.max(4, Math.round((item.count / top) * 100))}%` }} />
                    </span>
                    <span className="gv-count" title={`${item.unique} different addresses`}>
                      {item.count}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {stats.by_city.length > 0 ? (
            <section className="panel gv-panel">
              <h3>Top cities</h3>
              <ul className="gv-countries gv-cities">
                {stats.by_city.map((item) => (
                  <li key={`${item.city}-${item.region}-${item.country}`}>
                    <span className="gv-name">{[item.city, item.region].filter(Boolean).join(", ")}</span>
                    <span className="gv-sub">{item.country}</span>
                    <span className="gv-bar">
                      <i style={{ width: `${Math.max(4, Math.round((item.count / topCity) * 100))}%` }} />
                    </span>
                    <span className="gv-count">{item.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel gv-panel">
            <h3>
              Latest sign-ins <small className="muted">{rows.length} shown{hasNextPage ? ", scroll for more" : ""}</small>
            </h3>
            <div className="gv-scroll" onScroll={onScroll} tabIndex={0} role="region" aria-label="Latest sign-ins">
              <table className="table gv-table">
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
              {isFetchingNextPage ? <p className="muted gv-more">Loading more…</p> : null}
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
