import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { Issue } from "../types";

export default function IssueDetailPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["issue", id],
    queryFn: () => api.issue(id) as Promise<Issue>,
    enabled: !!id,
  });

  if (q.isLoading) return <div className="state-box">Loading issue…</div>;
  if (q.isError || !q.data) return <div className="state-box">Issue not found.</div>;

  const issue = q.data;

  return (
    <div>
      <p className="page-sub">
        <Link to="/issues">← Issues</Link>
      </p>
      <h1 className="page-title">{issue.title}</h1>
      <p className="page-sub">
        <span className={`sev ${issue.severity}`}>{issue.severity}</span> · {issue.status}
        {issue.root_cause_stage ? ` · root cause stage: ${issue.root_cause_stage}` : ""}
      </p>

      <div className="panel">
        <p style={{ marginTop: 0 }}>{issue.summary}</p>
        <div className="mono muted">
          Opened {new Date(issue.opened_at).toLocaleString()}
          {issue.resolved_at ? ` · resolved ${new Date(issue.resolved_at).toLocaleString()}` : ""}
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          {issue.sensor_id ? (
            <>
              Sensor: <Link to={`/sensors/${issue.sensor_id}`}>{issue.sensor_slug}</Link>
              {" · "}
            </>
          ) : null}
          {issue.test_id ? (
            <>
              Test: <Link to={`/tests/${issue.test_id}`}>{issue.test_slug}</Link>
            </>
          ) : null}
        </div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Recent failing results</h2>
        {issue.recent_failures.length === 0 ? (
          <div className="muted">No recent failing results attached.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Stages</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {issue.recent_failures.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{new Date(r.started_at).toLocaleString()}</td>
                  <td>
                    <span className={`status-dot status-${r.status}`} />
                    {r.status}
                  </td>
                  <td className="mono">
                    {r.stages.map((s) => `${s.name}:${s.duration_ms}ms`).join(" → ")}
                  </td>
                  <td>{r.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
