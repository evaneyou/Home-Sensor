import type { ReactNode } from "react";

export default function WaitButton({
  busy,
  label,
  busyLabel = "Scanning…",
  disabled = false,
  onClick,
  className = "npv-run",
  icon = null,
}: {
  busy: boolean;
  label: string;
  busyLabel?: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  icon?: ReactNode;
}) {
  const waiting = busy;
  return (
    <button
      className={waiting ? `${className} is-waiting` : className}
      type="button"
      disabled={disabled || waiting}
      aria-busy={waiting}
      onClick={onClick}
    >
      {waiting ? <span className="wait-spinner" aria-hidden="true" /> : icon}
      <span>{waiting ? busyLabel : label}</span>
    </button>
  );
}
