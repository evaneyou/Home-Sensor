import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import type { User, WebStability } from "../types";

type StabilityNumber = Exclude<keyof WebStability, "preset">;
type PresetName = "relaxed" | "balanced" | "strict";

const DEFAULTS: WebStability = {
  poll_interval_seconds: 300,
  window_size: 5,
  degraded_count: 3,
  fail_count: 3,
  recover_count: 3,
  pct_floor: 50,
  abs_floor_http_ms: 40,
  abs_floor_icmp_ms: 20,
  abs_floor_jitter_ms: 15,
  quorum_degraded_pct: 25,
  quorum_fail_pct: 40,
  preset: "balanced",
};

const PRESET_NUMBERS: Record<PresetName, Omit<WebStability, "poll_interval_seconds" | "preset">> = {
  relaxed: {
    window_size: 5,
    degraded_count: 4,
    fail_count: 4,
    recover_count: 4,
    pct_floor: 75,
    abs_floor_http_ms: 80,
    abs_floor_icmp_ms: 40,
    abs_floor_jitter_ms: 30,
    quorum_degraded_pct: 40,
    quorum_fail_pct: 60,
  },
  balanced: {
    window_size: DEFAULTS.window_size,
    degraded_count: DEFAULTS.degraded_count,
    fail_count: DEFAULTS.fail_count,
    recover_count: DEFAULTS.recover_count,
    pct_floor: DEFAULTS.pct_floor,
    abs_floor_http_ms: DEFAULTS.abs_floor_http_ms,
    abs_floor_icmp_ms: DEFAULTS.abs_floor_icmp_ms,
    abs_floor_jitter_ms: DEFAULTS.abs_floor_jitter_ms,
    quorum_degraded_pct: DEFAULTS.quorum_degraded_pct,
    quorum_fail_pct: DEFAULTS.quorum_fail_pct,
  },
  strict: {
    window_size: 3,
    degraded_count: 2,
    fail_count: 2,
    recover_count: 2,
    pct_floor: 30,
    abs_floor_http_ms: 25,
    abs_floor_icmp_ms: 12,
    abs_floor_jitter_ms: 8,
    quorum_degraded_pct: 15,
    quorum_fail_pct: 25,
  },
};

const PRESET_COPY: Record<PresetName, string> = {
  relaxed: "Waits for more bad samples, and allows a wider swing, before a service or the group changes color.",
  balanced: "A few bad samples in a row change the color. One bad sample does not.",
  strict: "Changes color after fewer bad samples, and a smaller swing counts as slow.",
};

const STABILITY_FIELDS: { field: StabilityNumber; label: string; unit: string; min: number; max: number; step: number }[] = [
  { field: "poll_interval_seconds", label: "Poll every", unit: "s", min: 60, max: 86400, step: 30 },
  { field: "pct_floor", label: "Tolerance", unit: "%", min: 0, max: 500, step: 5 },
  { field: "window_size", label: "Samples looked at", unit: "", min: 3, max: 30, step: 1 },
  { field: "degraded_count", label: "Slow samples before amber", unit: "", min: 1, max: 30, step: 1 },
  { field: "fail_count", label: "Failed samples before red", unit: "", min: 1, max: 30, step: 1 },
  { field: "recover_count", label: "Good samples in a row to clear", unit: "", min: 1, max: 30, step: 1 },
  { field: "abs_floor_http_ms", label: "HTTP floor", unit: "ms", min: 0, max: 5000, step: 5 },
  { field: "abs_floor_icmp_ms", label: "ICMP floor", unit: "ms", min: 0, max: 5000, step: 5 },
  { field: "abs_floor_jitter_ms", label: "Jitter floor", unit: "ms", min: 0, max: 5000, step: 5 },
  { field: "quorum_degraded_pct", label: "Services slow before the group is amber", unit: "%", min: 1, max: 100, step: 5 },
  { field: "quorum_fail_pct", label: "Services down before the group is red", unit: "%", min: 1, max: 100, step: 5 },
];

function errorText(error: Error): string {
  try {
    const body = JSON.parse(error.message) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    return error.message || "Could not save";
  }
  return "Could not save";
}

function stabilitySignature(row: WebStability): string {
  return STABILITY_FIELDS.map((item) => String(row[item.field])).join(":");
}

function activePreset(row: WebStability): PresetName | null {
  const names: PresetName[] = ["relaxed", "balanced", "strict"];
  return (
    names.find((name) =>
      (Object.keys(PRESET_NUMBERS[name]) as (keyof (typeof PRESET_NUMBERS)[PresetName])[]).every(
        (field) => row[field] === PRESET_NUMBERS[name][field],
      ),
    ) ?? null
  );
}

function DefaultButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="btn-default" type="button" onClick={onClick}>
      Default {label}
    </button>
  );
}

export default function WebServicesPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const admin = me.data?.role === "admin";
  const stabilityQ = useQuery({
    queryKey: ["web-stability"],
    queryFn: () => api.webStability(),
  });
  const [stability, setStability] = useState<WebStability>(DEFAULTS);
  const [synced, setSynced] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedSignature = stabilitySignature(stabilityQ.data ?? DEFAULTS);

  useEffect(() => {
    if (!stabilityQ.data || synced === loadedSignature) return;
    setSynced(loadedSignature);
    setStability(stabilityQ.data);
  }, [stabilityQ.data, loadedSignature, synced]);

  const save = useMutation({
    mutationFn: () => api.saveWebStability(stability),
    onSuccess: async (savedStability) => {
      setError(null);
      setConfirming(false);
      setStability(savedStability);
      setSynced("");
      await qc.invalidateQueries({ queryKey: ["web-stability"] });
      await qc.invalidateQueries({ queryKey: ["web-services"] });
      await qc.invalidateQueries({ queryKey: ["monitor"] });
    },
    onError: (e: Error) => {
      setConfirming(false);
      setError(errorText(e));
    },
  });

  function setStabilityNumber(field: StabilityNumber, value: number) {
    if (!Number.isFinite(value)) return;
    setStability((current) => {
      const next = { ...current, [field]: value };
      if (field === "window_size") {
        next.degraded_count = Math.min(next.degraded_count, value);
        next.fail_count = Math.min(next.fail_count, value);
        next.recover_count = Math.min(next.recover_count, value);
      }
      return next;
    });
  }

  function applyPreset(name: PresetName) {
    setStability((current) => ({ ...current, ...PRESET_NUMBERS[name] }));
  }

  const locked = !admin || save.isPending;
  const dirty = synced !== "" && stabilitySignature(stability) !== loadedSignature;
  const preset = activePreset(stability);

  if (stabilityQ.isLoading) return <div className="state-box">Loading web services…</div>;
  if (stabilityQ.isError) return <div className="state-box">Could not load web services.</div>;

  return (
    <div>
      <h2 className="page-title">Web Services</h2>
      <p className="page-sub">
        One set of numbers for every service. A single slow or failed check does not change the color. The color
        changes only after several samples agree, and it clears after several good samples in a row. Charts still show
        every sample.
      </p>
      <div className="panel settings-block">
        <h3>All web services</h3>
        <div className="tabs" role="tablist" aria-label="Sensitivity">
          {(["relaxed", "balanced", "strict"] as PresetName[]).map((name) => (
            <button
              key={name}
              className={`tab${preset === name ? " active" : ""}`}
              type="button"
              disabled={locked}
              onClick={() => applyPreset(name)}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
        <p className="preset-note">
          {preset ? PRESET_COPY[preset] : "These numbers are a custom mix. Pick a preset to fill them again."}
        </p>
        <table className="table web-service-table">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {STABILITY_FIELDS.map((item) => {
              const value = stability[item.field];
              const fallback = DEFAULTS[item.field];
              return (
                <tr key={item.field}>
                  <td>{item.label}</td>
                  <td>
                    <span className="field-with-default">
                      <input
                        aria-label={item.label}
                        type="number"
                        min={item.min}
                        max={item.max}
                        step={item.step}
                        value={value}
                        disabled={locked}
                        onChange={(event) => setStabilityNumber(item.field, Number(event.target.value))}
                      />
                      {item.unit ? <span className="muted">{item.unit}</span> : null}
                      {admin && value !== fallback ? (
                        <DefaultButton label={`${fallback}${item.unit}`} onClick={() => setStabilityNumber(item.field, fallback)} />
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
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
          Save this for every web service? Agents pick up the poll interval on the next health report.
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
