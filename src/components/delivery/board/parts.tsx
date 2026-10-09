"use client";

/** Small shared pieces of the manager board: situation chip, avatar, ring, product thumb, tooltip. */
import { useEffect, useRef, type CSSProperties } from "react";
import { Check } from "lucide-react";
import type { SituationKey, Tone } from "@/lib/delivery/presentation";
import { SIT_TONE } from "@/lib/delivery/presentation";
import type { WorklistItem } from "@/lib/delivery/types";
import { agentColorKey, agentColorVars } from "@/lib/team/agent-color";
import { SIT_ICON } from "../ui";

/** [chip from, chip to, text, ring, dot] — the §4.22 hues as hex, softened toward white where they are drawn. */
const TONE_HEX: Record<Tone, [string, string, string, string, string]> = {
  red: ["#FECACA", "#FEF2F2", "#B91C1C", "#FCA5A5", "#EF4444"],
  rose: ["#FECDD3", "#FFF1F2", "#9F1239", "#FDA4AF", "#F43F5E"],
  fuchsia: ["#F5D0FE", "#FDF4FF", "#86198F", "#F0ABFC", "#D946EF"],
  violet: ["#DDD6FE", "#F5F3FF", "#5B21B6", "#C4B5FD", "#8B5CF6"],
  orange: ["#FED7AA", "#FFF7ED", "#9A3412", "#FDBA74", "#F97316"],
  amber: ["#FDE68A", "#FFFBEB", "#92400E", "#FCD34D", "#F59E0B"],
  yellow: ["#FEF08A", "#FEFCE8", "#854D0E", "#FDE047", "#EAB308"],
  teal: ["#99F6E4", "#F0FDFA", "#115E59", "#5EEAD4", "#14B8A6"],
  indigo: ["#C7D2FE", "#EEF2FF", "#3730A3", "#A5B4FC", "#6366F1"],
  stone: ["#D6D3D1", "#FAFAF9", "#44403C", "#A8A29E", "#A8A29E"],
  slate: ["#CBD5E1", "#F8FAFC", "#334155", "#94A3B8", "#94A3B8"],
  blue: ["#BFDBFE", "#EFF6FF", "#1D4ED8", "#93C5FD", "#3B82F6"],
  grey: ["#E5E7EB", "#F9FAFB", "#374151", "#D1D5DB", "#9CA3AF"],
  green: ["#BBF7D0", "#F0FDF4", "#15803D", "#86EFAC", "#22C55E"],
};

const soft = (hex: string, pct: number) => `color-mix(in srgb,${hex} ${pct}%,#fff)`;

/** The colour of a situation's dot and bar segment. */
export const sitDot = (key: SituationKey) => soft(TONE_HEX[SIT_TONE[key]][4], 72);

export function SitChip({ sit, label }: { sit: SituationKey; label: string }) {
  const [a, b, c, r] = TONE_HEX[SIT_TONE[sit]];
  const Icon = SIT_ICON[sit];
  return (
    <span className="sit" style={{ background: `linear-gradient(var(--gd),${soft(a, 60)},${b})`, color: c, boxShadow: `inset 0 0 0 1px ${soft(r, 55)}` }}>
      <Icon className="ic" aria-hidden /><span>{label}</span>
    </span>
  );
}

/** Her identity ramp (--a5/--a7/--a9) for every child of the element that wears it. */
export const agentVars = (id: string, color: string | null | undefined): CSSProperties => agentColorVars(agentColorKey(color, id));

export function Avatar({ id, name, color, small }: { id: string | null; name: string | null; color?: string | null; small?: boolean }) {
  if (!id) return <span className={`av none${small ? " s24" : ""}`} aria-hidden>?</span>;
  return <span className={`av${small ? " s24" : ""}`} style={agentVars(id, color)} aria-hidden>{(name ?? "?").slice(0, 1).toUpperCase()}</span>;
}

/** Parcels treated today out of those that needed her today. */
export function Ring({ treated, total, size = 42 }: { treated: number; total: number; size?: number }) {
  const r = size / 2 - 4, C = 2 * Math.PI * r, c = size / 2;
  const f = total ? Math.min(1, treated / total) : 0;
  const gap = f > 0 && f < 1 ? 2 : 0;
  return (
    <span className="rng2" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="color-mix(in srgb,var(--a5) 10%,transparent)" strokeWidth="5" />
        {f > 0 ? <circle cx={c} cy={c} r={r} fill="none" stroke="color-mix(in srgb,var(--a5) 82%,#fff)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${Math.max(0, C * f - gap)} ${C}`} /> : null}
      </svg>
      <b className={`num${treated ? "" : " zero"}`}>{treated}</b>
    </span>
  );
}

/** The product's photo, or its first three letters on a dark tile. */
export function Thumb({ item }: { item: WorklistItem | undefined }) {
  if (item?.image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <span className="thumb"><img src={item.image_url} alt="" loading="lazy" /></span>;
  }
  return <span className="thumb" aria-hidden>{(item?.product_name ?? "").split(" ")[0].slice(0, 3)}</span>;
}

export function CheckBox({ on }: { on: boolean }) {
  return <span className={`cb${on ? " on" : ""}`} aria-hidden>{on ? <Check className="ic" /> : null}</span>;
}

/** One tooltip for the whole board: any element with data-tip. */
export function useTip() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      const tip = ref.current;
      if (!tip) return;
      if (!el) { tip.style.opacity = "0"; return; }
      tip.textContent = el.dataset.tip ?? "";
      tip.style.opacity = "1";
      tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${e.clientY + 18 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18}px`;
    };
    document.addEventListener("mousemove", move);
    return () => document.removeEventListener("mousemove", move);
  }, []);
  return ref;
}

/** Close a popover when the pointer goes down outside it, or on Escape. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open, onClose]);
  return ref;
}
