import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import NetworkPathView from "../components/NetworkPathView";
import type { MonitorAdmin, WebServiceSetting } from "../types";

const SERVER_DESTINATION = { id: "server", label: "HomeNetWatch server" };

export default function PathPage() {
  const [params, setParams] = useSearchParams();
  const monitorsQ = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api.monitors() as Promise<MonitorAdmin[]>,
  });
  const servicesQ = useQuery({
    queryKey: ["web-services"],
    queryFn: () => api.webServices() as Promise<WebServiceSetting[]>,
  });

  if (monitorsQ.isLoading || servicesQ.isLoading) return <div className="state-box">Loading path…</div>;
  if (monitorsQ.isError || servicesQ.isError) return <div className="state-box">Could not load Path View.</div>;

  const monitors = monitorsQ.data ?? [];
  if (monitors.length === 0) return <div className="state-box">No remote agents yet.</div>;

  const requested = params.get("agent");
  const agent = monitors.find((monitor) => monitor.id === requested) ?? monitors[0];
  const link = params.get("link") === "wireless" ? "wireless" : "wired";
  const destinations = [SERVER_DESTINATION, ...(servicesQ.data ?? []).map((service) => ({ id: service.key, label: service.label }))];
  const requestedDestination = params.get("destination") ?? "server";
  const destination = destinations.some((item) => item.id === requestedDestination) ? requestedDestination : "server";

  function update(next: { agent?: string; destination?: string }) {
    const query = new URLSearchParams(params);
    query.set("agent", next.agent ?? agent.id);
    query.set("link", link);
    query.set("destination", next.destination ?? destination);
    setParams(query);
  }

  return (
    <NetworkPathView
      monitorId={agent.id}
      link={link}
      destination={destination}
      agents={monitors.map((monitor) => ({ id: monitor.id, name: monitor.name }))}
      destinations={destinations}
      agentOnline={agent.status === "online"}
      onAgent={(id) => update({ agent: id })}
      onDestination={(id) => update({ destination: id })}
    />
  );
}
