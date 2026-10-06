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
  sensor: (id: string) => request(`/api/v1/sensors/${id}`),
  test: (id: string) => request(`/api/v1/tests/${id}`),
};
