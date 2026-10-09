import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { ReferenceArea } from "recharts";

function timeOf(row: object): string {
  const record = row as { ts?: unknown; t?: unknown };
  const value = record.ts ?? record.t;
  return value == null ? "" : String(value);
}

function axisValue(label: string): string | number {
  const numeric = Number(label);
  return label !== "" && Number.isFinite(numeric) ? numeric : label;
}
type Bounds = { start: number; end: number };
type ChartMouse = { activeLabel?: string | number } | null;

function nextWindow(length: number, bounds: Bounds | null, ratio: number, deltaY: number): Bounds | null {
  if (length < 2) return bounds;
  const strength = Math.min(0.5, Math.abs(deltaY) / 360);
  if (strength < 0.02) return bounds;
  const start = bounds?.start ?? 0;
  const end = bounds?.end ?? length - 1;
  const span = Math.max(1, end - start);
  const minSpan = Math.min(4, length - 1);
  const factor = deltaY < 0 ? 1 - strength : 1 + strength;
  let nextSpan = Math.round(span * factor);
  if (nextSpan === span) nextSpan = deltaY < 0 ? span - 1 : span + 1;
  if (nextSpan < minSpan) nextSpan = minSpan;
  if (nextSpan >= length - 1) return null;
  const anchor = start + span * Math.min(1, Math.max(0, ratio));
  let nextStart = Math.round(anchor - nextSpan * ratio);
  let nextEnd = nextStart + nextSpan;
  if (nextStart < 0) {
    nextEnd -= nextStart;
    nextStart = 0;
  }
  if (nextEnd > length - 1) {
    nextStart -= nextEnd - (length - 1);
    nextEnd = length - 1;
  }
  nextStart = Math.max(0, nextStart);
  if (nextStart === 0 && nextEnd >= length - 1) return null;
  return { start: nextStart, end: nextEnd };
}

export function useChartZoom<T extends object>(data: T[]) {
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [drag, setDrag] = useState<{ from: string; to: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const dragRef = useRef(drag);
  dataRef.current = data;
  dragRef.current = drag;

  const signature = data.length ? `${data.length}:${timeOf(data[0])}:${timeOf(data[data.length - 1])}` : "empty";

  useEffect(() => {
    setBounds(null);
    setDrag(null);
  }, [signature]);

  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (dataRef.current.length < 2) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      setBounds((current) => nextWindow(dataRef.current.length, current, ratio, event.deltaY));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [signature]);

  useEffect(() => {
    if (!drag) return;
    const finish = () => {
      const current = dragRef.current;
      const rows = dataRef.current;
      setDrag(null);
      if (!current) return;
      const i1 = rows.findIndex((row) => timeOf(row) === current.from);
      const i2 = rows.findIndex((row) => timeOf(row) === current.to);
      if (i1 < 0 || i2 < 0) return;
      const start = Math.min(i1, i2);
      const end = Math.max(i1, i2);
      if (end - start < 2) return;
      setBounds({ start, end });
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [drag]);

  const start = bounds?.start ?? 0;
  const end = bounds?.end ?? Math.max(0, data.length - 1);

  function onMouseDown(state: ChartMouse) {
    if (state?.activeLabel == null) return;
    const label = String(state.activeLabel);
    setDrag({ from: label, to: label });
  }

  function onMouseMove(state: ChartMouse) {
    if (!dragRef.current || state?.activeLabel == null) return;
    const label = String(state.activeLabel);
    setDrag((current) => (current ? { from: current.from, to: label } : current));
  }

  function onDoubleClick(event: ReactMouseEvent) {
    event.preventDefault();
    setBounds(null);
    setDrag(null);
  }

  const selection =
    drag && drag.from !== drag.to ? (
      <ReferenceArea
        x1={axisValue(drag.from)}
        x2={axisValue(drag.to)}
        fill="var(--accent)"
        fillOpacity={0.16}
        stroke="var(--accent)"
        strokeOpacity={0.4}
      />
    ) : null;

  return {
    boxRef,
    visible: data.slice(start, end + 1),
    selection,
    onMouseDown,
    onMouseMove,
    onDoubleClick,
  };
}
