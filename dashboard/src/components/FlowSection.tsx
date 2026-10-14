import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  MEASURE_PORT,
  ROUTE_LABEL,
  TUNNEL_HOST,
  buildFlowTests,
  groupFlows,
  type FlowHealth,
  type FlowLatest,
  type FlowProfile,
  type FlowTest,
} from "../flowPaths";
import type { MonitorAdmin, MonitorDetail, RfOverview } from "../types";
import FlowDiagram from "./FlowDiagram";

/**
 * The same four tabs as the monitor page, applied to the flows. Web and Internet Connection split
 * the flows by what they measure (public websites, or the connection to the server); Wired and
 * Wi-Fi split them by the link they use.
 */
type View = "web" | "wired" | "wifi" | "connection";

const VIEWS: { id: View; label: string; keep: (flow: FlowTest) => boolean }[] = [
  { id: "web", label: "Web", keep: (flow) => flow.category === "web" },
  { id: "wired", label: "Wired", keep: (flow) => flow.link === "wired" },
  { id: "wifi", label: "Wi-Fi", keep: (flow) => flow.link === "wifi" },
  { id: "connection", label: "Internet Connection", keep: (flow) => flow.category !== "web" },
];

const STATUS_LABEL: Record<FlowTest["status"], string> = {
  ok: "Passing",
  degraded: "Degraded",
  fail: "Failing",
  idle: "No recent result",
};

/**
 * The network path diagram: the connection drawn with React Flow, with every flow
 * of one service animated together. The list is built from what the
 * server has switched on and what the Pi is running, so it changes when they do.
 */
export default function FlowSection({
  monitorId,
  monitor,
  agent,
}: {
  monitorId: string;
  monitor?: MonitorDetail;
  agent?: MonitorAdmin | null;
}) {
  const profilesQ = useQuery({
    queryKey: ["synthetic-profiles", monitorId],
    queryFn: () => api.syntheticProfiles(monitorId) as Promise<{ profiles: FlowProfile[] }>,
    enabled: Boolean(monitorId),
    refetchInterval: 30000,
    retry: false,
  });
  // What the monitoring radio last heard, for the box that stands for the networks around the house.
  const rfQ = useQuery({
    queryKey: ["rf-overview", monitorId],
    queryFn: () => api.rfOverview(monitorId) as Promise<RfOverview>,
    enabled: Boolean(monitorId),
    refetchInterval: 60000,
    retry: false,
  });
  // The newest figures for each application flow, which the checks table does not hold.
  const healthWired = useHealth(monitorId, "wired");
  const healthWifi = useHealth(monitorId, "wireless");
  const [view, setView] = useState<View>("connection");
  const [chosen, setChosen] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null);

  const health = useMemo<FlowHealth>(() => ({ wired: healthWired, wifi: healthWifi }), [healthWired, healthWifi]);
  const keep = (VIEWS.find((item) => item.id === view) ?? VIEWS[3]).keep;
  const groups = useMemo(
    () => groupFlows(buildFlowTests(monitor?.tests, profilesQ.data?.profiles, health).filter(keep)),
    [monitor?.tests, profilesQ.data, health, keep],
  );
  const selected = groups.find((item) => item.key === chosen) ?? groups[0] ?? null;
  // Hovering a chip isolates one flow of the group; leaving it brings the rest back.
  const shown = selected ? selected.flows.filter((flow) => only === null || flow.key === only) : [];

  return (
    <section className="flow-compare" aria-labelledby="flow-heading">
      <h2 id="flow-heading" className="flow-heading">
        Network Path Diagram
      </h2>
      <p className="page-sub">
        Pick a service to watch all of its flows at once: each leaves the Pi, reaches its destination and comes
        back. Teal is the wired link, amber is Wi-Fi. An application flow sends its payload straight across the
        internet, and its signalling, drawn dashed, through the tunnel. Hover a box for its live details, or a flow under the diagram to follow just
        that one. Zoom with the buttons, Ctrl or ⌘ and scroll, pinch or a double-click, and drag to pan.
      </p>
      <div className="tabs flow-tabs" role="group" aria-label="Which flows to show">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab${view === item.id ? " active" : ""}`}
            aria-pressed={view === item.id}
            onClick={() => {
              setView(item.id);
              setChosen(null);
              setOnly(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flow-layout">
        <nav className="flow-list" aria-label="Services running on this agent">
          {groups.length === 0 ? (
            <p className="muted">Nothing is running here for this view.</p>
          ) : (
            CATEGORY_ORDER.map((category) => {
              const inCategory = groups.filter((group) => group.category === category);
              if (inCategory.length === 0) return null;
              return (
                <div className="flow-group" key={category}>
                  <h3>{CATEGORY_LABEL[category]}</h3>
                  {inCategory.map((group) => (
                    <button
                      key={group.key}
                      type="button"
                      className={`flow-item${selected?.key === group.key ? " is-selected" : ""}`}
                      aria-pressed={selected?.key === group.key}
                      onClick={() => {
                        setChosen(group.key);
                        setOnly(null);
                      }}
                    >
                      <span className={`flow-dot status-${group.status}`} title={STATUS_LABEL[group.status]} />
                      <span className="flow-item-name">{group.name}</span>
                      <span className="flow-count">
                        {group.flows.length} {group.flows.length === 1 ? "flow" : "flows"}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </nav>
        <div className="flow-stage">
          <FlowDiagram flows={shown} monitor={monitor} agent={agent} rf={rfQ.data} />
          <div className="flow-legend" aria-hidden="true">
            <span><i className="flow-key-out" /> out to the destination</span>
            <span><i className="flow-key-back" /> back to the Pi</span>
            <span><i className="flow-key-dash" /> signalling, in the tunnel</span>
          </div>
          {selected ? (
            <ul className="flow-chips" aria-label={`Flows of ${selected.name}`}>
              {selected.flows.map((flow) => (
                <li key={flow.key}>
                  <button
                    type="button"
                    className={`flow-chip link-${flow.link}${only === flow.key ? " is-only" : ""}`}
                    onMouseEnter={() => setOnly(flow.key)}
                    onMouseLeave={() => setOnly(null)}
                    onFocus={() => setOnly(flow.key)}
                    onBlur={() => setOnly(null)}
                  >
                    <span className={`flow-dot status-${flow.status}`} title={STATUS_LABEL[flow.status]} />
                    <strong>
                      {flow.kindLabel} · {flow.link === "wired" ? "Wired" : "Wi-Fi"}
                    </strong>
                    {flow.application ? (
                      <>
                        {flow.detail ? <span className="flow-chip-detail">{flow.detail}</span> : null}
                        <span className="flow-chip-line">
                          <b>Payload</b> out the {flow.link === "wired" ? "Ethernet" : "Wi-Fi"} link and across the
                          internet, UDP {MEASURE_PORT.payload} on the server's public address
                        </span>
                        <span className="flow-chip-line">
                          <b>Signalling</b> through the {flow.link === "wired" ? "wired" : "Wi-Fi"} WireGuard tunnel,
                          TCP {MEASURE_PORT.signalling} on {TUNNEL_HOST[flow.link]}
                        </span>
                      </>
                    ) : (
                      <>
                        <span>{ROUTE_LABEL[flow.route]}</span>
                        {flow.detail ? <span className="flow-chip-detail">{flow.detail}</span> : null}
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function useHealth(monitorId: string, link: "wired" | "wireless"): FlowLatest[] | undefined {
  const query = useQuery({
    queryKey: ["synthetic-health", monitorId, link, "1h"],
    queryFn: () =>
      api.syntheticHealth(monitorId, link, "1h") as Promise<{ types: { slug: string; latest: FlowLatest["latest"] }[] }>,
    enabled: Boolean(monitorId),
    refetchInterval: 15000,
    retry: false,
  });
  return useMemo(
    () => query.data?.types.map((item) => ({ slug: item.slug, latest: item.latest })),
    [query.data],
  );
}
