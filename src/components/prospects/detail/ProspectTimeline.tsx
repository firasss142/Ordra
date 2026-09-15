"use client";

/**
 * What happened to this prospect, newest first.
 *
 * The old card printed raw transitions — "attempt_1 → attempt_2" — which is
 * the database's language, not a person's. Each entry is named here instead,
 * and the dot takes the tone of what happened: green for a conversion, red
 * for a loss, amber for a scheduled callback.
 *
 * Design: prototypes/prospects-manager-v1.html (the .tl block).
 */
import { useTranslations } from "next-intl";
import {
  Ban, Calendar, Check, Megaphone, Phone, PlusCircle, RotateCcw, ShoppingCart, User,
} from "lucide-react";
import type { LeadStatus } from "@/types/lead";
import type { Tone } from "@/lib/prospects/presentation";
import { TONE, type IconComponent } from "../ui";
import { timeOnMarketClock } from "../ui";

export interface TimelineEntry {
  id: string;
  status_from: LeadStatus | null;
  status_to: LeadStatus;
  actor_type: "system" | "agent" | "manager";
  actor_name?: string | null;
  note: string | null;
  created_at: string;
}

/** `actor_type` in the table vs the key in messages/*.json. */
const ACTOR_KEY: Record<TimelineEntry["actor_type"], string> = {
  system: "sys",
  agent: "agent",
  manager: "mgr",
};

/** What a transition looks like to a person, not to the enum. */
function describe(e: TimelineEntry): { key: string; tone: Tone; icon: IconComponent } {
  const to = e.status_to;
  // No previous status means this is the row being born — even when it was
  // created straight into `assigned` by an agent taking their own call.
  if (e.status_from === null) return { key: "created", tone: "grey", icon: PlusCircle };
  if (to === "won") return { key: "conv", tone: "green", icon: ShoppingCart };
  if (to === "lost") return { key: "lost", tone: "red", icon: Ban };
  if (to === "archived") return { key: "archived", tone: "grey", icon: Ban };
  if (to === "callback_scheduled") return { key: "cb", tone: "blue", icon: Calendar };
  if (to === "qualified") return { key: "qualified", tone: "green", icon: Check };
  if (to.startsWith("attempt_")) return { key: "noans", tone: "grey", icon: Phone };
  if (to === "assigned") return { key: "assigned", tone: "violet", icon: User };
  return { key: "edit", tone: "grey", icon: RotateCcw };
}

export function ProspectTimeline({
  entries, tz, locale, now,
}: { entries: TimelineEntry[]; tz: string; locale: string; now: number }) {
  const t = useTranslations("prospects.console.tl");

  const sorted = [...entries].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );

  return (
    <ol className="relative m-0 flex list-none flex-col gap-3 p-0">
      {sorted.map((e, i) => {
        const d = describe(e);
        const Icon = d.icon;
        const at = Date.parse(e.created_at);
        const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
        return (
          <li key={e.id} className="grid grid-cols-[62px_24px_1fr] items-start gap-2.5">
            <span className="pt-1 text-end text-[12px] tabular-nums text-[#6B7280]">
              {sameDay
                ? timeOnMarketClock(e.created_at, tz, locale)
                : new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", {
                    day: "numeric", month: "numeric", timeZone: tz,
                  }).format(at)}
            </span>
            <span className="relative flex justify-center">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${TONE[d.tone].soft} ${TONE[d.tone].icon}`}>
                <Icon size={13} aria-hidden />
              </span>
              {/* The thread joining one event to the next. */}
              {i < sorted.length - 1 ? (
                <span aria-hidden className="absolute top-6 bottom-[-12px] w-px bg-[#E5E7EB]" />
              ) : null}
            </span>
            <span className="min-w-0 pt-0.5">
              <b className="block text-[13.5px] font-semibold text-[#111827]">
                {safe(t, d.key, e.status_to)}
                {e.actor_name ? (
                  <span className="ms-1 font-normal text-[#6B7280] [unicode-bidi:plaintext]">· {e.actor_name}</span>
                ) : (
                  <span className="ms-1 font-normal text-[#6B7280]">· {safe(t, `by.${ACTOR_KEY[e.actor_type]}`, e.actor_type)}</span>
                )}
              </b>
              {e.note ? (
                <small className="mt-0.5 block max-w-prose text-[12.5px] text-[#6B7280] [unicode-bidi:plaintext]">
                  {e.note}
                </small>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Some transitions have no name of their own yet — `qualified` and `archived`
 * among them. Falling back to the raw status beats printing the missing key,
 * which is exactly how "crm.leads.markLost" ended up on a button.
 */
function safe(t: (k: string) => string, key: string, fallback: string): string {
  try {
    const value = t(key);
    // next-intl echoes the full path back when a message is missing rather
    // than throwing — which is exactly how "crm.leads.markLost" reached a
    // button. Treat an echoed key as a miss.
    return value.includes(key) ? fallback : value;
  } catch {
    return fallback;
  }
}
