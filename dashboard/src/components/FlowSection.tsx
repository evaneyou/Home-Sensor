import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  ROUTE_LABEL,
  buildFlowTests,
  groupFlows,
  type FlowProfile,
  type FlowTest,
} from "../flowPaths";
import type { MonitorDetail } from "../types";
import FlowDiagram from "./FlowDiagram";

const STATUS_LABEL: Record<FlowTest["status"], string> = {
  ok: "Passing",
  degraded: "Degraded",
  fail: "Failing",
  idle: "No recent result",
};

/**
 * The same connection as the draw.io page above it, drawn with React Flow, with
 * every flow of one service animated together. The list is built from what the
 * server has switched on and what the Pi is running, so it changes when they do.
 */
export default function FlowSection({ monitorId, monitor }: { monitorId: string; monitor?: MonitorDetail }) {
  const profilesQ = useQuery({
    queryKey: ["synthetic-profiles", monitorId],
    queryFn: () => api.syntheticProfiles(monitorId) as Promise<{ profiles: FlowProfile[] }>,
    enabled: Boolean(monitorId),
    refetchInterval: 30000,
    retry: false,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null);

  const groups = useMemo(
    () => groupFlows(buildFlowTests(monitor?.tests, profilesQ.data?.profiles)),
    [monitor?.tests, profilesQ.data],
  );
  const selected = groups.find((item) => item.key === chosen) ?? groups[0] ?? null;
  // Hovering a chip isolates one flow of the group; leaving it brings the rest back.
  const shown = selected ? selected.flows.filter((flow) => only === null || flow.key === only) : [];

  return (
    <section className="flow-compare" aria-labelledby="flow-heading">
      <h2 id="flow-heading" className="flow-heading">
        Animated paths <span className="flow-tag">React Flow</span>
      </h2>
      <p className="page-sub">
        Pick a service to watch all of its flows at once: each leaves the Pi, reaches its destination and comes
        back. Teal is the wired link, amber is Wi-Fi, and a dashed line is an application flow's control channel,
        which always rides the tunnel. Hover a flow under the diagram to follow just that one.
      </p>
      <div className="flow-layout">
        <nav className="flow-list" aria-label="Services running on this agent">
          {groups.length === 0 ? (
            <p className="muted">No check is switched on for this agent.</p>
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
          <FlowDiagram flows={shown} monitor={monitor} />
          <div className="flow-legend" aria-hidden="true">
            <span><i className="flow-key-out" /> out to the destination</span>
            <span><i className="flow-key-back" /> back to the Pi</span>
            <span><i className="flow-key-dash" /> control channel</span>
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
                    <span>{ROUTE_LABEL[flow.route]}</span>
                    {flow.detail ? <span className="flow-chip-detail">{flow.detail}</span> : null}
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
