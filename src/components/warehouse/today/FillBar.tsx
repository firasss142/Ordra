"use client";

import { useEffect, useRef } from "react";

/**
 * A progress bar whose fill grows in once, the way the prototype's `.bar > i`
 * does (`fill .7s ease-out`, from the reading start). Motion only on arrival —
 * nothing animates at rest — and none at all under reduced motion.
 *
 * The width is the percentage itself, never a scale: the bar has to read right
 * in the very first server frame, before any script runs.
 */
export function FillBar({
  pct,
  label,
  className,
  fillClassName = "bg-job",
}: {
  pct: number;
  label: string;
  /** Track: height, radius, colour, margin. */
  className: string;
  fillClassName?: string;
}) {
  const fill = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = fill.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 700, easing: "ease-out" });
  }, []);
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      aria-label={label}
      className={`overflow-hidden ${className}`}
    >
      <i
        ref={fill}
        className={`block h-full origin-left rounded-[inherit] rtl:origin-right ${fillClassName}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
