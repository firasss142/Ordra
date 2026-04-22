import React from "react";

export type StatusGlyphShape =
  | "ring"
  | "solid"
  | "half"
  | "check"
  | "cross"
  | "square";

export type StatusGlyphTone = "default" | "muted";

interface Props {
  shape: StatusGlyphShape;
  tone?: StatusGlyphTone;
}

/**
 * Monochrome 8×8 status glyph. Always paired with a visible text label — the
 * glyph is redundant, never the sole signal (WCAG).
 */
export function StatusGlyph({ shape, tone = "default" }: Props) {
  const color = tone === "muted" ? "#6D7175" : "#1A1A1A";
  return (
    <svg
      width={8}
      height={8}
      viewBox="0 0 8 8"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "0 0 auto", display: "inline-block" }}
    >
      {shape === "ring" && (
        <circle cx={4} cy={4} r={3} fill="none" stroke={color} strokeWidth={1.5} />
      )}
      {shape === "solid" && <circle cx={4} cy={4} r={3.5} fill={color} />}
      {shape === "half" && (
        <>
          <circle cx={4} cy={4} r={3} fill="none" stroke={color} strokeWidth={1} />
          <path d="M4 1 A3 3 0 0 0 4 7 Z" fill={color} />
        </>
      )}
      {shape === "check" && (
        <path
          d="M1.5 4.2 L3.3 6 L6.5 2.5"
          fill="none"
          stroke={color}
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {shape === "cross" && (
        <path
          d="M2 2 L6 6 M6 2 L2 6"
          fill="none"
          stroke={color}
          strokeWidth={1.3}
          strokeLinecap="round"
        />
      )}
      {shape === "square" && <rect x={2} y={2} width={4} height={4} fill={color} />}
    </svg>
  );
}
