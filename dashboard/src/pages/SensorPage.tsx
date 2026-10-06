import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Result, SensorDetail } from "../types";

export default function SensorPage() {
  const { id = "" } = useParams();
  const sensorQ = useQuery({
    queryKey: ["sensor", id],
    queryFn: () => api.sensor(id) as Promise<SensorDetail>,
    enabled: !!id,
  });
  const resultsQ = useQuery({
    queryKey: ["results", "sensor", id],
    queryFn: () => api.results({ sensor_id: id, limit: "40" }) as Promise<Result[]>,
    enabled: !!id,
  });

  const networks = useMemo(() => {
    const map = new Map<string, { id: string; slug: string; name: string }>();
    for (const t of sensorQ.data?.tests ?? []) {
      map.set(t.network_id, { id: t.network_id, slug: t.network_slug, name: t.network_name });
    }
    return [...map.values()];
  }, [sensorQ.data]);

  const [tab, setTab] = useState<string | null>(null);
  const activeTab = tab ?? networks[0]?.id ?? null;

  if (sensorQ.isLoading) return <div className="state-box">Loading sensor…</div>;
  if (sensorQ.isError || !sensorQ.data) {
    return <div className="state-box">Sensor not found.</div>;
  }

  const sensor = sensorQ.data;
  const tests = sensor.tests.filter((t) => !activeTab || t.network_id === activeTab);
  const results = (resultsQ.data ?? []).filter((r) => !activeTab || r.network_id === activeTab);

  return (
    <div>
      <h1 className="page-title">{sensor.name}</h1>
      <p className="page-sub">
        <span className={`status-dot status-${sensor.status === "online" ? "ok" : "unknown"}`} />
        {sensor.status}
        {sensor.last_seen_at ? ` · last seen ${new Date(sensor.last_seen_at).toLocaleString()}` : ""}
      </p>

      <div className="tabs">
        {networks.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`tab ${activeTab === n.id ? "active" : ""}`}
            onClick={() => setTab(n.id)}
          >
            {n.name}
          </button>
        ))}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Tests</h2>
        {tests.length === 0 ? (
          <div className="muted">No tests on this network.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Test</th>
                <th>Kind</th>
                <th>Target</th>
                <th>Status</th>
                <th>Last</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/tests/${t.id}`}>{t.name}</Link>
                  </td>
                  <td className="mono">{t.kind}</td>
                  <td className="mono">{t.target}</td>
                  <td>
                    <span className={`status-dot status-${t.latest_status}`} />
                    {t.latest_status}
                  </td>
                  <td className="mono">
                    {t.latest_at ? new Date(t.latest_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Recent results</h2>
        {resultsQ.isLoading ? (
          <div className="muted">Loading results…</div>
        ) : results.length === 0 ? (
          <div className="muted">No results yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Test</th>
                <th>Status</th>
                <th>RTT</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{new Date(r.started_at).toLocaleString()}</td>
                  <td>
                    <Link to={`/tests/${r.test_id}`}>{r.test_name}</Link>
                  </td>
                  <td>
                    <span className={`status-dot status-${r.status}`} />
                    {r.status}
                  </td>
                  <td className="mono">{r.metrics?.rtt_ms ?? "—"} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
