/**
 * How a prospect row reads on screen: the situation chip, the one recommended
 * move, the customer-history badge, and the callback presets. Mirrors
 * situation()/nextFor() in prototypes/prospects-v3.html.
 *
 * Labels live in messages/*.json under `prospects`; this file only picks keys.
 * The one exception is text a human typed — a carrier's return remark, an
 * agent's note — which is carried as `{ text }` because it cannot be
 * translated.
 */
import type { Bucket, ProspectRow } from "./types";
import { attemptCount, isCallbackDue } from "./worklist";

export type Tone = "amber" | "blue" | "grey" | "violet" | "red" | "green";

/**
 * One tone per bucket. Amber is the colour of "a person is waiting", which is
 * why hot owns it; violet marks campaign stock, a list rather than an
 * interruption; red is a parcel that already failed once.
 */
export const BUCKET_TONE: Record<Bucket, Tone> = {
  hot: "amber",
  callback: "blue",
  retry: "grey",
  campaign: "violet",
  winback: "red",
  converted: "green",
};

export type SituationKey =
  | "hot" | "callback_due" | "callback_at" | "retry" | "campaign" | "winback" | "converted";

export interface Situation {
  key: SituationKey;
  tone: Tone;
  /** Minutes of age (hot) or of lateness (an overdue callback). */
  minutes: number | null;
  /** When a callback is still ahead, the time it is set for. */
  at: string | null;
  /** Which attempt this is, for the retry chip. */
  attempts: number;
  /** The order a converted prospect became. */
  orderRef: string | null;
  /** The grey line under the chip: a translated sentence, or someone's own words. */
  sub: { key: string } | { text: string };
}

const minutesBetween = (from: number, to: number) => Math.max(0, Math.round((to - from) / 60_000));

export function situationOf(row: ProspectRow, now: number = Date.now()): Situation {
  const base = { minutes: null, at: null, attempts: 0, orderRef: null } as const;

  switch (row.bucket) {
    case "hot":
      return {
        ...base,
        key: "hot",
        tone: "amber",
        minutes: minutesBetween(Date.parse(row.created_at), now),
        sub: row.notes ? { text: row.notes } : { key: `hot_${row.source}` },
      };

    case "callback": {
      const due = isCallbackDue(row, now);
      return {
        ...base,
        key: due ? "callback_due" : "callback_at",
        tone: "blue",
        minutes: due ? minutesBetween(Date.parse(row.callback_scheduled_at ?? ""), now) : null,
        at: due ? null : row.callback_scheduled_at,
        sub: { key: "callback" },
      };
    }

    case "retry":
      return { ...base, key: "retry", tone: "grey", attempts: attemptCount(row), sub: { key: "retry" } };

    case "campaign":
      return {
        ...base,
        key: "campaign",
        tone: "violet",
        sub: row.campaign_name ? { text: row.campaign_name } : { key: "campaign" },
      };

    case "winback":
      // The carrier's own words about why the parcel came back. Never a key:
      // Darb writes them free-form, in Arabic, one remark at a time.
      return {
        ...base,
        key: "winback",
        tone: "red",
        sub: row.return_reason ? { text: row.return_reason } : { key: "winback" },
      };

    case "converted":
      return {
        ...base,
        key: "converted",
        tone: "green",
        orderRef: row.converted_order_ref,
        sub: { key: "converted" },
      };
  }
}

export type MoveKind = "call" | "callback" | "retry" | "script" | "resend" | "order";

export interface Move {
  kind: MoveKind;
  /** The number the primary button dials; null when the move is not a call. */
  dial: string | null;
}

const MOVE_BY_BUCKET: Record<Bucket, MoveKind> = {
  hot: "call",
  callback: "callback",
  retry: "retry",
  campaign: "script",
  winback: "resend",
  converted: "order",
};

export function moveFor(row: ProspectRow, _now: number = Date.now()): Move {
  const kind = MOVE_BY_BUCKET[row.bucket];
  return { kind, dial: kind === "order" ? null : row.customer_phone };
}

/**
 * The action button takes the row's own tone. Unlike the delivery worklist,
 * where the move can be more urgent than the state, a prospect's next move is
 * always the one thing its bucket means — so one colour, not two.
 */
export function moveTone(row: ProspectRow, _now: number = Date.now()): Tone {
  return BUCKET_TONE[row.bucket];
}

export interface NextAction {
  titleKey: string;
  whyKey: string;
  whyValues: Record<string, string | number>;
}

/** The headline of the detail panel: what to do, and why now. */
export function nextActionOf(row: ProspectRow, now: number = Date.now()): NextAction {
  const b = row.bucket;
  const values: Record<string, string | number> = {};

  if (b === "hot") values.minutes = minutesBetween(Date.parse(row.created_at), now);
  if (b === "retry") values.attempts = attemptCount(row);
  if (b === "campaign") values.offer = row.campaign_offer ?? "";
  if (b === "winback") values.reason = row.return_reason ?? "";
  if (b === "converted") values.order = row.converted_order_ref ?? "";

  return { titleKey: `next.${b}.title`, whyKey: `next.${b}.why`, whyValues: values };
}

/** "0921122334" → "092 112 2334", the way the prototype prints a Libyan number. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return phone;
}

export type HistoryKey = "new" | "loyal" | "risk" | "mixed";

export interface History {
  key: HistoryKey;
  tone: Tone;
  delivered: number;
  returned: number;
}

/**
 * The one line that tells the agent who they are about to call. It reads the
 * outcomes the customer actually has, not the four-value RepeatKind, because
 * "2 delivered, 1 returned" is what changes what you promise on the phone.
 */
export function historyOf(row: ProspectRow): History {
  const delivered = row.prior_delivered_count;
  const returned = row.prior_returned_count;

  if (row.prior_order_count === 0) return { key: "new", tone: "grey", delivered, returned };
  if (delivered === 0 && returned > 0) return { key: "risk", tone: "red", delivered, returned };
  if (returned > 0) return { key: "mixed", tone: "amber", delivered, returned };
  return { key: "loyal", tone: "green", delivered, returned };
}

export interface CallbackChoice {
  key: "p1h" | "p2h" | "evening" | "tomorrow";
  at: string;
}

/** Offset of `tz` from UTC at instant `ms`, in minutes. */
function offsetMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The wall-clock hour `hour` on the market's clock, `dayOffset` days from now. */
function atLocalHour(now: number, tz: string, hour: number, dayOffset: number): string {
  const local = new Date(now + offsetMinutes(now, tz) * 60_000);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, hour, 0, 0);
  return new Date(guess - offsetMinutes(guess, tz) * 60_000).toISOString();
}

const EVENING_HOUR = 18;
const MORNING_HOUR = 10;

/**
 * The four presets of the callback sheet. "Ce soir" and "Demain 10:00" are on
 * the market's clock — an agent in Tripoli promising "demain 10h" means
 * Tripoli, whatever the browser's timezone says. An evening that has already
 * passed is dropped rather than offered in the past.
 */
export function callbackChoices(now: number = Date.now(), tz: string = "Africa/Tripoli"): CallbackChoice[] {
  const evening = atLocalHour(now, tz, EVENING_HOUR, 0);
  const choices: CallbackChoice[] = [
    { key: "p1h", at: new Date(now + 3_600_000).toISOString() },
    { key: "p2h", at: new Date(now + 7_200_000).toISOString() },
  ];
  if (Date.parse(evening) > now) choices.push({ key: "evening", at: evening });
  choices.push({ key: "tomorrow", at: atLocalHour(now, tz, MORNING_HOUR, 1) });
  return choices;
}
