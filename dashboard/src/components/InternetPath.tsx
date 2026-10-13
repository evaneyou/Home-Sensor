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
import { CHART_COLORS } from "../chartTheme";
import { formatChartTick, chartTicks, chartWindow, zoomedDomain } from "../chartTime";
import type { MetricsResponse, MonitorDetail } from "../types";
import { useChartZoom } from "../useChartZoom";
import StatusMark, { statusLabel } from "./StatusMark";

const RANGES = ["1h", "6h", "12h", "24h", "7d"] as const;
const RANGE_HOURS: Record<(typeof RANGES)[number], number> = {
  "1h": 1,
  "6h": 6,
  "12h": 12,
  "24h": 24,
  "7d": 24 * 7,
};
const STRIP_RANGES = [
  { id: "1h", label: "1h", hours: 1 },
  { id: "3h", label: "3h", hours: 3 },
  { id: "6h", label: "6h", hours: 6 },
  { id: "24h", label: "24h", hours: 24 },
] as const;

type StripRange = (typeof STRIP_RANGES)[number]["id"];
const COLORS = CHART_COLORS;
const ISP_SLUGS = ["http-path", "icmp-path", "mtr-path"] as const;

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
type CheckKey = "librespeed" | "webrtc";

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

function isCheck(value: string | null): value is CheckKey {
  return value === "librespeed" || value === "webrtc";
}

export function logProbeForDetail(detail: string | null, check: string | null = null): string | null {
  if (check?.startsWith("rtnp:")) return check;
  if (detail === "isp" && isCheck(check)) return `slug:${check}`;
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
  isp,
}: {
  tests: MonitorDetail["tests"];
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
    next.delete("check");
    next.delete("view");
    if (nextLink === "wireless") {
      const wifiId = wireless[0]?.network_id;
      if (wifiId) next.set("network", wifiId);
      next.set("link", "wireless");
    } else if (nextLink === "wired") {
      const wiredId = wired[0]?.network_id;
      if (wiredId) next.set("network", wiredId);
      next.set("link", "wired");
    } else if (nextLink) {
      next.set("link", nextLink);
    } else {
      next.delete("link");
    }
    setSearchParams(next);
  }

  if (detail) {
    const networkId = searchParams.get("network");
    const selectedSlug = tests.find((test) => test.network_id === networkId)?.network_slug ?? "";
    const resolved =
      link === "wireless"
        ? "wireless"
        : link === "wired"
          ? "wired"
          : selectedSlug === "wifi"
            ? "wireless"
            : selectedSlug === "wired" || wired.length > 0
              ? "wired"
              : "";
    // The old Internet-network copies stop updating once a wired or wireless link is reporting.
    const pool = resolved === "wireless" ? wireless : resolved === "wired" ? wired : wan;
    return (
      <>
        <InternetDetail
          tests={pool.length > 0 ? pool : tests}
          detail={detail}
          isp={isp}
          linkLabel={resolved === "wired" ? "Wired" : resolved === "wireless" ? "Wi-Fi" : null}
        />
      </>
    );
  }
  if (wired.length > 0 && wireless.length > 0) {
    return (
      <ServiceCompare
        wired={wired}
        wireless={wireless}
        onOpen={(key, linkName) => openDetail(key, linkName)}
      />
    );
  }
  return (
    <InternetDashboard tests={wan.length > 0 ? wan : tests} onOpen={openDetail} />
  );
}

function useAppStrips(tests: TestRow[], stripRange: StripRange) {
  const bySlug = useMemo(() => new Map(tests.map((test) => [test.slug, test])), [tests]);
  const stripTests = useMemo(() => {
    const slugs: string[] = [];
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
  }, [bySlug, stripPoints, stripHours]);

  function probesFor(key: AppKey): TestRow[] {
    return probeKinds(key).flatMap((kind) => {
      const test = bySlug.get(`${kind}-${key}`);
      return test && test.enabled !== false ? [test] : [];
    });
  }

  function statusFor(key: AppKey): string {
    return currentRag(probesFor(key).map((test) => test.latest_status));
  }

  function detailFor(key: AppKey): string | null {
    const blocks = probesFor(key).map(probeEvent);
    return blocks.length ? blocks.join("\n\n") : null;
  }

  const stripLabel = STRIP_RANGES.find((item) => item.id === stripRange)?.label ?? "1 hour";
  return { appStrips, statusFor, detailFor, stripLabel };
}

function probeEvent(test: TestRow): string {
  const name = test.kind === "http" ? "HTTP" : test.kind === "ping" ? "ICMP" : test.name;
  const when = test.latest_at ? new Date(test.latest_at).toLocaleString() : "No sample yet";
  const lines = [`${name} · ${when}`, test.latest_reason?.trim() || statusLabel(test.latest_status)];
  const metrics: string[] = [];
  if (test.latest_rtt_ms != null) metrics.push(`RTT ${fmt(test.latest_rtt_ms)} ms`);
  if (test.latest_loss_pct != null) metrics.push(`Loss ${fmt(test.latest_loss_pct)}%`);
  if (metrics.length) lines.push(metrics.join(" · "));
  return lines.join("\n");
}

function StripRangeTabs({ range, onChange }: { range: StripRange; onChange: (range: StripRange) => void }) {
  return (
    <div className="range-row">
      {STRIP_RANGES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`tab ${range === item.id ? "active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ServiceSide({
  label,
  status,
  detail,
  strip,
  stripLabel,
  onOpen,
}: {
  label: string;
  status: string;
  detail: string | null;
  strip: string[];
  stripLabel: string;
  onOpen: () => void;
}) {
  return (
    <button className="saas-tile" type="button" onClick={onOpen}>
      <span className="saas-tile-head">
        <strong>{label}</strong>
        <StatusMark status={status} detail={detail} focusable={false} />
      </span>
      <span className="isp-strip" title={stripLabel} style={{ background: stripGradient(strip) }} />
    </button>
  );
}

function ServiceCompare({
  wired,
  wireless,
  onOpen,
}: {
  wired: TestRow[];
  wireless: TestRow[];
  onOpen: (key: DetailKey, link: "wired" | "wireless") => void;
}) {
  const [stripRange, setStripRange] = useState<StripRange>("1h");
  const wiredView = useAppStrips(wired, stripRange);
  const wirelessView = useAppStrips(wireless, stripRange);

  return (
    <div className="service-compare">
      <StripRangeTabs range={stripRange} onChange={setStripRange} />
      <div className="svc-table">
        <div className="svc-head" aria-hidden="true">
          <span>Service</span>
          <span>Wired</span>
          <span>Wi-Fi</span>
        </div>
        {APPS.map((app) => (
          <div className="svc-row" key={app.key}>
            <h2 className="svc-name">{app.label}</h2>
            <ServiceCell
              link="Wired"
              app={app.label}
              status={wiredView.statusFor(app.key)}
              detail={wiredView.detailFor(app.key)}
              strip={wiredView.appStrips.get(app.key) ?? []}
              stripLabel={wiredView.stripLabel}
              onOpen={() => onOpen(app.key, "wired")}
            />
            <ServiceCell
              link="Wi-Fi"
              app={app.label}
              status={wirelessView.statusFor(app.key)}
              detail={wirelessView.detailFor(app.key)}
              strip={wirelessView.appStrips.get(app.key) ?? []}
              stripLabel={wirelessView.stripLabel}
              onOpen={() => onOpen(app.key, "wireless")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One link of one service: the column heading names it on wide screens, the
    inline label does below 700px where the columns stack. */
function ServiceCell({
  link,
  app,
  status,
  detail,
  strip,
  stripLabel,
  onOpen,
}: {
  link: string;
  app: string;
  status: string;
  detail: string | null;
  strip: string[];
  stripLabel: string;
  onOpen: () => void;
}) {
  return (
    <button className="svc-cell" type="button" onClick={onOpen} aria-label={`${app} over ${link}`}>
      <span className="svc-link">{link}</span>
      <StatusMark status={status} detail={detail} focusable={false} />
      <span className="isp-strip" title={stripLabel} style={{ background: stripGradient(strip) }} />
    </button>
  );
}

function InternetDashboard({
  tests,
  onOpen,
}: {
  tests: TestRow[];
  onOpen: (key: DetailKey) => void;
}) {
  const [stripRange, setStripRange] = useState<StripRange>("1h");
  const { appStrips, statusFor, detailFor, stripLabel } = useAppStrips(tests, stripRange);

  return (
    <>
      <StripRangeTabs range={stripRange} onChange={setStripRange} />
      <div className="panel">
      <h3 className="wifi-heading">Web Services</h3>
      <div className="saas-grid">
        {APPS.map((app) => (
          <ServiceSide
            key={app.key}
            label={app.label}
            status={statusFor(app.key)}
            detail={detailFor(app.key)}
            strip={appStrips.get(app.key) ?? []}
            stripLabel={stripLabel}
            onOpen={() => onOpen(app.key)}
          />
        ))}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [range, setRange] = useState<(typeof RANGES)[number]>("1h");
  const bySlug = useMemo(() => new Map(tests.map((test) => [test.slug, test])), [tests]);
  const app = APPS.find((item) => item.key === detail);
  const slugs =
    detail === "isp"
      ? [...ISP_SLUGS, "librespeed", "webrtc"]
      : [...probeKinds(detail).map((kind) => `${kind}-${detail}`), `mtr-${detail}`];
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

  const transferChart = useMemo(
    () =>
      (points.get("librespeed") ?? []).map((point) => {
        const sample = speed(point);
        return {
          t: point.t,
          ts: new Date(point.t).getTime(),
          down: sample.down,
          up: sample.up,
          ping: point.rtt_ms,
          jitter: point.jitter_ms,
        };
      }),
    [points],
  );

  const callChart = useMemo(
    () =>
      (points.get("webrtc") ?? []).map((point) => ({
        t: point.t,
        ts: new Date(point.t).getTime(),
        rtt: point.rtt_ms,
        jitter: point.jitter_ms,
        loss: point.loss_pct,
      })),
    [points],
  );

  const latestHops = (points.get(mtrSlug) ?? []).at(-1)?.hops ?? [];
  const latestLibre = (points.get("librespeed") ?? []).at(-1);
  const latestCall = (points.get("webrtc") ?? []).at(-1);
  const transferStrip = useMemo(
    () => statusStrip(points.get("librespeed") ?? [], range),
    [points, range],
  );
  const callStrip = useMemo(
    () => statusStrip(points.get("webrtc") ?? [], range),
    [points, range],
  );
  const span = chartWindow(range);
  const linkHealth = detail === "isp" && (linkLabel === "Wired" || linkLabel === "Wi-Fi");
  const requestedCheck = searchParams.get("check");
  const check = linkHealth && isCheck(requestedCheck) ? requestedCheck : null;

  function openCheck(key: CheckKey) {
    const next = new URLSearchParams(searchParams);
    next.set("check", key);
    setSearchParams(next);
  }

  if (linkHealth && !check) {
    return (
      <section className="panel network-health">
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>{linkLabel} Network Health</h2>
        <RangeTabs range={range} onChange={setRange} />
        {loading ? (
          <div className="muted">Loading internet checks…</div>
        ) : failed ? (
          <div className="muted">Could not load internet checks.</div>
        ) : (
          <div className="health-stack">
            <HealthBar
              title="Transfer Speed"
              detail={`${fmt(speed(latestLibre).down)} Mbps down · ${fmt(speed(latestLibre).up)} Mbps up · ping ${fmt(latestLibre?.rtt_ms)} ms · jitter ${fmt(latestLibre?.jitter_ms)} ms`}
              strip={transferStrip}
              empty={transferChart.length === 0}
              onOpen={() => openCheck("librespeed")}
            />
            <HealthBar
              title="Video call"
              detail={`${fmt(latestCall?.rtt_ms)} ms · jitter ${fmt(latestCall?.jitter_ms)} ms · loss ${fmt(latestCall?.loss_pct)}%`}
              strip={callStrip}
              empty={callChart.length === 0}
              onOpen={() => openCheck("webrtc")}
            />
          </div>
        )}
      </section>
    );
  }

  if (check === "librespeed") {
    return (
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1.4rem" }}>
          {linkLabel} · File Transfer
        </h2>
        <RangeTabs range={range} onChange={setRange} />
        {loading ? (
          <div className="muted">Loading internet checks…</div>
        ) : failed ? (
          <div className="muted">Could not load internet checks.</div>
        ) : (
          <>
            <PathChart
              title="Download and upload"
              data={transferChart}
              span={span}
              series={[
                { key: "down", label: "Download" },
                { key: "up", label: "Upload" },
              ]}
              unit=" Mbps"
            />
            <div className="chart-pair">
              <PathChart title="Ping" data={transferChart} span={span} dataKey="ping" label="Ping" unit=" ms" />
              <PathChart title="Jitter" data={transferChart} span={span} dataKey="jitter" label="Jitter" unit=" ms" />
            </div>
          </>
        )}
      </div>
    );
  }

  if (check === "webrtc") {
    return (
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1.4rem" }}>
          {linkLabel} · Video call
        </h2>
        <RangeTabs range={range} onChange={setRange} />
        {loading ? (
          <div className="muted">Loading internet checks…</div>
        ) : failed ? (
          <div className="muted">Could not load internet checks.</div>
        ) : (
          <>
            <div className="chart-pair">
              <PathChart title="Round-trip" data={callChart} span={span} dataKey="rtt" label="Round-trip" unit=" ms" />
              <PathChart title="Jitter" data={callChart} span={span} dataKey="jitter" label="Jitter" unit=" ms" />
            </div>
            <PathChart title="Packet loss" data={callChart} span={span} dataKey="loss" label="Loss" unit=" %" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: "1.4rem" }}>
        {linkLabel ? `${linkLabel} · ` : ""}
        {detail === "isp" ? isp || "ISP" : app?.label}
      </h2>
      <RangeTabs range={range} onChange={setRange} />
      {loading ? (
        <div className="muted">Loading internet checks…</div>
      ) : failed ? (
        <div className="muted">Could not load internet checks.</div>
      ) : detail === "isp" ? (
        <>
          <div>
            <h3 className="wifi-heading">HTTP</h3>
            {httpChart.rows.length === 0 ? (
              <div className="muted">No samples in this range.</div>
            ) : (
              <HttpAreaChart rows={httpChart.rows} stageNames={httpChart.stageNames} span={span} />
            )}
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
      )}
    </div>
  );
}

function statusStrip(samples: Point[], range: (typeof RANGES)[number]): string[] {
  const series = new Map<string, Point[]>();
  series.set("sample", samples);
  return ispStrip(series, RANGE_HOURS[range]);
}

function RangeTabs({
  range,
  onChange,
}: {
  range: (typeof RANGES)[number];
  onChange: (range: (typeof RANGES)[number]) => void;
}) {
  return (
    <div className="range-row">
      {RANGES.map((item) => (
        <button
          key={item}
          type="button"
          className={`tab ${range === item ? "active" : ""}`}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function HealthBar({
  title,
  detail,
  strip,
  empty,
  onOpen,
}: {
  title: string;
  detail: string;
  strip: string[];
  empty: boolean;
  onOpen?: () => void;
}) {
  return (
    <div className="health-row">
      <div className="health-row-head">
        {onOpen ? (
          <button className="health-row-title" type="button" onClick={onOpen}>
            {title}
          </button>
        ) : (
          <strong>{title}</strong>
        )}
        <span className="mono">{detail}</span>
      </div>
      <span className="isp-strip health-bar" title={title} style={{ background: stripGradient(strip) }} />
      {empty ? <div className="muted">No samples in this range.</div> : null}
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
