import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import "../kpi.css";

type Period = "day" | "week" | "month" | "year";
type Kind = { samples: number; failed: number; availability: number | null; loss_avg: number | null; loss_max: number | null; rtt_ms: number | null; jitter_ms: number | null; down_mbps: number | null; up_mbps: number | null; incidents: number; outage_minutes: number; mttr_minutes?: number | null };
type Point = {
  t: string;
  internet: number | null;
  internet_wired: number | null;
  internet_wireless: number | null;
  voice: number | null;
  video: number | null;
  loss_internet: number | null;
  loss_voice: number | null;
  loss_video: number | null;
  rtt_ms: number | null;
  jitter_ms: number | null;
  down_mbps: number | null;
  up_mbps: number | null;
  outage_minutes: number;
};
type Report = {
  period: Period;
  bucket: "hour" | "day" | "month";
  from: string;
  to: string;
  generated_at: string;
  data_since: string | null;
  targets: { internet: number; voice: number; video: number; loss_pct: number };
  summary: Record<"internet" | "voice" | "video" | "apps" | "speed", Kind>;
  previous: Record<"internet" | "voice" | "video" | "apps" | "speed", Kind>;
  app_loss_avg: number | null;
  links: Record<"internet" | "voice" | "video", Record<string, Kind>>;
  series: Point[];
  incidents: { start: string; link: string; minutes: number; checks: number }[];
};

const PERIODS: { key: Period; label: string; text: string }[] = [
  { key: "day", label: "Day", text: "the last 24 hours, by hour" },
  { key: "week", label: "Week", text: "the last 7 days, by day" },
  { key: "month", label: "Month", text: "the last 30 days, by day" },
  { key: "year", label: "Year", text: "the last 12 months, by month" },
];

const C = { good: "#4fd1b5", warn: "#ffc24d", bad: "#ff8a7a", blue: "#6aa8ff", violet: "#a78bfa", grid: "#232d49", axis: "#9aa6c4" };
const LINKS = { wired: "Wired", wireless: "Wi-Fi" } as const;

/** Availability shown to three decimals and never rounded up to 100: 99.9996 reads 99.999%. */
function pct(value: number | null | undefined, digits = 3): string {
  if (value == null || Number.isNaN(value)) return "—";
  const scale = 10 ** digits;
  return `${(Math.floor(value * scale + 1e-9) / scale).toFixed(digits)}%`;
}

function num(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value >= 100 ? value.toFixed(0) : value.toFixed(digits);
}

function minutes(value: number): string {
  if (value < 1) return "0 min";
  if (value < 90) return `${Math.round(value)} min`;
  const hours = value / 60;
  return hours < 48 ? `${hours.toFixed(1)} h` : `${(hours / 24).toFixed(1)} days`;
}

type Tone = "good" | "warn" | "bad" | "none";

function availabilityTone(value: number | null, target: number): Tone {
  if (value == null) return "none";
  if (value >= target) return "good";
  return value >= target - 1 ? "warn" : "bad";
}

function lossTone(value: number | null, target: number): Tone {
  if (value == null) return "none";
  if (value <= target) return "good";
  return value <= target * 3 ? "warn" : "bad";
}

function stamp(iso: string, bucket: Report["bucket"], full = false): string {
  const date = new Date(iso);
  if (bucket === "hour") return full ? `${date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })} ${String(date.getUTCHours()).padStart(2, "0")}:00` : `${String(date.getUTCHours()).padStart(2, "0")}:00`;
  if (bucket === "month") return date.toLocaleDateString(undefined, { month: "short", year: full ? "numeric" : undefined, timeZone: "UTC" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function Delta({ now, before, better, unit = "pts" }: { now: number | null; before: number | null; better: "up" | "down"; unit?: string }) {
  if (now == null || before == null) return <span className="kpi-delta none">no earlier data</span>;
  const diff = now - before;
  if (Math.abs(diff) < 0.0005) return <span className="kpi-delta none">unchanged vs previous</span>;
  const good = better === "up" ? diff > 0 : diff < 0;
  return (
    <span className={good ? "kpi-delta good" : "kpi-delta bad"}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(3)} {unit} vs previous
    </span>
  );
}

function Spark({ data, field, color }: { data: Point[]; field: keyof Point; color: string }) {
  return (
    <div className="kpi-spark" aria-hidden="true">
      <ResponsiveContainer width="100%" height={40}>
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
          <Line type="monotone" dataKey={field} stroke={color} strokeWidth={1.8} dot={false} isAnimationActive={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Card({ label, value, tone, target, children, spark }: { label: string; value: string; tone: Tone; target?: string; children?: React.ReactNode; spark?: React.ReactNode }) {
  return (
    <article className={`kpi-card tone-${tone}`}>
      <div className="kpi-card-top">
        <span className="kpi-label">{label}</span>
        {target ? <span className="kpi-target">{target}</span> : null}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-card-sub">{children}</div>
      {spark}
    </article>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="kpi-panel">
      <header>
        <h3>{title}</h3>
        {note ? <span>{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

const tooltipStyle = { background: "#10172a", border: "1px solid #232d49", borderRadius: 10, fontSize: 12 };

export default function KpiPage() {
  const [params, setParams] = useSearchParams();
  const period = (PERIODS.find((item) => item.key === params.get("period"))?.key ?? "week") as Period;
  const query = useQuery({
    queryKey: ["kpi", period],
    queryFn: () => api.kpi(period) as Promise<Report>,
    refetchInterval: 30000,
    placeholderData: (previous) => previous,
  });

  if (query.isLoading) return <div className="state-box">Loading the KPI report…</div>;
  if (query.isError || !query.data) return <div className="state-box">Could not load the KPI report.</div>;

  const report = query.data;
  const { summary, previous, targets, series, bucket } = report;
  const data = series.map((point) => ({ ...point, label: stamp(point.t, bucket), full: stamp(point.t, bucket, true) }));
  const internet = summary.internet;
  const voice = summary.voice;
  const video = summary.video;
  const wired = report.links.internet.wired;
  const wifi = report.links.internet.wireless;
  const appLossPeak = Math.max(voice.loss_max ?? 0, video.loss_max ?? 0);
  const speed = summary.speed;

  const checks: { name: string; tone: Tone }[] = [
    { name: "Internet availability", tone: availabilityTone(internet.availability, targets.internet) },
    { name: "Voice availability", tone: availabilityTone(voice.availability, targets.voice) },
    { name: "Video availability", tone: availabilityTone(video.availability, targets.video) },
    { name: "Packet drop", tone: lossTone(report.app_loss_avg, targets.loss_pct) },
  ];
  const measured = checks.filter((item) => item.tone !== "none");
  const missed = measured.filter((item) => item.tone !== "good");
  const verdict: Tone = measured.length === 0 ? "none" : missed.some((item) => item.tone === "bad") ? "bad" : missed.length > 0 ? "warn" : "good";
  const headline =
    verdict === "none"
      ? "Gathering the first measurements"
      : verdict === "good"
        ? "All service levels are being met"
        : `${missed.length} of ${measured.length} service levels below target`;

  const minFloor = (values: (number | null)[], target: number) => {
    const real = values.filter((value): value is number => value != null);
    const low = real.length ? Math.min(...real, target) : target;
    return Math.max(0, Math.floor(low - 0.3));
  };
  const availFloor = minFloor(data.flatMap((point) => [point.internet_wired, point.internet_wireless]), targets.internet);
  const appFloor = minFloor(data.flatMap((point) => [point.voice, point.video]), Math.min(targets.voice, targets.video));
  const axis = { stroke: C.axis, tick: { fontSize: 11 }, tickLine: false } as const;
  const range = `${stamp(report.from, "day", true)}${report.bucket === "month" ? "" : ` – ${stamp(report.to, "day", true)}`}`;
  const periodText = PERIODS.find((item) => item.key === period)?.text ?? "";

  return (
    <div className="kpi">
      <header className="kpi-head">
        <div>
          <p className="kpi-eyebrow">Home network · Service report</p>
          <h1>Network health report</h1>
          <p className="kpi-range">
            {range}, {new Date(report.to).getUTCFullYear()} · {periodText} · times in UTC
          </p>
        </div>
        <div className="kpi-tools">
          <div className="kpi-seg" role="group" aria-label="Reporting period">
            {PERIODS.map((item) => (
              <button key={item.key} type="button" className={item.key === period ? "active" : ""} aria-pressed={item.key === period} onClick={() => setParams({ period: item.key }, { replace: true })}>
                {item.label}
              </button>
            ))}
          </div>
          <span className="kpi-live" title="This page refreshes every 30 seconds">
            <i aria-hidden="true" />
            Live · updated {new Date(query.dataUpdatedAt || report.generated_at).toLocaleTimeString()}
          </span>
          <button type="button" className="kpi-print" onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </header>

      <section className={`kpi-verdict tone-${verdict}`} role="status">
        <span className="kpi-verdict-mark" aria-hidden="true">
          {verdict === "good" ? "✓" : verdict === "none" ? "…" : "!"}
        </span>
        <div>
          <b>{headline}</b>
          <span>
            {measured.length === 0
              ? "The report fills in as measurements arrive."
              : `Targets: internet ${targets.internet}%, voice and video ${targets.voice}%, packet drop at or under ${targets.loss_pct}%.`}
          </span>
        </div>
        <ul>
          {checks.map((item) => (
            <li key={item.name} className={`tone-${item.tone}`}>
              {item.name}
            </li>
          ))}
        </ul>
      </section>

      <section className="kpi-cards" aria-label="Key indicators">
        <Card
          label="Internet availability"
          value={pct(internet.availability)}
          tone={availabilityTone(internet.availability, targets.internet)}
          target={`Target ${targets.internet}%`}
          spark={<Spark data={series} field="internet" color={C.good} />}
        >
          <Delta now={internet.availability} before={previous.internet.availability} better="up" />
          <span className="kpi-split">
            Wired {pct(wired?.availability)} · Wi-Fi {pct(wifi?.availability)}
          </span>
        </Card>
        <Card
          label="Voice availability"
          value={pct(voice.availability)}
          tone={availabilityTone(voice.availability, targets.voice)}
          target={`Target ${targets.voice}%`}
          spark={<Spark data={series} field="voice" color={C.blue} />}
        >
          <Delta now={voice.availability} before={previous.voice.availability} better="up" />
          <span className="kpi-split">{voice.samples.toLocaleString()} quality checks</span>
        </Card>
        <Card
          label="Video availability"
          value={pct(video.availability)}
          tone={availabilityTone(video.availability, targets.video)}
          target={`Target ${targets.video}%`}
          spark={<Spark data={series} field="video" color={C.violet} />}
        >
          <Delta now={video.availability} before={previous.video.availability} better="up" />
          <span className="kpi-split">{video.samples.toLocaleString()} quality checks</span>
        </Card>
        <Card
          label="Packet drop (voice and video)"
          value={pct(report.app_loss_avg)}
          tone={lossTone(report.app_loss_avg, targets.loss_pct)}
          target={`Target ≤ ${targets.loss_pct}%`}
          spark={<Spark data={series} field="loss_voice" color={C.warn} />}
        >
          <span className="kpi-split">
            Voice {pct(voice.loss_avg)} · Video {pct(video.loss_avg)}
          </span>
          <span className="kpi-split">Worst interval {appLossPeak ? `${appLossPeak.toFixed(1)}%` : "—"}</span>
        </Card>
        <Card label="Time offline" value={internet.samples ? minutes(internet.outage_minutes) : "—"} tone={internet.samples === 0 ? "none" : internet.incidents === 0 ? "good" : "warn"}>
          <span className="kpi-split">
            {internet.samples ? `${internet.incidents} outage${internet.incidents === 1 ? "" : "s"}` : "No data yet"}
            {internet.mttr_minutes ? ` · about ${minutes(internet.mttr_minutes)} each` : ""}
          </span>
          <span className="kpi-split">Counted from failed internet checks</span>
        </Card>
        <Card label="Latency to the server" value={internet.rtt_ms == null ? "—" : `${num(internet.rtt_ms)} ms`} tone="none" spark={<Spark data={series} field="rtt_ms" color={C.good} />}>
          <span className="kpi-split">Jitter {internet.jitter_ms == null ? "—" : `${num(internet.jitter_ms)} ms`}</span>
          <span className="kpi-split">
            Speed ↓ {speed.down_mbps == null ? "—" : num(speed.down_mbps, 0)} / ↑ {speed.up_mbps == null ? "—" : num(speed.up_mbps, 0)} Mbit/s
          </span>
        </Card>
      </section>

      <div className="kpi-grid">
        <Panel title="Internet availability" note={`Dashed line is the ${targets.internet}% target`}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={20} />
              <YAxis {...axis} domain={[availFloor, 100]} width={58} tickFormatter={(value: number) => `${value}%`} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(_label, rows) => String(rows?.[0]?.payload?.full ?? "")} formatter={(value) => [pct(typeof value === "number" ? value : null), ""]} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={targets.internet} stroke={C.warn} strokeDasharray="5 4" />
              <Line name="Wired" type="monotone" dataKey="internet_wired" stroke={C.good} strokeWidth={2.2} dot={false} isAnimationActive={false} />
              <Line name="Wi-Fi" type="monotone" dataKey="internet_wireless" stroke={C.blue} strokeWidth={2.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Voice and video availability" note={`Dashed line is the ${targets.voice}% target`}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={20} />
              <YAxis {...axis} domain={[appFloor, 100]} width={58} tickFormatter={(value: number) => `${value}%`} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(_label, rows) => String(rows?.[0]?.payload?.full ?? "")} formatter={(value) => [pct(typeof value === "number" ? value : null), ""]} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={targets.voice} stroke={C.warn} strokeDasharray="5 4" />
              <Line name="Voice" type="monotone" dataKey="voice" stroke={C.blue} strokeWidth={2.2} dot={false} isAnimationActive={false} />
              <Line name="Video" type="monotone" dataKey="video" stroke={C.violet} strokeWidth={2.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Packet drop" note={`Average loss; ${targets.loss_pct}% is the limit`}>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={20} />
              <YAxis {...axis} domain={[0, "auto"]} width={58} tickFormatter={(value: number) => `${value}%`} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(_label, rows) => String(rows?.[0]?.payload?.full ?? "")} formatter={(value) => [pct(typeof value === "number" ? value : null), ""]} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={targets.loss_pct} stroke={C.warn} strokeDasharray="5 4" />
              <Area name="Voice" type="monotone" dataKey="loss_voice" stroke={C.blue} fill={C.blue} fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Area name="Video" type="monotone" dataKey="loss_video" stroke={C.violet} fill={C.violet} fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Area name="Internet path" type="monotone" dataKey="loss_internet" stroke={C.good} fill={C.good} fillOpacity={0.1} strokeWidth={2} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Time offline" note="Minutes without internet">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={20} />
              <YAxis {...axis} allowDecimals={false} width={44} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,138,122,0.1)" }} labelFormatter={(_label, rows) => String(rows?.[0]?.payload?.full ?? "")} formatter={(value) => [`${num(typeof value === "number" ? value : null)} min`, "Offline"]} />
              <Bar dataKey="outage_minutes" fill={C.bad} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Latency and jitter" note="Round trip to the server, in milliseconds">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={20} />
              <YAxis yAxisId="rtt" {...axis} width={44} axisLine={false} />
              <YAxis yAxisId="jit" orientation="right" {...axis} width={36} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={(_label, rows) => String(rows?.[0]?.payload?.full ?? "")} formatter={(value) => [`${num(typeof value === "number" ? value : null)} ms`, ""]} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="rtt" name="Latency" type="monotone" dataKey="rtt_ms" stroke={C.good} strokeWidth={2.2} dot={false} isAnimationActive={false} />
              <Line yAxisId="jit" name="Jitter" type="monotone" dataKey="jitter_ms" stroke={C.warn} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Internet speed" note="Average from the bandwidth test, Mbit/s">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" {...axis} minTickGap={20} />
              <YAxis {...axis} width={44} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(79,209,181,0.08)" }} labelFormatter={(_label, rows) => String(rows?.[0]?.payload?.full ?? "")} formatter={(value) => [`${num(typeof value === "number" ? value : null, 0)} Mbit/s`, ""]} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
              <Bar name="Download" dataKey="down_mbps" fill={C.good} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar name="Upload" dataKey="up_mbps" fill={C.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="kpi-lower">
        <Panel title="Wired and Wi-Fi compared">
          <div className="kpi-table-wrap">
            <table className="kpi-table">
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Internet</th>
                  <th>Voice</th>
                  <th>Voice drop</th>
                  <th>Video</th>
                  <th>Video drop</th>
                </tr>
              </thead>
              <tbody>
                {(["wired", "wireless"] as const).map((link) => (
                  <tr key={link}>
                    <th scope="row">{LINKS[link]}</th>
                    <td className={`tone-${availabilityTone(report.links.internet[link]?.availability ?? null, targets.internet)}`}>{pct(report.links.internet[link]?.availability)}</td>
                    <td className={`tone-${availabilityTone(report.links.voice[link]?.availability ?? null, targets.voice)}`}>{pct(report.links.voice[link]?.availability)}</td>
                    <td className={`tone-${lossTone(report.links.voice[link]?.loss_avg ?? null, targets.loss_pct)}`}>{pct(report.links.voice[link]?.loss_avg)}</td>
                    <td className={`tone-${availabilityTone(report.links.video[link]?.availability ?? null, targets.video)}`}>{pct(report.links.video[link]?.availability)}</td>
                    <td className={`tone-${lossTone(report.links.video[link]?.loss_avg ?? null, targets.loss_pct)}`}>{pct(report.links.video[link]?.loss_avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Outage log" note={report.period === "year" ? "Most recent, from detailed records" : "Most recent first"}>
          {report.incidents.length === 0 ? (
            <p className="kpi-clear">No internet outages in this period.</p>
          ) : (
            <ul className="kpi-incidents">
              {report.incidents.map((item) => (
                <li key={`${item.start}-${item.link}`}>
                  <i aria-hidden="true" />
                  <span>
                    <b>{LINKS[item.link as keyof typeof LINKS] ?? item.link}</b> offline for {minutes(item.minutes)}
                  </span>
                  <time>{new Date(item.start).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <footer className="kpi-foot">
        <p>
          <b>How these are measured.</b> Internet availability is the share of one-minute checks to the HomeNetWatch server, on each link, that
          succeeded. Voice and video availability is the share of their quality checks (every few seconds) that stayed within their limits. Packet
          drop is the average loss those checks reported. Time offline is counted from failed internet checks. A period with no measurements shows a
          gap, never 100%. Figures are cut off, not rounded up, at three decimals.
        </p>
        <p>{report.data_since ? `Measurements since ${new Date(report.data_since).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. ` : ""}Home network, report generated {new Date(report.generated_at).toLocaleString()}.</p>
      </footer>
    </div>
  );
}
