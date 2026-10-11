import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

type MenuItem = { value: string; label: string; disabled: boolean; group?: string };

function readItems(select: HTMLSelectElement | null): MenuItem[] {
  if (!select) return [];
  const items: MenuItem[] = [];
  for (const node of Array.from(select.children)) {
    if (node instanceof HTMLOptGroupElement) {
      for (const option of Array.from(node.children)) {
        if (!(option instanceof HTMLOptionElement)) continue;
        items.push({ value: option.value, label: option.text, disabled: option.disabled, group: node.label });
      }
    } else if (node instanceof HTMLOptionElement) {
      items.push({ value: node.value, label: node.text, disabled: node.disabled });
    }
  }
  return items;
}

function sameItems(left: MenuItem[], right: MenuItem[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return item.value === other.value && item.label === other.label && item.disabled === other.disabled && item.group === other.group;
  });
}

export default function SelectMenu({
  id,
  value,
  onChange,
  children,
  className,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: {
  id?: string;
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const current = items.find((item) => item.value === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLSelectElement>(null);
  const panelId = useId();

  useLayoutEffect(() => {
    const next = readItems(sourceRef.current);
    setItems((prev) => (sameItems(prev, next) ? prev : next));
  });

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(next: string) {
    onChange({ target: { value: next } });
    setOpen(false);
  }

  function move(step: number) {
    const enabled = items.map((item, index) => ({ item, index })).filter((entry) => !entry.item.disabled);
    if (enabled.length === 0) return;
    const at = enabled.findIndex((entry) => entry.index === active);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    setActive(next.index);
  }

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        const index = Math.max(0, items.findIndex((item) => item.value === String(value)));
        setActive(index);
        setOpen(true);
        return;
      }
      if (event.key === "ArrowDown") move(1);
      if (event.key === "ArrowUp") move(-1);
      if (event.key === "Enter" || event.key === " ") {
        const item = items[active];
        if (item && !item.disabled) choose(item.value);
      }
    }
  }

  let lastGroup: string | undefined;
  return (
    <div className="select-menu" ref={rootRef}>
      <select ref={sourceRef} hidden aria-hidden="true" tabIndex={-1} value={String(value)} onChange={() => undefined}>
        {children}
      </select>
      <button
        id={id}
        type="button"
        className={className ? `select-menu-trigger ${className}` : "select-menu-trigger"}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (disabled) return;
          if (open) {
            setOpen(false);
            return;
          }
          const index = Math.max(0, items.findIndex((item) => item.value === String(value)));
          setActive(index);
          setOpen(true);
        }}
        onKeyDown={onTriggerKey}
      >
        <span className="select-menu-label">{current?.label ?? ""}</span>
        <svg className="select-menu-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <ul className="select-menu-panel" id={panelId} role="listbox" aria-label={ariaLabel}>
          {items.map((item, index) => {
            const showGroup = item.group && item.group !== lastGroup;
            if (item.group) lastGroup = item.group;
            return (
              <li key={`${item.group ?? ""}-${item.value}`} role="presentation">
                {showGroup ? <div className="select-menu-group">{item.group}</div> : null}
                <button
                  type="button"
                  className="select-menu-option"
                  role="option"
                  aria-selected={item.value === String(value)}
                  data-active={index === active ? "true" : undefined}
                  disabled={item.disabled}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item.value)}
                >
                  <span className="select-menu-option-label">{item.label}</span>
                  {item.value === String(value) ? (
                    <svg className="select-menu-check" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                      <path d="M5 12.5 10 17.5 19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <span className="select-menu-check" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
