import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Summary } from "../types";

function formatAge(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function OverviewPage() {
  const q = useQuery({
    queryKey: ["summary"],
    queryFn: () => api.summary() as Promise<Summary>,
  });

  if (q.isLoading) return <div className="state-box">Loading health matrix…</div>;
  if (q.isError) {
    return (
      <div className="state-box">
        Could not load summary. <button className="btn" onClick={() => void q.refetch()}>Retry</button>
      </div>
    );
  }

  const data = q.data!;
  const sensors = data.sensors;
  const networks = data.networks;
  const open = data.open_issues;
  const worst = open.some((i) => i.severity === "critical")
    ? "critical"
    : open.some((i) => i.severity === "warning")
      ? "warning"
      : "empty";

  const cell = (sensorId: string, networkId: string) =>
    data.matrix.find((c) => c.sensor_id === sensorId && c.network_id === networkId);

  return (
    <div>
      <h1 className="page-title">Overview</h1>
      <p className="page-sub">Sensor × network health · auto-refreshes every 30s</p>

      <div className={`banner ${worst}`}>
        {open.length === 0 ? (
          <span>No open issues. All monitored paths look quiet.</span>
        ) : (
          <>
            <strong>
              {open.length} open issue{open.length === 1 ? "" : "s"}
            </strong>
            {open.slice(0, 3).map((i) => (
              <div key={i.id}>
                <span className={`sev ${i.severity}`}>{i.severity}</span>{" "}
                <Link to={`/issues/${i.id}`}>{i.title}</Link>
                {i.root_cause_stage ? (
                  <span className="muted"> · stage {i.root_cause_stage}</span>
                ) : null}
              </div>
            ))}
            {open.length > 3 ? (
              <Link to="/issues">View all issues →</Link>
            ) : null}
          </>
        )}
      </div>

      {sensors.length === 0 || networks.length === 0 ? (
        <div className="state-box">No sensors or networks yet. Run the seed command.</div>
      ) : (
        <div className="matrix" style={{ ["--cols" as string]: networks.length }}>
          <div className="matrix-row">
            <div className="matrix-cell head">Sensor</div>
            {networks.map((n) => (
              <div className="matrix-cell head" key={n.id}>
                {n.name}
              </div>
            ))}
          </div>
          {sensors.map((s) => (
            <div className="matrix-row" key={s.id}>
              <div className="matrix-cell head">
                <Link to={`/sensors/${s.id}`}>{s.name}</Link>
              </div>
              {networks.map((n) => {
                const c = cell(s.id, n.id);
                const status = c?.status ?? "unknown";
                return (
                  <div className="matrix-cell" key={`${s.id}-${n.id}`}>
                    <div className="cell-status">
                      <span className={`status-dot status-${status}`} />
                      {status}
                    </div>
                    <div className="cell-meta">{formatAge(c?.last_test_at ?? null)}</div>
                    {c && c.failing_tests > 0 ? (
                      <div className="cell-meta">{c.failing_tests} test(s) not ok</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
