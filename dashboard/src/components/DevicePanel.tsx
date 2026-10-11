import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import CityMap from "./CityMap";
import { formatChartHour } from "../chartTime";
import { useChartZoom } from "../useChartZoom";
import type { DeviceReport } from "../types";

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function mb(used: number, total: number): string {
  return `${used} / ${total} MB`;
}

type DevicePoint = DeviceReport["points"][number];

function HealthChart({
  title,
  data,
  dataKey,
  color,
  unit,
  axisWidth = 36,
}: {
  title: string;
  data: DevicePoint[];
  dataKey: "cpu_percent" | "temp_c" | "mem_used_mb" | "disk_used_mb";
  color: string;
  unit: string;
  axisWidth?: number;
}) {
  const zoom = useChartZoom(data);
  return (
    <div className="chart-zoom" ref={zoom.boxRef} onDoubleClick={zoom.onDoubleClick}>
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={zoom.visible} onMouseDown={zoom.onMouseDown} onMouseMove={zoom.onMouseMove}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="t" tickFormatter={formatChartHour} minTickGap={28} stroke="var(--muted)" />
          <YAxis stroke="var(--muted)" width={axisWidth} />
          <Tooltip
            labelFormatter={(value) => formatChartHour(String(value))}
            formatter={(value) => [`${value} ${unit}`, title]}
          />
          {zoom.selection}
          <Line type="monotone" dataKey={dataKey} stroke={color} dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DevicePanel({ monitorId }: { monitorId: string }) {
  const deviceQ = useQuery({
    queryKey: ["monitor-device", monitorId],
    queryFn: () => api.monitorDevice(monitorId) as Promise<DeviceReport>,
    refetchInterval: 15000,
  });

  if (deviceQ.isLoading) return <div className="panel">Loading device health…</div>;
  if (deviceQ.isError || !deviceQ.data) return <div className="panel">Could not load device health.</div>;

  const report = deviceQ.data;
  const latest = report.latest;
  const place = [report.location_label, report.region, report.country].filter(Boolean).join(", ");
  const savedPin =
    report.latitude != null && report.longitude != null
      ? { latitude: report.latitude, longitude: report.longitude }
      : null;

  return (
    <>
      <section className="panel device-panel">
        <h2>Location</h2>
        <p className="muted">{place || "No location saved."}</p>
        {savedPin ? (
          <CityMap
            className="location-map"
            latitude={savedPin.latitude}
            longitude={savedPin.longitude}
            label={place || report.name}
            zoomControl={false}
          />
        ) : null}
      </section>
      <section className="panel device-panel">
        <div className="device-head">
          <h2>Device</h2>
          <span className={report.connected ? "device-live" : "device-quiet"}>
            {report.connected ? "Connected" : "Waiting"}
          </span>
        </div>
        {latest ? (
          <div className="device-stats">
            <div>
              <span>CPU</span>
              <strong>{latest.cpu_percent.toFixed(1)}%</strong>
            </div>
            <div>
              <span>Load</span>
              <strong>{latest.load_1.toFixed(2)}</strong>
            </div>
            <div>
              <span>Memory</span>
              <strong>{mb(latest.mem_used_mb, latest.mem_total_mb)}</strong>
            </div>
            <div>
              <span>Disk</span>
              <strong>{mb(latest.disk_used_mb, latest.disk_total_mb)}</strong>
            </div>
            <div>
              <span>Temperature</span>
              <strong>{latest.temp_c == null ? "—" : `${latest.temp_c.toFixed(1)}°C`}</strong>
            </div>
            <div>
              <span>Uptime</span>
              <strong>{formatUptime(latest.uptime_seconds)}</strong>
            </div>
            <div>
              <span>Address</span>
              <strong>{report.lan_ip || latest.lan_ip || "—"}</strong>
            </div>
            <div>
              <span>Host</span>
              <strong>{report.hostname || "—"}</strong>
            </div>
            <div>
              <span>Agent</span>
              <strong>{report.agent_version || "—"}</strong>
            </div>
          </div>
        ) : (
          <p className="muted">This remote agent has not reported health yet.</p>
        )}
        {latest?.last_error ? <p className="state-box">{latest.last_error}</p> : null}
        {report.points.length > 1 ? (
          <div className="device-charts">
            <HealthChart title="CPU" data={report.points} dataKey="cpu_percent" color="var(--accent)" unit="%" />
            <HealthChart title="Temperature" data={report.points} dataKey="temp_c" color="var(--degraded)" unit="°C" />
            <HealthChart title="Memory" data={report.points} dataKey="mem_used_mb" color="var(--ok)" unit="MB" axisWidth={48} />
            <HealthChart title="Disk" data={report.points} dataKey="disk_used_mb" color="var(--role-ixp)" unit="MB" axisWidth={52} />
          </div>
        ) : null}
      </section>
    </>
  );
}
