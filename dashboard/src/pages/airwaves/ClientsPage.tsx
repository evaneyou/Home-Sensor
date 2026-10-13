import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useOutletContext } from "react-router-dom";
import { api } from "../../api";
import { CHART_COLORS } from "../../chartTheme";
import type { RfClient } from "../../types";
import { type AirContext } from "./shared";

const PAGE = 25;

export default function AirwavesClients() {
  const ctx = useOutletContext<AirContext>();
  const clientsQ = useQuery({
    queryKey: ["rf-clients", ctx.agent.id],
    queryFn: () => api.rfClients(ctx.agent.id),
    refetchInterval: ctx.refresh ? 15_000 : false,
  });
  const [query, setQuery] = useState("");
  const [hidePrivate, setHidePrivate] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [openIds, setOpenIds] = useState<string[] | null>(null);

  const clients = clientsQ.data ?? [];
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      clients.filter((client) => {
        if (hidePrivate && client.randomized) return false;
        if (!needle) return true;
        const title = client.randomized ? "private address" : (client.vendor || client.mac).toLowerCase();
        return (
          title.includes(needle)
          || client.mac.toLowerCase().includes(needle)
          || client.ssid.toLowerCase().includes(needle)
          || client.bssid.toLowerCase().includes(needle)
        );
      }),
    [clients, hidePrivate, needle],
  );
  const shown = filtered.slice(0, limit);
  const open = new Set(openIds ?? (filtered[0] ? [filtered[0].mac] : []));
  const allOpen = filtered.length > 0 && filtered.every((client) => open.has(client.mac));

  if (clientsQ.isLoading) return <div className="state-box">Loading clients…</div>;
  if (clientsQ.isError) return <div className="state-box">Could not load clients.</div>;
  if (clients.length === 0) {
    return (
      <section className="npv-card air-empty">
        <h2>No clients yet</h2>
        <p>Devices show up here when they join an access point you marked trusted.</p>
      </section>
    );
  }

  function toggle(mac: string) {
    setOpenIds((current) => {
      const next = new Set(current ?? (filtered[0] ? [filtered[0].mac] : []));
      if (next.has(mac)) next.delete(mac);
      else next.add(mac);
      return [...next];
    });
  }

  return (
    <section className="npv-card air-list-card">
      <div className="air-list-tools">
        <input
          className="air-filter"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE);
          }}
          placeholder="Filter clients"
          aria-label="Filter clients"
        />
        <label className="air-check">
          <input
            type="checkbox"
            checked={hidePrivate}
            onChange={(event) => {
              setHidePrivate(event.target.checked);
              setLimit(PAGE);
            }}
          />
          Hide private addresses
        </label>
        <button
          className="air-text-btn"
          type="button"
          onClick={() => setOpenIds(allOpen ? [] : filtered.map((client) => client.mac))}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
        <p className="air-caption">Showing {shown.length} of {filtered.length}</p>
      </div>
      <div className="air-colhead" aria-hidden="true">
        <span>Device</span>
        <span>Network and AP</span>
        <span>Band and channel</span>
        <span>Signal</span>
        <span>Retries</span>
        <span>Last seen</span>
      </div>
      {shown.length === 0 ? <p className="air-caption">No clients match this filter.</p> : null}
      {shown.map((client) => (
        <ClientRow
          key={client.mac}
          client={client}
          expanded={open.has(client.mac)}
          onToggle={() => toggle(client.mac)}
        />
      ))}
      {shown.length < filtered.length ? (
        <button className="air-text-btn" type="button" onClick={() => setLimit((value) => value + PAGE)}>
          Show {filtered.length - shown.length} more
        </button>
      ) : null}
    </section>
  );
}

function ClientRow({ client, expanded, onToggle }: { client: RfClient; expanded: boolean; onToggle: () => void }) {
  const title = client.randomized ? "Private address" : client.vendor || client.mac;
  const network = client.ssid || "Name not heard";
  const band = client.band ? `${client.band} GHz` : "Band unknown";
  const channel = client.channel ? `ch ${client.channel}` : "channel unknown";
  const seen = shortWhen(client.last_seen);
  return (
    <div className="air-list-item">
      <button className="air-row" type="button" aria-expanded={expanded} onClick={onToggle}>
        <span className="air-row-device">
          <strong>{title}</strong>
          <em>{client.mac}</em>
        </span>
        <span className="air-row-net">
          <strong>{network}</strong>
          <em>{client.bssid}</em>
        </span>
        <span className="air-row-band">{band} · {channel}</span>
        <span className="air-row-signal">
          <span className="air-sigbar" aria-hidden="true"><i style={{ width: meter(client.signal) }} /></span>
          <span>{client.signal == null ? "—" : dbm(client.signal)}</span>
        </span>
        <span className="air-row-retries">{client.retries ? client.retries.toLocaleString() : "0"}</span>
        <span className="air-row-seen">{seen}</span>
        <span className="air-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <span className="air-row-sub">{band} · {channel} · {network} · {seen}</span>
      </button>
      {expanded ? <ClientDetails client={client} /> : null}
    </div>
  );
}

function ClientDetails({ client }: { client: RfClient }) {
  const plotted = client.points.filter((point) => point.rssi_dbm != null && point.rssi_dbm !== 0);
  const roams = client.points.filter((point) => point.roam);
  return (
    <div className="air-details">
      <div className="air-tiles">
        {clientFacts(client).map((fact) => (
          <div className="air-tile" key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>
      {plotted.length > 1 ? (
        <div className="air-client-spark" aria-hidden="true">
          <ResponsiveContainer width="100%" height={60}>
            <LineChart data={plotted}>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={["dataMin - 5", "dataMax + 5"]} />
              <Tooltip />
              <Line dataKey="rssi_dbm" stroke={CHART_COLORS[0]} dot={false} strokeWidth={2} />
              {roams.map((point) => (
                <ReferenceDot key={point.t} x={point.t} y={point.rssi_dbm} r={4} fill="#ffc457" stroke="none" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      {roams.map((point) => (
        <p key={point.t} className="air-caption">Roamed to {point.bssid} at {shortWhen(point.t)}</p>
      ))}
    </div>
  );
}

function clientFacts(client: RfClient): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [
    { label: "Network", value: client.ssid || "Name not heard" },
    { label: "Access point", value: client.bssid },
    { label: "Client MAC", value: client.mac },
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
  if (client.first_seen) facts.push({ label: "First seen", value: shortWhen(client.first_seen) });
  facts.push({ label: "Last seen", value: shortWhen(client.last_seen) });
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

function meter(value: number | null): string {
  if (value == null) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(((value + 100) / 80) * 100)))}%`;
}

function byteText(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function shortWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
