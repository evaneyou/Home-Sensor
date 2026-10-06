import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { Issue } from "../types";

export default function IssuesPage() {
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("open");
  const q = useQuery({
    queryKey: ["issues", filter],
    queryFn: () =>
      api.issues(filter === "all" ? undefined : filter) as Promise<Issue[]>,
  });

  return (
    <div>
      <h1 className="page-title">Issues</h1>
      <p className="page-sub">Open and resolved problems inferred from failing staged tests.</p>

      <div className="tabs">
        {(["open", "resolved", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`tab ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="state-box">Loading issues…</div>
      ) : q.isError ? (
        <div className="state-box">Failed to load issues.</div>
      ) : (q.data ?? []).length === 0 ? (
        <div className="state-box">No issues in this filter.</div>
      ) : (
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Title</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((i) => (
                <tr key={i.id}>
                  <td>
                    <span className={`sev ${i.severity}`}>{i.severity}</span>
                  </td>
                  <td>
                    <Link to={`/issues/${i.id}`}>{i.title}</Link>
                    <div className="muted" style={{ fontSize: "0.8rem" }}>
                      {[i.sensor_slug, i.network_slug].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td>{i.status}</td>
                  <td className="mono">{i.root_cause_stage ?? "—"}</td>
                  <td className="mono">{new Date(i.opened_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
