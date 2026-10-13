import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { User } from "../types";
import { FIELD_LIMITS, rangeError } from "./syntheticList";

type Options = {
  report_interval_s: number;
  max_rtt_ms: number;
  max_jitter_ms: number;
  max_loss_pct: number;
  ptime_ms?: number;
};

type Continuous = {
  links: string[];
  options: Options;
  status: string;
};

type Profile = {
  slug: string;
  options: Options;
  continuous: Continuous | null;
};

type PathChoice = "wired" | "wireless" | "both";

export function PresetForm({
  monitorId,
  profile,
  onSaved,
}: {
  monitorId: string;
  profile: Profile;
  onSaved: () => void;
}) {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const admin = me.data?.role === "admin";
  const source = profile.continuous?.options ?? profile.options;
  const running = profile.continuous?.status === "running" || profile.continuous?.status === "pending";
  const [path, setPath] = useState<PathChoice>(running ? pathOf(profile.continuous?.links) : "both");
  const [manualPath, setManualPath] = useState<PathChoice>("both");
  const [reportInterval, setReportInterval] = useState(source.report_interval_s);
  const [maxRtt, setMaxRtt] = useState(source.max_rtt_ms);
  const [maxJitter, setMaxJitter] = useState(source.max_jitter_ms);
  const [maxLoss, setMaxLoss] = useState(source.max_loss_pct);
  const [ptime, setPtime] = useState(source.ptime_ms ?? 20);
  const [duration, setDuration] = useState(30);
  const voice = source.ptime_ms != null;
  const queryClient = useQueryClient();
  const options: Options = {
    report_interval_s: reportInterval,
    max_rtt_ms: maxRtt,
    max_jitter_ms: maxJitter,
    max_loss_pct: maxLoss,
    ...(voice ? { ptime_ms: ptime } : {}),
  };
  const errors = {
    report: rangeError(reportInterval, ...FIELD_LIMITS.report_interval_s),
    rtt: rangeError(maxRtt, ...FIELD_LIMITS.max_rtt_ms),
    jitter: rangeError(maxJitter, ...FIELD_LIMITS.max_jitter_ms),
    loss: rangeError(maxLoss, ...FIELD_LIMITS.max_loss_pct),
    ptime: voice ? rangeError(ptime, ...FIELD_LIMITS.ptime_ms) : "",
    duration: rangeError(duration, ...FIELD_LIMITS.duration_seconds),
  };
  const continuousInvalid = Boolean(errors.report || errors.rtt || errors.jitter || errors.loss || errors.ptime);
  const savedPath = running ? pathOf(profile.continuous?.links) : null;
  const dirty = running && (
    path !== savedPath
    || reportInterval !== source.report_interval_s
    || maxRtt !== source.max_rtt_ms
    || maxJitter !== source.max_jitter_ms
    || maxLoss !== source.max_loss_pct
    || (voice && ptime !== source.ptime_ms)
  );
  const action: "on" | "save" | "off" = !running ? "on" : dirty ? "save" : "off";
  const actionLabel = action === "on" ? "Turn on continuous" : action === "save" ? "Save changes" : "Turn off";
  const save = useMutation({
    mutationFn: (links: string[]) =>
      api.saveSyntheticContinuous({ monitor_id: monitorId, profile_slug: profile.slug, links, options }),
    onSuccess: onSaved,
  });
  const manual = useMutation({
    mutationFn: () =>
      api.startSyntheticManual({
        monitor_id: monitorId,
        profile_slug: profile.slug,
        links: linksFor(manualPath),
        duration_seconds: duration,
        options,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["synthetic-runs", monitorId] }),
  });

  return (
    <div className="app-health-form">
      <h4>Continuous</h4>
      <div className="app-health-fields">
        <NumberField label="Report every" unit="s" value={reportInterval} limits={FIELD_LIMITS.report_interval_s} error={errors.report} onChange={setReportInterval} />
        <NumberField label="Max round trip" unit="ms" value={maxRtt} limits={FIELD_LIMITS.max_rtt_ms} error={errors.rtt} onChange={setMaxRtt} />
        <NumberField label="Max jitter" unit="ms" value={maxJitter} limits={FIELD_LIMITS.max_jitter_ms} error={errors.jitter} onChange={setMaxJitter} />
        <NumberField label="Max loss" unit="%" value={maxLoss} limits={FIELD_LIMITS.max_loss_pct} error={errors.loss} step={0.1} onChange={setMaxLoss} />
        {voice ? (
          <NumberField label="Packet time" unit="ms" value={ptime} limits={FIELD_LIMITS.ptime_ms} error={errors.ptime} onChange={setPtime} />
        ) : null}
      </div>
      <PathControl label="Continuous path" value={path} onChange={setPath} />
      {admin ? (
        <button
          className="app-health-primary"
          type="button"
          disabled={save.isPending || continuousInvalid || (action === "save" && !dirty)}
          onClick={() => save.mutate(action === "off" ? [] : linksFor(path))}
        >
          {save.isPending ? "Saving…" : actionLabel}
        </button>
      ) : (
        <p className="app-health-note">An admin starts and changes these checks.</p>
      )}
      {save.isError ? <p className="app-health-error">Could not save this continuous check.</p> : null}
      <div className="app-health-split">
        <h4>Timed run</h4>
        <div className="app-health-timed">
          <NumberField label="Duration" unit="s" value={duration} limits={FIELD_LIMITS.duration_seconds} error={errors.duration} onChange={setDuration} />
          <PathControl label="Timed run path" value={manualPath} onChange={setManualPath} />
          {admin ? (
            <button
              className="app-health-outline"
              type="button"
              disabled={manual.isPending || continuousInvalid || Boolean(errors.duration)}
              onClick={() => manual.mutate()}
            >
              {manual.isPending ? "Starting…" : "Run once"}
            </button>
          ) : null}
        </div>
        {manual.isError ? <p className="app-health-error">Could not start the timed run.</p> : null}
      </div>
    </div>
  );
}

function NumberField({
  label,
  unit,
  value,
  limits,
  error,
  step = 1,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  limits: readonly [number, number];
  error: string;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [min, max] = limits;
  return (
    <label className="app-health-field">
      <span>{label}</span>
      <span className="app-health-input">
        <input
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))}
        />
        <i>{unit}</i>
      </span>
      {error ? <small>{error}</small> : null}
    </label>
  );
}

function PathControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PathChoice;
  onChange: (value: PathChoice) => void;
}) {
  const choices: { id: PathChoice; text: string }[] = [
    { id: "wired", text: "Wired" },
    { id: "wireless", text: "Wi-Fi" },
    { id: "both", text: "Both" },
  ];
  return (
    <div className="app-health-path" role="group" aria-label={label}>
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          aria-pressed={value === choice.id}
          className={value === choice.id ? "on" : ""}
          onClick={() => onChange(choice.id)}
        >
          {choice.text}
        </button>
      ))}
    </div>
  );
}

function pathOf(links: string[] | undefined): PathChoice {
  const wired = links?.includes("wired");
  const wifi = links?.includes("wireless");
  if (wired && wifi) return "both";
  if (wifi) return "wireless";
  if (wired) return "wired";
  return "both";
}

function linksFor(path: PathChoice): string[] {
  if (path === "both") return ["wired", "wireless"];
  return [path];
}
