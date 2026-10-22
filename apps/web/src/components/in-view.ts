"use client";
import { useEffect, useRef } from "react";

/** Calls `onVisible` once each time the returned element comes within `margin` of the viewport (used to load content just before it is needed). */
export function useInView<T extends Element>(onVisible: () => void, enabled = true, margin = "600px") {
  const ref = useRef<T>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    if (typeof IntersectionObserver === "undefined") { cb.current(); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) cb.current(); }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, margin]);
  return ref;
}
