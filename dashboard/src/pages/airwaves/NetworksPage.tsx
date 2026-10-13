import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api";
import { useGuestGate } from "../../guestGate";
import SelectMenu from "../../components/SelectMenu";
import type { RfAp } from "../../types";
import { AIR_TREND_RANGE, type AirContext } from "./shared";

const PAGE = 25;

export default function AirwavesNetworks() {
  const ctx = useOutletContext<AirContext>();
  const run = useGuestGate();
  const [band, setBand] = useState("all");
  const [security, setSecurity] = useState("all");
  const [hidden, setHidden] = useState("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const qc = useQueryClient();
  const apsQ = useQuery({
    queryKey: ["rf-aps", ctx.agent.id, "rssi"],
    queryFn: () => api.rfAps(ctx.agent.id, { sort: "rssi" }),
    refetchInterval: ctx.refresh ? 15_000 : false,
  });
  const trust = useMutation({
    mutationFn: (ap: RfAp) => api.rfTrust(ctx.agent.id, ap.bssid, !ap.trusted),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rf-aps", ctx.agent.id] });
      void qc.invalidateQueries({ queryKey: ["rf-channels", ctx.agent.id] });
    },
  });

  const all = apsQ.data ?? [];
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    const rows = all.filter((ap) => {
      if (band !== "all" && ap.band !== band) return false;
      if (security === "open" && !isOpen(ap.security)) return false;
      if (security === "secured" && isOpen(ap.security)) return false;
      if (hidden === "hidden" && !ap.hidden) return false;
      if (hidden === "visible" && ap.hidden) return false;
      if (needle && !ap.ssid.toLowerCase().includes(needle) && !ap.bssid.toLowerCase().includes(needle)) return false;
      return true;
    });
    return rows.sort((left, right) => bandRank(left.band) - bandRank(right.band) || right.rssi_dbm - left.rssi_dbm);
  }, [all, band, security, hidden, needle]);
  const shown = filtered.slice(0, limit);
  const open = new Set(openIds);
  const allOpen = filtered.length > 0 && filtered.every((ap) => open.has(ap.bssid));

  if (!ctx.overviewLoading && !ctx.overview?.last_scan_at) {
    return <p className="npv-card air-empty-note">No data yet. {ctx.agent.name} has not uploaded a scan.</p>;
  }
  if (apsQ.isLoading) return <p className="npv-card air-empty-note">Loading nearby networks…</p>;
  if (apsQ.isError) return <p className="npv-card air-empty-note">Could not load nearby networks.</p>;

  function toggle(bssid: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(bssid)) next.delete(bssid);
      else next.add(bssid);
      return [...next];
    });
  }

  let previousBand = "";
  return (
    <section className="npv-card air-list-card">
      <div className="air-list-tools">
        <input
          className="air-filter"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setLimit(PAGE);
          }}
          placeholder="Filter networks"
          aria-label="Filter networks"
        />
        <Filter label="Band" value={band} onChange={(value) => { setBand(value); setLimit(PAGE); }}>
          <option value="all">All bands</option>
          <option value="2.4">2.4 GHz</option>
          <option value="5">5 GHz</option>
        </Filter>
        <Filter label="Security" value={security} onChange={(value) => { setSecurity(value); setLimit(PAGE); }}>
          <option value="all">All</option>
          <option value="secured">Secured</option>
          <option value="open">Open</option>
        </Filter>
        <Filter label="Hidden" value={hidden} onChange={(value) => { setHidden(value); setLimit(PAGE); }}>
          <option value="all">All</option>
          <option value="hidden">Hidden only</option>
          <option value="visible">Visible only</option>
        </Filter>
        <button
          className="air-text-btn"
          type="button"
          onClick={() => setOpenIds(allOpen ? [] : filtered.map((ap) => ap.bssid))}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
        <p className="air-caption">Showing {shown.length} of {filtered.length}</p>
      </div>
      {shown.length === 0 ? <p className="air-caption">No networks match these filters.</p> : null}
      {shown.map((ap) => {
        const header = ap.band !== previousBand;
        previousBand = ap.band;
        const count = filtered.filter((item) => item.band === ap.band).length;
        return (
          <div key={ap.bssid}>
            {header ? <h2 className="air-group">{ap.band} GHz · {count}</h2> : null}
            <NetworkRow
              ap={ap}
              expanded={open.has(ap.bssid)}
              onToggle={() => toggle(ap.bssid)}
              ctx={ctx}
              pending={trust.isPending}
              onTrust={() => run(() => trust.mutate(ap))}
            />
          </div>
        );
      })}
      {trust.isError ? <p className="error">Trust could not be saved.</p> : null}
      {shown.length < filtered.length ? (
        <button className="air-text-btn" type="button" onClick={() => setLimit((value) => value + PAGE)}>
          Show {filtered.length - shown.length} more
        </button>
      ) : null}
    </section>
  );
}

function bandRank(band: string): number {
  if (band === "2.4") return 0;
  if (band === "5") return 1;
  return 2;
}

function isOpen(security: string): boolean {
  return security === "Open" || security === "WEP";
}

function networkName(ap: RfAp): string {
  return ap.hidden || !ap.ssid ? "Hidden network" : ap.ssid;
}

function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="air-mini-filter">
      <span className="air-label">{label}</span>
      <SelectMenu className="air-select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </SelectMenu>
    </label>
  );
}

function NetworkRow({
  ap,
  expanded,
  onToggle,
  ctx,
  pending,
  onTrust,
}: {
  ap: RfAp;
  expanded: boolean;
  onToggle: () => void;
  ctx: AirContext;
  pending: boolean;
  onTrust: () => void;
}) {
  const name = networkName(ap);
  const open = isOpen(ap.security);
  return (
    <div className="air-list-item">
      <button className="air-row air-ap-row" type="button" aria-expanded={expanded} onClick={onToggle}>
        <span className="air-row-device"><strong>{name}</strong></span>
        <span className="air-row-signal">{`−${Math.abs(Math.round(ap.rssi_dbm))} dBm`}</span>
        <span className="air-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
        <span className="air-row-sub">
          Ch {ap.channel} · {ap.band} GHz · {open ? `${ap.security} · Risky` : ap.security}
        </span>
      </button>
      {expanded ? (
        <NetworkDetails ap={ap} ctx={ctx} pending={pending} onTrust={onTrust} />
      ) : null}
    </div>
  );
}

function NetworkDetails({
  ap,
  ctx,
  pending,
  onTrust,
}: {
  ap: RfAp;
  ctx: AirContext;
  pending: boolean;
  onTrust: () => void;
}) {
  const historyQ = useQuery({
    queryKey: ["rf-history", ctx.agent.id, ap.bssid, AIR_TREND_RANGE],
    queryFn: () => api.rfHistory(ctx.agent.id, ap.bssid, AIR_TREND_RANGE),
    refetchInterval: ctx.refresh ? 15_000 : false,
  });
  const open = isOpen(ap.security);
  const points = historyQ.data ?? [];
  const facts = [
    { label: "BSSID", value: ap.bssid },
    { label: "Vendor", value: ap.vendor || "Unknown" },
    { label: "Channel", value: `${ap.channel} · ${ap.channel_width} MHz` },
    { label: "Security", value: open ? `${ap.security} · Risky` : ap.security },
    { label: "PHY", value: ap.phy || "—" },
    { label: "First seen", value: shortWhen(ap.first_seen) },
    { label: "Last seen", value: shortWhen(ap.last_seen) },
  ];
  return (
    <div className="air-details">
      <div className="air-tiles">
        {facts.map((fact) => (
          <div className="air-tile" key={fact.label}>
            <span>{fact.label}</span>
            <strong>{fact.value}</strong>
          </div>
        ))}
      </div>
      <button
        className={ap.trusted ? "air-trust on" : "air-trust"}
        type="button"
        disabled={!ctx.operate || pending}
        onClick={onTrust}
      >
        {ap.trusted ? "Trusted" : "Trust"}
      </button>
      {!ctx.operate ? <p className="air-caption">An admin can mark this network as trusted.</p> : null}
      {historyQ.isLoading ? <p className="air-caption">Loading history…</p> : null}
      {historyQ.isError ? <p className="error">Could not load signal history.</p> : null}
      {points.length > 1 ? (
        <div className="air-net-spark">
          <span className="air-caption">Last 24 h</span>
          <ResponsiveContainer width="100%" height={60}>
            <LineChart data={points.map((point) => ({ t: point.t, rssi: point.rssi_dbm }))}>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={[-100, -30]} />
              <Tooltip />
              <Line dataKey="rssi" stroke="#5eead4" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  );
}

function shortWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
