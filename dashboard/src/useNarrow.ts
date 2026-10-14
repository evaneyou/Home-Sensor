import { useEffect, useRef, useState, type RefObject } from "react";

/** True while the viewport is at or under a phone-and-small-tablet width. */
export function useNarrow(query = "(max-width: 768px)"): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [query]);
  return narrow;
}

/**
 * The width of an element, kept current as it is resized. A diagram uses it to lay itself out for the
 * space it has, so a phone gets a layout that fits rather than a desktop one that scrolls.
 */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const apply = () => setWidth(Math.round(element.getBoundingClientRect().width));
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
