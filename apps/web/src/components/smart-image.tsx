"use client";
import { useEffect, useRef, useState } from "react";
import { IconImage } from "./icons";
import { cx } from "./ui";

interface Props {
  src?: string;
  alt: string;
  width: number;
  height: number;
  /** Above-the-fold image: loaded eagerly with high priority (hero, first product). */
  priority?: boolean;
  fit?: "cover" | "contain";
  className?: string;
}

/**
 * Image with a shimmer placeholder until it has loaded, a fade-in, and a graceful fallback if it fails.
 * The box reserves its aspect ratio (width/height), so nothing jumps when the image arrives.
 */
export function SmartImage({ src, alt, width, height, priority, fit = "cover", className }: Props) {
  const [state, setState] = useState<"loading" | "ready" | "error">(src ? "loading" : "error");
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // Cached/SSR images can finish before hydration, so onLoad never fires: check the element directly.
    const el = ref.current;
    if (el?.complete) setState(el.naturalWidth > 0 ? "ready" : "error");
  }, [src]);
  return (
    <span className={cx("simg", `simg-${state}`, className)} style={{ aspectRatio: `${width} / ${height}` }}>
      {src && state !== "error" && (
        <img
          ref={ref} src={src} alt={alt} width={width} height={height} style={{ objectFit: fit }}
          loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"}
          onLoad={() => setState("ready")} onError={() => setState("error")}
        />
      )}
      {state === "error" && <span className="simg-fallback" role="img" aria-label={alt || "Image unavailable"}><IconImage width={28} height={28} /></span>}
    </span>
  );
}
