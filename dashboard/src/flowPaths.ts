import type { MonitorDetail } from "./types";

export type FlowLink = "wired" | "wifi";

/**
 * Where a check's packets go.
 * - web: a public website, straight out through the home router.
 * - server-direct: the HomeNetWatch server's public address, not through a tunnel.
 * - tunnel: the server's WireGuard address, inside the tunnel for that link.
 */
export type FlowRoute = "web" | "server-direct" | "tunnel";

export type FlowCategory = "web" | "application" | "server";

export type FlowTest = {
  key: string;
  name: string;
  /** The service a check belongs to: Facebook's HTTP and ICMP checks share one. */
  group: string;
  groupName: string;
  /** What kind of check it is, for telling same-service flows apart. */
  kindLabel: string;
  category: FlowCategory;
  link: FlowLink;
  route: FlowRoute;
  /** An always-on application flow also keeps its control channel in the tunnel. */
  application: boolean;
  status: "ok" | "degraded" | "fail" | "idle";
  detail: string;
  /** The host or address the check talks to; empty for an application flow. */
  target: string;
  /** The server's own words for the latest result. */
  reason: string | null;
  lossPct: number | null;
  checkedAt: string | null;
};

/** The newest figures the server holds for one application flow on one link. */
export type FlowLatest = {
  slug: string;
  latest: { rtt_ms: number | null; jitter_ms: number | null; loss_pct: number | null; verdict: string | null };
};
export type FlowHealth = Partial<Record<FlowLink, FlowLatest[]>>;

export type FlowProfile = {
  slug: string;
  name: string;
  continuous: { links: string[]; status: string } | null;
};

export const NODE = {
  piWired: "pi-wired",
  piWifi: "pi-wifi",
  /** The Pi's monitor-mode radio: it scans the air and never carries a flow. */
  piRadio: "pi-radio",
  /** The Wi-Fi networks around the house that the radio hears. */
  nearby: "nearby",
  router: "router",
  internet: "internet",
  web: "web",
  serverDirect: "srv-direct",
  tunnelWired: "srv-wg-wired",
  tunnelWifi: "srv-wg-wifi",
  services: "srv-services",
} as const;

export const EDGE_IDS = [
  `${NODE.piWired}>${NODE.router}`,
  `${NODE.piWifi}>${NODE.router}`,
  `${NODE.router}>${NODE.internet}`,
  `${NODE.internet}>${NODE.web}`,
  `${NODE.internet}>${NODE.serverDirect}`,
  `${NODE.internet}>${NODE.tunnelWired}`,
  `${NODE.internet}>${NODE.tunnelWifi}`,
  `${NODE.tunnelWired}>${NODE.services}`,
  `${NODE.tunnelWifi}>${NODE.services}`,
] as const;

/** Not a flow edge: the radio listening to the networks around it. */
export const SCAN_EDGE = `${NODE.piRadio}>${NODE.nearby}`;

/** A result older than this means the Pi is not running the check right now. */
const STALE_MS = 30 * 60 * 1000;

const KINDS = new Set(["http", "ping", "mtr", "librespeed"]);

/** Tunnel addresses are the only private 10.7.x.x targets the checks use. */
export function isTunnelTarget(target: string): boolean {
  return /^(https?:\/\/)?10\.7\.\d+\.\d+/.test(target);
}

export function routeOf(slug: string, target: string): FlowRoute {
  if (isTunnelTarget(target)) return "tunnel";
  if (slug === "mtr-path") return "server-direct";
  return "web";
}

function linkOf(slug: string): FlowLink | null {
  if (slug === "wired") return "wired";
  if (slug === "wifi") return "wifi";
  return null;
}

function statusOf(status: string, at: string | null, now: number): FlowTest["status"] {
  if (!at || now - new Date(at).getTime() > STALE_MS) return "idle";
  if (status === "ok") return "ok";
  if (status === "degraded") return "degraded";
  if (status === "fail") return "fail";
  return "idle";
}

function formatMs(value: number | null): string {
  if (value == null) return "";
  return value >= 100 ? `${value.toFixed(0)} ms` : `${value.toFixed(1)} ms`;
}

const KIND_LABEL: Record<string, string> = { http: "HTTP", ping: "ICMP", mtr: "MTR", librespeed: "Bandwidth" };
const KIND_ORDER = ["HTTP", "ICMP", "MTR", "Bandwidth", "Flow"];

/** http-facebook and icmp-facebook are one service; so are the three path checks. */
function groupOf(slug: string): string {
  return slug.replace(/^(http|icmp|mtr)-/, "");
}

function groupNameOf(slug: string, name: string): string {
  if (groupOf(slug) === "path") return "Path to the HomeNetWatch server";
  return name.replace(/\s+(HTTP|ICMP|MTR)$/i, "") || name;
}

/**
 * Every check the server has switched on for this Pi, plus every application flow
 * that is running, as one row per link. Nothing here is a fixed list: a check
 * that is disabled, or a flow that is stopped, simply is not returned.
 */
export function buildFlowTests(
  tests: MonitorDetail["tests"] | undefined,
  profiles: FlowProfile[] | undefined,
  health: FlowHealth = {},
  now: number = Date.now(),
): FlowTest[] {
  const rows: FlowTest[] = [];
  for (const test of tests ?? []) {
    const link = linkOf(test.network_slug);
    if (!test.enabled || !link || !KINDS.has(test.kind)) continue;
    const rtt = formatMs(test.latest_rtt_ms);
    const route = routeOf(test.slug, test.target);
    rows.push({
      key: `check:${test.id}`,
      name: test.name,
      group: groupOf(test.slug),
      groupName: groupNameOf(test.slug, test.name),
      kindLabel: KIND_LABEL[test.kind] ?? test.kind,
      category: route === "web" ? "web" : "server",
      link,
      route,
      application: false,
      status: statusOf(test.latest_status, test.latest_at, now),
      detail: rtt,
      target: test.target,
      reason: test.latest_reason,
      lossPct: test.latest_loss_pct,
      checkedAt: test.latest_at,
    });
  }
  for (const profile of profiles ?? []) {
    if (!profile.continuous || profile.continuous.status !== "running") continue;
    for (const raw of profile.continuous.links) {
      const link: FlowLink | null = raw === "wired" ? "wired" : raw === "wireless" ? "wifi" : null;
      if (!link) continue;
      const latest = health[link]?.find((item) => item.slug === profile.slug)?.latest;
      const figures = latest
        ? [
            latest.rtt_ms != null ? formatMs(latest.rtt_ms) : "",
            latest.jitter_ms != null ? `jitter ${formatMs(latest.jitter_ms)}` : "",
            latest.loss_pct != null ? `loss ${latest.loss_pct.toFixed(1)}%` : "",
          ].filter(Boolean)
        : [];
      rows.push({
        key: `flow:${profile.slug}:${link}`,
        name: profile.name,
        group: `flow:${profile.slug}`,
        groupName: profile.name,
        kindLabel: "Flow",
        category: "application",
        link,
        route: "server-direct",
        application: true,
        status: latest?.verdict === "fail" ? "fail" : latest?.verdict === "pass" ? "ok" : "idle",
        detail: figures.join(" · ") || "continuous",
        target: "",
        reason: null,
        lossPct: latest?.loss_pct ?? null,
        checkedAt: null,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      Number(b.application) - Number(a.application) ||
      a.name.localeCompare(b.name) ||
      Number(a.link === "wifi") - Number(b.link === "wifi"),
  );
}

export type FlowPath = { nodes: string[]; role: "data" | "control" };

function start(link: FlowLink): string {
  return link === "wired" ? NODE.piWired : NODE.piWifi;
}

function tunnelEnd(link: FlowLink): string {
  return link === "wired" ? NODE.tunnelWired : NODE.tunnelWifi;
}

/**
 * The hops a check takes out to its destination, left to right. The return trip
 * is the same hops reversed, so only the way out is described.
 */
export function pathsFor(test: FlowTest): FlowPath[] {
  const home = [start(test.link), NODE.router, NODE.internet];
  const tunnel: FlowPath = { nodes: [...home, tunnelEnd(test.link), NODE.services], role: "data" };
  if (test.route === "tunnel") return [tunnel];
  if (test.route === "web") return [{ nodes: [...home, NODE.web], role: "data" }];
  const direct: FlowPath = { nodes: [...home, NODE.serverDirect], role: "data" };
  return test.application ? [direct, { ...tunnel, role: "control" }] : [direct];
}

export function edgeId(from: string, to: string): string {
  return `${from}>${to}`;
}

export const ROUTE_LABEL: Record<FlowRoute, string> = {
  web: "Direct to the internet",
  "server-direct": "Direct to the server",
  tunnel: "Through a WireGuard tunnel",
};

export const ROUTE_ORDER: FlowRoute[] = ["web", "server-direct", "tunnel"];

export type FlowGroup = {
  key: string;
  name: string;
  category: FlowCategory;
  flows: FlowTest[];
  /** The worst state among its flows, so a failing one is not hidden by passing ones. */
  status: FlowTest["status"];
};

export const CATEGORY_LABEL: Record<FlowCategory, string> = {
  web: "Direct to the internet",
  application: "Application flows",
  server: "To the HomeNetWatch server",
};

export const CATEGORY_ORDER: FlowCategory[] = ["web", "application", "server"];

const SEVERITY: Record<FlowTest["status"], number> = { fail: 3, degraded: 2, ok: 1, idle: 0 };

/**
 * One group per service, holding every flow it has: Facebook's HTTP and ICMP
 * checks on both links become one group of four, drawn together.
 */
export function groupFlows(tests: FlowTest[]): FlowGroup[] {
  const groups = new Map<string, FlowGroup>();
  for (const test of tests) {
    const group = groups.get(test.group);
    if (group) {
      group.flows.push(test);
    } else {
      groups.set(test.group, {
        key: test.group,
        name: test.groupName,
        category: test.category,
        flows: [test],
        status: "idle",
      });
    }
  }
  for (const group of groups.values()) {
    group.flows.sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kindLabel) - KIND_ORDER.indexOf(b.kindLabel) ||
        Number(a.link === "wifi") - Number(b.link === "wifi"),
    );
    group.status = group.flows.reduce<FlowTest["status"]>(
      (worst, flow) => (SEVERITY[flow.status] > SEVERITY[worst] ? flow.status : worst),
      "idle",
    );
  }
  return [...groups.values()].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name),
  );
}

export function hostOf(target: string): string {
  try {
    return new URL(target.includes("://") ? target : `https://${target}`).hostname;
  } catch {
    return target;
  }
}
