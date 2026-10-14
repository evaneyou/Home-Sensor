import { useEffect, useMemo, useRef, useState } from "react";

type Cell = {
  id: string;
  label: string;
  edge: boolean;
  source: string;
  target: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: "rect" | "ellipse";
  fill: string;
  stroke: string;
  fontColor: string;
  fontSize: number;
  bold: boolean;
  dashed: boolean;
  dash: string;
  align: "left" | "center";
  valign: "top" | "middle";
  spacingLeft: number;
  spacingTop: number;
  rx: number;
};

type View = { x: number; y: number; w: number; h: number };

export default function LiveDiagram({
  xml,
  selectedId,
  onSelect,
  notes,
}: {
  xml: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  notes?: Record<string, string>;
}) {
  const cells = useMemo(() => parseDiagram(xml), [xml]);
  const fitted = useMemo(() => fitCells(cells), [cells]);
  const aspectRef = useRef(fitted.h / fitted.w);
  aspectRef.current = fitted.h / fitted.w;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(fitted);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; id: string | null } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = svg!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const mx = (event.clientX - rect.left) / rect.width;
      const my = (event.clientY - rect.top) / rect.height;
      setView((current) => zoomView(current, mx, my, event.deltaY < 0 ? 0.88 : 1.14, aspectRef.current));
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const target = event.target instanceof Element ? event.target.closest("[data-cell]") : null;
    svgRef.current?.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      view,
      moved: false,
      id: target?.getAttribute("data-cell") ?? null,
    };
  }

  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    const svg = svgRef.current;
    if (!active || !svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (Math.hypot(dx, dy) > 4) active.moved = true;
    if (!active.moved || rect.width === 0) return;
    setView({
      ...active.view,
      x: active.view.x - (dx / rect.width) * active.view.w,
      y: active.view.y - (dy / rect.height) * active.view.h,
    });
  }

  function pointerUp() {
    const active = drag.current;
    drag.current = null;
    if (active && !active.moved && active.id) onSelect(active.id);
  }

  const nodes = cells.filter((cell) => !cell.edge);
  const frames = nodes.filter((cell) => cell.fill === "transparent");
  const devices = nodes.filter((cell) => cell.fill !== "transparent");
  const edges = cells.filter((cell) => cell.edge);
  const byId = new Map(nodes.map((cell) => [cell.id, cell]));
  const dotted = edges.filter((edge) => edge.dashed);

  return (
    <div className="connection-live-stage">
      <div className="connection-live-zoom">
        <button type="button" onClick={() => setView((current) => zoomView(current, 0.5, 0.5, 0.88, fitted.h / fitted.w))} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => setView((current) => zoomView(current, 0.5, 0.5, 1.14, fitted.h / fitted.w))} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setView(fitted)}>
          Fit
        </button>
      </div>
      <svg
        ref={svgRef}
        className="connection-live-canvas"
        style={{ aspectRatio: `${fitted.w} / ${fitted.h}` }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="application"
        aria-label="Connection diagram. Drag to pan, scroll to zoom, and click a device for its connection."
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      >
        <defs>
          <filter id="diagram-card" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#05070d" floodOpacity="0.55" />
          </filter>
        </defs>
        <rect x={-4000} y={-4000} width={9000} height={9000} fill="#0e1320" />
        {frames.map((node) => renderNode(node, selectedId === node.id, notes))}
        {edges.map((edge) => renderEdge(edge, byId, nodes, selectedId))}
        {devices.map((node) => renderNode(node, selectedId === node.id, notes))}
        {dotted.map((edge) => renderEdge(edge, byId, nodes, selectedId, true))}
      </svg>
    </div>
  );
}

function fitCells(cells: Cell[]): View {
  const nodes = cells.filter((cell) => !cell.edge && cell.width > 0 && cell.height > 0);
  if (nodes.length === 0) return { x: 0, y: 0, w: 1280, h: 600 };
  const pad = 12;
  const minX = Math.min(...nodes.map((node) => node.x)) - pad;
  const minY = Math.min(...nodes.map((node) => node.y)) - pad;
  const maxX = Math.max(...nodes.map((node) => node.x + node.width)) + pad;
  const maxY = Math.max(...nodes.map((node) => node.y + node.height)) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function zoomView(current: View, mx: number, my: number, factor: number, aspect: number): View {
  const width = clamp(current.w * factor, 360, 2800);
  const height = width * aspect;
  const worldX = current.x + mx * current.w;
  const worldY = current.y + my * current.h;
  return { x: worldX - mx * width, y: worldY - my * height, w: width, h: height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function renderEdge(
  edge: Cell,
  byId: Map<string, Cell>,
  nodes: Cell[],
  selectedId: string | null,
  overlay = false,
) {
  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  if (!source || !target) return null;
  const from = anchor(source, target);
  const to = anchor(target, source);
  const selected = selectedId === edge.id;
  const labelAt = edge.label ? labelPoint(from, to, nodes) : null;
  return (
    <g
      key={overlay ? `${edge.id}-top` : edge.id}
      data-cell={overlay ? undefined : edge.id}
      className={selected ? "is-selected" : undefined}
      pointerEvents={overlay ? "none" : undefined}
    >
      {overlay ? null : <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth={18} />}
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={edge.stroke}
        strokeWidth={selected ? 3.5 : 1.75}
        strokeLinecap="round"
        strokeDasharray={edge.dashed ? edge.dash : undefined}
      />
      {labelAt ? (
        <>
          {/* A chip keeps the label legible where it crosses its own line. */}
          <rect
            x={labelAt.x - (edge.label.length * 3.3 + 8)}
            y={labelAt.y - 11}
            width={edge.label.length * 6.6 + 16}
            height={18}
            rx={9}
            fill="#0e1320"
            stroke={edge.stroke}
            strokeOpacity={0.35}
          />
          <text
            x={labelAt.x}
            y={labelAt.y + 2}
            textAnchor="middle"
            fill={edge.fontColor}
            fontSize={11}
            fontWeight={600}
          >
            {edge.label}
          </text>
        </>
      ) : null}
    </g>
  );
}

function renderNode(node: Cell, selected: boolean, notes: Record<string, string> | undefined) {
  const lines = [...node.label.split("\n"), notes?.[node.id] ?? ""].filter((line) => line.length > 0);
  const lineHeight = node.fontSize * 1.25;
  const block = lines.length * lineHeight;
  const textX = node.align === "left" ? node.x + node.spacingLeft : node.x + node.width / 2;
  const firstBaseline =
    node.valign === "top"
      ? node.y + node.spacingTop + node.fontSize
      : node.y + node.height / 2 - block / 2 + node.fontSize;
  return (
    <g key={node.id} data-cell={node.id} className={selected ? "is-selected" : undefined}>
      {node.shape === "ellipse" ? (
        <ellipse
          cx={node.x + node.width / 2}
          cy={node.y + node.height / 2}
          rx={node.width / 2}
          ry={node.height / 2}
          fill={node.fill}
          stroke={selected ? "#4fd1b5" : node.stroke}
          strokeWidth={selected ? 2.5 : 1.25}
          filter={node.fill === "transparent" ? undefined : "url(#diagram-card)"}
        />
      ) : (
        <rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rx={Math.max(node.rx, 10)}
          fill={node.fill}
          stroke={selected ? "#4fd1b5" : node.stroke}
          strokeWidth={selected ? 2.5 : 1.25}
          strokeDasharray={node.dashed ? node.dash : undefined}
          filter={node.fill === "transparent" ? undefined : "url(#diagram-card)"}
        />
      )}
      <text
        x={textX}
        y={firstBaseline}
        textAnchor={node.align === "left" ? "start" : "middle"}
        fill={node.fontColor}
        fontSize={node.fontSize}
        fontWeight={node.bold ? 700 : 500}
      >
        {lines.map((line, index) => (
          <tspan
            key={`${node.id}-${index}`}
            x={textX}
            dy={index === 0 ? 0 : lineHeight}
            fontWeight={index === 0 ? 700 : 500}
            fillOpacity={index === 0 ? 1 : 0.72}
          >
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function labelPoint(from: { x: number; y: number }, to: { x: number; y: number }, nodes: Cell[]): { x: number; y: number } | null {
  const boxes = nodes.filter((node) => node.fill !== "transparent");
  const samples = Array.from({ length: 19 }, (_, index) => {
    const t = (index + 1) / 20;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const covered = boxes.some(
      (node) =>
        x >= node.x - 16 &&
        x <= node.x + node.width + 16 &&
        y >= node.y - 14 &&
        y <= node.y + node.height + 8,
    );
    return { x, y, covered };
  });
  let best: { start: number; end: number } | null = null;
  let start = -1;
  for (let index = 0; index <= samples.length; index += 1) {
    const covered = index === samples.length || samples[index].covered;
    if (!covered && start < 0) start = index;
    if (covered && start >= 0) {
      if (!best || index - start > best.end - best.start) best = { start, end: index };
      start = -1;
    }
  }
  if (!best) return null;
  const sample = samples[Math.floor((best.start + best.end - 1) / 2)];
  return { x: sample.x, y: sample.y - 8 };
}

function anchor(from: Cell, to: Cell): { x: number; y: number } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = to.x + to.width / 2 - cx;
  const dy = to.y + to.height / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (from.shape === "ellipse") {
    const rx = from.width / 2;
    const ry = from.height / 2;
    const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    return { x: cx + dx * scale, y: cy + dy * scale };
  }
  const sx = from.width / 2 / Math.abs(dx);
  const sy = from.height / 2 / Math.abs(dy);
  const scale = Math.min(sx, sy);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function parseDiagram(xml: string): Cell[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) return [];
  return Array.from(doc.querySelectorAll("mxCell"))
    .map((node) => readCell(node))
    .filter((cell): cell is Cell => cell !== null);
}

function readCell(node: Element): Cell | null {
  const id = node.getAttribute("id") ?? "";
  if (!id || id === "0" || id === "1") return null;
  const style = styleMap(node.getAttribute("style") ?? "");
  const geometry = node.querySelector("mxGeometry");
  return {
    id,
    label: (node.getAttribute("value") ?? "").replace(/\r/g, ""),
    edge: node.getAttribute("edge") === "1",
    source: node.getAttribute("source") ?? "",
    target: node.getAttribute("target") ?? "",
    x: numberAttr(geometry, "x"),
    y: numberAttr(geometry, "y"),
    width: numberAttr(geometry, "width"),
    height: numberAttr(geometry, "height"),
    shape: style.ellipse ? "ellipse" : "rect",
    fill: style.fillColor && style.fillColor !== "none" ? style.fillColor : "transparent",
    stroke: style.strokeColor || "#8b93a7",
    fontColor: style.fontColor || "#e8eefc",
    fontSize: Number(style.fontSize) || 13,
    bold: style.fontStyle === "1",
    dashed: style.dashed === "1",
    dash: style.dashPattern ? style.dashPattern.replace(/ /g, ",") : "6,4",
    align: style.align === "left" ? "left" : "center",
    valign: style.verticalAlign === "top" ? "top" : "middle",
    spacingLeft: Number(style.spacingLeft) || 8,
    spacingTop: Number(style.spacingTop) || 8,
    rx: style.rounded === "1" ? 12 : 0,
  };
}

function styleMap(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq === -1) out[part] = "1";
    else out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

function numberAttr(node: Element | null, name: string): number {
  const value = Number(node?.getAttribute(name) ?? "");
  return Number.isFinite(value) ? value : 0;
}
