import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { joinAnon } from "../../anonymized";
import SelectMenu from "../../components/SelectMenu";
import type { MonitorAdmin, RfOverview, User } from "../../types";

/** Sparklines and history charts. Lists use the server default, which is the same window. */
export const AIR_TREND_RANGE = "1h";

export type AirContext = {
  agent: MonitorAdmin;
  operate: boolean;
  refresh: boolean;
  overview: RfOverview | undefined;
  overviewLoading: boolean;
  overviewError: boolean;
};

export function scanLabel(lastScan: string | null | undefined): string {
  if (!lastScan) return "No scans yet";
  return `Last scan ${new Date(lastScan).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
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
  const refresh = params.get("refresh") !== "off";

  useEffect(() => {
    if (!agent) return;
    if (!params.has("range") && requested === agent.id) return;
    const next = new URLSearchParams(params);
    next.delete("range");
    next.set("agent", agent.id);
    setParams(next, { replace: true });
  }, [agent, requested, params, setParams]);

  const overviewQ = useQuery({
    queryKey: ["rf-overview", agent?.id],
    queryFn: () => api.rfOverview(agent.id),
    enabled: Boolean(agent),
    refetchInterval: refresh ? 15_000 : false,
  });

  if (monitorsQ.isLoading || me.isLoading) return "loading";
  if (monitorsQ.isError || me.isError) return "error";
  if (!agent || !me.data) return "empty";

  return {
    agent,
    operate: me.data.role === "admin" || me.data.role === "guest",
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
  const coarse = useCoarsePointer();

  if (state === "loading") return <div className="state-box">Loading airwaves…</div>;
  if (state === "error") return <div className="state-box">Could not load airwave data.</div>;
  if (state === "empty") return <div className="state-box">No remote agents yet.</div>;

  const { agent, overview, overviewLoading, overviewError } = state;

  function setQuery(patch: Record<string, string>) {
    const next = new URLSearchParams(params);
    next.delete("range");
    for (const [key, value] of Object.entries(patch)) next.set(key, value);
    setParams(next);
  }

  function pageHref(path: string) {
    const next = new URLSearchParams(params);
    next.delete("range");
    next.set("agent", agent.id);
    const query = next.toString();
    return query ? `${path}?${query}` : path;
  }

  const pages = [
    { path: "/airwaves", label: "Overview" },
    { path: "/airwaves/networks", label: "Nearby networks" },
    { path: "/airwaves/clients", label: "Clients" },
    { path: "/airwaves/channels", label: "Channel graph" },
  ];
  const band = params.get("band") === "5" ? "5" : "2.4";
  const place = joinAnon([agent.name, agent.location_label], " · ");

  return (
    <div className="npv airwaves">
      <header className="air-titlebar">
        <div className="air-title">
          <h1>Airwaves</h1>
        </div>
        <p className="air-sub">What's in the air around {place}</p>
      </header>
      <div className="npv-card air-controls">
        <div className="air-agent">
          <span className="air-label" id="air-agent-label">Remote agent</span>
          <div className="air-select-wrap">
            {coarse ? (
              <select
                className="air-select"
                aria-labelledby="air-agent-label"
                value={agent.id}
                onChange={(event) => setQuery({ agent: event.target.value })}
              >
                <AgentOptions />
              </select>
            ) : (
              <SelectMenu
                className="air-select"
                aria-labelledby="air-agent-label"
                value={agent.id}
                onChange={(event) => setQuery({ agent: event.target.value })}
              >
                <AgentOptions />
              </SelectMenu>
            )}
          </div>
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
        <p className="air-scan-time">{overviewLoading ? "Checking scans…" : scanLabel(overview?.last_scan_at)}</p>
      </div>
      {overviewError ? <div className="error">Could not load the latest scan.</div> : null}
      <div className="air-tabs">
        <div className="air-tab-grid" role="tablist">
          {pages.map((page) => (
            <Link
              key={page.path}
              to={pageHref(page.path)}
              className={loc.pathname === page.path ? "air-pill active" : "air-pill"}
              role="tab"
              aria-selected={loc.pathname === page.path}
            >
              {page.label}
            </Link>
          ))}
        </div>
        {loc.pathname === "/airwaves/channels" ? (
          <div className="air-band-picks" role="group" aria-label="Band">
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
      {overview?.headline ? <p className="air-headline">{overview.headline}</p> : null}
      <Outlet context={state} />
    </div>
  );
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
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
