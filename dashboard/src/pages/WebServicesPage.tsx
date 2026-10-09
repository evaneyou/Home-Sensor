import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import type { User, WebServiceSetting } from "../types";

type Field = "interval_seconds" | "http_variance_pct" | "icmp_variance_pct" | "jitter_variance_pct";
type Toggle = "http_enabled" | "icmp_enabled" | "jitter_enabled";

function errorText(error: Error): string {
  try {
    const body = JSON.parse(error.message) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    return error.message || "Could not save";
  }
  return "Could not save";
}

export default function WebServicesPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const admin = me.data?.role === "admin";
  const servicesQ = useQuery({
    queryKey: ["web-services"],
    queryFn: () => api.webServices() as Promise<WebServiceSetting[]>,
  });
  const [rows, setRows] = useState<WebServiceSetting[]>([]);
  const [synced, setSynced] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signature = (servicesQ.data ?? [])
    .map((row) =>
      [
        row.key,
        row.interval_seconds,
        row.http_enabled,
        row.icmp_enabled,
        row.jitter_enabled,
        row.http_variance_pct,
        row.icmp_variance_pct,
        row.jitter_variance_pct,
      ].join(":"),
    )
    .join("|");

  useEffect(() => {
    if (!servicesQ.data || synced === signature) return;
    setSynced(signature);
    setRows(servicesQ.data);
  }, [servicesQ.data, signature, synced]);

  const save = useMutation({
    mutationFn: () => api.saveWebServices(rows) as Promise<WebServiceSetting[]>,
    onSuccess: async (saved) => {
      setError(null);
      setConfirming(false);
      setRows(saved);
      setSynced("");
      await qc.invalidateQueries({ queryKey: ["web-services"] });
      await qc.invalidateQueries({ queryKey: ["monitor"] });
    },
    onError: (e: Error) => {
      setConfirming(false);
      setError(errorText(e));
    },
  });

  function setNumber(key: string, field: Field, value: string) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: parsed } : row)));
  }

  function setToggle(key: string, field: Toggle, value: boolean) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  const currentSignature = rows
    .map((row) =>
      [
        row.key,
        row.interval_seconds,
        row.http_enabled,
        row.icmp_enabled,
        row.jitter_enabled,
        row.http_variance_pct,
        row.icmp_variance_pct,
        row.jitter_variance_pct,
      ].join(":"),
    )
    .join("|");
  const dirty = synced !== "" && rows.length > 0 && currentSignature !== signature;

  if (servicesQ.isLoading) return <div className="state-box">Loading web services…</div>;
  if (servicesQ.isError) return <div className="state-box">Could not load web services.</div>;

  return (
    <div>
      <h2 className="page-title">Web Services</h2>
      <p className="page-sub">
        Set how often each service is polled, and which checks run. Each protocol has its own variance: a response
        more than that percent off the recent normal is amber, as is an error status or packet loss. Red means an
        active check got no response. Jitter is the spread in the ICMP ping, and it is scored only when its check is on.
      </p>
      <div className="panel table-scroll">
        <table className="table web-service-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Poll every</th>
              <th>HTTP</th>
              <th>Variance</th>
              <th>ICMP</th>
              <th>Variance</th>
              <th>Jitter</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>
                  <input
                    aria-label={`${row.label} interval`}
                    type="number"
                    min={60}
                    max={86400}
                    step={30}
                    value={row.interval_seconds}
                    disabled={!admin || save.isPending}
                    onChange={(event) => setNumber(row.key, "interval_seconds", event.target.value)}
                  />
                  <span className="muted"> s</span>
                </td>
                <td className="check">
                  <input
                    aria-label={`${row.label} HTTP`}
                    type="checkbox"
                    checked={row.http_enabled}
                    disabled={!admin || save.isPending}
                    onChange={(event) => setToggle(row.key, "http_enabled", event.target.checked)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`${row.label} HTTP variance`}
                    type="number"
                    min={0}
                    max={500}
                    step={5}
                    value={row.http_variance_pct}
                    disabled={!admin || save.isPending}
                    onChange={(event) => setNumber(row.key, "http_variance_pct", event.target.value)}
                  />
                  <span className="muted"> %</span>
                </td>
                <td className="check">
                  <input
                    aria-label={`${row.label} ICMP`}
                    type="checkbox"
                    checked={row.icmp_enabled}
                    disabled={!admin || save.isPending}
                    onChange={(event) => setToggle(row.key, "icmp_enabled", event.target.checked)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`${row.label} ICMP variance`}
                    type="number"
                    min={0}
                    max={500}
                    step={5}
                    value={row.icmp_variance_pct}
                    disabled={!admin || save.isPending}
                    onChange={(event) => setNumber(row.key, "icmp_variance_pct", event.target.value)}
                  />
                  <span className="muted"> %</span>
                </td>
                <td className="check">
                  <input
                    aria-label={`${row.label} jitter`}
                    type="checkbox"
                    checked={row.jitter_enabled}
                    disabled={!admin || save.isPending}
                    onChange={(event) => setToggle(row.key, "jitter_enabled", event.target.checked)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`${row.label} jitter variance`}
                    type="number"
                    min={0}
                    max={500}
                    step={5}
                    value={row.jitter_variance_pct}
                    disabled={!admin || save.isPending}
                    onChange={(event) => setNumber(row.key, "jitter_variance_pct", event.target.value)}
                  />
                  <span className="muted"> %</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {admin ? (
        <div className="form-actions">
          <button
            className={`btn btn-primary${dirty ? " is-dirty" : ""}`}
            type="button"
            disabled={save.isPending}
            onClick={() => setConfirming(true)}
          >
            Save
          </button>
        </div>
      ) : (
        <p className="muted">Viewers can see these settings. An admin can change them.</p>
      )}
      {confirming ? (
        <ConfirmDialog
          title="Save web services"
          confirmLabel="Save"
          busy={save.isPending}
          onConfirm={() => save.mutate()}
          onCancel={() => setConfirming(false)}
        >
          Save polling intervals, active checks, and variance? Agents pick up the schedule on the next health report.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
