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
  const plotted = client.points.filter((point) => point.rssi_dbm != null && point.rssi_dbm !== 0);
  const named = Boolean(client.vendor) && !client.randomized;
  const title = client.randomized ? "Private address" : client.vendor || client.mac;
  const facts = clientFacts(client);
  return (
    <section className="npv-card">
      <div className="npv-card-head">
        <h2>{title}</h2>
        <p className="npv-hint">
          {named || client.randomized ? `${client.mac}` : client.bssid}
          {client.randomized ? " · randomized MAC" : ""}
        </p>
      </div>
      <div className="air-overlay-facts" style={{ marginTop: 16 }}>
        {facts.map((fact) => (
          <Fact key={fact.label} label={fact.label} value={fact.value} />
        ))}
      </div>
      {plotted.length > 1 ? (
        <div style={{ height: 160, marginTop: 16 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={plotted}>
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
      ) : null}
      {roams.map((point) => (
        <p key={point.t} className="npv-hint">
          Roamed to {point.bssid} at {new Date(point.t).toLocaleString()}
        </p>
      ))}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function clientFacts(client: RfClient): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [
    { label: "Network", value: client.ssid || "Name not heard" },
    { label: "Access point", value: client.bssid },
  ];
  if (client.channel) {
    facts.push({ label: "Channel", value: client.band ? `${client.channel} · ${client.band} GHz` : String(client.channel) });
  }
  facts.push({ label: "Signal", value: signalText(client) });
  if (client.packets) facts.push({ label: "Packets", value: client.packets.toLocaleString() });
  if (client.data_bytes) facts.push({ label: "Data", value: byteText(client.data_bytes) });
  if (client.retries) facts.push({ label: "Retries", value: client.retries.toLocaleString() });
  if (client.disconnects) facts.push({ label: "Disconnects", value: client.disconnects.toLocaleString() });
  if (client.probed_ssids.length) facts.push({ label: "Probed networks", value: client.probed_ssids.join(", ") });
  if (client.first_seen) facts.push({ label: "First seen", value: new Date(client.first_seen).toLocaleString() });
  facts.push({ label: "Last seen", value: new Date(client.last_seen).toLocaleString() });
  return facts;
}

function signalText(client: RfClient): string {
  if (!client.signal) return "No reading";
  const last = dbm(client.signal);
  if (client.signal_min != null && client.signal_max != null && client.signal_min !== client.signal_max) {
    return `${last} · ${dbm(client.signal_min)} to ${dbm(client.signal_max)}`;
  }
  return last;
}

function dbm(value: number): string {
  return `−${Math.abs(Math.round(value))} dBm`;
}

function byteText(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
