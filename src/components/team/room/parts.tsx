"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle, Phone } from "lucide-react";
import { toWhatsAppE164 } from "@/lib/whatsapp/phone";
import { agentColorKey, agentColorVars } from "@/lib/team/agent-color";
import type { MarketCode } from "@/lib/markets";

/**
 * Salle de contrôle v6 — the small pieces every block shares. Class names are the
 * prototype's own (prototypes/team-v6.html) with the r6- prefix; the rules live in
 * globals.css under « Salle de contrôle v6 ».
 */

export type Presence = "working" | "idle" | "late" | "early" | "off" | null;

/** Her colour ramp as --a0…--a9, for every child of the element that wears it. */
export function agentStyle(color: string | null | undefined, agentId: string): CSSProperties {
  return agentColorVars(agentColorKey(color, agentId));
}

/** Her initial on her colour, with the live dot when there is one to show. */
export function Avatar({ name, agentId, color, presence = null, className = "", style }: {
  name: string;
  agentId: string;
  color: string | null | undefined;
  presence?: Presence;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`r6-av ${className}`} style={{ ...agentStyle(color, agentId), ...style }} aria-hidden="true">
      {name.slice(0, 1)}
      {presence && <i className={`r6-dot r6-${presence}`} />}
    </span>
  );
}

/** WhatsApp to the agent — or, with no number in Accès, a disabled button that says so. */
export function WhatsAppButton({ phone, market, variant = "icon" }: { phone: string | null; market: MarketCode; variant?: "icon" | "labelled" }) {
  const t = useTranslations("team.room.agents");
  const number = toWhatsAppE164(phone, market);
  const title = number ? t("wa") : t("waNone");
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  if (variant === "labelled") {
    const inner = (
      <>
        <MessageCircle className="r6-ic" aria-hidden="true" />
        <span>WhatsApp</span>
      </>
    );
    return number ? (
      <a href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" className="r6-btn r6-sm" data-tip={title} onClick={stop}>
        {inner}
      </a>
    ) : (
      <button type="button" disabled className="r6-btn r6-sm" data-tip={title} aria-label={title}>
        {inner}
      </button>
    );
  }
  return number ? (
    <a href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" className="r6-wa" data-tip={title} aria-label={title} onClick={stop}>
      <MessageCircle className="r6-ic" aria-hidden="true" />
    </a>
  ) : (
    <button type="button" disabled className="r6-wa" data-tip={title} aria-label={title} onClick={stop}>
      <MessageCircle className="r6-ic" aria-hidden="true" />
    </button>
  );
}

/** A plain call, for the drawer header. */
export function CallButton({ phone }: { phone: string | null }) {
  const t = useTranslations("team.room.agents");
  return phone ? (
    <a href={`tel:${phone}`} className="r6-btn r6-sm r6-icon" aria-label={t("call")} data-tip={t("call")}>
      <Phone className="r6-ic" aria-hidden="true" />
    </a>
  ) : (
    <button type="button" disabled className="r6-btn r6-sm r6-icon" aria-label={t("call")} data-tip={t("waNone")}>
      <Phone className="r6-ic" aria-hidden="true" />
    </button>
  );
}

/** The drawer's small uppercase section label, with an optional reading at its end. */
export function SectionLabel({ icon, children, end, style }: { icon?: ReactNode; children: ReactNode; end?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="r6-sl" style={style}>
      {icon}
      {children}
      {end !== undefined && <span className="r6-r">{end}</span>}
    </div>
  );
}

/** A legend swatch: k = up | rej | prog | todo | late | del | road | ret | x. */
export function Swatch({ k, style }: { k?: string; style?: CSSProperties }) {
  return <i className={`r6-sw ${k ? `r6-k-${k}` : ""}`} style={style} aria-hidden="true" />;
}

/**
 * The dark tooltip of the prototype: anything inside `root` with data-tip shows it,
 * following the pointer. One layer for the whole page; touch screens never see it.
 */
export function TipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el || !el.closest(".r6")) {
        tip.classList.remove("r6-on");
        return;
      }
      tip.textContent = el.dataset.tip ?? "";
      tip.classList.add("r6-on");
    };
    const move = (e: MouseEvent) => {
      if (!tip.classList.contains("r6-on")) return;
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      let x = e.clientX + 14;
      let y = e.clientY - h - 12;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y < 8) y = e.clientY + 18;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mousemove", move);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mousemove", move);
    };
  }, []);
  return <div ref={ref} className="r6-tip" role="tooltip" aria-hidden="true" />;
}

/** The hatching pattern « non appelées > N h » uses inside an SVG ring. */
export function HatchDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <pattern id="r6-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#FFD9E1" />
          <rect width="2.6" height="6" fill="#EF5A78" />
        </pattern>
      </defs>
    </svg>
  );
}
