import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import FlowSection from "../components/FlowSection";
import MonitorTabs, { monitorNetworks } from "../components/MonitorTabs";
import type { MonitorAdmin, MonitorDetail } from "../types";

/**
 * The network path diagram sits under Internet Connection, so that tab is the one lit. The bar is the
 * monitor page's own, and picking a tab goes to the monitor page for it.
 */
export default function ConnectionDiagramPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
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
  const link = params.get("link") === "wireless" ? "wireless" : "wired";
  const wanId = monitorNetworks(monitor.data?.tests).find((network) => network.slug === "wan")?.id ?? null;

  return (
    <div className="connection-live-page">
      <h1 className="page-title">{monitor.data?.name ?? "Connection"}</h1>
      <div className="page-tabs">
        <MonitorTabs
          tests={monitor.data?.tests}
          activeTab={wanId}
          onWired={false}
          onWireless={false}
          onConnection
          link={link}
          onSelect={(next) => navigate(`/monitors/${id}?${new URLSearchParams(next).toString()}`)}
        />
      </div>
      <FlowSection monitorId={id} monitor={monitor.data} agent={agent} />
    </div>
  );
}
