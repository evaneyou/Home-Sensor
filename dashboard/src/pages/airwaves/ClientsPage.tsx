import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useOutletContext } from "react-router-dom";
import { api } from "../../api";
import { CHART_COLORS } from "../../chartTheme";
import type { RfClient } from "../../types";
import { type AirContext } from "./shared";

export default function AirwavesClients() {
  const ctx = useOutletContext<AirContext>();
  const clientsQ = useQuery({
    queryKey: ["rf-clients", ctx.agent.id, ctx.range],
    queryFn: () => api.rfClients(ctx.agent.id, ctx.range),
    refetchInterval: ctx.refresh ? 15_000 : false,
  });

  if (clientsQ.isLoading) return <div className="state-box">Loading clients…</div>;
  if (clientsQ.isError) return <div className="state-box">Could not load clients.</div>;
  const clients = clientsQ.data ?? [];
  if (clients.length === 0) {
    return (
      <section className="npv-card air-empty">
        <h2>No clients yet</h2>
        <p>Devices show up here when they join an access point you marked trusted.</p>
      </section>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {clients.map((client) => (
        <ClientCard key={client.mac} client={client} />
      ))}
    </div>
  );
}

function ClientCard({ client }: { client: RfClient }) {
  const roams = client.points.filter((point) => point.roam);
  return (
    <section className="npv-card">
      <div className="npv-card-head">
        <h2>{client.mac}</h2>
        <p className="npv-hint">
          {client.bssid}
          {client.randomized ? " · randomized MAC" : ""} · {Math.round(client.signal)} dBm
        </p>
      </div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={client.points}>
            <XAxis dataKey="t" hide />
            <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
            <Tooltip />
            <Line dataKey="rssi_dbm" stroke={CHART_COLORS[0]} dot={false} strokeWidth={2} />
            {roams.map((point) => (
              <ReferenceDot key={point.t} x={point.t} y={point.rssi_dbm} r={5} fill="#ffc457" stroke="none" />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {roams.map((point) => (
        <p key={point.t} className="npv-hint">
          Roamed to {point.bssid} at {new Date(point.t).toLocaleString()}
        </p>
      ))}
    </section>
  );
}
