import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import SelectMenu from "../../components/SelectMenu";
import type { MonitorAdmin, RfOverview, User } from "../../types";

export const RANGES = ["1h", "6h", "24h", "7d"] as const;
export type AirRange = (typeof RANGES)[number];

export type AirContext = {
  agent: MonitorAdmin;
  range: AirRange;
  admin: boolean;
  refresh: boolean;
  overview: RfOverview | undefined;
  overviewLoading: boolean;
  overviewError: boolean;
};

const STALE_MS = 15 * 60 * 1000;

export function isStale(lastScan: string | null | undefined): boolean {
  if (!lastScan) return false;
  return Date.now() - new Date(lastScan).getTime() > STALE_MS;
}

export function scanLabel(lastScan: string | null | undefined): string {
  if (!lastScan) return "No scans yet";
  return `Last scan ${new Date(lastScan).toLocaleString()}`;
}

export function useAirwaves(): AirContext | "loading" | "error" | "empty" {
  const [params, setParams] = useSearchParams();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const monitorsQ = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api.monitors() as Promise<MonitorAdmin[]>,
  });
  const monitors = monitorsQ.data ?? [];
  const requested = params.get("agent");
  const agent = monitors.find((item) => item.id === requested) ?? monitors[0];
  const rangeParam = params.get("range");
  const range: AirRange = RANGES.includes(rangeParam as AirRange) ? (rangeParam as AirRange) : "24h";
  const refresh = params.get("refresh") !== "off";

  useEffect(() => {
    if (!agent || requested === agent.id) return;
    const next = new URLSearchParams(params);
    next.set("agent", agent.id);
    setParams(next, { replace: true });
  }, [agent, requested, params, setParams]);

  const overviewQ = useQuery({
    queryKey: ["rf-overview", agent?.id, range],
    queryFn: () => api.rfOverview(agent.id, range),
    enabled: Boolean(agent),
    refetchInterval: refresh ? 15_000 : false,
  });

  if (monitorsQ.isLoading || me.isLoading) return "loading";
  if (monitorsQ.isError || me.isError) return "error";
  if (!agent || !me.data) return "empty";

  return {
    agent,
    range,
    admin: me.data.role === "admin",
    refresh,
    overview: overviewQ.data,
    overviewLoading: overviewQ.isLoading,
    overviewError: overviewQ.isError,
  };
}

export default function AirwavesLayout() {
  const state = useAirwaves();
  const [params, setParams] = useSearchParams();
  const loc = useLocation();

  if (state === "loading") return <div className="state-box">Loading airwaves…</div>;
  if (state === "error") return <div className="state-box">Could not load airwave data.</div>;
  if (state === "empty") return <div className="state-box">No remote agents yet.</div>;

  const { agent, range, overview, overviewLoading, overviewError } = state;

  function setQuery(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) next.set(key, value);
    setParams(next);
  }

  function pageHref(path: string) {
    const next = new URLSearchParams(params);
    next.set("agent", agent.id);
    next.set("range", range);
    return `${path}?${next.toString()}`;
  }

  const pages = [
    { path: "/airwaves", label: "Overview" },
    { path: "/airwaves/networks", label: "Nearby networks" },
    { path: "/airwaves/clients", label: "Clients" },
    { path: "/airwaves/channels", label: "Channel graph" },
  ];
  const band = params.get("band") === "5" ? "5" : "2.4";
  const place = [agent.name, agent.location_label].filter(Boolean).join(" · ");

  return (
    <div className="npv airwaves">
      <div className="npv-titlebar">
        <div className="air-brand">
          <div className="air-mark" aria-hidden="true">
            <WaveIcon />
          </div>
          <div>
            <h1>Airwaves</h1>
            <p className="npv-sub">What's in the air around {place}</p>
          </div>
        </div>
        <div className={overview?.last_scan_at ? "npv-agent" : "npv-agent offline"}>
          <span className="npv-dot" />
          <span>{overviewLoading ? "Checking scans…" : scanLabel(overview?.last_scan_at)}</span>
        </div>
      </div>
      <div className="npv-card air-controls">
        <div className="air-agent">
          <span id="air-agent-label">Remote Agent</span>
          <div className="air-select-wrap">
            <SelectMenu
              className="air-select"
              aria-labelledby="air-agent-label"
              value={agent.id}
              onChange={(event) => setQuery({ agent: event.target.value })}
            >
              <AgentOptions />
            </SelectMenu>
          </div>
        </div>
        <div className="air-pills" role="group" aria-label="Time range">
          {RANGES.map((item) => (
            <button
              key={item}
              className={item === range ? "air-pill active" : "air-pill"}
              type="button"
              onClick={() => setQuery({ range: item })}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="air-live">
          <button
            className={state.refresh ? "air-switch on" : "air-switch"}
            type="button"
            aria-label="Refresh every 15 seconds"
            aria-pressed={state.refresh}
            onClick={() => setQuery({ refresh: state.refresh ? "off" : "on" })}
          >
            <i />
          </button>
          <span>Refresh every 15 s</span>
        </div>
      </div>
      {overviewError ? <div className="error">Could not load the latest scan.</div> : null}
      {isStale(overview?.last_scan_at) ? <div className="air-stale">The last scan is more than 15 minutes old.</div> : null}
      <div className="air-tabs">
        <div className="air-pills" role="tablist">
          {pages.map((page) => (
            <Link
              key={page.path}
              to={pageHref(page.path)}
              className={loc.pathname === page.path ? "air-pill active" : "air-pill"}
              role="tab"
            >
              {page.label}
            </Link>
          ))}
        </div>
        {loc.pathname === "/airwaves/channels" ? (
          <div className="air-pills" role="group" aria-label="Band">
            {["2.4", "5"].map((item) => (
              <button
                key={item}
                className={band === item ? "air-pill active" : "air-pill"}
                type="button"
                onClick={() => setQuery({ band: item })}
              >
                {item} GHz
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Outlet context={state} />
    </div>
  );
}

function WaveIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0" />
    </svg>
  );
}

function AgentOptions() {
  const monitorsQ = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api.monitors() as Promise<MonitorAdmin[]>,
  });
  return (
    <>
      {(monitorsQ.data ?? []).map((monitor) => (
        <option key={monitor.id} value={monitor.id}>
          {monitor.name}
        </option>
      ))}
    </>
  );
}
