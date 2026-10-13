import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import SelectMenu from "./SelectMenu";
import WaitButton from "./WaitButton";

type PathHop = {
  ttl: number;
  ip: string | null;
  rdns: string | null;
  silent: boolean;
  loss_pct: number | null;
  best_ms: number | null;
  avg_ms: number | null;
  worst_ms: number | null;
  asn: number | null;
  as_name: string | null;
  prefix: string | null;
  registry: string | null;
  country: string | null;
  role: string;
  name: string;
  role_label: string;
  asn_label: string;
  inferred: boolean;
};

type PathGroup = {
  role: string;
  asn: number | null;
  name: string;
  asn_label: string;
  role_label: string;
  hop_ttls: number[];
  delta_in_ms: number | null;
};

type AsChip = {
  type: string;
  asn: number | null;
  name: string;
  role: string;
  label: string;
};

export type PathTrace = {
  status: string;
  traced_at: string | null;
  probes_per_hop: number;
  agent: { name: string; online: boolean };
  target: { name: string; ip: string };
  hops: PathHop[];
  groups: PathGroup[];
  warn_ttls: number[];
  focus_ttl: number | null;
  insight: string;
  stats: {
    hop_count: number;
    silent_count: number;
    network_count: number;
    asn_count: number;
    ixp_count: number;
    end_to_end_ms: number | null;
    loss_pct: number | null;
    biggest_step_ms: number | null;
    biggest_step_name: string | null;
  };
  as_path_observed: AsChip[];
  bgp: {
    origin_asn: number | null;
    prefix: string | null;
    rpki: string | null;
    as_path_announced: AsChip[];
    path_match: boolean | null;
    stable_days: number | null;
  };
  history: Record<string, (number | null)[]>;
};

function fmt(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function dash(value: string | null | undefined): string {
  return value ? value : "—";
}

function networkLabel(label: string): string {
  return label === "AS ?" ? "Unknown network" : label;
}

function useNarrow(query = "(max-width: 768px)") {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [query]);
  return narrow;
}

function tracedWhen(iso: string): string {
  const when = new Date(iso);
  const clock = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (when.toDateString() === new Date().toDateString()) return `today at ${clock}`;
  return when.toLocaleString();
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
    </svg>
  );
}

export type PathChoice = { id: string; label: string };

export default function NetworkPathView({
  monitorId,
  link,
  destination,
  agents,
  destinations,
  agentOnline,
  onAgent,
  onDestination,
}: {
  monitorId: string;
  link: "wired" | "wireless";
  destination: string;
  agents: { id: string; name: string }[];
  destinations: PathChoice[];
  agentOnline: boolean;
  onAgent: (id: string) => void;
  onDestination: (id: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hopOpen, setHopOpen] = useState(false);
  const [bgpOpen, setBgpOpen] = useState(false);
  const pathQ = useQuery({
    queryKey: ["monitor-path", monitorId, link, destination],
    queryFn: () => api.monitorPath(monitorId, link, destination) as Promise<PathTrace>,
    enabled: Boolean(monitorId),
  });

  useEffect(() => {
    setSelected(pathQ.data?.focus_ttl ?? null);
  }, [pathQ.data?.traced_at, pathQ.data?.focus_ttl]);

  async function runTrace() {
    if (running) return;
    setRunning(true);
    try {
      await pathQ.refetch();
    } finally {
      setRunning(false);
    }
  }

  const trace = pathQ.data;
  const agentName = agents.find((agent) => agent.id === monitorId)?.name ?? trace?.agent.name ?? "the remote agent";
  const destinationName = destinations.find((item) => item.id === destination)?.label ?? trace?.target.name ?? "HomeNetWatch server";
  const hop = trace?.hops.find((item) => item.ttl === selected) ?? trace?.hops[trace.hops.length - 1];
  const linkName = link === "wired" ? "Wired" : "Wi-Fi";
  const networks = trace?.stats.asn_count || trace?.stats.network_count || 0;
  const ixp = trace?.stats.ixp_count ?? 0;
  const subtitle = running || pathQ.isLoading
    ? `Tracing from ${agentName} to ${destinationName}.`
    : pathQ.isError || !trace
      ? "Could not load this path."
      : trace.hops.length === 0 || !trace.traced_at
        ? `No traceroute yet from ${agentName} to ${destinationName} on the ${linkName} link.`
        : `Last traced ${tracedWhen(trace.traced_at)} to ${destinationName}. ${trace.stats.hop_count} hop${trace.stats.hop_count === 1 ? "" : "s"}${
            networks === 0
              ? ""
              : ` across ${networks} network${networks === 1 ? "" : "s"}${ixp ? ` and ${ixp} exchange point${ixp === 1 ? "" : "s"}` : ""}`
          }.`;

  return (
    <div className="npv">
      <div className="npv-titlebar">
        <div>
          <h1>Path View</h1>
          <p className="npv-sub">{subtitle}</p>
        </div>
        <div className="npv-actions">
          <label className={agentOnline ? "npv-agent" : "npv-agent offline"}>
            <span className="npv-dot" />
            <span>
              <span className="npv-agent-label">Remote agent</span>
              <SelectMenu className="npv-select" value={monitorId} onChange={(event) => onAgent(event.target.value)} aria-label="Remote agent">
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </SelectMenu>
            </span>
          </label>
          <label className="npv-agent">
            <span>
              <span className="npv-agent-label">Destination</span>
              <SelectMenu
                className="npv-select"
                value={destinations.some((item) => item.id === destination) ? destination : "server"}
                onChange={(event) => onDestination(event.target.value)}
                aria-label="Destination"
              >
                {destinations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </SelectMenu>
            </span>
          </label>
          <WaitButton
            busy={running}
            disabled={!agentOnline || !monitorId}
            label="Run trace"
            busyLabel="Tracing…"
            icon={<PlayIcon />}
            onClick={() => void runTrace()}
          />
        </div>
      </div>

      {pathQ.isLoading ? (
        <div className="state-box">Loading path…</div>
      ) : pathQ.isError || !trace ? (
        <div className="state-box">Could not load the path.</div>
      ) : trace.hops.length === 0 ? (
        <section className="npv-card">
          <h2>{destinationName}</h2>
          <p className="npv-hint">This destination has not reported a traceroute yet.</p>
        </section>
      ) : (
        <>
          <StatCards trace={trace} />
          <PathStrip trace={trace} selected={hop?.ttl ?? null} onSelect={setSelected} />
          <div className="npv-row">
            <LatencyChart trace={trace} selected={hop?.ttl ?? null} onSelect={setSelected} />
            <FoldCard
              className="npv-detail"
              title={hop ? `Hop ${hop.ttl}` : "Selected hop"}
              hint={hop ? networkLabel(hop.silent ? "Unknown network" : hop.asn_label) : undefined}
              open={hopOpen}
              onToggle={() => setHopOpen((open) => !open)}
            >
              <HopDetail trace={trace} hop={hop} headless />
            </FoldCard>
          </div>
          <FoldCard
            title="BGP view"
            hint="Announced path and RPKI"
            open={bgpOpen}
            onToggle={() => setBgpOpen((open) => !open)}
          >
            <BgpView trace={trace} headless />
          </FoldCard>
        </>
      )}
    </div>
  );
}

function FoldCard({
  title,
  hint,
  open,
  onToggle,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`npv-card npv-fold ${open ? "open" : ""} ${className}`.trim()}>
      <button type="button" className="npv-fold-toggle" aria-expanded={open} onClick={onToggle}>
        <span className="npv-fold-copy">
          <span className="npv-fold-title">{title}</span>
          {hint ? <span className="npv-fold-hint">{hint}</span> : null}
        </span>
        <svg className="npv-fold-chevron" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
      {open ? <div className="npv-fold-body">{children}</div> : null}
    </section>
  );
}

function StatCards({ trace }: { trace: PathTrace }) {
  const stats = trace.stats;
  const ixp = stats.ixp_count
    ? `plus ${stats.ixp_count} exchange point${stats.ixp_count === 1 ? "" : "s"}`
    : "";
  const cards = [
    { k: "Hops", v: String(stats.hop_count), s: `${stats.silent_count} not replying` },
    {
      k: "Networks crossed",
      v: stats.asn_count ? `${stats.asn_count} ASes` : stats.network_count ? String(stats.network_count) : "—",
      s: stats.network_count || stats.asn_count ? ixp : "home network only",
    },
    { k: "End to end", v: `${fmt(stats.end_to_end_ms)} ms`, s: `average over ${trace.probes_per_hop} probes` },
    {
      k: "Packet loss",
      v: stats.loss_pct == null ? "—" : `${fmt(stats.loss_pct, stats.loss_pct % 1 === 0 ? 0 : 1)}%`,
      s: "at the destination",
      cls: stats.loss_pct === 0 ? "ok" : "warn",
    },
    {
      k: "Biggest step",
      v: stats.biggest_step_ms == null ? "—" : `+${fmt(stats.biggest_step_ms)} ms`,
      s: stats.biggest_step_name ? `entering ${stats.biggest_step_name}` : "",
      cls: "warn",
    },
  ];
  return (
    <div className="npv-stats">
      {cards.map((card) => (
        <div key={card.k} className={`npv-stat ${card.cls ?? ""}`}>
          <div className="k">{card.k}</div>
          <div className="v">{card.v}</div>
          <div className="s">{card.s}</div>
        </div>
      ))}
    </div>
  );
}

function PathStrip({
  trace,
  selected,
  onSelect,
}: {
  trace: PathTrace;
  selected: number | null;
  onSelect: (ttl: number) => void;
}) {
  const hops = new Map(trace.hops.map((hop) => [hop.ttl, hop]));
  const warn = new Set(trace.warn_ttls);
  return (
    <section className="npv-card">
      <div className="npv-card-head">
        <div>
          <h2>Network path</h2>
          <p className="npv-hint">
            Hops grouped by the network that owns them. Pick a hop for details. Pills between networks show the latency change at each handoff, in ms.
          </p>
        </div>
        <div className="npv-legend">
          <span>
            <i className="npv-swatch" />
            Step of 15 ms or more
          </span>
          <span>
            <i className="npv-swatch dashed" />
            No reply
          </span>
        </div>
      </div>
      <div className="npv-vpath">
        {trace.groups.map((group, index) => {
          const delta = group.delta_in_ms;
          const big = delta != null && delta >= 15;
          const silent = group.role === "unknown";
          return (
            <div className="npv-vblock" key={`v-${group.role}-${group.hop_ttls[0]}`}>
              {index > 0 ? (
                <div className={`npv-vdiv ${big ? "big" : ""}`}>
                  <span>{delta == null ? "?" : `${delta >= 0 ? "+" : ""}${fmt(delta)} ms`}</span>
                </div>
              ) : null}
              <div className={`npv-vrow ${silent ? "dashed" : ""}`} style={{ ["--c" as string]: `var(--role-${group.role})` }}>
                {silent ? (
                  <div className="npv-vmeta">
                    <div className="npv-gname">Hidden by router, no reply</div>
                  </div>
                ) : (
                  <>
                    <div className="npv-vmeta">
                      <span className="npv-asn">{networkLabel(group.asn_label)}</span>
                      <div className="npv-gname">{group.name}</div>
                      <div className="npv-grole">{group.role_label}</div>
                    </div>
                    <div className="npv-vpills">
                      {group.hop_ttls.map((ttl) => {
                        const item = hops.get(ttl);
                        if (!item) return null;
                        return (
                          <button
                            key={ttl}
                            type="button"
                            className={`npv-vpill ${warn.has(ttl) ? "warn" : ""}`}
                            aria-pressed={selected === ttl}
                            aria-label={`Hop ${ttl}, ${item.name}, ${item.silent ? "no reply" : `${fmt(item.avg_ms)} milliseconds`}`}
                            onClick={() => onSelect(ttl)}
                          >
                            <b>#{ttl}</b>
                            <span>{item.silent ? "no reply" : `${fmt(item.avg_ms)} ms`}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="npv-strip-scroll">
        <div className="npv-strip">
          {trace.groups.map((group, index) => {
            const next = trace.groups[index + 1];
            const big = next?.delta_in_ms != null && next.delta_in_ms >= 15;
            return (
              <div className="npv-gwrap" key={`${group.role}-${group.hop_ttls[0]}`}>
                <div className={`npv-group ${group.role === "unknown" ? "dashed" : ""}`} style={{ ["--c" as string]: `var(--role-${group.role})` }}>
                  <div className="npv-ghead">
                    <span className="npv-asn">{networkLabel(group.asn_label)}</span>
                    <div className="npv-gname">{group.name}</div>
                    <div className="npv-grole">{group.role_label}</div>
                  </div>
                  <div className="npv-chips">
                    {group.hop_ttls.map((ttl) => {
                      const item = hops.get(ttl);
                      if (!item) return null;
                      const silent = item.silent;
                      return (
                        <button
                          key={ttl}
                          type="button"
                          className={`npv-chip ${silent ? "silent" : ""} ${warn.has(ttl) ? "warn" : ""}`}
                          style={{ ["--c" as string]: `var(--role-${item.role})` }}
                          aria-pressed={selected === ttl}
                          aria-label={`Hop ${ttl}, ${item.name}, ${silent ? "no reply" : `${fmt(item.avg_ms)} milliseconds`}`}
                          onClick={() => onSelect(ttl)}
                        >
                          <span className="n">#{ttl}</span>
                          <span className="v">{silent ? "* * *" : fmt(item.avg_ms)}</span>
                          <span className="u">{silent ? "no reply" : "ms"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {next ? (
                  <div className={`npv-conn ${big ? "big" : ""}`}>
                    <span className="npv-delta">
                      {next.delta_in_ms == null ? "?" : `${next.delta_in_ms >= 0 ? "+" : ""}${fmt(next.delta_in_ms)}`}
                    </span>
                    <svg width="48" height="12" viewBox="0 0 48 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2 6h42M39 1.5L44 6l-5 4.5" />
                    </svg>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LatencyChart({
  trace,
  selected,
  onSelect,
}: {
  trace: PathTrace;
  selected: number | null;
  onSelect: (ttl: number) => void;
}) {
  const narrow = useNarrow();
  const replying = trace.hops.filter((hop) => !hop.silent && hop.avg_ms != null);
  const maxAvg = Math.max(0, ...replying.map((hop) => hop.avg_ms ?? 0));
  const axisMax = Math.max(15, Math.ceil(maxAvg / 15) * 15);
  const ticks = [axisMax, (axisMax * 2) / 3, axisMax / 3, 0].map((tick) => Math.round(tick));
  return (
    <section className="npv-card npv-chartcard">
      <div>
        <h2>Latency by hop</h2>
        <p className="npv-hint">Average round trip in ms. Bars take the color of the network they belong to.</p>
      </div>
      <div className="npv-chart">
        <div className="npv-grid">
          {ticks.map((tick) => (
            <div className="npv-gl" key={tick}>
              <span>{tick}</span>
              <i />
            </div>
          ))}
        </div>
        <div className="npv-bars">
          {trace.hops.map((hop) => {
            const silent = hop.silent || hop.avg_ms == null;
            const height = silent ? 0 : Math.max(6, Math.round(((hop.avg_ms ?? 0) / axisMax) * (narrow ? 100 : 190)));
            return (
              <button
                key={hop.ttl}
                type="button"
                className="npv-col"
                style={{ ["--c" as string]: `var(--role-${hop.role})` }}
                aria-pressed={selected === hop.ttl}
                aria-label={`Hop ${hop.ttl}, ${silent ? "no reply" : `${fmt(hop.avg_ms)} milliseconds`}`}
                onClick={() => onSelect(hop.ttl)}
              >
                <span className="val">{silent ? "—" : fmt(hop.avg_ms)}</span>
                {silent ? <div className="npv-stub" /> : <div className="npv-bar" style={{ height }} />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="npv-xlabels">
        {trace.hops.map((hop) => {
          const short = hop.silent ? "?" : hop.asn ? String(hop.asn) : hop.role === "ixp" ? "IXP" : hop.role === "home" ? "LAN" : "Unknown";
          return (
            <div className="npv-xl" key={hop.ttl} style={{ ["--c" as string]: `var(--role-${hop.role})` }}>
              <b>#{hop.ttl}</b>
              <span>{short}</span>
            </div>
          );
        })}
      </div>
      {trace.insight ? (
        <div className="npv-insight">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--degraded)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M12 11v5.5" />
            <circle cx="12" cy="7.6" r="0.6" fill="var(--degraded)" />
          </svg>
          <div>{trace.insight}</div>
        </div>
      ) : null}
    </section>
  );
}

function HopDetail({ trace, hop, headless = false }: { trace: PathTrace; hop: PathHop | undefined; headless?: boolean }) {
  if (!hop) return <aside className={headless ? "npv-detail" : "npv-card npv-detail"} />;
  const registry = [hop.registry, hop.country].filter(Boolean).join(", ");
  const network = hop.silent
    ? "Unknown"
    : hop.asn
      ? `AS${hop.asn} ${hop.as_name || hop.name}`
      : hop.name;
  const rows: [string, string, boolean?][] = hop.silent
    ? [
        ["Address", "* * *", true],
        ["Reverse DNS", "—"],
        ["Network", "Unknown"],
        ["Packet loss", "100% (no replies)"],
      ]
    : [
        ["IP address", dash(hop.ip), true],
        ["Reverse DNS", dash(hop.rdns), true],
        ["Network", network],
        ["Prefix", dash(hop.prefix), true],
        ["Registry", dash(registry || null)],
        ["Role", hop.role_label],
        ["Packet loss", hop.loss_pct == null ? "—" : `${fmt(hop.loss_pct, hop.loss_pct % 1 === 0 ? 0 : 1)}%`],
      ];
  const history = (trace.history[String(hop.ttl)] ?? []).filter((value): value is number => value != null);
  const lo = history.length ? Math.min(...history) : 0;
  const hi = history.length ? Math.max(...history) : 0;
  return (
    <aside className={headless ? "npv-detail" : "npv-card npv-detail"} style={{ ["--c" as string]: `var(--role-${hop.role})` }}>
      {headless ? null : (
      <div className="npv-detail-head">
        <div>
          <div className="cap">Selected hop</div>
          <div className="ttl">Hop {hop.ttl}</div>
        </div>
        <span className="npv-asn">{hop.silent ? "Unknown network" : networkLabel(hop.asn_label)}</span>
      </div>
      )}
      {hop.inferred ? (
        <div className="npv-notice inferred">
          Network inferred. This address sits on an interconnect link, so the owner shown is a best guess.
        </div>
      ) : null}
      {hop.silent ? (
        <div className="npv-notice silent">
          No reply. This router ignores traceroute probes, which is common and not a fault on its own.
        </div>
      ) : null}
      <div>
        {rows.map(([label, value, mono]) => (
          <div className="npv-kv" key={label}>
            <span className="k">{label}</span>
            <span className={mono ? "v mono" : "v"}>{value}</span>
          </div>
        ))}
      </div>
      {hop.silent ? null : (
        <>
          <div className="npv-tiles">
            {(
              [
                ["Min", hop.best_ms],
                ["Avg", hop.avg_ms],
                ["Max", hop.worst_ms],
              ] as const
            ).map(([label, value]) => (
              <div className="npv-tile" key={label}>
                <span className="k">{label}</span>
                <span className="v">{fmt(value)} ms</span>
              </div>
            ))}
          </div>
          {history.length > 0 ? (
            <div>
              <div className="npv-spark-title">Last {history.length} traces</div>
              <div className="npv-spark">
                {history.map((value, index) => {
                  const scale = hi === lo ? 0.5 : (value - lo) / (hi - lo);
                  return (
                    <i
                      key={`${hop.ttl}-${index}`}
                      style={{ height: Math.round(10 + scale * 34), opacity: index === history.length - 1 ? 1 : 0.55 }}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}

function AsPath({ items }: { items: AsChip[] }) {
  if (items.length === 0) return <div className="npv-missing">—</div>;
  return (
    <div className="npv-aspath">
      {items.map((item, index) => (
        <div className="npv-asitem" key={`${item.label}-${index}`}>
          <div className="npv-aschip" style={{ ["--c" as string]: `var(--role-${item.role})` }}>
            <b>{item.label}</b>
            <span>{item.name}</span>
          </div>
          {index < items.length - 1 ? (
            <svg width="22" height="12" viewBox="0 0 22 12" fill="none" stroke="var(--unknown)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 6h16M14 2l4 4-4 4" />
            </svg>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function BgpView({ trace, headless = false }: { trace: PathTrace; headless?: boolean }) {
  const bgp = trace.bgp;
  const rpki = bgp.rpki ? bgp.rpki[0].toUpperCase() + bgp.rpki.slice(1) : "—";
  const tiles: [string, string, string][] = [
    ["Origin AS", bgp.origin_asn ? `AS${bgp.origin_asn}` : "—", ""],
    ["Destination prefix", dash(bgp.prefix), "mono"],
    ["RPKI", rpki, bgp.rpki === "valid" || bgp.rpki === "Valid" ? "ok" : ""],
    ["Path stability", bgp.stable_days == null ? "—" : `Unchanged ${bgp.stable_days} days`, ""],
  ];
  return (
    <section className={headless ? "npv-bgp" : "npv-card"}>
      {headless ? null : (
      <div>
        <h2>BGP view</h2>
        <p className="npv-hint">The networks your packets crossed, next to the path BGP says should be used for the destination prefix.</p>
      </div>
      )}
      <div className="npv-bgp-grid">
        <div className="npv-bgp-paths">
          <div>
            <div className="npv-bgp-label">Observed in traceroute</div>
            <AsPath items={trace.as_path_observed} />
          </div>
          <div>
            <div className="npv-bgp-label">Announced in BGP</div>
            <AsPath items={bgp.as_path_announced} />
          </div>
          {bgp.path_match == null ? null : bgp.path_match ? (
            <div className="npv-match yes">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>Paths match. The exchange point doesn&apos;t appear in BGP, which is expected.</span>
            </div>
          ) : (
            <div className="npv-match no">
              <span>Paths differ. The traffic is not following the path BGP announces for this prefix.</span>
            </div>
          )}
        </div>
        <div className="npv-bgp-tiles">
          {tiles.map(([label, value, cls]) => (
            <div className="npv-bgp-tile" key={label}>
              <span className="k">{label}</span>
              <span className={`v ${cls}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
