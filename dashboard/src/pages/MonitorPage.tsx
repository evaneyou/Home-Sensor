import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import StatusMark from "../components/StatusMark";
import DevicePanel from "../components/DevicePanel";
import InternetPath, { logProbeForDetail } from "../components/InternetPath";
import MonitorStatusDialog from "../components/MonitorStatusDialog";
import WifiScans from "../components/WifiScans";
import { networkLabel, networkOrder } from "../labels";
import type { MonitorDetail } from "../types";

export default function MonitorPage() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusOpen, setStatusOpen] = useState(false);
  const monitorQ = useQuery({
    queryKey: ["monitor", id],
    queryFn: () => api.monitor(id) as Promise<MonitorDetail>,
    enabled: !!id,
  });

  const networks = useMemo(() => {
    const map = new Map<string, { id: string; slug: string; name: string }>();
    for (const t of monitorQ.data?.tests ?? []) {
      map.set(t.network_id, { id: t.network_id, slug: t.network_slug, name: t.network_name });
    }
    return [...map.values()]
      .filter((network) => network.slug !== "wired" && network.slug !== "wifi")
      .sort((a, b) => networkOrder(a) - networkOrder(b));
  }, [monitorQ.data]);

  const requested = searchParams.get("network");
  const activeTab =
    requested && networks.some((n) => n.id === requested) ? requested : (networks[0]?.id ?? null);

  if (monitorQ.isLoading) return <div className="state-box">Loading monitor…</div>;
  if (monitorQ.isError || !monitorQ.data) {
    return <div className="state-box">Remote agent not found.</div>;
  }

  const monitor = monitorQ.data;
  const activeNetwork = networks.find((n) => n.id === activeTab);
  const tests =
    activeNetwork?.slug === "wan"
      ? monitor.tests.filter((test) => ["wan", "wired", "wifi"].includes(test.network_slug))
      : monitor.tests.filter((test) => !activeTab || test.network_id === activeTab);

  return (
    <div>
      <div className="monitor-head">
        <h1 className="page-title">
          <ProbeIcon />
          <span>{monitor.name}</span>
        </h1>
        <button
          className="monitor-status-box"
          type="button"
          onClick={() => setStatusOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={statusOpen}
        >
          <StatusMark status={monitor.status} />
          <span className="monitor-status-seen">
            Remote Probe Status
            {monitor.last_seen_at
              ? ` · Last seen ${new Date(monitor.last_seen_at).toLocaleString()}`
              : " · Not seen yet"}
          </span>
        </button>
      </div>
      {statusOpen ? <MonitorStatusDialog monitor={monitor} onClose={() => setStatusOpen(false)} /> : null}

      {activeNetwork?.slug === "wan" || statusOpen ? null : <DevicePanel monitorId={monitor.id} />}

      <div className="tabs">
        {networks.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`tab ${activeTab === n.id ? "active" : ""}`}
            onClick={() => setSearchParams({ network: n.id })}
          >
            {networkLabel(n)}
          </button>
        ))}
      </div>

      {activeNetwork?.slug === "wifi-main" ? <WifiScans monitorId={monitor.id} /> : null}
      {activeNetwork?.slug === "wan" ? (
        <InternetPath tests={tests} publicIp={monitor.public_ip} isp={monitor.isp} />
      ) : null}

      <div className="panel">
        <Link className="btn log-link" to={logHref(monitor.id, activeNetwork?.slug, searchParams.get("detail"))}>
          Log of recent results
        </Link>
      </div>
    </div>
  );
}

function logHref(monitorId: string, networkSlug: string | undefined, detail: string | null): string {
  const probe = networkSlug === "wan" ? logProbeForDetail(detail) : null;
  if (!probe) return `/monitors/${monitorId}/log`;
  return `/monitors/${monitorId}/log?probe=${encodeURIComponent(probe)}`;
}

function ProbeIcon() {
  return (
    <svg className="probe-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <path d="M5.4 4.7a12.2 12.2 0 0 1 13.2 0" />
        <path d="M7.7 7.2a8.4 8.4 0 0 1 8.6 0" />
        <path d="M10 9.6a4.4 4.4 0 0 1 4 0" />
      </g>
      <path fill="currentColor" d="M11.15 10.15h1.7V13h-1.7z" />
      <path
        fill="currentColor"
        d="M3.1 13.15h17.8c.9 0 1.6.7 1.6 1.6v4.5c0 .9-.7 1.6-1.6 1.6H3.1c-.9 0-1.6-.7-1.6-1.6v-4.5c0-.9.7-1.6 1.6-1.6z"
      />
      <circle cx="6.15" cy="17.2" r="1.05" className="probe-icon-hole" />
      <circle cx="9.15" cy="17.2" r="1.05" className="probe-icon-hole" />
    </svg>
  );
}
