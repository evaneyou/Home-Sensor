export type User = {
  id: string;
  username: string;
  role: "admin" | "viewer";
};

export type HealthCell = {
  sensor_id: string;
  sensor_slug: string;
  sensor_name: string;
  network_id: string;
  network_slug: string;
  network_name: string;
  status: "ok" | "degraded" | "fail" | "unknown";
  last_test_at: string | null;
  failing_tests: number;
};

export type IssueSummary = {
  id: string;
  title: string;
  severity: "info" | "warning" | "critical";
  status: string;
  opened_at: string;
  root_cause_stage: string | null;
  sensor_slug: string | null;
  network_slug: string | null;
};

export type Summary = {
  generated_at: string;
  matrix: HealthCell[];
  open_issues: IssueSummary[];
  sensors: { id: string; slug: string; name: string; status: string }[];
  networks: { id: string; slug: string; name: string; kind: string }[];
};

export type Result = {
  id: string;
  external_id: string;
  test_id: string;
  test_slug: string;
  test_name: string;
  test_kind: string;
  sensor_id: string;
  sensor_slug: string;
  network_id: string;
  network_slug: string;
  started_at: string;
  finished_at: string;
  status: string;
  stages: { name: string; duration_ms: number; status?: string }[];
  metrics: Record<string, number>;
  message: string | null;
};

export type MetricsResponse = {
  test_id: string;
  test_slug: string;
  points: {
    t: string;
    status: string;
    rtt_ms: number | null;
    loss_pct: number | null;
    stages: { name: string; duration_ms: number; status?: string }[];
  }[];
};

export type Issue = {
  id: string;
  title: string;
  summary: string;
  severity: string;
  status: string;
  root_cause_stage: string | null;
  opened_at: string;
  resolved_at: string | null;
  sensor_id: string | null;
  sensor_slug: string | null;
  network_id: string | null;
  network_slug: string | null;
  test_id: string | null;
  test_slug: string | null;
  recent_failures: Result[];
};

export type SensorDetail = {
  id: string;
  slug: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  tests: {
    id: string;
    slug: string;
    name: string;
    kind: string;
    target: string;
    network_id: string;
    network_slug: string;
    network_name: string;
    latest_status: string;
    latest_at: string | null;
  }[];
};

export type TestDetail = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  target: string;
  interval_seconds: number;
  sensor_id: string;
  sensor_slug: string;
  sensor_name: string;
  network_id: string;
  network_slug: string;
  network_name: string;
};
