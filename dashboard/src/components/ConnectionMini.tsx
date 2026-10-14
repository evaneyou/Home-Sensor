import { Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type MiniData = { title: string; tone: "wired" | "wifi" | "neutral"; shape?: "ellipse" };
type MiniNode = Node<MiniData, "mini">;

function MiniBox({ data }: NodeProps<MiniNode>) {
  return (
    <div className={`flow-node mini-node tone-${data.tone}${data.shape === "ellipse" ? " is-ellipse" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <strong>{data.title}</strong>
    </div>
  );
}

const nodeTypes = { mini: MiniBox };

const node = (id: string, x: number, y: number, width: number, data: MiniData): MiniNode => ({
  id,
  type: "mini",
  position: { x, y },
  data,
  draggable: false,
  connectable: false,
  selectable: false,
  focusable: false,
  style: { width },
});

/** Teal is the wired link and amber is Wi-Fi, as everywhere else; the neutral hops are grey. */
const line = (id: string, source: string, target: string, stroke: string, dashed = false): Edge => ({
  id,
  source,
  target,
  selectable: false,
  focusable: false,
  style: { stroke, strokeWidth: 2, strokeLinecap: "round", strokeDasharray: dashed ? "6 5" : undefined },
});

const NODES: MiniNode[] = [
  node("home", 0, 38, 130, { title: "Home", tone: "neutral" }),
  node("wired", 230, 0, 130, { title: "Wired", tone: "wired" }),
  node("wifi", 230, 90, 130, { title: "Wi-Fi", tone: "wifi" }),
  node("internet", 460, 28, 140, { title: "Internet", tone: "neutral", shape: "ellipse" }),
  node("server", 700, 38, 140, { title: "Server", tone: "wired" }),
];

const EDGES: Edge[] = [
  line("home-wired", "home", "wired", "#4fd1b5"),
  line("home-wifi", "home", "wifi", "#ffc24d", true),
  line("wired-internet", "wired", "internet", "#4fd1b5", true),
  line("wifi-internet", "wifi", "internet", "#ffc24d", true),
  line("internet-server", "internet", "server", "#6d7895"),
];

/**
 * The overview on the Internet Connection page: home, the two links, the internet and the
 * server. It is a picture, not a control, so nothing in it moves, zooms or takes the pointer;
 * the link that wraps it opens the full diagram.
 */
export default function ConnectionMini() {
  return (
    <div className="connection-mini" aria-hidden="true">
      <ReactFlow
        nodes={NODES}
        edges={EDGES}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.08 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        colorMode="dark"
      />
    </div>
  );
}
