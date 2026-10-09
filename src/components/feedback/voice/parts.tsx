"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, DoorOpen, Package, PackageCheck, Phone, Truck, type LucideIcon } from "lucide-react";
import type { FeedbackCategory, FeedbackMoment } from "@/lib/feedback/taxonomy";
import { agentColorKey, agentColorVars } from "@/lib/team/agent-color";
import type { FeedbackTopic } from "@/types/feedback";

/** The calm category steps (prototype v2): the dot, the bar, the quote rule. */
export const CATEGORY_COLOR: Record<FeedbackCategory, string> = {
  reclamation: "var(--c-rec)",
  objection: "var(--c-obj)",
  suggestion: "var(--c-sug)",
};

export const catStyle = (c: FeedbackCategory) => ({ "--c": CATEGORY_COLOR[c] }) as CSSProperties;

export const MOMENT_ICON: Record<FeedbackMoment, LucideIcon> = { call: Phone, door: DoorOpen, transit: Truck, after: PackageCheck };

export function topicLabel(topics: FeedbackTopic[], id: string | null, locale: string): string | null {
  const t = id ? topics.find((x) => x.id === id) : null;
  if (!t) return null;
  return locale.startsWith("ar") ? t.label_ar : t.label_fr;
}

/** « 27 % » in French, « 27% » in Arabic — a plain space, never U+202F (the font has a gap). */
export const pct = (n: number, total: number, locale: string) =>
  `${total ? Math.round((n * 100) / total) : 0}${locale.startsWith("ar") ? "%" : " %"}`;

/**
 * The trend against the previous period (prototype `trend()`): « nouveau » when it did not
 * exist before, « = » when flat, the arrow and the gap otherwise. More objections or
 * complaints is bad; more suggestions is good, fewer is just flat.
 */
export function Trend({ n, prev, category }: { n: number; prev: number | null; category: FeedbackCategory }) {
  const t = useTranslations("feedback.voice");
  if (prev === null) return null;
  const title = t("vsPrev", { n: prev });
  if (prev === 0 && n > 0) return <span className="tr new" title={title}>{t("new")}</span>;
  const d = n - prev;
  if (d === 0) return <span className="tr eq" title={title}>=</span>;
  const tone = category === "suggestion" ? (d > 0 ? "good" : "eq") : d > 0 ? "bad" : "good";
  const Icon = d > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`tr ${tone}`} title={title} dir="ltr">
      <Icon className="ic" aria-hidden />
      {Math.abs(d)}
    </span>
  );
}

const THUMB_BG = [
  "linear-gradient(140deg,#2F6F5E,#1F4D41)",
  "linear-gradient(140deg,#B7791F,#8A5A12)",
  "linear-gradient(140deg,#7B4FA0,#573875)",
  "linear-gradient(140deg,#3B5BA9,#283F78)",
  "linear-gradient(140deg,#C2410C,#8F300A)",
];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);

/** A product's photo, or a tile in one of the prototype's five tones. */
export function Thumb({ id, url, small = false }: { id: string; url: string | null; small?: boolean }) {
  return (
    <span className={`thumb${small ? " sm" : ""}`} style={url ? undefined : { background: THUMB_BG[hash(id) % THUMB_BG.length] }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" /> : <Package className="ic" />}
    </span>
  );
}

/** An agent's initial in her colour; the Darb courier is a truck in slate. */
export function Avatar({ id, name, courier = false }: { id: string | null; name: string; courier?: boolean }) {
  if (courier || !id) {
    return <span className="av" aria-hidden><Truck className="ic" /></span>;
  }
  return <span className="av" style={agentColorVars(agentColorKey(null, id))} aria-hidden>{name.slice(0, 1).toUpperCase()}</span>;
}
