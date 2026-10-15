import type { ReactNode } from "react";

/** A guest value whose letters and digits have already been replaced with #. */
export function isAnonymized(value: unknown): boolean {
  return typeof value === "string" && value.includes("#") && !/[A-Za-z0-9]/.test(value);
}

export function coordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Join place parts, keeping each field's hashed length. */
export function joinAnon(parts: Array<string | null | undefined>, separator = ", "): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(separator);
}

export function stableId(row: { anon_key?: string | null }, fallback: string): string {
  return row.anon_key || fallback;
}

export function AnonText({
  value,
  fallback = "—",
  className,
}: {
  value: string | null | undefined;
  fallback?: string;
  className?: string;
}): ReactNode {
  if (!value) return <span className={className}>{fallback}</span>;
  if (isAnonymized(value)) return <span className="anon-mark">{value}</span>;
  return <span className={className}>{value}</span>;
}

export function AnonPlate({ value }: { value?: string | null }) {
  return (
    <div className="anon-plate" aria-label="Anonymized">
      <span className="anon-mark">{value || "####"}</span>
    </div>
  );
}
