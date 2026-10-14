import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api";
import {
  ROUTE_LABEL,
  ROUTE_ORDER,
  buildFlowTests,
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
 * the path of one check animated out to its destination and back. The list is
 * built from what the server has switched on and what the Pi is running, so it
 * changes when they do.
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

  const tests = useMemo(
    () => buildFlowTests(monitor?.tests, profilesQ.data?.profiles),
    [monitor?.tests, profilesQ.data],
  );
  const selected = tests.find((item) => item.key === chosen) ?? tests[0] ?? null;

  return (
    <section className="flow-compare" aria-labelledby="flow-heading">
      <h2 id="flow-heading" className="flow-heading">
        Animated path <span className="flow-tag">React Flow</span>
      </h2>
      <p className="page-sub">
        Pick a check to watch its packets leave the Pi, reach the destination and come back. Solid teal or amber is
        the data path; dashed is an application flow's control channel, which always rides the tunnel.
      </p>
      <div className="flow-layout">
        <nav className="flow-list" aria-label="Checks running on this agent">
          {tests.length === 0 ? (
            <p className="muted">No check is switched on for this agent.</p>
          ) : (
            ROUTE_ORDER.map((route) => {
              const group = tests.filter((item) => item.route === route);
              if (group.length === 0) return null;
              return (
                <div className="flow-group" key={route}>
                  <h3>{ROUTE_LABEL[route]}</h3>
                  {group.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`flow-item${selected?.key === item.key ? " is-selected" : ""}`}
                      aria-pressed={selected?.key === item.key}
                      onClick={() => setChosen(item.key)}
                    >
                      <span className={`flow-dot status-${item.status}`} title={STATUS_LABEL[item.status]} />
                      <span className="flow-item-name">{item.name}</span>
                      <span className={`flow-link link-${item.link}`}>{item.link === "wired" ? "Wired" : "Wi-Fi"}</span>
                      {item.detail ? <span className="flow-item-detail">{item.detail}</span> : null}
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </nav>
        <div className="flow-stage">
          <FlowDiagram test={selected} monitor={monitor} />
          <div className="flow-legend" aria-hidden="true">
            <span><i className="dot-out" /> out to the destination</span>
            <span><i className="dot-back" /> back to the Pi</span>
            <span><i className="dash" /> control channel</span>
          </div>
        </div>
      </div>
    </section>
  );
}
