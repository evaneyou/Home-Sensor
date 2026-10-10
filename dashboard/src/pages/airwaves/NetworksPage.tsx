import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api";
import SelectMenu from "../../components/SelectMenu";
import type { RfAp } from "../../types";
import { type AirContext } from "./shared";

export default function AirwavesNetworks() {
  const ctx = useOutletContext<AirContext>();
  const [band, setBand] = useState("all");
  const [security, setSecurity] = useState("all");
  const [hidden, setHidden] = useState("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
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
  const rows = useMemo(
    () =>
      all.filter((ap) => {
        if (band !== "all" && ap.band !== band) return false;
        if (security === "open" && !isOpen(ap.security)) return false;
        if (security === "secured" && isOpen(ap.security)) return false;
        if (hidden === "hidden" && !ap.hidden) return false;
        if (hidden === "visible" && ap.hidden) return false;
        if (needle && !ap.ssid.toLowerCase().includes(needle) && !ap.bssid.toLowerCase().includes(needle)) return false;
        return true;
      }),
    [all, band, security, hidden, needle],
  );

  if (!ctx.overviewLoading && !ctx.overview?.last_scan_at) {
    return <p className="npv-card air-empty-note">No data yet. {ctx.agent.name} has not uploaded a scan.</p>;
  }
  if (apsQ.isLoading) return <p className="npv-card air-empty-note">Loading nearby networks…</p>;
  if (apsQ.isError) return <p className="npv-card air-empty-note">Could not load nearby networks.</p>;

  const hiddenCount = rows.filter((ap) => ap.hidden).length;
  const openCount = rows.filter((ap) => isOpen(ap.security)).length;

  return (
    <div className="air-nearby">
      <div className="air-near-stats">
        <Stat label="Networks" value={String(rows.length)} note={`of ${all.length} seen`} />
        <Stat label="Hidden" value={String(hiddenCount)} note="no broadcast name" />
        <Stat label="Open networks" value={String(openCount)} note="no password, worth a look" warn={openCount > 0} />
      </div>
      <div className="npv-card air-filters">
        <Filter label="Band" value={band} onChange={setBand}>
          <option value="all">All bands</option>
          <option value="2.4">2.4 GHz</option>
          <option value="5">5 GHz</option>
        </Filter>
        <Filter label="Security" value={security} onChange={setSecurity}>
          <option value="all">All</option>
          <option value="secured">Secured</option>
          <option value="open">Open</option>
        </Filter>
        <Filter label="Hidden" value={hidden} onChange={setHidden}>
          <option value="all">All</option>
          <option value="hidden">Hidden only</option>
          <option value="visible">Visible only</option>
        </Filter>
        <label className="air-search">
          Search
          <span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9aa6c0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="SSID or BSSID" />
          </span>
        </label>
      </div>
      <section className="npv-card air-near-table">
        <div className="npv-card-head">
          <h2>Nearby networks</h2>
          <p className="npv-hint">Strongest signal first</p>
        </div>
        <div className="air-near-scroll">
          <div className="air-near-grid air-near-head">
            <span>Network</span>
            <span>Band</span>
            <span>Channel</span>
            <span className="air-near-sort">Signal ↓</span>
            <span>Security</span>
            <span>Vendor</span>
            <span>Last seen</span>
            <span>Trusted</span>
          </div>
          {rows.length === 0 ? (
            <p className="air-near-empty">No networks match these filters. Try clearing the search.</p>
          ) : (
            rows.map((ap) => (
              <NetworkRow
                key={ap.bssid}
                ap={ap}
                admin={ctx.admin}
                pending={trust.isPending}
                onOpen={() => setSelected(ap.bssid)}
                onTrust={() => trust.mutate(ap)}
              />
            ))
          )}
          {trust.isError ? <p className="error">Trust could not be saved.</p> : null}
        </div>
      </section>
      {selected ? (
        <NetworkOverlay
          ap={all.find((item) => item.bssid === selected) ?? null}
          ctx={ctx}
          pending={trust.isPending}
          onTrust={(ap) => trust.mutate(ap)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function isOpen(security: string): boolean {
  return security === "Open" || security === "WEP";
}

function Stat({ label, value, note, warn = false }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className="npv-stat air-near-stat">
      <div className="k">{label}</div>
      <div className={warn ? "v warn" : "v"}>{value}</div>
      <div className="s">{note}</div>
    </div>
  );
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
    <label>
      {label}
      <span className="air-select-wrap">
        <SelectMenu className="air-select" value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </SelectMenu>
      </span>
    </label>
  );
}

function NetworkRow({
  ap,
  admin,
  pending,
  onOpen,
  onTrust,
}: {
  ap: RfAp;
  admin: boolean;
  pending: boolean;
  onOpen: () => void;
  onTrust: () => void;
}) {
  const five = ap.band === "5";
  const tone = five ? "#b79cff" : "#7cb7ff";
  const open = isOpen(ap.security);
  const name = ap.hidden || !ap.ssid ? "Hidden network" : ap.ssid;
  const signal = ap.rssi_dbm >= -60 ? "#5eead4" : ap.rssi_dbm >= -75 ? "#ffc457" : "#ff8f85";
  const width = `${Math.max(0, Math.min(100, Math.round(((ap.rssi_dbm + 100) / 80) * 100)))}%`;
  return (
    <div className="air-near-grid air-near-row" onClick={onOpen}>
      <div className="air-near-id">
        <span className="air-near-icon" style={{ background: ap.hidden ? "rgba(255,255,255,0.06)" : five ? "rgba(183,156,255,0.16)" : "rgba(124,183,255,0.16)" }}>
          {ap.hidden ? <HiddenIcon /> : <WifiIcon color={tone} />}
        </span>
        <span>
          <strong style={{ color: ap.hidden ? "#9aa6c0" : "#eef2fb" }}>{name}</strong>
          <em>{ap.bssid}</em>
        </span>
      </div>
      <div className="air-near-band" data-label="Band">
        <span className="air-tag" style={{ background: five ? "rgba(183,156,255,0.16)" : "rgba(124,183,255,0.16)", color: tone }}>
          {ap.band} GHz
        </span>
      </div>
      <div className="air-near-channel" data-label="Channel">
        <strong>Ch {ap.channel}</strong>
        <em>{ap.channel_width} MHz</em>
      </div>
      <div className="air-near-signal" data-label="Signal">
        <strong>{`−${Math.abs(Math.round(ap.rssi_dbm))} dBm`}</strong>
        <span className="air-meter">
          <span style={{ width, background: signal }} />
        </span>
      </div>
      <div className="air-near-security" data-label="Security">
        <span className={open ? "air-tag risk" : "air-tag"}>{open ? `${ap.security} · Risky` : ap.security}</span>
      </div>
      <div className="air-near-vendor" data-label="Vendor">
        {ap.vendor || "Unknown"}
      </div>
      <div className="air-near-seen" data-label="Last seen">
        <strong>{formatLast(ap.last_seen, false)}</strong>
        <em>first {formatClock(ap.first_seen, false)}</em>
      </div>
      <div className="air-near-trust" data-label="Trusted">
        <button
          className={ap.trusted ? "air-trust on" : "air-trust"}
          type="button"
          disabled={!admin || pending}
          onClick={(event) => {
            event.stopPropagation();
            onTrust();
          }}
        >
          {ap.trusted ? "Trusted" : "Trust"}
        </button>
      </div>
    </div>
  );
}

function NetworkOverlay({
  ap,
  ctx,
  pending,
  onTrust,
  onClose,
}: {
  ap: RfAp | null;
  ctx: AirContext;
  pending: boolean;
  onTrust: (ap: RfAp) => void;
  onClose: () => void;
}) {
  const historyQ = useQuery({
    queryKey: ["rf-history", ctx.agent.id, ap?.bssid, ctx.range],
    queryFn: () => api.rfHistory(ctx.agent.id, ap!.bssid, ctx.range),
    enabled: Boolean(ap),
    refetchInterval: ctx.refresh ? 15_000 : false,
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  if (!ap) return null;
  const name = ap.hidden || !ap.ssid ? "Hidden network" : ap.ssid;
  const open = isOpen(ap.security);
  const points = (historyQ.data ?? []).map((point) => ({
    t: new Date(point.t).toLocaleString(),
    rssi: point.rssi_dbm,
  }));

  return (
    <div className="air-overlay" role="presentation">
      <button className="air-overlay-backdrop" type="button" aria-label="Close network details" onClick={onClose} />
      <section className="air-overlay-page" role="dialog" aria-modal="true" aria-label={name}>
        <div className="air-overlay-head">
          <div>
            <h2>{name}</h2>
            <p>{ap.bssid}</p>
          </div>
          <button className="air-trust" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="air-overlay-facts">
          <Fact label="Band" value={`${ap.band} GHz`} />
          <Fact label="Channel" value={`${ap.channel} · ${ap.channel_width} MHz`} />
          <Fact label="Signal" value={`−${Math.abs(Math.round(ap.rssi_dbm))} dBm`} />
          <Fact label="Security" value={open ? `${ap.security} · Risky` : ap.security} />
          <Fact label="Vendor" value={ap.vendor || "Unknown"} />
          <Fact label="PHY" value={ap.phy || "—"} />
          <Fact label="Last seen" value={formatLast(ap.last_seen)} />
          <Fact label="First seen" value={formatLast(ap.first_seen)} />
        </div>
        <button
          className={ap.trusted ? "air-trust on" : "air-trust"}
          type="button"
          disabled={!ctx.admin || pending}
          onClick={() => onTrust(ap)}
        >
          {ap.trusted ? "Trusted" : "Trust"}
        </button>
        {!ctx.admin ? <p className="npv-hint">An admin can mark this network as trusted.</p> : null}
        <h3>Signal in this range</h3>
        {historyQ.isLoading ? <p className="npv-hint">Loading history…</p> : null}
        {historyQ.isError ? <p className="error">Could not load signal history.</p> : null}
        {points.length > 0 ? (
          <div className="air-overlay-chart">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={points}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="t" hide />
                <YAxis domain={[-100, -30]} width={36} stroke="#9aa6c0" />
                <Tooltip />
                <Line dataKey="rssi" stroke="#5eead4" dot={false} strokeWidth={2} name="RSSI" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : historyQ.isSuccess ? (
          <p className="npv-hint">No samples in this range.</p>
        ) : null}
      </section>
    </div>
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

function formatLast(iso: string, withSeconds = true): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day} · ${formatClock(iso, withSeconds)}`;
}

function formatClock(iso: string, withSeconds = true): string {
  return new Date(iso).toLocaleTimeString([], withSeconds
    ? { hour: "numeric", minute: "2-digit", second: "2-digit" }
    : { hour: "numeric", minute: "2-digit" });
}

function WifiIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <path d="M12 20h.01" />
    </svg>
  );
}

function HiddenIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9aa6c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  );
}
