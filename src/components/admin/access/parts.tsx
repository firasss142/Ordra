"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Box, Briefcase, Headphones, Shield, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { initialsOf } from "@/lib/user";
import { activityOf, type RoleTab } from "@/lib/users/access-view";
import type { UserWithStats } from "@/types";

/**
 * Accès building blocks — prototypes/acces-v2.html. One hue per role
 * (design-system §4.23): a wrapper names it with `.tone-*` and everything
 * inside reads `tone`, `tone-bg`, `tone-ink`, `tone-edge`. Sizes are px on
 * purpose: the root font is 14px, so rem classes would render 12.5% small.
 */

export const TONE: Record<RoleTab, string> = {
  all: "tone-all",
  agent: "tone-agent",
  warehouse_agent: "tone-warehouse",
  market_manager: "tone-manager",
  investor: "tone-investor",
  super_admin: "tone-admin",
};

export const ROLE_ICON: Record<RoleTab, LucideIcon> = {
  all: Users,
  agent: Headphones,
  warehouse_agent: Box,
  market_manager: Briefcase,
  investor: TrendingUp,
  super_admin: Shield,
};

export const dateLocale = (locale: string) => (locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR");

type ButtonVariant = "neutral" | "primary" | "danger" | "softCritical" | "ghostCritical";
const BUTTON: Record<ButtonVariant, string> = {
  neutral: "border-[#E3E5E8] bg-white text-[#15171A] hover:border-[#D5D8DC] hover:bg-[#F7F8F9]",
  primary: "border-brand bg-brand text-white hover:border-brand-hover hover:bg-brand-hover",
  danger: "border-[#D72C0D] bg-[#D72C0D] text-white hover:border-[#B8250B] hover:bg-[#B8250B]",
  softCritical: "border-[#F5C9C4] bg-white text-[#C0362C] hover:bg-[#FDECEA]",
  ghostCritical: "border-transparent bg-transparent px-[8px] text-[#C0362C] hover:bg-[#FDECEA]",
};

export function buttonClass(variant: ButtonVariant = "neutral", size: "md" | "sm" = "md"): string {
  const box = size === "sm" ? "h-[32px] rounded-[9px] px-[11px] text-[12.5px]" : "h-[38px] rounded-[10px] px-[15px] text-[13.5px]";
  return [
    "inline-flex items-center justify-center gap-[8px] whitespace-nowrap border font-semibold transition-colors duration-[120ms]",
    "disabled:cursor-not-allowed disabled:border-[#F3F4F6] disabled:bg-[#F3F4F6] disabled:text-[#80868C]",
    box,
    BUTTON[variant],
  ].join(" ");
}

export type Presence = "online" | "idle" | null;

/** Initials (or the photo) in the role's tint; a green or amber beat on the edge. */
export function AccessAvatar({
  user,
  size = "md",
  presence = null,
  muted = false,
}: {
  user: Pick<UserWithStats, "full_name" | "email" | "avatar_url" | "role">;
  size?: "xs" | "md" | "xl";
  presence?: Presence;
  muted?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const box = {
    xs: "h-[24px] w-[24px] text-[10px] shadow-[0_0_0_2px_var(--stack-ring,#fff),inset_0_0_0_1px_var(--tone-edge)]",
    md: "h-[36px] w-[36px] text-[13px] shadow-[inset_0_0_0_1px_var(--tone-edge)]",
    xl: "h-[60px] w-[60px] text-[21px] shadow-[0_0_0_3px_#fff,inset_0_0_0_1px_var(--tone-edge)]",
  }[size];
  const beat = size === "xl" ? "h-[15px] w-[15px] bottom-[1px] end-[1px] shadow-[0_0_0_3px_#fff]" : "h-[11px] w-[11px] bottom-[-1px] end-[-1px] shadow-[0_0_0_2px_#fff]";
  const initials = initialsOf(user);
  return (
    <span
      aria-hidden="true"
      className={`${TONE[user.role]} relative inline-grid flex-none place-items-center rounded-full bg-tone-bg font-semibold uppercase text-tone-ink ${box} ${muted ? "opacity-65 grayscale" : ""}`}
    >
      {user.avatar_url && !broken ? (
        /*
         * Out of the grid on purpose: as a grid item, `h-full` resolved against
         * a track the photo itself sized, so a portrait grew out of the circle.
         * Absolutely placed in a round clipping layer, any proportions fill the
         * frame — and the presence beat, a sibling, stays uncut.
         */
        <span className="absolute inset-0 overflow-hidden rounded-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={user.avatar_url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
        </span>
      ) : size === "xs" ? (
        initials.slice(0, 1)
      ) : (
        initials
      )}
      {presence && size !== "xs" && (
        <i className={`absolute rounded-full ${beat} ${presence === "idle" ? "bg-[#D97706]" : "bg-[#16A34A]"}`} />
      )}
    </span>
  );
}

/** The role, in its hue, with its dot. */
export function RoleChip({ role, onWhite = false, muted = false }: { role: UserWithStats["role"]; onWhite?: boolean; muted?: boolean }) {
  const t = useTranslations("users.role");
  const skin = muted
    ? "bg-[#F3F4F6] text-[#4F555B]"
    : onWhite
      ? "bg-white text-tone-ink shadow-[inset_0_0_0_1px_var(--tone-edge)]"
      : "bg-tone-bg text-tone-ink";
  return (
    <span className={`${TONE[role]} inline-flex h-[26px] items-center gap-[7px] whitespace-nowrap rounded-full pe-[11px] ps-[10px] text-[12.5px] font-semibold ${skin}`}>
      <span aria-hidden="true" className={`h-[6px] w-[6px] flex-none rounded-full ${muted ? "bg-[#9AA0A6]" : "bg-tone"}`} />
      {t(role)}
    </span>
  );
}

const DOT = {
  on: "bg-[#16A34A] shadow-[0_0_0_3px_rgba(22,163,74,.16)]",
  idle: "bg-[#D97706] shadow-[0_0_0_3px_rgba(217,119,6,.16)]",
  off: "bg-[#B4B9BF]",
  none: "bg-transparent shadow-[inset_0_0_0_1.5px_#9AA0A6]",
} as const;

export function Dot({ tone, size = 8 }: { tone: keyof typeof DOT; size?: 7 | 8 }) {
  return <i aria-hidden="true" className={`inline-block flex-none rounded-full ${size === 7 ? "h-[7px] w-[7px]" : "h-[8px] w-[8px]"} ${DOT[tone]}`} />;
}

/** Last presence beat in words: « En ligne », « il y a 12 h », « hier, 15:02 », « jeu. 1 oct. ». */
export function ActivityLabel({ lastSeenAt, now }: { lastSeenAt: string | null; now: Date }) {
  const t = useTranslations("users.activity");
  const locale = useLocale();
  const a = activityOf(lastSeenAt, now);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(dateLocale(locale), o).format(d);
  let text: string;
  switch (a.kind) {
    case "online": text = t("online"); break;
    case "idle": text = t("idle", { minutes: a.minutes }); break;
    case "minutes": text = t("minutes", { minutes: a.minutes }); break;
    case "hours": text = t("hours", { hours: a.hours }); break;
    case "yesterday": text = t("yesterday", { time: fmt(a.at, { hour: "2-digit", minute: "2-digit", hour12: false }) }); break;
    case "weekday": text = fmt(a.at, { weekday: "short", day: "numeric", month: "short" }); break;
    case "date": text = fmt(a.at, { day: "numeric", month: "short", ...(a.at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) }); break;
    default: text = t("none");
  }
  const tone = a.kind === "online" ? "on" : a.kind === "idle" ? "idle" : a.kind === "none" ? "none" : "off";
  const ink = tone === "on" ? "font-semibold text-[#15803D]" : tone === "idle" ? "font-semibold text-[#B45309]" : tone === "none" ? "text-[#656B72]" : "text-[#4F555B]";
  return (
    <span className={`inline-flex items-center gap-[8px] whitespace-nowrap text-[13.5px] ${ink}`}>
      <Dot tone={tone} />
      {text}
    </span>
  );
}

export function presenceOf(lastSeenAt: string | null, active: boolean, now: Date): Presence {
  if (!active) return null;
  const k = activityOf(lastSeenAt, now).kind;
  return k === "online" ? "online" : k === "idle" ? "idle" : null;
}
