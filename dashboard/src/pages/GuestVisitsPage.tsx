import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import type { User } from "../types";

type GuestVisit = { created_at: string; address: string };

export default function GuestVisitsPage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const visits = useQuery({
    queryKey: ["guest-visits"],
    queryFn: () => api.guestVisits() as Promise<GuestVisit[]>,
    enabled: me.data?.role === "admin",
  });

  if (me.isLoading) return <div className="state-box">Loading…</div>;
  if (me.data?.role !== "admin") return <Navigate to="/settings/onboarding" replace />;
  if (visits.isLoading) return <div className="state-box">Loading guest visits…</div>;
  if (visits.isError) return <div className="state-box">Could not load guest visits.</div>;

  const rows = visits.data ?? [];
  return (
    <div>
      <h2 className="page-title">Guest visits</h2>
      <p className="page-sub">Each time someone signs in as guest, the address they connected from is listed here.</p>
      {rows.length === 0 ? (
        <p className="muted">No guest logins yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Address</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.created_at}-${row.address}`}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td className="mono">{row.address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
