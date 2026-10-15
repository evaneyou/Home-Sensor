import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { api } from "../../api";
import { useGuestGate } from "../../guestGate";
import { CHART_COLORS } from "../../chartTheme";
import WaitButton from "../../components/WaitButton";
import type { RfBandAdvice, RfOverview, User } from "../../types";
import { type AirContext, scanLabel } from "./shared";

export default function AirwavesOverview() {
  const ctx = useOutletContext<AirContext>();
  const run = useGuestGate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const qc = useQueryClient();
  const scan = useMutation({
    mutationFn: () => {
      const csrf = me.data?.csrf_token;
      if (!csrf) throw new Error("The session is missing a CSRF token. Reload the page.");
      return api.rfScanNow(ctx.agent.id, csrf);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rf-overview", ctx.agent.id] });
    },
  });
  const overview = ctx.overview;

  if (ctx.overviewLoading) return <div className="state-box">Loading the latest scan…</div>;
  if (ctx.overviewError) return <div className="state-box">Could not load airwave data.</div>;
  if (!overview?.last_scan_at) {
    return (
      <div className="state-box">
        No data yet. {ctx.agent.name} uploads scans on its own.
        {ctx.operate ? <ScanButton ctx={ctx} pending={scan.isPending} onScan={() => run(() => scan.mutate())} /> : null}
      </div>
    );
  }

  const waiting = scan.isPending || overview.scan_requested;
  const place = [ctx.agent.name, ctx.agent.location_label].filter(Boolean).join(" · ");
  return (
    <div className="air-overview">
      <div className="air-bands">
        {overview.bands.map((band) => (
          <BandCard key={band.band} band={band} overview={overview} />
        ))}
      </div>
      <section className="npv-card air-scan-card">
        <div className="air-scan-copy">
          <h2>Run scan now</h2>
          <p>{place}</p>
        </div>
        {ctx.operate ? (
          <WaitButton className="air-scan-btn" busy={waiting} label="Scan now" onClick={() => run(() => scan.mutate())} />
        ) : (
          <p className="air-caption">An admin can ask the agent to scan.</p>
        )}
        <p className="air-caption air-scan-status">{waiting ? "Waiting for the agent to upload a scan." : scanLabel(overview.last_scan_at)}</p>
        {scan.isError ? <div className="error">The scan request did not go through.</div> : null}
      </section>
      <Alerts alerts={overview.alerts} />
    </div>
  );
}

function Alerts({ alerts }: { alerts: RfOverview["alerts"] }) {
  const body = alerts.length === 0 ? (
    <p className="npv-hint">No alerts in this range.</p>
  ) : (
    alerts.map((alert) => (
      <p key={`${alert.observed_at}-${alert.alert_type}-${alert.bssid}`}>
        {alert.alert_type}
        {alert.bssid ? ` · ${alert.bssid}` : ""} · {alert.text}
      </p>
    ))
  );
  return (
    <section className="npv-card air-alerts">
      <h2 className="air-alerts-title">Recent alerts</h2>
      <details className="air-alerts-phone">
        <summary>
          Recent alerts <span className="air-badge">{alerts.length}</span>
        </summary>
        <div className="air-alerts-list">{body}</div>
      </details>
      <div className="air-alerts-desk">{body}</div>
    </section>
  );
}

function BandCard({ band, overview }: { band: RfBandAdvice; overview: RfOverview }) {
  const key = band.band === "5" ? "count_5" : "count_24";
  const points = overview.sparkline.map((point) => ({ t: point.t, value: point[key] }));
  return (
    <section className="npv-card air-band">
      <div className="air-band-line">
        <h2>{band.band} GHz</h2>
        <span>{band.ap_count} networks</span>
      </div>
      <div className="air-band-stats">
        <div className="air-box">
          <span>Busiest channel</span>
          <strong>{band.busiest_channel ?? "—"}</strong>
        </div>
        <div className="air-box air-box-accent">
          <span>Recommended</span>
          <strong>{band.recommended_channel}</strong>
        </div>
      </div>
      {points.length > 1 ? (
        <div className="air-spark">
          <span className="air-caption">Last 1 h</span>
          <div className="air-spark-plot" aria-hidden="true">
            <ResponsiveContainer width="100%" height={48}>
              <AreaChart data={points}>
                <YAxis hide domain={[0, "auto"]} />
                <Tooltip />
                <Area dataKey="value" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.25} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ScanButton({ ctx, pending, onScan }: { ctx: AirContext; pending: boolean; onScan: () => void }) {
  const waiting = pending || Boolean(ctx.overview?.scan_requested);
  return (
    <div className="air-scan-inline">
      <WaitButton className="air-scan-btn" busy={waiting} label="Scan now" onClick={onScan} />
    </div>
  );
}
