"use client";

// Finances — the section's small atoms, from the prototypes' KIT script
// (prototypes/finances-*.html): number formats, the money figure, the trend
// pill, the tooltip and the drawer. Every page of the section uses these.

import { useCallback, useEffect, useRef, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { currencySymbol, groupDigits, numText } from "@/lib/products/format";

export type Loc = "fr" | "ar";
export const NB = " ";

export interface Fmt {
  loc: Loc;
  /** « 24 390 » — a whole (or `d`-decimal) number, bidi-safe in Arabic */
  n: (v: number, d?: number) => string;
  /** « 24 390 د.ل » */
  money: (v: number) => string;
  sym: string;
}

export function makeFmt(loc: Loc, currency: string): Fmt {
  const n = (v: number, d = 0) => (loc === "ar" ? numText(v, d) : `${Number(v.toFixed(d)) < 0 ? "−" : ""}${groupDigits(v, d)}`);
  const sym = currencySymbol(currency);
  return { loc, n, money: (v) => `${n(Math.round(v))}${NB}${sym}`, sym };
}

/** The big money figure: number, then the currency demoted beside it. */
export function Money({ f, v, className }: { f: Fmt; v: number; className?: string }) {
  return (
    <span className={className}>
      {f.n(Math.round(v))}
      <span className="cur">{f.sym}</span>
    </span>
  );
}

/** ▲ +12 % — green when the move is good for the owner, red when it is not. */
export function Trend({ f, pct, goodWhenUp = true, tip, unit = "%" }: { f: Fmt; pct: number; goodWhenUp?: boolean; tip?: string; unit?: string }) {
  const r = Math.round(pct);
  if (r === 0) return <span className="tr eq" data-tip={tip}>=</span>;
  const up = r > 0;
  const good = up === goodWhenUp;
  return (
    <span className={`tr ${good ? "good" : "bad"}`} data-tip={tip}>
      {up ? <ArrowUp className="ic" aria-hidden /> : <ArrowDown className="ic" aria-hidden />}
      {`${up ? "+" : "−"}${f.n(Math.abs(r))}${unit === "%" ? `${NB}%` : unit}`}
    </span>
  );
}

/**
 * The prototypes' tooltip: any element with data-tip. The first line is the
 * title, the following lines are small print. Text only — never HTML.
 */
export function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const onOver = useCallback((e: MouseEvent) => {
    const tip = ref.current;
    if (!tip) return;
    const el = (e.target as Element).closest?.("[data-tip]") as HTMLElement | null;
    const text = el?.dataset.tip;
    if (!text) {
      tip.classList.remove("on");
      return;
    }
    const [head, ...rest] = text.split("\n");
    tip.replaceChildren();
    const b = document.createElement("b");
    b.textContent = head;
    tip.append(b);
    for (const line of rest) {
      const s = document.createElement("small");
      s.textContent = line;
      tip.append(s);
    }
    tip.classList.add("on");
  }, []);
  const onMove = useCallback((e: MouseEvent) => {
    const tip = ref.current;
    if (!tip || !tip.classList.contains("on")) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY - h - 12;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y < 8) y = e.clientY + 18;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }, []);
  const onLeave = useCallback(() => ref.current?.classList.remove("on"), []);
  return { ref, onOver, onMove, onLeave };
}

/** Floating glass drawer with a halo of `hue`. Escape and the scrim close it. */
export function Drawer({ open, onClose, hue, labelledBy, closeLabel, children }: {
  open: boolean;
  onClose: () => void;
  hue?: string;
  labelledBy: string;
  closeLabel: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={{ "--h": hue } as CSSProperties}>
        {children}
      </aside>
    </>
  );
}

export function DrawerClose({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button className="dr-x" type="button" aria-label={label} onClick={onClose}>
      <X className="ic" aria-hidden />
    </button>
  );
}
