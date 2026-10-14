import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import FlowSection from "../components/FlowSection";
import type { MonitorAdmin, MonitorDetail } from "../types";

export default function ConnectionDiagramPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
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

  return (
    <div className="connection-live-page">
      <h1 className="page-title">{monitor.data?.name ?? "Connection"}</h1>
      <p>
        <Link to={`/monitors/${id}?${back.toString()}`}>Back to Internet Connection</Link>
      </p>
      <FlowSection monitorId={id} monitor={monitor.data} agent={agent} />
    </div>
  );
}
