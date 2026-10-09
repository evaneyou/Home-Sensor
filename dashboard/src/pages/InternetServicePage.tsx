import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import type { InternetServiceSetting, User } from "../types";

const EMPTY: InternetServiceSetting = {
  interval_seconds: 60,
  http_enabled: true,
  icmp_enabled: true,
  mtr_enabled: true,
  http_variance_pct: 25,
  icmp_variance_pct: 25,
  mtr_variance_pct: 25,
  iperf_enabled: true,
  iperf_interval_seconds: 900,
  iperf_variance_pct: 25,
};

function errorText(error: Error): string {
  try {
    const body = JSON.parse(error.message) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    return error.message || "Could not save";
  }
  return "Could not save";
}

export default function InternetServicePage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const admin = me.data?.role === "admin";
  const settingQ = useQuery({
    queryKey: ["internet-service"],
    queryFn: () => api.internetService() as Promise<InternetServiceSetting>,
  });
  const [row, setRow] = useState<InternetServiceSetting>(EMPTY);
  const [synced, setSynced] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signature = settingQ.data
    ? [
        settingQ.data.interval_seconds,
        settingQ.data.http_enabled,
        settingQ.data.icmp_enabled,
        settingQ.data.mtr_enabled,
        settingQ.data.http_variance_pct,
        settingQ.data.icmp_variance_pct,
        settingQ.data.mtr_variance_pct,
        settingQ.data.iperf_enabled,
        settingQ.data.iperf_interval_seconds,
        settingQ.data.iperf_variance_pct,
      ].join(":")
    : "";

  useEffect(() => {
    if (!settingQ.data || synced === signature) return;
    setSynced(signature);
    setRow(settingQ.data);
  }, [settingQ.data, signature, synced]);

  const save = useMutation({
    mutationFn: () => api.saveInternetService(row) as Promise<InternetServiceSetting>,
    onSuccess: async (saved) => {
      setError(null);
      setConfirming(false);
      setRow(saved);
      setSynced("");
      await qc.invalidateQueries({ queryKey: ["internet-service"] });
      await qc.invalidateQueries({ queryKey: ["monitor"] });
    },
    onError: (e: Error) => {
      setConfirming(false);
      setError(errorText(e));
    },
  });

  function setNumber(
    field:
      | "interval_seconds"
      | "iperf_interval_seconds"
      | "http_variance_pct"
      | "icmp_variance_pct"
      | "mtr_variance_pct"
      | "iperf_variance_pct",
    value: string,
  ) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    setRow((current) => ({ ...current, [field]: parsed }));
  }

  function setToggle(field: "http_enabled" | "icmp_enabled" | "mtr_enabled" | "iperf_enabled", value: boolean) {
    setRow((current) => ({ ...current, [field]: value }));
  }

  if (settingQ.isLoading) return <div className="state-box">Loading Internet Service…</div>;
  if (settingQ.isError) return <div className="state-box">Could not load Internet Service settings.</div>;

  const currentSignature = [
    row.interval_seconds,
    row.http_enabled,
    row.icmp_enabled,
    row.mtr_enabled,
    row.http_variance_pct,
    row.icmp_variance_pct,
    row.mtr_variance_pct,
    row.iperf_enabled,
    row.iperf_interval_seconds,
    row.iperf_variance_pct,
  ].join(":");
  const dirty = synced !== "" && currentSignature !== signature;
  const locked = !admin || save.isPending;

  return (
    <div>
      <h2 className="page-title">Internet Service</h2>
      <p className="page-sub">
        Each protocol has its own variance. A response more than that percent off the recent normal is amber, as is
        an error status or packet loss. Red means an active check got no response. HTTP, ICMP, and MTR share one poll
        interval. MTR runs at least every 2 minutes. iperf3 runs at least every 5 minutes and turns amber when
        download or upload falls more than its own percent below the recent normal.
      </p>
      <div className="panel table-scroll">
        <table className="table web-service-table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Poll every</th>
              <th>Enabled</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>HTTP</td>
              <td>
                <input
                  aria-label="Path interval"
                  type="number"
                  min={60}
                  max={86400}
                  step={30}
                  value={row.interval_seconds}
                  disabled={locked}
                  onChange={(event) => setNumber("interval_seconds", event.target.value)}
                />
                <span className="muted"> s</span>
              </td>
              <td className="check">
                <input
                  aria-label="Path HTTP"
                  type="checkbox"
                  checked={row.http_enabled}
                  disabled={locked}
                  onChange={(event) => setToggle("http_enabled", event.target.checked)}
                />
              </td>
              <td>
                <input
                  aria-label="HTTP variance"
                  type="number"
                  min={0}
                  max={500}
                  step={5}
                  value={row.http_variance_pct}
                  disabled={locked}
                  onChange={(event) => setNumber("http_variance_pct", event.target.value)}
                />
                <span className="muted"> %</span>
              </td>
            </tr>
            <tr>
              <td>ICMP</td>
              <td className="muted">Same as HTTP</td>
              <td className="check">
                <input
                  aria-label="Path ICMP"
                  type="checkbox"
                  checked={row.icmp_enabled}
                  disabled={locked}
                  onChange={(event) => setToggle("icmp_enabled", event.target.checked)}
                />
              </td>
              <td>
                <input
                  aria-label="ICMP variance"
                  type="number"
                  min={0}
                  max={500}
                  step={5}
                  value={row.icmp_variance_pct}
                  disabled={locked}
                  onChange={(event) => setNumber("icmp_variance_pct", event.target.value)}
                />
                <span className="muted"> %</span>
              </td>
            </tr>
            <tr>
              <td>MTR</td>
              <td className="muted">Same as HTTP</td>
              <td className="check">
                <input
                  aria-label="Path MTR"
                  type="checkbox"
                  checked={row.mtr_enabled}
                  disabled={locked}
                  onChange={(event) => setToggle("mtr_enabled", event.target.checked)}
                />
              </td>
              <td>
                <input
                  aria-label="MTR variance"
                  type="number"
                  min={0}
                  max={500}
                  step={5}
                  value={row.mtr_variance_pct}
                  disabled={locked}
                  onChange={(event) => setNumber("mtr_variance_pct", event.target.value)}
                />
                <span className="muted"> %</span>
              </td>
            </tr>
            <tr>
              <td>iperf3</td>
              <td>
                <input
                  aria-label="iperf3 interval"
                  type="number"
                  min={300}
                  max={86400}
                  step={60}
                  value={row.iperf_interval_seconds}
                  disabled={locked}
                  onChange={(event) => setNumber("iperf_interval_seconds", event.target.value)}
                />
                <span className="muted"> s</span>
              </td>
              <td className="check">
                <input
                  aria-label="iperf3"
                  type="checkbox"
                  checked={row.iperf_enabled}
                  disabled={locked}
                  onChange={(event) => setToggle("iperf_enabled", event.target.checked)}
                />
              </td>
              <td>
                <input
                  aria-label="iperf3 variance"
                  type="number"
                  min={0}
                  max={500}
                  step={5}
                  value={row.iperf_variance_pct}
                  disabled={locked}
                  onChange={(event) => setNumber("iperf_variance_pct", event.target.value)}
                />
                <span className="muted"> %</span>
              </td>
            </tr>
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
          title="Save Internet Service"
          confirmLabel="Save"
          busy={save.isPending}
          onConfirm={() => save.mutate()}
          onCancel={() => setConfirming(false)}
        >
          Save path checks, iperf3, and variance? Agents pick up the schedule on the next health report.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
