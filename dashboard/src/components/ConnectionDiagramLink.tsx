import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { MonitorAdmin, MonitorDetail } from "../types";
import ConnectionMini, { type LinkLive } from "./ConnectionMini";

export default function ConnectionDiagramLink({
  monitorId,
  wired,
  wireless,
}: {
  monitorId?: string;
  wired: LinkLive;
  wireless: LinkLive;
}) {
  const [params] = useSearchParams();
  // The same queries the monitor page and the connection page use, so they are usually already cached.
  const monitor = useQuery({
    queryKey: ["monitor", monitorId],
    queryFn: () => api.monitor(monitorId ?? "") as Promise<MonitorDetail>,
    enabled: Boolean(monitorId),
  });
  const monitors = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api.monitors() as Promise<MonitorAdmin[]>,
    enabled: Boolean(monitorId),
  });
  if (!monitorId) return null;
  const agent = monitors.data?.find((item) => item.id === monitorId);

  const next = new URLSearchParams();
  const network = params.get("network");
  const link = params.get("link");
  if (network) next.set("network", network);
  next.set("detail", "connection");
  if (link) next.set("link", link);
  return (
    <Link
      className="connection-diagram-link"
      to={`/monitors/${monitorId}/connection?${next.toString()}`}
      aria-label="Open the detailed connection diagram"
    >
      <ConnectionMini
        live={{
          name: monitor.data?.name,
          online: monitor.data ? monitor.data.status === "online" : undefined,
          isp: monitor.data?.isp,
          wired,
          wireless,
          tunnels: { wired: agent?.tunnel_state ?? undefined, wireless: agent?.wireless_tunnel_state ?? undefined },
        }}
      />
    </Link>
  );
}
