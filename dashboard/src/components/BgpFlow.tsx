import {
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { isAnonymized } from "../anonymized";
import { useElementWidth, useNarrow } from "../useNarrow";
import type { AsChip, PathTrace } from "./NetworkPathView";

const NODE_H = 60;
const STEP_GAP = 54;
const LANE_GAP = 92;
const TITLE_H = 30;
const PAD = 8;
const ARROW = "#4a5878";

type AsData = { item: AsChip; tag: string; origin: boolean; vertical: boolean };
type AsNode = Node<AsData, "as">;
type LaneNode = Node<{ text: string }, "lane">;

/** A network on one of the two paths. Its tag says why it has no partner on the other path. */
function AsBox({ data }: NodeProps<AsNode>) {
  const { item, tag, origin, vertical } = data;
  return (
    <div className="npf-as" style={{ ["--c" as string]: `var(--role-${item.role})` }} title={`${item.label} ${item.name}`}>
      <Handle type="target" position={vertical ? Position.Top : Position.Left} />
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
      <Handle id="across-out" type="source" position={vertical ? Position.Right : Position.Bottom} />
      <Handle id="across-in" type="target" position={vertical ? Position.Left : Position.Top} />
      <b>{item.label}</b>
      <span>{item.name}</span>
      {origin ? <i className="npf-tag origin">Origin</i> : tag ? <i className="npf-tag">{tag}</i> : null}
    </div>
  );
}

function LaneTitle({ data }: NodeProps<LaneNode>) {
  return <div className="npf-lane">{data.text}</div>;
}

const nodeTypes = { as: AsBox, lane: LaneTitle };

function sameNetwork(a: AsChip, b: AsChip): boolean {
  if (isAnonymized(a.asn) || isAnonymized(b.asn)) return Boolean(a.anon_key) && a.anon_key === b.anon_key;
  return a.asn != null && a.asn === b.asn;
}

function whyAlone(item: AsChip, side: "observed" | "announced"): string {
  if (side === "announced") return "Not seen in the trace";
  return item.type === "ixp" ? "Exchange point" : "Not in the BGP path";
}

/**
 * The traceroute's networks beside the path BGP announces, lined up so the same network sits opposite
 * itself, with a link between each pair. Rows on a wide screen, columns on a phone, where the page is
 * too narrow for rows.
 */
function Lanes({ trace, vertical, width }: { trace: PathTrace; vertical: boolean; width: number }) {
  const { nodes, edges } = useMemo(() => {
    const observed = trace.as_path_observed;
    const announced = trace.bgp.as_path_announced;
    // A column on a phone is half the width, less the room between the two; a box on a wide screen is fixed.
    const across = vertical ? Math.max(120, Math.floor((width - 2 * PAD - 44) / 2)) : 188;
    const stride = (vertical ? NODE_H : across) + STEP_GAP;
    const where = (index: number) => PAD + TITLE_H + index * stride;

    // Each announced network goes opposite the observed one it matches, and keeps the order otherwise.
    const slots: number[] = [];
    let last = -1;
    announced.forEach((item) => {
      const partner = observed.findIndex((seen) => sameNetwork(seen, item));
      let slot = partner >= 0 ? partner : last + 1;
      if (slot <= last) slot = last + 1;
      slots.push(slot);
      last = slot;
    });
    const partnerOf = (item: AsChip, others: AsChip[]) => others.findIndex((other) => sameNetwork(other, item));

    const laneStart = (lane: 0 | 1) => (vertical ? PAD + lane * (across + 44) : PAD + TITLE_H + lane * (NODE_H + LANE_GAP));
    const place = (lane: 0 | 1, index: number) =>
      vertical ? { x: laneStart(lane), y: where(index) } : { x: PAD + index * stride, y: laneStart(lane) };

    const built: (AsNode | LaneNode)[] = [];
    const wires: Edge[] = [];
    const arrow = { type: MarkerType.ArrowClosed, width: 16, height: 16, color: ARROW } as const;

    built.push({
      id: "lane-observed",
      type: "lane",
      position: vertical ? { x: laneStart(0), y: PAD } : { x: PAD, y: PAD },
      data: { text: "Observed in traceroute" },
      draggable: false,
      selectable: false,
      focusable: false,
    });
    built.push({
      id: "lane-announced",
      type: "lane",
      position: vertical ? { x: laneStart(1), y: PAD } : { x: PAD, y: laneStart(1) - TITLE_H },
      data: { text: "Announced in BGP" },
      draggable: false,
      selectable: false,
      focusable: false,
    });

    const box = (id: string, lane: 0 | 1, index: number, item: AsChip, tag: string, origin: boolean): AsNode => ({
      id,
      type: "as",
      position: place(lane, index),
      data: { item, tag, origin, vertical },
      draggable: false,
      selectable: false,
      focusable: false,
      style: { width: across, height: NODE_H },
    });

    observed.forEach((item, index) => {
      const matched = partnerOf(item, announced) >= 0;
      built.push(box(`o${index}`, 0, index, item, matched ? "" : whyAlone(item, "observed"), false));
      if (index > 0) {
        wires.push({ id: `oe${index}`, source: `o${index - 1}`, target: `o${index}`, type: "smoothstep", selectable: false, markerEnd: arrow, style: { stroke: ARROW, strokeWidth: 2 } });
      }
    });
    announced.forEach((item, index) => {
      const matched = partnerOf(item, observed) >= 0;
      const origin = isAnonymized(item.asn)
        ? Boolean(item.anon_key) && item.anon_key === trace.bgp.anon_key
        : trace.bgp.origin_asn != null && item.asn === trace.bgp.origin_asn;
      built.push(box(`a${index}`, 1, slots[index], item, matched ? "" : whyAlone(item, "announced"), origin));
      if (index > 0) {
        wires.push({ id: `ae${index}`, source: `a${index - 1}`, target: `a${index}`, type: "smoothstep", selectable: false, markerEnd: arrow, style: { stroke: ARROW, strokeWidth: 2 } });
      }
      const partner = partnerOf(item, observed);
      if (partner >= 0) {
        wires.push({
          id: `x${index}`,
          source: `o${partner}`,
          sourceHandle: "across-out",
          target: `a${index}`,
          targetHandle: "across-in",
          type: "straight",
          selectable: false,
          style: { stroke: "#6ee7a8", strokeWidth: 2, strokeDasharray: "5 5", strokeLinecap: "round" },
        });
      }
    });

    return { nodes: built, edges: wires };
  }, [trace, vertical, width]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.04, minZoom: vertical ? 0.4 : 0.5, maxZoom: 1 }}
      // Same rule as the path diagram: on a phone it is laid out to fit, and the page scrolls past it.
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag={!vertical}
      zoomOnScroll={false}
      zoomActivationKeyCode={["Control", "Meta"]}
      zoomOnPinch={!vertical}
      zoomOnDoubleClick={!vertical}
      preventScrolling={false}
      minZoom={0.4}
      maxZoom={1.6}
      colorMode="dark"
    >
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}

/** The BGP comparison as a diagram; the height it needs depends on how the lanes lay out. */
export default function BgpFlow({ trace }: { trace: PathTrace }) {
  const vertical = useNarrow();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const along = Math.max(trace.as_path_observed.length, trace.bgp.as_path_announced.length, 1);
  const height = vertical
    ? PAD + TITLE_H + along * (NODE_H + STEP_GAP) - STEP_GAP + 2 * PAD
    : PAD + TITLE_H + 2 * NODE_H + LANE_GAP + TITLE_H + 2 * PAD;
  return (
    <div ref={ref} className={`npf npf-bgp${vertical ? " is-vertical" : ""}`} style={{ height }}>
      {width > 0 ? (
        <ReactFlowProvider>
          <Lanes trace={trace} vertical={vertical} width={width} />
        </ReactFlowProvider>
      ) : null}
    </div>
  );
}
