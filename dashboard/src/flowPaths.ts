import type { MonitorDetail } from "./types";

export type FlowLink = "wired" | "wifi";

/**
 * Where a check's packets go.
 * - web: a public website, straight out through the home router.
 * - server-direct: the HomeNetWatch server's public address, not through a tunnel.
 * - tunnel: the server's WireGuard address, inside the tunnel for that link.
 */
export type FlowRoute = "web" | "server-direct" | "tunnel";

export type FlowTest = {
  key: string;
  name: string;
  link: FlowLink;
  route: FlowRoute;
  /** An always-on application flow also keeps its control channel in the tunnel. */
  application: boolean;
  status: "ok" | "degraded" | "fail" | "idle";
  detail: string;
};

export type FlowProfile = {
  slug: string;
  name: string;
  continuous: { links: string[]; status: string } | null;
};

export const NODE = {
  piWired: "pi-wired",
  piWifi: "pi-wifi",
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

/**
 * Every check the server has switched on for this Pi, plus every application flow
 * that is running, as one row per link. Nothing here is a fixed list: a check
 * that is disabled, or a flow that is stopped, simply is not returned.
 */
export function buildFlowTests(
  tests: MonitorDetail["tests"] | undefined,
  profiles: FlowProfile[] | undefined,
  now: number = Date.now(),
): FlowTest[] {
  const rows: FlowTest[] = [];
  for (const test of tests ?? []) {
    const link = linkOf(test.network_slug);
    if (!test.enabled || !link || !KINDS.has(test.kind)) continue;
    const rtt = formatMs(test.latest_rtt_ms);
    rows.push({
      key: `check:${test.id}`,
      name: test.name,
      link,
      route: routeOf(test.slug, test.target),
      application: false,
      status: statusOf(test.latest_status, test.latest_at, now),
      detail: rtt,
    });
  }
  for (const profile of profiles ?? []) {
    if (!profile.continuous || profile.continuous.status !== "running") continue;
    for (const raw of profile.continuous.links) {
      const link: FlowLink | null = raw === "wired" ? "wired" : raw === "wireless" ? "wifi" : null;
      if (!link) continue;
      rows.push({
        key: `flow:${profile.slug}:${link}`,
        name: profile.name,
        link,
        route: "server-direct",
        application: true,
        status: "ok",
        detail: "continuous",
      });
    }
  }
  return rows;
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
