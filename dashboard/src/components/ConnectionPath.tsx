import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import {
  WIRED_TUNNEL_SERVER,
  WIRELESS_TUNNEL_SERVER,
  adapterLines,
  tunnelLabel,
} from "../connectionPath";
import type { MonitorDetail } from "../types";

type BoxData = { title: string; lines: string[] };
type BoxNode = Node<BoxData, "path">;

function PathBox({ data }: NodeProps<BoxNode>) {
  return (
    <div className="path-node">
      <Handle type="target" position={Position.Left} id="in" />
      <Handle type="source" position={Position.Right} id="out" />
      <Handle type="source" position={Position.Top} id="wired-out" />
      <Handle type="target" position={Position.Top} id="wired-in" />
      <Handle type="source" position={Position.Bottom} id="wifi-out" />
      <Handle type="target" position={Position.Bottom} id="wifi-in" />
      <strong>{data.title}</strong>
      {data.lines.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </div>
  );
}

const nodeTypes = { path: PathBox };

const labelStyle = { fill: "#e4e4e4", fontSize: 11 };
const labelBgStyle = { fill: "#181524", fillOpacity: 0.92 };

function box(id: string, x: number, title: string, lines: string[]): BoxNode {
  return {
    id,
    type: "path",
    position: { x, y: 80 },
    data: { title, lines },
    draggable: false,
    connectable: false,
    style: { width: 220 },
  };
}

export default function ConnectionPath({ monitor }: { monitor?: MonitorDetail }) {
  const nodes = useMemo<BoxNode[]>(() => {
    const name = monitor?.name || "Pi";
    return [
      box("pi", 0, name, [
        `LAN ${monitor?.lan_ip || "—"}`,
        ...adapterLines(
          monitor?.wired_iface,
          monitor?.wifi_link_iface,
          monitor?.wifi_radio_iface,
          monitor?.airwave_mode,
        ),
      ]),
      box("isp", 300, "ISP gateway", [monitor?.isp || "ISP", "Wi-Fi and broadband"]),
      box("internet", 600, "Internet", [monitor?.public_ip || "—"]),
      box("server", 900, "HomeNetWatch server", [
        `Wired tunnel ${WIRED_TUNNEL_SERVER}`,
        `Wi-Fi tunnel ${WIRELESS_TUNNEL_SERVER}`,
      ]),
    ];
  }, [monitor]);

  const edges = useMemo<Edge[]>(
    () => [
      { id: "lan", source: "pi", target: "isp", sourceHandle: "out", targetHandle: "in" },
      { id: "wan", source: "isp", target: "internet", sourceHandle: "out", targetHandle: "in" },
      { id: "cloud", source: "internet", target: "server", sourceHandle: "out", targetHandle: "in" },
      {
        id: "wired-tunnel",
        source: "pi",
        target: "server",
        sourceHandle: "wired-out",
        targetHandle: "wired-in",
        label: tunnelLabel("wired", monitor?.tunnel_address),
        labelStyle,
        labelBgStyle,
        labelBgPadding: [6, 3],
        style: { stroke: "#4c9df3" },
      },
      {
        id: "wifi-tunnel",
        source: "pi",
        target: "server",
        sourceHandle: "wifi-out",
        targetHandle: "wifi-in",
        label: tunnelLabel("wireless", monitor?.wireless_tunnel_address),
        labelStyle,
        labelBgStyle,
        labelBgPadding: [6, 3],
        style: { stroke: "#3fa266" },
      },
    ],
    [monitor?.tunnel_address, monitor?.wireless_tunnel_address],
  );

  return (
    <div className="connection-path" aria-label="Path from the Pi to the HomeNetWatch server">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        colorMode="dark"
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
