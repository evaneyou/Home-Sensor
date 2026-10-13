import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const IDLE_MS = 3 * 60 * 1000;

const GuestGateContext = createContext<(action: () => void) => void>((action) => {
  action();
});

export function canOperate(role: string | undefined): boolean {
  return role === "admin" || role === "guest";
}

export function GuestGate({ role, children }: { role: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const run = useCallback(
    (action: () => void) => {
      if (role === "guest") {
        setOpen(true);
        return;
      }
      action();
    },
    [role],
  );

  return (
    <GuestGateContext.Provider value={run}>
      {children}
      {open ? <GuestNotice onClose={() => setOpen(false)} /> : null}
    </GuestGateContext.Provider>
  );
}

export function useGuestGate(): (action: () => void) => void {
  return useContext(GuestGateContext);
}

export function useGuestIdle(role: string, onLogout: () => void) {
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  useEffect(() => {
    if (role !== "guest") return;
    let timer = window.setTimeout(() => onLogoutRef.current(), IDLE_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => onLogoutRef.current(), IDLE_MS);
    };
    const names = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"] as const;
    for (const name of names) window.addEventListener(name, reset, { passive: true });
    window.addEventListener("scroll", reset, { capture: true, passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of names) window.removeEventListener(name, reset);
      window.removeEventListener("scroll", reset, { capture: true });
    };
  }, [role]);
}

function GuestNotice({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "Enter") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="monitor-dialog-backdrop confirm-backdrop" onClick={onClose}>
      <div
        className="monitor-dialog confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-notice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="guest-notice-title">Guest account</h2>
        <p>This doesn&apos;t work for a guest.</p>
        <div className="confirm-actions">
          <button className="btn btn-primary" type="button" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
