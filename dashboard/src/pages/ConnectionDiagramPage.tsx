import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import LiveDiagram from "../components/LiveDiagram";
import type { MonitorAdmin, MonitorDetail } from "../types";

const TUNNEL_STATE: Record<string, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  never_connected: "Not connected yet",
};

export default function ConnectionDiagramPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const diagram = useQuery({
    queryKey: ["connection-diagram"],
    queryFn: async () => {
      const response = await fetch("/diagrams/connection-detail.drawio");
      if (!response.ok) throw new Error("missing diagram");
      return response.text();
    },
    staleTime: Infinity,
  });
  const monitor = useQuery({
    queryKey: ["monitor", id],
    queryFn: () => api.monitor(id) as Promise<MonitorDetail>,
    enabled: Boolean(id),
  });
  const monitors = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api.monitors() as Promise<MonitorAdmin[]>,
  });
  const agent = monitors.data?.find((item) => item.id === id) ?? null;

  const back = new URLSearchParams();
  const network = params.get("network");
  const link = params.get("link");
  if (network) back.set("network", network);
  back.set("detail", "connection");
  if (link) back.set("link", link);
  const detail = describe(selectedId ?? "", monitor.data, agent, id);
  const notes = liveNotes(monitor.data, agent);

  return (
    <div className="connection-live-page">
      <h1 className="page-title">{monitor.data?.name ?? "Connection"}</h1>
      <p className="page-sub">Drag to pan, scroll to zoom, then click a device or a line for its connection.</p>
      <p>
        <Link to={`/monitors/${id}?${back.toString()}`}>Back to Internet Connection</Link>
      </p>
      <div className="connection-live">
        {diagram.isError ? (
          <p className="probe-text">The connection diagram could not be loaded.</p>
        ) : diagram.data ? (
          <LiveDiagram xml={diagram.data} selectedId={selectedId} onSelect={setSelectedId} notes={notes} />
        ) : (
          <p className="probe-text">Loading the connection diagram.</p>
        )}
        <aside className="connection-live-detail" aria-live="polite">
          {detail ? (
            <>
              <h2>{detail.title}</h2>
              {detail.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {detail.href ? <Link to={detail.href}>{detail.hrefLabel}</Link> : null}
            </>
          ) : (
            <p>Click a device or a connection in the diagram.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function liveNotes(monitor: MonitorDetail | undefined, agent: MonitorAdmin | null): Record<string, string> {
  const notes: Record<string, string> = {};
  if (agent?.lan_ip) notes.router = agent.lan_ip;
  if (monitor?.status) notes.pi = monitor.status;
  if (agent?.tunnel_state) notes.wg0 = TUNNEL_STATE[agent.tunnel_state] ?? agent.tunnel_state;
  if (agent?.wireless_tunnel_state) notes.wg1 = TUNNEL_STATE[agent.wireless_tunnel_state] ?? agent.wireless_tunnel_state;
  if (agent?.tunnel_address) notes.swg0 = agent.tunnel_state ? TUNNEL_STATE[agent.tunnel_state] ?? agent.tunnel_state : "";
  if (agent?.wireless_tunnel_address) {
    notes.swg1 = agent.wireless_tunnel_state ? TUNNEL_STATE[agent.wireless_tunnel_state] ?? agent.wireless_tunnel_state : "";
  }
  return notes;
}

function describe(
  cellId: string,
  monitor: MonitorDetail | undefined,
  agent: MonitorAdmin | null,
  monitorId: string,
): { title: string; lines: string[]; href?: string; hrefLabel?: string } | null {
  if (!cellId) return null;
  const wiredId = monitor?.tests.find((test) => test.network_slug === "wired")?.network_id;
  const wifiId = monitor?.tests.find((test) => test.network_slug === "wifi")?.network_id;
  const wiredHref = wiredId
    ? `/monitors/${monitorId}?network=${wiredId}&detail=isp&link=wired`
    : undefined;
  const wifiHref = wifiId
    ? `/monitors/${monitorId}?network=${wifiId}&detail=isp&link=wireless`
    : undefined;
  const airwaves = `/airwaves?agent=${monitorId}`;

  if (cellId === "router" || cellId === "home") {
    return {
      title: "Home router",
      lines: [
        monitor?.isp ? `ISP ${monitor.isp}` : "ISP name is not reported yet.",
        agent?.lan_ip ? `LAN ${agent.lan_ip}` : "The LAN address is assigned by DHCP.",
        "Ethernet and Wi-Fi both leave through this router.",
      ],
    };
  }
  if (cellId === "pi") {
    return {
      title: monitor?.name ?? "Remote agent",
      lines: [
        `Status ${monitor?.status ?? "unknown"}`,
        monitor?.last_seen_at ? `Last seen ${new Date(monitor.last_seen_at).toLocaleString()}` : "Not seen yet",
        "Checks go out through the wired LAN or the Wi-Fi client. Nothing inbound is open on the agent.",
      ],
    };
  }
  if (cellId === "wired-nic" || cellId === "eth") {
    return {
      title: "Wired LAN",
      lines: ["DHCP on the wired adapter.", ...checkLines(monitor, "wired")],
      href: wiredHref,
      hrefLabel: "Open wired checks",
    };
  }
  if (cellId === "wifi-nic" || cellId === "wlan") {
    return {
      title: "Wi-Fi client",
      lines: ["The Wi-Fi uplink used for tests.", ...checkLines(monitor, "wifi")],
      href: wifiHref,
      hrefLabel: "Open Wi-Fi checks",
    };
  }
  if (cellId === "radio" || cellId === "nearby" || cellId === "scan") {
    return {
      title: "Wi-Fi scans",
      lines: ["The monitor radio scans nearby networks and does not join them."],
      href: airwaves,
      hrefLabel: "Open Airwaves",
    };
  }
  if (cellId === "wg0" || cellId === "swg0" || cellId === "tun0") {
    return {
      title: "Wired tunnel",
      lines: [
        tunnelLine(agent?.tunnel_address, agent?.tunnel_state, "10.7.0.1", "51820"),
        "Path checks to the server ride this tunnel. Web services do not.",
        ...checkLines(monitor, "wired", isPathCheck),
      ],
      href: wiredHref,
      hrefLabel: "Open wired checks",
    };
  }
  if (cellId === "wg1" || cellId === "swg1" || cellId === "tun1") {
    return {
      title: "Wi-Fi tunnel",
      lines: [
        tunnelLine(agent?.wireless_tunnel_address, agent?.wireless_tunnel_state, "10.7.1.1", "51821"),
        "Path checks to the server ride this tunnel. Web services do not.",
        ...checkLines(monitor, "wifi", isPathCheck),
      ],
      href: wifiHref,
      hrefLabel: "Open Wi-Fi checks",
    };
  }
  if (cellId === "web" || cellId === "webs") {
    return {
      title: "Web services",
      lines: [
        "These checks leave through the home router and go straight to each public site.",
        "They do not enter either WireGuard tunnel.",
        ...webLines(monitor),
      ],
    };
  }
  if (cellId === "cloud" || cellId === "coax" || cellId === "wan") {
    return {
      title: "Internet",
      lines: [monitor?.isp ? `Path leaves through ${monitor.isp}.` : "The path leaves the home router for the server."],
    };
  }
  if (cellId === "srv" || cellId === "server") {
    return {
      title: "HomeNetWatch server",
      lines: ["Receives both tunnels. The API, dashboard, and database stay internal."],
    };
  }
  if (cellId === "enroll") {
    return {
      title: "Agent enrollment",
      lines: ["Outbound HTTPS on TCP 8848, with a pinned key."],
    };
  }
  if (cellId === "https") {
    return {
      title: "HTTPS",
      lines: ["The dashboard is served on TCP 443."],
    };
  }
  if (cellId === "api") {
    return {
      title: "API, dashboard, database",
      lines: ["These stay on the server and are not exposed as inbound ports on the agent."],
    };
  }
  return null;
}

function tunnelLine(
  address: string | null | undefined,
  state: MonitorAdmin["tunnel_state"],
  server: string,
  port: string,
): string {
  const where = address ? `${address} to ${server}` : `Not issued yet. Server end is ${server}`;
  const how = state ? TUNNEL_STATE[state] ?? state : "No handshake yet";
  return `${where}. UDP ${port}. ${how}.`;
}

function checkLines(
  monitor: MonitorDetail | undefined,
  slug: string,
  include: (testSlug: string) => boolean = () => true,
): string[] {
  const tests = (monitor?.tests ?? []).filter((test) => test.network_slug === slug && test.enabled && include(test.slug));
  if (tests.length === 0) return ["No checks are reporting on this link yet."];
  return tests.slice(0, 6).map((test) => `${test.name}: ${test.latest_status || "no result yet"}`);
}

function isPathCheck(slug: string): boolean {
  return slug === "http-path" || slug === "icmp-path" || slug === "mtr-path" || slug === "librespeed";
}

function isWebCheck(slug: string): boolean {
  const dash = slug.indexOf("-");
  if (dash <= 0) return false;
  const kind = slug.slice(0, dash);
  const key = slug.slice(dash + 1);
  return (kind === "http" || kind === "icmp") && key.length > 0 && key !== "path";
}

function webLines(monitor: MonitorDetail | undefined): string[] {
  const tests = (monitor?.tests ?? []).filter((test) => test.enabled && isWebCheck(test.slug));
  const byName = new Map<string, string>();
  for (const test of tests) {
    const status = test.latest_status || "no result yet";
    const previous = byName.get(test.name);
    if (!previous || status !== "ok") byName.set(test.name, status);
  }
  const lines = [...byName.entries()].slice(0, 6).map(([name, status]) => `${name}: ${status}`);
  return lines.length > 0 ? lines : ["No web services are reporting yet."];
}
