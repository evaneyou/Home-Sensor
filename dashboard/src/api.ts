import type { InternetServiceSetting, RfAp, RfChannelSnapshot, RfHistoryPoint, RfOverview, WebServiceSetting, WebStability } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8847";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  base: API_BASE,
  login: (username: string, password: string) =>
    request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request("/api/v1/auth/logout", { method: "POST" }),
  me: () => request("/api/v1/auth/me"),
  summary: () => request("/api/v1/summary"),
  results: (params: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/v1/results?${q}`);
  },
  metrics: (testId: string, range: string) =>
    request(`/api/v1/metrics?test_id=${testId}&range=${range}`),
  issues: (status?: string) =>
    request(`/api/v1/issues${status ? `?status=${status}` : ""}`),
  issue: (id: string) => request(`/api/v1/issues/${id}`),
  monitors: () => request("/api/v1/monitors"),
  createMonitor: (name: string) =>
    request("/api/v1/monitors", { method: "POST", body: JSON.stringify({ name }) }),
  deleteMonitor: (id: string) => request(`/api/v1/monitors/${id}`, { method: "DELETE" }),
  regenerateMonitorKey: (id: string) => request(`/api/v1/monitors/${id}/key`, { method: "POST" }),
  issueMonitorTunnel: (id: string) => request(`/api/v1/monitors/${id}/tunnel`, { method: "POST" }),
  restartMonitor: (id: string) => request(`/api/v1/monitors/${id}/restart`, { method: "POST" }),
  monitor: (id: string) => request(`/api/v1/monitors/${id}`),
  monitorPath: (id: string, link: "wired" | "wireless", destination = "server") =>
    request(`/api/v1/monitors/${id}/path?link=${link}&destination=${encodeURIComponent(destination)}`),
  monitorLog: (id: string, offset: number, limit: number, probe = "all") =>
    request(`/api/v1/monitors/${id}/log?offset=${offset}&limit=${limit}&probe=${encodeURIComponent(probe)}`),
  updateMonitorLocation: (
    id: string,
    body: {
      latitude?: number | null;
      longitude?: number | null;
      location_label?: string | null;
      region?: string | null;
      country?: string | null;
      name?: string;
      health_interval_seconds?: number;
    },
  ) =>
    request(`/api/v1/monitors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  monitorDevice: (id: string) => request(`/api/v1/monitors/${id}/device`),
  monitorHealth: (id: string, range: string) =>
    request(`/api/v1/monitors/${id}/health?range=${range}`),
  wifiScans: (monitorId: string, range: string) =>
    request(`/api/v1/wifi-scans?monitor_id=${monitorId}&range=${range}`),
  test: (id: string) => request(`/api/v1/tests/${id}`),
  webServices: () => request("/api/v1/settings/web-services"),
  saveWebServices: (services: WebServiceSetting[]) =>
    request("/api/v1/settings/web-services", {
      method: "PUT",
      body: JSON.stringify({ services }),
    }),
  webStability: () => request<WebStability>("/api/v1/settings/web-stability"),
  saveWebStability: (setting: WebStability) =>
    request<WebStability>("/api/v1/settings/web-stability", {
      method: "PUT",
      body: JSON.stringify(setting),
    }),
  internetService: () => request("/api/v1/settings/internet-service"),
  saveInternetService: (setting: InternetServiceSetting) =>
    request("/api/v1/settings/internet-service", {
      method: "PUT",
      body: JSON.stringify(setting),
    }),
  rfOverview: (agentId: string, range: string) =>
    request<RfOverview>(`/api/v1/rf/overview?agent_id=${agentId}&range=${range}`),
  rfAps: (agentId: string, params: Record<string, string>) => {
    const query = new URLSearchParams({ agent_id: agentId, ...params });
    return request<RfAp[]>(`/api/v1/rf/aps?${query}`);
  },
  rfHistory: (agentId: string, bssid: string, range: string) =>
    request<RfHistoryPoint[]>(
      `/api/v1/rf/aps/${encodeURIComponent(bssid)}/history?agent_id=${agentId}&range=${range}`,
    ),
  rfChannels: (agentId: string, band: string) =>
    request<RfChannelSnapshot>(
      `/api/v1/rf/channel-snapshot?agent_id=${agentId}&band=${encodeURIComponent(band)}`,
    ),
  rfScanNow: (agentId: string) =>
    request(`/api/v1/rf/scan-now?agent_id=${agentId}`, { method: "POST" }),
  rfTrust: (agentId: string, bssid: string, trusted: boolean) =>
    request<RfAp>(`/api/v1/rf/aps/${encodeURIComponent(bssid)}/trust?agent_id=${agentId}`, {
      method: trusted ? "POST" : "DELETE",
    }),
};
