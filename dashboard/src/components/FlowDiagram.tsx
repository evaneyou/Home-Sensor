import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  NodeToolbar,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { EDGE_IDS, NODE, edgeId, hostOf, pathsFor, type FlowLink, type FlowTest } from "../flowPaths";
import type { MonitorAdmin, MonitorDetail } from "../types";

type Tone = "wired" | "wifi" | "neutral";
type Fact = [label: string, value: string];
type Through = { flow: FlowTest; role: "data" | "control" };
type NodeInfo = {
  facts: Fact[];
  through: Through[];
  side: Position.Top | Position.Bottom;
  align: "start" | "center" | "end";
};
type FlowNodeData = { title: string; lines: string[]; tone: Tone; active: boolean; dim: boolean; info: NodeInfo };
type FlowNodeType = Node<FlowNodeData, "box">;

type Pulse = { hop: number; hops: number; role: "data" | "control"; color: string; offset: number };
type RouteEdgeData = { label: string; pulses: Pulse[]; dim: boolean };
type RouteEdgeType = Edge<RouteEdgeData, "route">;

const COLOR: Record<FlowLink, string> = { wired: "#4fd1b5", wifi: "#ffc24d" };
const QUIET = "#2a3550";
const SHARED = "#8fa3d1";
const RETURN_COLOR = "#e8ecf8";

/** One hop's pulse crosses its edge in this long; the cycle is out, back, then a rest. */
const STEP = 0.55;
const REST = 0.9;

const STATUS_LABEL: Record<FlowTest["status"], string> = {
  ok: "Passing",
  degraded: "Degraded",
  fail: "Failing",
  idle: "No recent result",
};

function PathBox({ data }: NodeProps<FlowNodeType>) {
  const [open, setOpen] = useState(false);
  const classes = ["flow-node", `tone-${data.tone}`, data.active ? "is-active" : "", data.dim ? "is-dim" : ""]
    .filter(Boolean)
    .join(" ");
  const { facts, through, side, align } = data.info;
  return (
    <div
      className={classes}
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <strong>{data.title}</strong>
      {data.lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
      <NodeToolbar isVisible={open} position={side} align={align} offset={12}>
        <div className="flow-tip" role="tooltip">
          <h4>{data.title}</h4>
          {facts.length > 0 ? (
            <dl>
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {through.length > 0 ? (
            <>
              <h5>Flows through here</h5>
              <ul>
                {through.map(({ flow, role }) => (
                  <li key={`${flow.key}:${role}`}>
                    <span className={`flow-dot status-${flow.status}`} title={STATUS_LABEL[flow.status]} />
                    <strong>
                      {flow.kindLabel} · {flow.link === "wired" ? "Wired" : "Wi-Fi"}
                      {role === "control" ? " (control)" : ""}
                    </strong>
                    <span>
                      {[flow.route === "web" ? hostOf(flow.target) : "", flow.detail].filter(Boolean).join(" · ") ||
                        STATUS_LABEL[flow.status]}
                    </span>
                    {flow.status === "degraded" || flow.status === "fail" ? (
                      <em>{flow.reason ?? STATUS_LABEL[flow.status]}</em>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>Nothing in the selected service passes through here.</p>
          )}
        </div>
      </NodeToolbar>
    </div>
  );
}

function fractions(value: number): string {
  return value.toFixed(4);
}

/** A dot that rides the edge during its own slice of the cycle, and is hidden the rest of it. */
function Dot({
  path,
  color,
  radius,
  from,
  to,
  window,
  total,
  offset,
}: {
  path: string;
  color: string;
  radius: number;
  from: number;
  to: number;
  window: [number, number];
  total: number;
  offset: number;
}) {
  const a = window[0] / total;
  const b = window[1] / total;
  const times = `0;${fractions(a)};${fractions(b)};1`;
  return (
    <circle r={radius} fill={color} opacity={0}>
      <animateMotion
        dur={`${total}s`}
        begin={`-${offset.toFixed(3)}s`}
        repeatCount="indefinite"
        path={path}
        calcMode="linear"
        keyPoints={`${from};${from};${to};${to}`}
        keyTimes={times}
      />
      <animate
        attributeName="opacity"
        dur={`${total}s`}
        begin={`-${offset.toFixed(3)}s`}
        repeatCount="indefinite"
        calcMode="discrete"
        values="0;1;0"
        keyTimes={`0;${fractions(a)};${fractions(b)}`}
      />
    </circle>
  );
}

function Pulses({ path, pulses }: { path: string; pulses: Pulse[] }) {
  return (
    <>
      {pulses.map((pulse, index) => {
        const total = pulse.hops * 2 * STEP + REST;
        const out = pulse.hop * STEP;
        const back = (pulse.hops + (pulse.hops - 1 - pulse.hop)) * STEP;
        const radius = pulse.role === "data" ? 4.5 : 2.75;
        const tint = pulse.role === "data" ? pulse.color : `${pulse.color}aa`;
        return (
          <g key={index}>
            <Dot path={path} color={tint} radius={radius} from={0} to={1} window={[out, out + STEP]} total={total} offset={pulse.offset} />
            <Dot
              path={path}
              color={pulse.role === "data" ? RETURN_COLOR : `${RETURN_COLOR}88`}
              radius={radius}
              from={1}
              to={0}
              window={[back, back + STEP]}
              total={total}
              offset={pulse.offset}
            />
          </g>
        );
      })}
    </>
  );
}

function RouteEdge(props: EdgeProps<RouteEdgeType>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const pulses = data?.pulses ?? [];
  const active = pulses.length > 0;
  const controlOnly = active && pulses.every((pulse) => pulse.role === "control");
  const colors = new Set(pulses.map((pulse) => pulse.color));
  const color = colors.size === 1 ? [...colors][0] : SHARED;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: active ? color : QUIET,
          strokeWidth: active ? 2.5 : 1.5,
          strokeLinecap: "round",
          strokeDasharray: controlOnly ? "5 5" : undefined,
          opacity: active || !data?.dim ? 1 : 0.45,
        }}
      />
      {active ? <Pulses path={path} pulses={pulses} /> : null}
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className={`flow-edge-label nodrag nopan${active ? " is-active" : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const nodeTypes = { box: PathBox };
const edgeTypes = { route: RouteEdge };

const EDGE_LABEL: Record<string, string> = {
  [edgeId(NODE.piWired, NODE.router)]: "Ethernet",
  [edgeId(NODE.piWifi, NODE.router)]: "Wi-Fi",
  [edgeId(NODE.router, NODE.internet)]: "ISP",
  [edgeId(NODE.internet, NODE.serverDirect)]: "Public address",
  [edgeId(NODE.internet, NODE.tunnelWired)]: "Tunnel 1",
  [edgeId(NODE.internet, NODE.tunnelWifi)]: "Tunnel 2",
};

type Spec = { id: string; x: number; y: number; tone: Tone; title: string; lines: string[] };

function specs(monitor: MonitorDetail | undefined): Spec[] {
  const name = monitor?.name || "Pi";
  const clean = (lines: (string | null | undefined)[]) => lines.filter((line): line is string => Boolean(line));
  return [
    {
      id: NODE.piWired,
      x: 0,
      y: 10,
      tone: "wired",
      title: `${name} · Wired`,
      lines: clean([monitor?.wired_iface ? `Ethernet ${monitor.wired_iface}` : "Ethernet", monitor?.tunnel_address]),
    },
    {
      id: NODE.piWifi,
      x: 0,
      y: 230,
      tone: "wifi",
      title: `${name} · Wi-Fi`,
      lines: clean([
        monitor?.wifi_link_iface ? `Wi-Fi client ${monitor.wifi_link_iface}` : "Wi-Fi client",
        monitor?.wireless_tunnel_address,
      ]),
    },
    { id: NODE.router, x: 250, y: 120, tone: "neutral", title: "Home router", lines: ["LAN switch and Wi-Fi access point"] },
    {
      id: NODE.internet,
      x: 500,
      y: 120,
      tone: "neutral",
      title: "Internet",
      lines: clean([monitor?.isp ?? "ISP", monitor?.public_ip]),
    },
    { id: NODE.web, x: 750, y: -20, tone: "neutral", title: "Web services", lines: ["Public sites", "Not through a tunnel"] },
    {
      id: NODE.serverDirect,
      x: 750,
      y: 105,
      tone: "neutral",
      title: "Server · public address",
      lines: ["Application flows and traces"],
    },
    { id: NODE.tunnelWired, x: 750, y: 235, tone: "wired", title: "WireGuard · wired", lines: ["10.7.0.1 · UDP 51820"] },
    { id: NODE.tunnelWifi, x: 750, y: 345, tone: "wifi", title: "WireGuard · Wi-Fi", lines: ["10.7.1.1 · UDP 51821"] },
    { id: NODE.services, x: 1000, y: 290, tone: "neutral", title: "Server services", lines: ["API and File Transfer", "Inside the tunnel"] },
  ];
}

const TUNNEL_STATE: Record<string, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  never_connected: "Not connected yet",
};

function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "";
}

/** What is known about one hop, whatever flows pass through it. */
function factsFor(id: string, monitor: MonitorDetail | undefined, agent: MonitorAdmin | null | undefined, flows: FlowTest[]): Fact[] {
  const facts: Fact[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value) facts.push([label, value]);
  };
  // The agent works its "LAN IP" out from the route to the server, which now runs through the
  // tunnel, so it can report the tunnel address. Showing that as a LAN address would be wrong.
  const reported = agent?.lan_ip ?? monitor?.lan_ip;
  const lan = reported && reported !== monitor?.tunnel_address && reported !== monitor?.wireless_tunnel_address ? reported : null;
  switch (id) {
    case NODE.piWired:
      add("Status", monitor?.status);
      add("Last seen", when(monitor?.last_seen_at));
      add("Adapter", monitor?.wired_iface);
      add("LAN address", lan);
      add("Tunnel address", monitor?.tunnel_address);
      add("Tunnel", agent?.tunnel_state ? (TUNNEL_STATE[agent.tunnel_state] ?? agent.tunnel_state) : "");
      add("Last handshake", when(agent?.last_handshake_at));
      add("Agent version", agent?.agent_version);
      break;
    case NODE.piWifi:
      add("Wi-Fi client", monitor?.wifi_link_iface);
      add("Monitor radio", monitor?.wifi_radio_iface);
      add("Tunnel address", monitor?.wireless_tunnel_address);
      add(
        "Tunnel",
        agent?.wireless_tunnel_state ? (TUNNEL_STATE[agent.wireless_tunnel_state] ?? agent.wireless_tunnel_state) : "",
      );
      break;
    case NODE.router:
      add("ISP", monitor?.isp);
      add("Pi LAN address", lan);
      add("Carries", "Ethernet and Wi-Fi");
      break;
    case NODE.internet:
      add("ISP", monitor?.isp);
      add("Public address", monitor?.public_ip);
      break;
    case NODE.web: {
      const hosts = [...new Set(flows.filter((flow) => flow.route === "web").map((flow) => hostOf(flow.target)))];
      add("Destination", hosts.join(", "));
      add("Through a tunnel", "No");
      break;
    }
    case NODE.serverDirect:
      add("Reached by", "Application flows and MTR");
      add("Through a tunnel", "No: the server's public address");
      break;
    case NODE.tunnelWired:
      add("Address", "10.7.0.1 · UDP 51820");
      add("Tunnel", agent?.tunnel_state ? (TUNNEL_STATE[agent.tunnel_state] ?? agent.tunnel_state) : "");
      add("Last handshake", when(agent?.last_handshake_at));
      break;
    case NODE.tunnelWifi:
      add("Address", "10.7.1.1 · UDP 51821");
      add(
        "Tunnel",
        agent?.wireless_tunnel_state ? (TUNNEL_STATE[agent.wireless_tunnel_state] ?? agent.wireless_tunnel_state) : "",
      );
      break;
    case NODE.services:
      add("Serves", "API and File Transfer");
      add("Reached", "Only inside a tunnel");
      break;
  }
  return facts;
}

export default function FlowDiagram({
  flows,
  monitor,
  agent,
}: {
  flows: FlowTest[];
  monitor?: MonitorDetail;
  agent?: MonitorAdmin | null;
}) {
  const { nodes, edges } = useMemo(() => {
    const active = flows.length > 0;
    const lit = new Set<string>();
    const pulses = new Map<string, Pulse[]>();
    const through = new Map<string, Through[]>();
    flows.forEach((flow, index) => {
      for (const path of pathsFor(flow)) {
        path.nodes.forEach((node) => {
          lit.add(node);
          through.set(node, [...(through.get(node) ?? []), { flow, role: path.role }]);
        });
        const hops = path.nodes.length - 1;
        // Spread the flows evenly through the cycle so those that share a hop do not overlap.
        const offset = (index / flows.length) * (hops * 2 * STEP + REST);
        for (let hop = 0; hop < hops; hop += 1) {
          const id = edgeId(path.nodes[hop], path.nodes[hop + 1]);
          pulses.set(id, [...(pulses.get(id) ?? []), { hop, hops, role: path.role, color: COLOR[flow.link], offset }]);
        }
      }
    });
    const built: FlowNodeType[] = specs(monitor).map((spec) => ({
      id: spec.id,
      type: "box",
      position: { x: spec.x, y: spec.y },
      data: { title: spec.title, lines: spec.lines, tone: spec.tone, active: lit.has(spec.id), dim: active && !lit.has(spec.id),
        // The top row opens its card downwards so it is not cut off by the edge of the canvas.
        info: {
          facts: factsFor(spec.id, monitor, agent, flows),
          through: through.get(spec.id) ?? [],
          side: spec.y < 150 ? Position.Bottom : Position.Top,
          // The outer columns open their card inwards, so it is not cut off by the side of the canvas.
          align: spec.x === 0 ? "start" : spec.x >= 750 ? "end" : "center",
        },
      },
      draggable: false,
      connectable: false,
      selectable: false,
      style: { width: 190 },
    }));
    const wires: RouteEdgeType[] = EDGE_IDS.map((id) => {
      const [source, target] = id.split(">");
      return {
        id,
        type: "route",
        source,
        target,
        selectable: false,
        data: { label: EDGE_LABEL[id] ?? "", pulses: pulses.get(id) ?? [], dim: active },
      };
    });
    return { nodes: built, edges: wires };
  }, [flows, monitor, agent]);

  return (
    <div className="flow-canvas" aria-label="Animated paths of the selected service">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.35}
        maxZoom={2.5}
        // A plain wheel scrolls the page; zooming takes Ctrl or Cmd so the diagram never traps it.
        zoomOnScroll={false}
        zoomActivationKeyCode={["Control", "Meta"]}
        zoomOnPinch
        zoomOnDoubleClick
        panOnDrag
        preventScrolling={false}
        colorMode="dark"
      >
        <Background gap={24} size={1} color="#1a2238" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
}
