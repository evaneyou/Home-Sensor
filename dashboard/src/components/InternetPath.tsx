import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import { formatChartTick, chartTicks, chartWindow, zoomedDomain } from "../chartTime";
import type { MetricsResponse, MonitorDetail } from "../types";
import { useChartZoom } from "../useChartZoom";
import StatusMark from "./StatusMark";

const RANGES = ["1h", "6h", "12h", "24h", "7d"] as const;
const STRIP_RANGES = [
  { id: "1h", label: "1h", hours: 1 },
  { id: "3h", label: "3h", hours: 3 },
  { id: "6h", label: "6h", hours: 6 },
  { id: "24h", label: "24h", hours: 24 },
] as const;

type StripRange = (typeof STRIP_RANGES)[number]["id"];
const COLORS = ["#4c9df3", "#3fa266", "#f1b467", "#e34671", "#88c0d0", "#aaa0fa"];
const ISP_SLUGS = ["http-path", "icmp-path", "mtr-path", "iperf3"] as const;

const APPS = [
  { key: "youtube", label: "YouTube" },
  { key: "google", label: "Google" },
  { key: "microsoft", label: "Microsoft" },
  { key: "hulu", label: "Hulu" },
  { key: "zoom", label: "Zoom" },
  { key: "netflix", label: "Netflix" },
  { key: "teams", label: "Microsoft Teams" },
  { key: "facebook", label: "Facebook" },
] as const;

type AppKey = (typeof APPS)[number]["key"];
type DetailKey = "isp" | AppKey;

function probeKinds(_key: AppKey): ("http" | "icmp")[] {
  return ["http", "icmp"];
}

export function isSaasProbe(slug: string): boolean {
  return APPS.some(
    (app) => slug === `http-${app.key}` || slug === `icmp-${app.key}` || slug === `mtr-${app.key}`,
  );
}

type Point = MetricsResponse["points"][number];
type TestRow = MonitorDetail["tests"][number];

function stripGradient(statuses: string[]): string {
  if (statuses.length === 0) return "var(--line)";
  const stops: string[] = [];
  let index = 0;
  while (index < statuses.length) {
    const status = statuses[index];
    let end = index + 1;
    while (end < statuses.length && statuses[end] === status) end += 1;
    const color = statusColor(status);
    const from = (index / statuses.length) * 100;
    const to = (end / statuses.length) * 100;
    stops.push(`${color} ${from}%`, `${color} ${to}%`);
    index = end;
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function statusColor(status: string): string {
  if (status === "ok") return "var(--ok)";
  if (status === "degraded") return "var(--degraded)";
  if (status === "fail") return "var(--fail)";
  if (status === "empty") return "var(--line)";
  return "var(--unknown)";
}

function ispStrip(series: Map<string, Point[]>, hours: number): string[] {
  const buckets = 96;
  const end = Date.now();
  const start = end - hours * 60 * 60 * 1000;
  const width = (end - start) / buckets;
  const tracks = [...series.values()].map((points) => trackStatuses(points, start, end, width, buckets));
  return Array.from({ length: buckets }, (_, index) => ragStatus(tracks.map((track) => track[index])));
}

function trackStatuses(
  points: Point[],
  start: number,
  end: number,
  width: number,
  buckets: number,
): (string | null)[] {
  const slots: (string | null)[] = Array.from({ length: buckets }, () => null);
  for (const point of points) {
    const time = new Date(point.t).getTime();
    if (time < start || time > end) continue;
    const index = Math.min(buckets - 1, Math.floor((time - start) / width));
    slots[index] = point.status || "unknown";
  }
  const first = slots.findIndex((status) => status);
  if (first < 0) return slots;
  let last = slots[first];
  return slots.map((status, index) => {
    if (index < first) return null;
    if (status) last = status;
    return last;
  });
}

function ragStatus(statuses: (string | null | undefined)[]): string {
  const present = statuses.filter((status) => status != null);
  if (present.length === 0) return "empty";
  if (statuses.every((status) => status === "fail")) return "fail";
  if (present.every((status) => status === "ok")) return "ok";
  if (present.some((status) => status === "fail" || status === "degraded")) return "degraded";
  if (present.some((status) => status === "ok")) return "ok";
  return "unknown";
}

function httpStages(point: Point) {
  return point.stages.filter((stage) => stage.name !== "ttfb");
}

function httpTime(point: Point | undefined): number | null {
  if (!point) return null;
  const stages = httpStages(point);
  if (stages.length > 0) {
    return Math.round(stages.reduce((sum, stage) => sum + stage.duration_ms, 0) * 10) / 10;
  }
  return point.rtt_ms;
}

function destLatency(point: Point | undefined): number | null {
  if (!point) return null;
  const lastHop = point.hops[point.hops.length - 1];
  return lastHop?.avg_ms ?? point.rtt_ms;
}

function worstHopLoss(point: Point | undefined): number | null {
  if (!point) return null;
  if (point.hops.length === 0) return point.loss_pct;
  return Math.max(...point.hops.map((hop) => hop.loss_pct));
}

function speed(point: Point | undefined): { down: number | null; up: number | null } {
  return {
    down: point?.throughput_mbps?.download ?? point?.down_mbps ?? null,
    up: point?.throughput_mbps?.upload ?? point?.up_mbps ?? null,
  };
}

function currentRag(statuses: (string | null | undefined)[]): string {
  const status = ragStatus(statuses);
  return status === "empty" ? "unknown" : status;
}

function fmt(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function isDetail(value: string | null): value is DetailKey {
  return value === "isp" || APPS.some((app) => app.key === value);
}

export function logProbeForDetail(detail: string | null): string | null {
  if (detail === "isp") return "internet";
  if (APPS.some((app) => app.key === detail)) return `svc:${detail}`;
  return null;
}

function useSeries(tests: TestRow[], range: string) {
  const queries = useQueries({
    queries: tests.map((test) => ({
      queryKey: ["metrics", test.id, range],
      queryFn: () => api.metrics(test.id, range) as Promise<MetricsResponse>,
    })),
  });
  const points = useMemo(() => {
    const map = new Map<string, Point[]>();
    queries.forEach((query, index) => {
      const slug = tests[index]?.slug;
      if (slug && query.data) map.set(slug, query.data.points);
    });
    return map;
  }, [queries, tests]);
  return {
    points,
    loading: queries.some((query) => query.isLoading),
    failed: queries.some((query) => query.isError),
  };
}

export default function InternetPath({
  tests,
  publicIp,
  isp,
}: {
  tests: MonitorDetail["tests"];
  publicIp: string | null;
  isp: string | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("detail");
  const detail = isDetail(requested) ? requested : null;
  const link = searchParams.get("link");
  const wired = tests.filter((test) => test.network_slug === "wired");
  const wireless = tests.filter((test) => test.network_slug === "wifi");
  const wan = tests.filter((test) => test.network_slug === "wan");

  function openDetail(key: DetailKey, nextLink?: string) {
    const next = new URLSearchParams(searchParams);
    next.set("detail", key);
    if (nextLink) next.set("link", nextLink);
    else next.delete("link");
    setSearchParams(next);
  }

  if (detail) {
    const pool = link === "wireless" ? wireless : link === "wired" ? wired : wan;
    return (
      <InternetDetail
        tests={pool.length > 0 ? pool : tests}
        detail={detail}
        isp={isp}
        linkLabel={link === "wired" ? "Wired" : link === "wireless" ? "Wireless" : null}
      />
    );
  }
  if (wired.length > 0 && wireless.length > 0) {
    return (
      <>
        <PerformanceDelta wired={wired} wireless={wireless} />
        <div className="link-compare">
          <section>
            <h2 className="wifi-heading">Wired</h2>
            <InternetDashboard
              tests={wired}
              publicIp={publicIp}
              isp={isp}
              onOpen={(key) => openDetail(key, "wired")}
            />
          </section>
          <section>
            <h2 className="wifi-heading">Wireless</h2>
            <InternetDashboard
              tests={wireless}
              publicIp={publicIp}
              isp={isp}
              onOpen={(key) => openDetail(key, "wireless")}
            />
          </section>
        </div>
      </>
    );
  }
  return (
    <InternetDashboard tests={wan.length > 0 ? wan : tests} publicIp={publicIp} isp={isp} onOpen={openDetail} />
  );
}

function signedDelta(wired: number | null, wireless: number | null, unit: string): string {
  if (wired == null || wireless == null || Number.isNaN(wired) || Number.isNaN(wireless)) return "—";
  const diff = wireless - wired;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)} ${unit}`;
}

function PerformanceDelta({ wired, wireless }: { wired: TestRow[]; wireless: TestRow[] }) {
  const wiredBy = useMemo(() => new Map(wired.map((test) => [test.slug, test])), [wired]);
  const wirelessBy = useMemo(() => new Map(wireless.map((test) => [test.slug, test])), [wireless]);
  const slugs = useMemo(() => {
    const names = ["http-path", "icmp-path", "iperf3"];
    for (const app of APPS) {
      names.push(`http-${app.key}`, `icmp-${app.key}`);
    }
    return names.filter((slug) => wiredBy.has(slug) && wirelessBy.has(slug));
  }, [wiredBy, wirelessBy]);
  const wiredSeries = useSeries(
    slugs.flatMap((slug) => {
      const test = wiredBy.get(slug);
      return test ? [test] : [];
    }),
    "1h",
  );
  const wirelessSeries = useSeries(
    slugs.flatMap((slug) => {
      const test = wirelessBy.get(slug);
      return test ? [test] : [];
    }),
    "1h",
  );
  const rows = slugs.map((slug) => {
    const left = (wiredSeries.points.get(slug) ?? []).at(-1);
    const right = (wirelessSeries.points.get(slug) ?? []).at(-1);
    const app = APPS.find((item) => slug === `http-${item.key}` || slug === `icmp-${item.key}`);
    const label =
      slug === "http-path"
        ? "Internet HTTP"
        : slug === "icmp-path"
          ? "Internet ICMP"
          : app
            ? `${app.label} ${slug.startsWith("http-") ? "HTTP" : "ICMP"}`
            : slug;
    if (slug === "iperf3") {
      const wiredSpeed = speed(left);
      const wirelessSpeed = speed(right);
      return {
        label: "Download",
        wired: fmt(wiredSpeed.down),
        wireless: fmt(wirelessSpeed.down),
        delta: signedDelta(wiredSpeed.down, wirelessSpeed.down, "Mbps"),
        extra: {
          label: "Upload",
          wired: fmt(wiredSpeed.up),
          wireless: fmt(wirelessSpeed.up),
          delta: signedDelta(wiredSpeed.up, wirelessSpeed.up, "Mbps"),
        },
      };
    }
    const wiredMs = slug.startsWith("http-") ? httpTime(left) : (left?.rtt_ms ?? null);
    const wirelessMs = slug.startsWith("http-") ? httpTime(right) : (right?.rtt_ms ?? null);
    return {
      label,
      wired: wiredMs == null ? "—" : fmt(wiredMs),
      wireless: wirelessMs == null ? "—" : fmt(wirelessMs),
      delta: signedDelta(wiredMs, wirelessMs, "ms"),
      extra: null,
    };
  });
  const flat = rows.flatMap((row) => (row.extra ? [row, row.extra] : [row]));

  return (
    <section className="panel link-delta">
      <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Wired compared with wireless</h2>
      <p className="muted">Delta is wireless minus wired. A positive latency means wireless is slower.</p>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Wired</th>
              <th>Wireless</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            {flat.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="mono">{row.wired}</td>
                <td className="mono">{row.wireless}</td>
                <td className="mono">{row.delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InternetDashboard({
  tests,
  publicIp,
  isp,
  onOpen,
}: {
  tests: TestRow[];
  publicIp: string | null;
  isp: string | null;
  onOpen: (key: DetailKey) => void;
}) {
  const [stripRange, setStripRange] = useState<StripRange>("1h");
  const bySlug = useMemo(() => new Map(tests.map((test) => [test.slug, test])), [tests]);
  const watched = useMemo(() => {
    return ["http-path", "icmp-path", "iperf3"].flatMap((slug) => {
      const test = bySlug.get(slug);
      return test ? [test] : [];
    });
  }, [bySlug]);
  const { points } = useSeries(watched, "1h");
  const stripTests = useMemo(() => {
    const slugs: string[] = [...ISP_SLUGS];
    for (const app of APPS) {
      for (const kind of probeKinds(app.key)) slugs.push(`${kind}-${app.key}`);
    }
    return slugs.flatMap((slug) => {
      const test = bySlug.get(slug);
      if (!test || test.enabled === false) return [];
      return [test];
    });
  }, [bySlug]);
  const { points: stripPoints } = useSeries(stripTests, stripRange);
  const stripHours = STRIP_RANGES.find((item) => item.id === stripRange)?.hours ?? 1;
  const strip = useMemo(() => {
    const series = new Map<string, Point[]>();
    for (const slug of ISP_SLUGS) {
      const test = bySlug.get(slug);
      if (!test || test.enabled === false) continue;
      series.set(slug, stripPoints.get(slug) ?? []);
    }
    return ispStrip(series, stripHours);
  }, [bySlug, stripPoints, stripHours]);
  const appStrips = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const app of APPS) {
      const series = new Map<string, Point[]>();
      for (const kind of probeKinds(app.key)) {
        const slug = `${kind}-${app.key}`;
        const test = bySlug.get(slug);
        if (!test || test.enabled === false) continue;
        series.set(slug, stripPoints.get(slug) ?? []);
      }
      map.set(app.key, ispStrip(series, stripHours));
    }
    return map;
  }, [stripPoints, stripHours]);

  const httpPoint = (points.get("http-path") ?? []).at(-1);
  const icmpPoint = (points.get("icmp-path") ?? []).at(-1);
  const speedPoint = speed((points.get("iperf3") ?? []).at(-1));
  const ispStatus = currentRag(
    ISP_SLUGS.flatMap((slug) => {
      const test = bySlug.get(slug);
      return test && test.enabled !== false ? [test.latest_status] : [];
    }),
  );

  const stripLabel = STRIP_RANGES.find((item) => item.id === stripRange)?.label ?? "1 hour";

  return (
    <>
      <div className="range-row">
        {STRIP_RANGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab ${stripRange === item.id ? "active" : ""}`}
            onClick={() => setStripRange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Internet Service</h2>
      <button className="isp-card" type="button" onClick={() => onOpen("isp")}>
        <span className="isp-card-head">
          <StatusMark status={ispStatus} />
          <span className="isp-card-title">
            <strong>{isp || "ISP"}</strong>
            <span className="mono">{publicIp || "Internet path"}</span>
          </span>
        </span>
        <span className="isp-stats">
          <span className="isp-stat">
            <em>HTTP</em>
            <strong className="mono">{fmt(httpTime(httpPoint))} ms</strong>
          </span>
          <span className="isp-stat">
            <em>ICMP</em>
            <strong className="mono">{fmt(icmpPoint?.rtt_ms)} ms</strong>
          </span>
          <span className="isp-stat">
            <em>Loss</em>
            <strong className="mono">{fmt(icmpPoint?.loss_pct)}%</strong>
          </span>
          <span className="isp-stat">
            <em>Down</em>
            <strong className="mono">{fmt(speedPoint.down)} Mbps</strong>
          </span>
          <span className="isp-stat">
            <em>Up</em>
            <strong className="mono">{fmt(speedPoint.up)} Mbps</strong>
          </span>
        </span>
        <span className="isp-strip" title={stripLabel} style={{ background: stripGradient(strip) }} />
      </button>

      <h3 className="wifi-heading">Web Services</h3>
      <div className="saas-grid">
        {APPS.map((app) => {
          const status = currentRag(
            probeKinds(app.key).flatMap((kind) => {
              const test = bySlug.get(`${kind}-${app.key}`);
              return test && test.enabled !== false ? [test.latest_status] : [];
            }),
          );
          return (
            <button key={app.key} className="saas-tile" type="button" onClick={() => onOpen(app.key)}>
              <span className="saas-tile-head">
                <strong>{app.label}</strong>
                <StatusMark status={status} />
              </span>
              <span
                className="isp-strip"
                title={stripLabel}
                style={{ background: stripGradient(appStrips.get(app.key) ?? []) }}
              />
            </button>
          );
        })}
      </div>
    </div>
    </>
  );
}

function InternetDetail({
  tests,
  detail,
  isp,
  linkLabel,
}: {
  tests: TestRow[];
  detail: DetailKey;
  isp: string | null;
  linkLabel?: string | null;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("24h");
  const bySlug = useMemo(() => new Map(tests.map((test) => [test.slug, test])), [tests]);
  const app = APPS.find((item) => item.key === detail);
  const slugs =
    detail === "isp"
      ? [...ISP_SLUGS]
      : probeKinds(detail).map((kind) => `${kind}-${detail}`);
  const watched = slugs.flatMap((slug) => {
    const test = bySlug.get(slug);
    return test ? [test] : [];
  });
  const { points, loading, failed } = useSeries(watched, range);

  const httpSlug = detail === "isp" ? "http-path" : `http-${detail}`;
  const icmpSlug = detail === "isp" ? "icmp-path" : `icmp-${detail}`;
  const mtrSlug = detail === "isp" ? "mtr-path" : `mtr-${detail}`;

  const httpChart = useMemo(() => {
    const names = new Set<string>();
    for (const point of points.get(httpSlug) ?? []) {
      for (const stage of httpStages(point)) names.add(stage.name);
    }
    const stageNames = [...names];
    const rows = (points.get(httpSlug) ?? []).map((point) => {
      const row: Record<string, string | number> = { t: point.t, ts: new Date(point.t).getTime() };
      const stages = httpStages(point);
      for (const name of stageNames) {
        row[name] = stages.find((stage) => stage.name === name)?.duration_ms ?? 0;
      }
      return row;
    });
    return { stageNames, rows };
  }, [points, httpSlug]);

  const httpLine = useMemo(
    () =>
      (points.get(httpSlug) ?? []).map((point) => ({
        t: point.t,
        ts: new Date(point.t).getTime(),
        ms: httpTime(point),
      })),
    [points, httpSlug],
  );

  const icmpChart = useMemo(
    () =>
      (points.get(icmpSlug) ?? []).map((point) => ({
        t: point.t,
        ts: new Date(point.t).getTime(),
        rtt: point.rtt_ms,
        loss: point.loss_pct,
        jitter: point.jitter_ms,
      })),
    [points, icmpSlug],
  );

  const mtrChart = useMemo(
    () =>
      (points.get(mtrSlug) ?? []).map((point) => ({
        t: point.t,
        ts: new Date(point.t).getTime(),
        latency: destLatency(point),
        loss: worstHopLoss(point),
      })),
    [points, mtrSlug],
  );

  const speedChart = useMemo(
    () =>
      (points.get("iperf3") ?? []).map((point) => {
        const sample = speed(point);
        return { t: point.t, ts: new Date(point.t).getTime(), down: sample.down, up: sample.up };
      }),
    [points],
  );

  const latestHops = (points.get(mtrSlug) ?? []).at(-1)?.hops ?? [];
  const span = chartWindow(range);

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: "1.4rem" }}>
        {linkLabel ? `${linkLabel} · ` : ""}
        {detail === "isp" ? isp || "ISP" : app?.label}
      </h2>
      <div className="range-row">
        {RANGES.map((item) => (
          <button
            key={item}
            type="button"
            className={`tab ${range === item ? "active" : ""}`}
            onClick={() => setRange(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="muted">Loading internet checks…</div>
      ) : failed ? (
        <div className="muted">Could not load internet checks.</div>
      ) : detail === "isp" ? (
        <>
          <div className="chart-pair">
            <div>
              <h3 className="wifi-heading">HTTP</h3>
              {httpChart.rows.length === 0 ? (
                <div className="muted">No samples in this range.</div>
              ) : (
                <HttpAreaChart rows={httpChart.rows} stageNames={httpChart.stageNames} span={span} />
              )}
            </div>
            <PathChart
              title="Bandwidth (iperf3)"
              data={speedChart}
              span={span}
              series={[
                { key: "down", label: "Download" },
                { key: "up", label: "Upload" },
              ]}
              unit=" Mbps"
            />
          </div>
          <div className="chart-pair">
            <PathChart title="ICMP round-trip" data={icmpChart} span={span} dataKey="rtt" label="Round-trip" unit=" ms" />
            <PathChart title="ICMP packet loss" data={icmpChart} span={span} dataKey="loss" label="Loss" unit=" %" />
          </div>
          <div className="chart-pair">
            <PathChart title="MTR destination latency" data={mtrChart} span={span} dataKey="latency" label="Destination" unit=" ms" />
            <PathChart title="MTR worst hop loss" data={mtrChart} span={span} dataKey="loss" label="Worst hop" unit=" %" />
          </div>
          <h3 className="wifi-heading">Latest MTR hops</h3>
          {latestHops.length === 0 ? (
            <div className="muted">No hop sample in this range.</div>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Hop</th>
                    <th>Host</th>
                    <th>Loss</th>
                    <th>Best</th>
                    <th>Avg</th>
                    <th>Worst</th>
                  </tr>
                </thead>
                <tbody>
                  {latestHops.map((hop) => (
                    <tr key={hop.hop}>
                      <td className="mono">{hop.hop}</td>
                      <td className="mono">{hop.host}</td>
                      <td className="mono">{fmt(hop.loss_pct)}%</td>
                      <td className="mono">{fmt(hop.best_ms)} ms</td>
                      <td className="mono">{fmt(hop.avg_ms)} ms</td>
                      <td className="mono">{fmt(hop.worst_ms)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="chart-pair">
            <PathChart title="HTTP response time" data={httpLine} span={span} dataKey="ms" label="HTTP" unit=" ms" />
            <PathChart title="ICMP round-trip" data={icmpChart} span={span} dataKey="rtt" label="Round-trip" unit=" ms" />
          </div>
          <div className="chart-pair">
            <PathChart title="ICMP packet loss" data={icmpChart} span={span} dataKey="loss" label="Loss" unit=" %" />
            <PathChart title="ICMP jitter" data={icmpChart} span={span} dataKey="jitter" label="Jitter" unit=" ms" />
          </div>
        </>
      )}
    </div>
  );
}

function HttpAreaChart({
  rows,
  stageNames,
  span,
}: {
  rows: Record<string, string | number>[];
  stageNames: string[];
  span: [number, number];
}) {
  const zoom = useChartZoom(rows);
  const domain = zoomedDomain(span, rows.length, zoom.visible as { ts?: unknown }[]);
  return (
    <div className="chart-zoom" ref={zoom.boxRef} style={{ width: "100%", height: 240 }} onDoubleClick={zoom.onDoubleClick}>
      <ResponsiveContainer>
        <AreaChart
          data={zoom.visible}
          margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
          onMouseDown={zoom.onMouseDown}
          onMouseMove={zoom.onMouseMove}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <TimeAxis domain={domain} />
          <YAxis tick={{ fontSize: 11 }} unit=" ms" width={64} />
          <Tooltip labelFormatter={(value) => formatChartTick(value, domain[1] - domain[0])} />
          {zoom.selection}
          {stageNames.map((name, index) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stackId="http"
              stroke={COLORS[index % COLORS.length]}
              fill={COLORS[index % COLORS.length]}
              fillOpacity={0.65}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TimeAxis({ domain }: { domain: [number, number] }) {
  const span = domain[1] - domain[0];
  return (
    <XAxis
      dataKey="ts"
      type="number"
      scale="time"
      domain={domain}
      allowDataOverflow
      ticks={chartTicks(domain)}
      tickFormatter={(value) => formatChartTick(value, span)}
      tick={{ fontSize: 10, fill: "var(--muted)" }}
      minTickGap={56}
      angle={-28}
      textAnchor="end"
      height={40}
    />
  );
}

function PathChart({
  title,
  data,
  span,
  dataKey,
  label,
  series,
  unit,
}: {
  title: string;
  data: Record<string, string | number | null>[];
  span: [number, number];
  dataKey?: string;
  label?: string;
  series?: { key: string; label: string }[];
  unit: string;
}) {
  const lines = series ?? (dataKey ? [{ key: dataKey, label: label ?? dataKey }] : []);
  const zoom = useChartZoom(data);
  const domain = zoomedDomain(span, data.length, zoom.visible as { ts?: unknown }[]);
  return (
    <div>
      <h3 className="wifi-heading">{title}</h3>
      {data.length === 0 ? (
        <div className="muted">No samples in this range.</div>
      ) : (
        <div className="chart-zoom" ref={zoom.boxRef} style={{ width: "100%", height: 240 }} onDoubleClick={zoom.onDoubleClick}>
          <ResponsiveContainer>
            <LineChart
              data={zoom.visible}
              margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
              onMouseDown={zoom.onMouseDown}
              onMouseMove={zoom.onMouseMove}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <TimeAxis domain={domain} />
              <YAxis tick={{ fontSize: 11 }} unit={unit} width={64} />
              <Tooltip labelFormatter={(value) => formatChartTick(value, domain[1] - domain[0])} />
              {zoom.selection}
              {lines.map((line, index) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  name={line.label}
                  stroke={COLORS[index % COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
