import type { ReactNode } from "react";

/**
 * The two shapes every mobile screen is built from.
 *
 * Measurements come from docs/design/entrepot/mobile/*.png: a white card with
 * a single green-tinted hairline and no shadow, and a bold page title that
 * starts the screen because there is no header above it.
 */

export function WmCard({
  children,
  className = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[10px] border border-wm-card-edge bg-wm-card ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** The page title. Centred, as in every mockup, and the first thing on screen. */
export function WmTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-center text-[26px] font-extrabold tracking-[-0.02em] text-wm-ink">
      {children}
    </h1>
  );
}

/** Uppercase micro-label above a figure. */
export const WM_LABEL =
  "text-[11px] font-semibold uppercase tracking-[0.06em] text-wm-ink-2";
