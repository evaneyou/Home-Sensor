/** Axis label. Short windows keep the minutes; longer windows use the hour. */
export function formatChartTick(value: unknown, spanMs = Number.POSITIVE_INFINITY): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (spanMs <= 3 * 60 * 60 * 1000) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  date.setMinutes(0, 0, 0);
  return date.toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
  });
}

export function formatChartHour(value: unknown): string {
  return formatChartTick(value);
}

/** Even ticks inside a one-hour window so the labels are not all the same hour. */
export function chartTicks(domain: [number, number]): number[] | undefined {
  const span = domain[1] - domain[0];
  if (span <= 0 || span > 60 * 60 * 1000) return undefined;
  const step = 10 * 60 * 1000;
  const start = Math.ceil(domain[0] / step) * step;
  const ticks: number[] = [];
  for (let time = start; time <= domain[1]; time += step) ticks.push(time);
  return ticks.length > 0 ? ticks : undefined;
}

const RANGE_HOURS: Record<string, number> = {
  "1h": 1,
  "3h": 3,
  "6h": 6,
  "8h": 8,
  "12h": 12,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

/** Start and end of the selected chart window, in epoch milliseconds. */
export function chartWindow(range: string, now = Date.now()): [number, number] {
  const hours = RANGE_HOURS[range] ?? 1;
  return [now - hours * 60 * 60 * 1000, now];
}

/** Keep the full window until the user zooms into a subset of samples. */
export function zoomedDomain(
  full: [number, number],
  dataLength: number,
  visible: { ts?: unknown }[],
): [number, number] {
  if (visible.length > 1 && visible.length < dataLength) {
    const start = Number(visible[0]?.ts);
    const end = Number(visible[visible.length - 1]?.ts);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return [start, end];
  }
  return full;
}
