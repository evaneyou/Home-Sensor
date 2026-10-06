import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api";
import type { MetricsResponse, TestDetail } from "../types";

const RANGES = ["1h", "6h", "24h", "7d", "30d"] as const;

const STAGE_COLORS = ["#4a90c8", "#2f9e77", "#c9922a", "#8b6cc9", "#c44b3c", "#5a9ea8"];

export default function TestPage() {
  const { id = "" } = useParams();
  const [range, setRange] = useState<(typeof RANGES)[number]>("24h");

  const testQ = useQuery({
    queryKey: ["test", id],
    queryFn: () => api.test(id) as Promise<TestDetail>,
    enabled: !!id,
  });
  const metricsQ = useQuery({
    queryKey: ["metrics", id, range],
    queryFn: () => api.metrics(id, range) as Promise<MetricsResponse>,
    enabled: !!id,
  });

  const stageNames = useMemo(() => {
    const names = new Set<string>();
    for (const p of metricsQ.data?.points ?? []) {
      for (const s of p.stages) names.add(s.name);
    }
    return [...names];
  }, [metricsQ.data]);

  const waterfallData = useMemo(() => {
    return (metricsQ.data?.points ?? []).map((p) => {
      const row: Record<string, string | number> = {
        t: new Date(p.t).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        status: p.status,
      };
      for (const name of stageNames) {
        const stage = p.stages.find((s) => s.name === name);
        row[name] = stage?.duration_ms ?? 0;
      }
      return row;
    });
  }, [metricsQ.data, stageNames]);

  const metricData = useMemo(
    () =>
      (metricsQ.data?.points ?? []).map((p) => ({
        t: new Date(p.t).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        rtt_ms: p.rtt_ms,
        loss_pct: p.loss_pct,
      })),
    [metricsQ.data],
  );

  if (testQ.isLoading) return <div className="state-box">Loading test…</div>;
  if (testQ.isError || !testQ.data) return <div className="state-box">Test not found.</div>;

  const test = testQ.data;
  const points = metricsQ.data?.points ?? [];

  return (
    <div>
      <h1 className="page-title">{test.name}</h1>
      <p className="page-sub">
        <Link to={`/sensors/${test.sensor_id}`}>{test.sensor_name}</Link>
        {" · "}
        {test.network_name}
        {" · "}
        <span className="mono">
          {test.kind} → {test.target}
        </span>
      </p>

      <div className="range-row">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={`tab ${range === r ? "active" : ""}`}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>

      {metricsQ.isLoading ? (
        <div className="state-box">Loading metrics…</div>
      ) : points.length === 0 ? (
        <div className="state-box">No results in this range.</div>
      ) : (
        <>
          <div className="panel">
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Pass / fail strip</h2>
            <div className="passfail" title="Chronological pass/fail">
              {points.map((p, i) => (
                <span
                  key={i}
                  className={`status-${p.status}`}
                  style={{
                    background:
                      p.status === "ok"
                        ? "var(--ok)"
                        : p.status === "degraded"
                          ? "var(--degraded)"
                          : "var(--fail)",
                  }}
                />
              ))}
            </div>
          </div>

          <div className="panel">
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Stage waterfall</h2>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <AreaChart data={waterfallData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="t" hide={waterfallData.length > 48} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="ms" />
                  <Tooltip />
                  <Legend />
                  {stageNames.map((name, i) => (
                    <Area
                      key={name}
                      type="monotone"
                      dataKey={name}
                      stackId="1"
                      stroke={STAGE_COLORS[i % STAGE_COLORS.length]}
                      fill={STAGE_COLORS[i % STAGE_COLORS.length]}
                      fillOpacity={0.7}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>RTT</h2>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={metricData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="t" hide={metricData.length > 48} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="ms" />
                  <Tooltip />
                  <Line type="monotone" dataKey="rtt_ms" stroke="var(--accent)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="panel">
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Packet loss</h2>
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={metricData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="t" hide={metricData.length > 48} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip />
                  <Bar dataKey="loss_pct" fill="var(--degraded)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
