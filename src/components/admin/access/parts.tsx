"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Box, Briefcase, Headphones, Shield, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { initialsOf } from "@/lib/user";
import { activityOf, type RoleTab } from "@/lib/users/access-view";
import type { UserWithStats } from "@/types";

/**
 * Accès building blocks, in « Aurore calme » (acces.css, design-system §4.23).
 * One hue per role: a wrapper names it with `.tone-*` and the stylesheet reads
 * `--tone`, `--tone-bg`, `--tone-ink`, `--tone-edge` inside it.
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
  neutral: "acx-btn--sec",
  primary: "acx-btn--pri",
  danger: "acx-btn--danger",
  softCritical: "acx-btn--soft-bad",
  ghostCritical: "acx-btn--ghost-bad",
};

export function buttonClass(variant: ButtonVariant = "neutral", size: "md" | "sm" = "md"): string {
  return `acx-btn ${BUTTON[variant]}${size === "sm" ? " acx-btn--sm" : ""}`;
}

export type Presence = "online" | "idle" | null;

/** Initials (or the photo) on the role's gradient, with a green or amber beat on the edge. */
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
  const initials = initialsOf(user);
  return (
    <span aria-hidden="true" className={`${TONE[user.role]} acx-av acx-av--${size} relative${muted ? " acx-av--muted" : ""}`}>
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
      {presence && size !== "xs" && <i className={`acx-beat ${presence === "idle" ? "idle" : "on"}`} />}
    </span>
  );
}

/** The role, in its hue, with its dot. */
export function RoleChip({ role, onWhite = false, muted = false }: { role: UserWithStats["role"]; onWhite?: boolean; muted?: boolean }) {
  const t = useTranslations("users.role");
  return (
    <span className={`${TONE[role]} acx-rchip${muted ? " muted" : onWhite ? " white" : ""}`}>
      <i aria-hidden="true" />
      {t(role)}
    </span>
  );
}

export function Dot({ tone, size = 8, pulse = false }: { tone: "on" | "idle" | "off" | "none"; size?: 7 | 8; pulse?: boolean }) {
  return <i aria-hidden="true" className={`acx-dot ${tone}${size === 7 ? " acx-dot--7" : ""}${pulse && tone === "on" ? " pulse" : ""}`} />;
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
  return (
    <span className={`acx-act ${tone}`}>
      <Dot tone={tone} pulse />
      {text}
    </span>
  );
}

export function presenceOf(lastSeenAt: string | null, active: boolean, now: Date): Presence {
  if (!active) return null;
  const k = activityOf(lastSeenAt, now).kind;
  return k === "online" ? "online" : k === "idle" ? "idle" : null;
}
