import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { api } from "../../api";
import { CHART_COLORS } from "../../chartTheme";
import WaitButton from "../../components/WaitButton";
import type { RfBandAdvice, RfOverview } from "../../types";
import { type AirContext, scanLabel } from "./shared";

export default function AirwavesOverview() {
  const ctx = useOutletContext<AirContext>();
  const qc = useQueryClient();
  const scan = useMutation({
    mutationFn: () => api.rfScanNow(ctx.agent.id),
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
        {ctx.admin ? <ScanButton ctx={ctx} pending={scan.isPending} onScan={() => scan.mutate()} /> : null}
      </div>
    );
  }

  const waiting = scan.isPending || overview.scan_requested;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p className="air-reason">{overview.headline}</p>
      <div className="air-kicker">{modeLabel(overview.airwave_mode)}</div>
      <section className="npv-card">
        <h2>Recent alerts</h2>
        {overview.alerts.length === 0 ? (
          <p className="npv-hint">No alerts in this range.</p>
        ) : (
          overview.alerts.map((alert) => (
            <p key={`${alert.observed_at}-${alert.alert_type}-${alert.bssid}`}>
              {alert.alert_type}
              {alert.bssid ? ` · ${alert.bssid}` : ""} · {alert.text}
            </p>
          ))
        )}
      </section>
      <div className="npv-stats">
        {overview.bands.map((band) => (
          <BandCard key={band.band} band={band} overview={overview} />
        ))}
      </div>
      <div className="npv-card air-rec">
        <div>
          <h2>Run scan now</h2>
          <p>
            {ctx.agent.name}
            {ctx.agent.location_label ? ` · ${ctx.agent.location_label}` : ""}
          </p>
          <p className="cell-meta">{waiting ? "Waiting for the agent to upload a scan." : scanLabel(overview.last_scan_at)}</p>
        </div>
        {ctx.admin ? (
          <WaitButton busy={waiting} label="Run scan now" onClick={() => scan.mutate()} />
        ) : (
          <p className="cell-meta">An admin can ask the agent to scan.</p>
        )}
        {scan.isError ? <div className="error">The scan request did not go through.</div> : null}
      </div>
    </div>
  );
}

function modeLabel(mode: string): string {
  if (mode === "kismet") return "Kismet capture";
  if (mode === "scan") return "Scan capture";
  return "Capture off";
}

function BandCard({ band, overview }: { band: RfBandAdvice; overview: RfOverview }) {
  const key = band.band === "5" ? "count_5" : "count_24";
  const points = overview.sparkline.map((point) => ({ t: point.t, value: point[key] }));
  return (
    <section className="npv-stat">
      <h2>{band.band} GHz</h2>
      <p className="v">{band.ap_count}</p>
      <p className="s">networks on the latest scan</p>
      <p className="s">Busiest channel {band.busiest_channel ?? "—"}</p>
      <p className="s">Recommended channel {band.recommended_channel}</p>
      <div className="air-spark" aria-hidden="true">
        {points.length > 1 ? (
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={points}>
              <YAxis hide domain={[0, "auto"]} />
              <Tooltip />
              <Area dataKey="value" stroke={CHART_COLORS[0]} fill={CHART_COLORS[0]} fillOpacity={0.25} strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <span className="cell-meta">Not enough scans in this range for a sparkline.</span>
        )}
      </div>
    </section>
  );
}

function ScanButton({ ctx, pending, onScan }: { ctx: AirContext; pending: boolean; onScan: () => void }) {
  const waiting = pending || Boolean(ctx.overview?.scan_requested);
  return (
    <div className="air-scan-inline">
      <WaitButton busy={waiting} label={`Run scan now on ${ctx.agent.name}`} onClick={onScan} />
    </div>
  );
}
