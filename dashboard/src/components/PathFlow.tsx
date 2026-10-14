import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useElementWidth } from "../useNarrow";
import type { PathGroup, PathHop, PathTrace } from "./NetworkPathView";

const NODE_WIDTH = 244;
/** Under this width the diagram runs top to bottom. */
const WIDE = 760;
const MAX_COLUMN = 460;
const BAR_MAX = 34;
const GAP_X = 100;
const GAP_Y = 64;
const PAD = 10;
/** A step this big between two networks is worth flagging. */
const BIG_STEP_MS = 15;

type GroupData = {
  group: PathGroup;
  hops: PathHop[];
  warn: number[];
  index: number;
  chosen: boolean;
  axisMax: number;
  selected: number | null;
  onSelect: (ttl: number) => void;
  onGroup: (index: number) => void;
  vertical: boolean;
};
type GroupNode = Node<GroupData, "network">;

type StepData = { delta: number | null; big: boolean };
type StepEdge = Edge<StepData, "step">;

function fmt(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function networkLabel(label: string): string {
  return label === "AS ?" ? "Unknown network" : label;
}

/** One network on the path, with the hops that belong to it. The hops stay buttons: pick one for its details. */
function NetworkNode({ data }: NodeProps<GroupNode>) {
  const { group, hops, warn, selected, onSelect, onGroup, vertical, index, chosen, axisMax } = data;
  const dashed = group.role === "unknown";
  // On a wide layout the connections leave at the header, so every link is level whatever a node's height.
  const level = vertical ? undefined : { top: 38 };
  return (
    <div
      className={`npv-group npf-node${dashed ? " dashed" : ""}${chosen ? " is-chosen" : ""}`}
      style={{ ["--c" as string]: `var(--role-${group.role})` }}
      role="button"
      tabIndex={0}
      aria-pressed={chosen}
      aria-label={`${group.name}, ${group.role_label}. Show details`}
      onClick={() => onGroup(index)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onGroup(index);
        }
      }}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} style={level} />
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} style={level} />
      <div className="npv-ghead">
        <span className="npv-asn">{networkLabel(group.asn_label)}</span>
        <div className="npv-gname">{group.name}</div>
        <div className="npv-grole">{group.role_label}</div>
      </div>
      <div className="npv-chips">
        {hops.map((hop) => (
          <button
            key={hop.ttl}
            type="button"
            className={`npv-chip nodrag nopan${hop.silent ? " silent" : ""}${warn.includes(hop.ttl) ? " warn" : ""}`}
            style={{ ["--c" as string]: `var(--role-${hop.role})` }}
            aria-pressed={selected === hop.ttl}
            aria-label={`Hop ${hop.ttl}, ${hop.name}, ${hop.silent ? "no reply" : `${fmt(hop.avg_ms)} milliseconds`}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(hop.ttl);
            }}
          >
            <span className="npf-bar-slot" aria-hidden="true">
              {hop.silent || hop.avg_ms == null ? (
                <i className="npf-bar none" />
              ) : (
                <i className="npf-bar" style={{ height: Math.max(4, Math.round((hop.avg_ms / axisMax) * BAR_MAX)) }} />
              )}
            </span>
            <span className="n">#{hop.ttl}</span>
            <span className="v">{hop.silent ? "* * *" : fmt(hop.avg_ms)}</span>
            <span className="u">{hop.silent ? "no reply" : "ms"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The link between two networks, labelled with the latency added at that handoff. */
function StepLine(props: EdgeProps<StepEdge>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data } = props;
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const delta = data?.delta ?? null;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={0}
        style={{ stroke: data?.big ? "#ffc24d" : "#4a5878", strokeWidth: 2.2, strokeLinecap: "round" }}
      />
      {[0, 0.5].map((phase) => (
        <circle key={phase} r={3.6} fill={data?.big ? "#ffc24d" : "#6ee7a8"} opacity={0.9} className="npf-dot">
          <animateMotion dur="1.8s" begin={`-${phase * 1.8}s`} repeatCount="indefinite" path={path} calcMode="linear" />
        </circle>
      ))}
      <EdgeLabelRenderer>
        <div
          className={`npf-step nodrag nopan${data?.big ? " is-big" : ""}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
        >
          {delta == null ? "?" : `${delta >= 0 ? "+" : ""}${fmt(delta)} ms`}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { network: NetworkNode };
const edgeTypes = { step: StepLine };

function Layout({
  trace,
  selected,
  onSelect,
  group: chosenGroup,
  onGroup,
  axisMax,
  vertical,
  width,
  onHeight,
}: {
  trace: PathTrace;
  selected: number | null;
  onSelect: (ttl: number) => void;
  group: number | null;
  onGroup: (index: number) => void;
  axisMax: number;
  vertical: boolean;
  width: number;
  onHeight: (height: number) => void;
}) {
  const { getNodes, setViewport, fitView } = useReactFlow();
  const ready = useNodesInitialized();
  const placed = useRef("");
  const [nodes, setNodes, onNodesChange] = useNodesState<GroupNode>([]);
  const nodeWidth = vertical ? Math.min(MAX_COLUMN, Math.max(200, width - 2 * PAD)) : NODE_WIDTH;
  const left = vertical ? Math.max(PAD, Math.round((width - nodeWidth) / 2)) : 0;
  const hopsByTtl = useMemo(() => new Map(trace.hops.map((hop) => [hop.ttl, hop])), [trace.hops]);

  // The boxes and what they say. Positions are kept, so choosing a hop does not move anything.
  useEffect(() => {
    setNodes((current) =>
      trace.groups.map((group, index): GroupNode => {
        const id = `g${index}`;
        const existing = current.find((node) => node.id === id);
        const data: GroupData = {
          group,
          hops: group.hop_ttls.map((ttl) => hopsByTtl.get(ttl)).filter((hop): hop is PathHop => Boolean(hop)),
          warn: trace.warn_ttls,
          index,
          chosen: chosenGroup === index,
          axisMax,
          selected,
          onSelect,
          onGroup,
          vertical,
        };
        return {
          ...(existing ?? { position: { x: 0, y: 0 } }),
          id,
          type: "network",
          data,
          draggable: false,
          selectable: false,
          focusable: false,
          style: { width: nodeWidth },
        };
      }),
    );
  }, [trace, hopsByTtl, selected, onSelect, chosenGroup, onGroup, axisMax, vertical, nodeWidth, setNodes]);

  const edges = useMemo<StepEdge[]>(
    () =>
      trace.groups.slice(1).map((group, index) => {
        const big = group.delta_in_ms != null && group.delta_in_ms >= BIG_STEP_MS;
        return {
          id: `s${index}`,
          type: "step",
          source: `g${index}`,
          target: `g${index + 1}`,
          selectable: false,
          focusable: false,
          markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: big ? "#ffc24d" : "#4a5878" },
          data: { delta: group.delta_in_ms, big },
        };
      }),
    [trace.groups],
  );

  // Once the boxes are measured, set them end to end, so a network with many hops gets the room it needs.
  useEffect(() => {
    const key = `${trace.traced_at}|${trace.groups.length}|${vertical}|${nodeWidth}`;
    if (!ready || placed.current === key) return;
    const measured = getNodes();
    if (measured.length === 0 || measured.some((node) => !node.measured?.height)) return;
    let cursor = 0;
    let tallest = 0;
    const next = measured.map((node) => {
      const w = node.measured?.width ?? nodeWidth;
      const h = node.measured?.height ?? 120;
      tallest = Math.max(tallest, h);
      const position = vertical ? { x: left, y: cursor + PAD } : { x: cursor, y: PAD };
      cursor += vertical ? h + GAP_Y : w + GAP_X;
      return { ...node, position };
    });
    placed.current = key;
    setNodes(next as GroupNode[]);
    if (vertical) {
      onHeight(cursor - GAP_Y + 2 * PAD);
      void setViewport({ x: 0, y: 0, zoom: 1 });
    } else {
      onHeight(tallest + 2 * PAD + 6);
      requestAnimationFrame(() => void fitView({ padding: 0.03, minZoom: 0.55, maxZoom: 1, duration: 0 }));
    }
  }, [ready, trace.traced_at, trace.groups.length, vertical, nodeWidth, left, getNodes, setNodes, setViewport, fitView, onHeight, nodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      minZoom={0.4}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      // On a phone the diagram is laid out to fit and the page scrolls past it; it must not take the touch.
      panOnDrag={!vertical}
      zoomOnScroll={false}
      zoomActivationKeyCode={["Control", "Meta"]}
      zoomOnPinch={!vertical}
      zoomOnDoubleClick={!vertical}
      preventScrolling={false}
      colorMode="dark"
    />
  );
}

/**
 * The network path as a diagram: one box per network, the hops inside it, and the latency each
 * handoff adds on the link between them. Left to right on a wide screen, top to bottom on a phone.
 */
export default function PathFlow({
  trace,
  selected,
  onSelect,
  group,
  onGroup,
}: {
  trace: PathTrace;
  selected: number | null;
  onSelect: (ttl: number) => void;
  group: number | null;
  onGroup: (index: number) => void;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const vertical = width > 0 && width < WIDE;
  const slowest = Math.max(0, ...trace.hops.map((hop) => (hop.silent ? 0 : (hop.avg_ms ?? 0))));
  const axisMax = Math.max(15, Math.ceil(slowest / 15) * 15);
  const [height, setHeight] = useState(vertical ? 420 : 280);
  const onHeight = useCallback((next: number) => setHeight(Math.ceil(next)), []);
  return (
    <div ref={ref} className={`npf${vertical ? " is-vertical" : ""}`} style={{ height }}>
      {width > 0 ? (
        <ReactFlowProvider>
          <Layout trace={trace} selected={selected} onSelect={onSelect} group={group} onGroup={onGroup} axisMax={axisMax} vertical={vertical} width={width} onHeight={onHeight} />
        </ReactFlowProvider>
      ) : null}
    </div>
  );
}
