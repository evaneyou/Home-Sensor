import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import SelectMenu from "../components/SelectMenu";
import StatusMark from "../components/StatusMark";
import type { MonitorAdmin, MonitorKey, TunnelIssue, User } from "../types";

const INTERVALS = [
  { value: 30, label: "30s" },
  { value: 60, label: "60s" },
  { value: 120, label: "2m" },
  { value: 300, label: "5m" },
];

type Pending =
  | { kind: "add"; name: string }
  | { kind: "delete"; monitor: MonitorAdmin }
  | { kind: "key"; monitor: MonitorAdmin }
  | { kind: "tunnel"; monitor: MonitorAdmin }
  | { kind: "save" };

function errorText(error: Error, fallback: string): string {
  try {
    const body = JSON.parse(error.message) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    return error.message || fallback;
  }
  return fallback;
}

function tunnelAction(monitor: MonitorAdmin): "issue" | "wireless" | "replace" {
  if (!monitor.tunnel_address) return "issue";
  if (!monitor.wireless_tunnel_address) return "wireless";
  return "replace";
}

function tunnelLabel(monitor: MonitorAdmin): string {
  const action = tunnelAction(monitor);
  if (action === "wireless") return "Issue Wi-Fi tunnel";
  if (action === "replace") return "Replace tunnels";
  return "Issue tunnels";
}

function placeLabel(city: string | null, region: string | null, country: string | null): string {
  const parts = [city?.trim(), region?.trim(), country?.trim()].filter(Boolean);
  return parts.join(", ") || "No location";
}

function formatSeen(iso: string | null): string {
  if (!iso) return "Not seen yet";
  return new Date(iso).toLocaleString();
}

export default function MonitorOnboardingPage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() as Promise<User> });
  const admin = me.data?.role === "admin";
  const monitorsQ = useQuery({
    queryKey: ["monitors"],
    queryFn: () => api.monitors() as Promise<MonitorAdmin[]>,
    refetchInterval: 5000,
  });
  const [draftName, setDraftName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [syncedKey, setSyncedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [issued, setIssued] = useState<MonitorKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedTunnel, setCopiedTunnel] = useState(false);
  const [copiedWireless, setCopiedWireless] = useState(false);

  const monitors = monitorsQ.data ?? [];
  const selected = monitors.find((monitor) => monitor.id === selectedId) ?? null;
  const serverKey = selected
    ? [selected.id, selected.config_version, selected.name, selected.health_interval_seconds].join("|")
    : "";

  useEffect(() => {
    if (!selected || syncedKey === serverKey) return;
    setSyncedKey(serverKey);
    setName(selected.name);
    setIntervalSeconds(selected.health_interval_seconds);
  }, [selected, serverKey, syncedKey]);

  const add = useMutation({
    mutationFn: (deviceName: string) => api.createMonitor(deviceName) as Promise<MonitorKey>,
    onSuccess: async (created) => {
      setError(null);
      setDraftName("");
      setPending(null);
      setIssued(created);
      setCopied(false);
      setSelectedId(created.id);
      setSyncedKey("");
      await qc.invalidateQueries({ queryKey: ["monitors"] });
    },
    onError: (e: Error) => {
      setPending(null);
      setError(errorText(e, "Could not add the device"));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMonitor(id),
    onSuccess: async () => {
      setError(null);
      setPending(null);
      setSelectedId(null);
      setSyncedKey("");
      await qc.invalidateQueries({ queryKey: ["monitors"] });
      await qc.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (e: Error) => {
      setPending(null);
      setError(errorText(e, "Could not delete the device"));
    },
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.regenerateMonitorKey(id) as Promise<MonitorKey>,
    onSuccess: (created) => {
      setError(null);
      setPending(null);
      setIssued(created);
      setCopied(false);
    },
    onError: (e: Error) => {
      setPending(null);
      setError(errorText(e, "Could not generate a key"));
    },
  });

  const tunnel = useMutation({
    mutationFn: (id: string) => api.issueMonitorTunnel(id) as Promise<TunnelIssue>,
    onSuccess: (created) => {
      setError(null);
      setPending(null);
      setIssued({
        id: created.id,
        name: created.name,
        key: "",
        tunnel_address: created.address,
        tunnel_config: created.config,
        wireless_tunnel_address: created.wireless_address,
        wireless_tunnel_config: created.wireless_config,
      });
      setCopiedTunnel(false);
      setCopiedWireless(false);
      void qc.invalidateQueries({ queryKey: ["monitors"] });
    },
    onError: (e: Error) => {
      setPending(null);
      setError(errorText(e, "Could not create the tunnel"));
    },
  });

  const save = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("Choose a device");
      return api.updateMonitorLocation(selected.id, {
        name: name.trim(),
        health_interval_seconds: intervalSeconds,
      });
    },
    onSuccess: async () => {
      setError(null);
      setPending(null);
      await qc.invalidateQueries({ queryKey: ["monitors"] });
      if (selected) {
        await qc.invalidateQueries({ queryKey: ["monitor", selected.id] });
        await qc.invalidateQueries({ queryKey: ["monitor-device", selected.id] });
      }
    },
    onError: (e: Error) => {
      setPending(null);
      setError(errorText(e, "Could not save"));
    },
  });

  const busy = add.isPending || remove.isPending || rotate.isPending || tunnel.isPending || save.isPending;

  function requestAdd(event: FormEvent) {
    event.preventDefault();
    const deviceName = draftName.trim();
    if (!deviceName) {
      setError("Enter a device name.");
      return;
    }
    setError(null);
    setPending({ kind: "add", name: deviceName });
  }

  function requestSave(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a device name.");
      return;
    }
    setError(null);
    setPending({ kind: "save" });
  }

  function confirm() {
    if (!pending) return;
    if (pending.kind === "add") add.mutate(pending.name);
    else if (pending.kind === "delete") remove.mutate(pending.monitor.id);
    else if (pending.kind === "key") rotate.mutate(pending.monitor.id);
    else if (pending.kind === "tunnel") tunnel.mutate(pending.monitor.id);
    else save.mutate();
  }

  async function copyKey() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const applying = selected != null && selected.config_version !== selected.applied_config_version;
  const setupDirty =
    selected != null &&
    syncedKey === serverKey &&
    (name.trim() !== selected.name || intervalSeconds !== selected.health_interval_seconds);
  const intervalOptions = INTERVALS.some((item) => item.value === intervalSeconds)
    ? INTERVALS
    : [...INTERVALS, { value: intervalSeconds, label: `${intervalSeconds}s` }];
  const confirmCopy = confirmText(pending, selected, name.trim());

  return (
    <div>
      <h2 className="page-title">Remote Agent Onboarding</h2>
      <p className="page-sub">
        Create each Raspberry Pi here first. The device name is case-sensitive, and the remote agent must use that same
        name plus the server key.
      </p>

      <section className="panel">
        <h3 className="wifi-heading" style={{ marginTop: 0 }}>
          Add a device
        </h3>
        <ol className="setup-steps">
          <li>Add the device and copy the key. The key is shown only once.</li>
          <li>
            On the Pi, install both WireGuard configs (<span className="mono">wg0.conf</span> for wired and{" "}
            <span className="mono">wg1.conf</span> for Wi-Fi), then open{" "}
            <span className="mono">http://&lt;hostname&gt;.local/</span> and enter the same name, the server address{" "}
            <span className="mono">http://10.7.0.1:8847</span>, and the key.
          </li>
          <li>Capitalization has to match. “Office” and “office” are different devices.</li>
        </ol>
        {me.isLoading ? (
          <p className="muted">Loading session…</p>
        ) : admin ? (
          <form className="device-form" onSubmit={requestAdd}>
            <div className="field">
              <label htmlFor="new-device-name">Device name</label>
              <input
                id="new-device-name"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                autoComplete="off"
                placeholder="Living Room"
              />
            </div>
            <div className="form-actions">
              <button
                className={`btn btn-primary${draftName.trim() ? " is-dirty" : ""}`}
                type="submit"
                disabled={busy}
              >
                Add device
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">An admin can add devices, generate keys, and change settings.</p>
        )}
        {issued ? (
          <div className="issued-key">
            {issued.key ? (
              <p>
                Key for <strong>{issued.name}</strong>. Paste this into the remote agent. It cannot be shown again.
              </p>
            ) : null}
            {issued.key ? (
              <div className="copy-row">
                <input className="mono" readOnly value={issued.key} aria-label={`Device key for ${issued.name}`} />
                <button className="btn" type="button" onClick={() => void copyKey()}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : null}
            {issued.tunnel_config ? (
              <>
                <p>
                  Wired tunnel for <strong>{issued.name}</strong>. Save it as <span className="mono">wg0.conf</span> next
                  to the installer. It cannot be shown again. Health reports use{" "}
                  <span className="mono">http://10.7.0.1:8847</span>.
                </p>
                <div className="copy-row">
                  <textarea className="mono" readOnly value={issued.tunnel_config} aria-label={`Wired WireGuard config for ${issued.name}`} />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(issued.tunnel_config || "").then(
                        () => setCopiedTunnel(true),
                        () => setCopiedTunnel(false),
                      );
                    }}
                  >
                    {copiedTunnel ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            ) : null}
            {issued.wireless_tunnel_config ? (
              <>
                <p>
                  Wi-Fi tunnel for <strong>{issued.name}</strong>. Save it as <span className="mono">wg1.conf</span>{" "}
                  next to the installer. It cannot be shown again. Wi-Fi path checks use{" "}
                  <span className="mono">http://10.7.1.1:8847</span>.
                </p>
                <div className="copy-row">
                  <textarea
                    className="mono"
                    readOnly
                    value={issued.wireless_tunnel_config}
                    aria-label={`Wi-Fi WireGuard config for ${issued.name}`}
                  />
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(issued.wireless_tunnel_config || "").then(
                        () => setCopiedWireless(true),
                        () => setCopiedWireless(false),
                      );
                    }}
                  >
                    {copiedWireless ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h3 className="wifi-heading" style={{ marginTop: 0 }}>
          Devices
        </h3>
        {monitorsQ.isLoading ? (
          <p className="muted">Loading devices…</p>
        ) : monitorsQ.isError ? (
          <p className="error">Could not load devices.</p>
        ) : monitors.length === 0 ? (
          <p className="muted">No devices yet.</p>
        ) : (
          <div className="monitor-picks">
            {monitors.map((monitor) => {
              const open = selected?.id === monitor.id;
              return (
                <div key={monitor.id} className={`monitor-card${open ? " open" : ""}`}>
                  <button
                    type="button"
                    className="monitor-pick"
                    aria-expanded={open}
                    onClick={() => {
                      if (open) {
                        setSelectedId(null);
                        return;
                      }
                      setSelectedId(monitor.id);
                      setSyncedKey("");
                    }}
                  >
                    <span className="monitor-pick-name">
                      <strong>{monitor.name}</strong>
                      <StatusMark status={monitor.status} />
                    </span>
                    <span className="muted">{placeLabel(monitor.location_label, monitor.region, monitor.country)}</span>
                    <span className="mono">{monitor.lan_ip || "No address yet"}</span>
                    <span className="muted">{formatSeen(monitor.last_seen_at)}</span>
                  </button>
                  {open ? (
                    <div className="monitor-card-body">
                      {admin ? (
                        <form className="device-form" onSubmit={requestSave}>
                          <div className="field">
                            <label htmlFor="onboard-name">Device name</label>
                            <input
                              id="onboard-name"
                              value={name}
                              onChange={(event) => setName(event.target.value)}
                              autoComplete="off"
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="onboard-interval">Report every</label>
                            <SelectMenu
                              id="onboard-interval"
                              value={intervalSeconds}
                              onChange={(event) => setIntervalSeconds(Number(event.target.value))}
                            >
                              {intervalOptions.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </SelectMenu>
                          </div>
                          <div className="form-actions">
                            <button className={`btn btn-primary${setupDirty ? " is-dirty" : ""}`} type="submit" disabled={busy}>
                              Save
                            </button>
                            <button
                              className="btn"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setError(null);
                                setPending({ kind: "key", monitor });
                              }}
                            >
                              Generate key
                            </button>
                            <button
                              className="btn"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setError(null);
                                setPending({ kind: "tunnel", monitor });
                              }}
                            >
                              {tunnelLabel(monitor)}
                            </button>
                            <button
                              className="btn"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setError(null);
                                setPending({ kind: "delete", monitor });
                              }}
                            >
                              Delete
                            </button>
                            <Link className="btn" to={`/settings/agents/${monitor.id}`}>
                              Configure Remote Agent
                            </Link>
                            {applying ? (
                              <span className="muted">The remote agent applies a new report interval on its next report.</span>
                            ) : null}
                          </div>
                        </form>
                      ) : (
                        <p className="page-sub" style={{ margin: 0 }}>
                          Reports every {monitor.health_interval_seconds}s.{" "}
                          <Link to={`/monitors/${monitor.id}`}>Open remote agent</Link>
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {error ? <div className="error">{error}</div> : null}
      </section>

      {pending && confirmCopy ? (
        <ConfirmDialog
          title={confirmCopy.title}
          confirmLabel={confirmCopy.confirmLabel}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => {
            if (!busy) setPending(null);
          }}
        >
          {confirmCopy.body}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function confirmText(
  pending: Pending | null,
  selected: MonitorAdmin | null,
  nextName: string,
): { title: string; body: string; confirmLabel: string } | null {
  if (!pending) return null;
  if (pending.kind === "add") {
    return {
      title: "Add device",
      confirmLabel: "Add device",
      body: `Create “${pending.name}” and generate a 256-bit key? The remote agent must use this name exactly, including capital letters.`,
    };
  }
  if (pending.kind === "delete") {
    return {
      title: "Delete device",
      confirmLabel: "Delete device",
      body: `Delete “${pending.monitor.name}”? This removes the device, and it will no longer be able to connect.`,
    };
  }
  if (pending.kind === "key") {
    return {
      title: "Generate key",
      confirmLabel: "Generate key",
      body: `Generate a new key for “${pending.monitor.name}”? The current key stops working. Paste the new key into the remote agent.`,
    };
  }
  if (pending.kind === "tunnel") {
    const action = tunnelAction(pending.monitor);
    if (action === "wireless") {
      return {
        title: "Issue Wi-Fi tunnel",
        confirmLabel: "Issue Wi-Fi tunnel",
        body: `Create the Wi-Fi tunnel for “${pending.monitor.name}”? The wired tunnel keeps working. The Wi-Fi config is shown once. Wi-Fi checks use http://10.7.1.1:8847.`,
      };
    }
    if (action === "replace") {
      return {
        title: "Replace tunnels",
        confirmLabel: "Replace tunnels",
        body: `Replace the wired and Wi-Fi tunnels for “${pending.monitor.name}”? The current tunnels stop working. Both configs are shown once.`,
      };
    }
    return {
      title: "Issue tunnels",
      confirmLabel: "Issue tunnels",
      body: `Create a wired tunnel and a Wi-Fi tunnel for “${pending.monitor.name}”? Both configs are shown once. Wired checks use http://10.7.0.1:8847 and Wi-Fi checks use http://10.7.1.1:8847.`,
    };
  }
  const current = selected?.name ?? "this device";
  const renamed = selected != null && nextName !== selected.name;
  return {
    title: "Save device",
    confirmLabel: "Save",
    body: renamed
      ? `Save changes for “${current}”? The remote agent must use “${nextName}” exactly, including capital letters, or it will stop connecting.`
      : `Save changes for “${current}”?`,
  };
}
