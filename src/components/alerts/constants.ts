import {
  CalendarX,
  CheckCircle2,
  CircleAlert,
  Clock,
  CloudOff,
  Coins,
  Hourglass,
  Inbox,
  Lock,
  MoreHorizontal,
  PackageX,
  PhoneMissed,
  PhoneOff,
  RadioTower,
  RotateCcw,
  TriangleAlert,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { AlertSeverity, AlertType } from "@/lib/alerts/catalogue";

export { SEVERITY_ORDER } from "@/lib/alerts/catalogue";

/**
 * Two colour vocabularies, doing two different jobs.
 *
 * The band says *how urgent*; the row says *what kind*. Inside one ÉLEVÉE band a
 * missed callback and a blocked dispatch are equally urgent and completely
 * different problems, so colouring both amber would throw away the only cue that
 * separates them at a glance. Severity is carried by the band header and the
 * summary tile; the row's mark and its reading take the type's own hue.
 */
type Tone = {
  /** Solid disc behind a white glyph — band headers and tiles. */
  solid: string;
  /** Tinted square behind a coloured glyph — row marks. */
  soft: string;
  /** Tinted pill — the age reading. */
  badge: string;
  /** Tinted card + hairline — summary tiles. */
  card: string;
  /** Coloured label text on that card. */
  label: string;
};

const RED: Tone = {
  solid: "bg-hue-red-edge text-white",
  soft: "bg-hue-red-bg text-hue-red-ink",
  badge: "bg-hue-red-bg text-hue-red-ink",
  card: "bg-hue-red-bg border-hue-red-edge-soft",
  label: "text-hue-red-ink",
};
const AMBER: Tone = {
  solid: "bg-hue-amber-edge text-white",
  soft: "bg-hue-amber-bg text-hue-amber-ink",
  badge: "bg-hue-amber-bg text-hue-amber-ink",
  card: "bg-hue-amber-bg border-hue-amber-edge-soft",
  label: "text-hue-amber-ink",
};
const VIOLET: Tone = {
  solid: "bg-hue-violet-edge text-white",
  soft: "bg-hue-violet-bg text-hue-violet-ink",
  badge: "bg-hue-violet-bg text-hue-violet-ink",
  card: "bg-hue-violet-bg border-hue-violet-edge-soft",
  label: "text-hue-violet-ink",
};
const NEUTRAL: Tone = {
  solid: "bg-hue-neutral-edge text-white",
  soft: "bg-oms-sunken text-oms-ink-2",
  badge: "bg-oms-sunken text-oms-ink-2",
  card: "bg-oms-sunken border-oms-border",
  label: "text-oms-ink-2",
};
/** Only ever shown on a tile whose count is zero — that band is clear. */
export const CLEAR_TONE: Tone = {
  solid: "bg-hue-green-edge text-white",
  soft: "bg-hue-green-bg text-hue-green-ink",
  badge: "bg-hue-green-bg text-hue-green-ink",
  card: "bg-hue-green-bg border-hue-green-edge-soft",
  label: "text-hue-green-ink",
};

export const SEVERITY_TONE: Record<AlertSeverity, Tone> = {
  critical: RED,
  high: AMBER,
  medium: VIOLET,
  low: NEUTRAL,
};

/** The disc glyph on a band header and a summary tile. */
export const SEVERITY_ICONS: Record<AlertSeverity, LucideIcon> = {
  critical: CircleAlert,
  high: TriangleAlert,
  medium: CircleAlert,
  low: MoreHorizontal,
};

export const CLEAR_ICON = CheckCircle2;

/** The bar under the header — one segment per severity, width by share. */
export const SEVERITY_BAR: Record<AlertSeverity, string> = {
  critical: "bg-hue-red-edge",
  high: "bg-hue-amber-edge",
  medium: "bg-hue-violet-edge",
  low: "bg-hue-neutral-edge",
};

/**
 * Each rule's own hue. A missed call is red wherever it appears, so the row
 * stays recognisable when its severity climbs and it moves band.
 */
export const TYPE_TONE: Record<AlertType, Tone> = {
  overdue_callback: RED,
  attempts_stalled: RED,
  dispatch_failure: AMBER,
  dispatch_schedule_missed: AMBER,
  upload_stalled: AMBER,
  carrier_webhook_stale: AMBER,
  stock_depleted: AMBER,
  unassigned_overflow: VIOLET,
  pending_idle: VIOLET,
  price_changed: VIOLET,
  order_reopened: NEUTRAL,
};

/** The mark on the row — which kind of problem this is. */
export const TYPE_ICONS: Record<AlertType, LucideIcon> = {
  dispatch_failure: Truck,
  carrier_webhook_stale: RadioTower,
  overdue_callback: PhoneMissed,
  unassigned_overflow: Inbox,
  stock_depleted: PackageX,
  attempts_stalled: PhoneOff,
  pending_idle: Hourglass,
  dispatch_schedule_missed: CalendarX,
  upload_stalled: CloudOff,
  price_changed: Coins,
  order_reopened: RotateCcw,
};

/**
 * The small glyph inside the age pill. Most readings are elapsed time and take
 * a clock; the ones that are not say so instead. `stock_depleted` has no
 * duration at all, so it has no glyph.
 */
export const META_ICONS: Partial<Record<AlertType, LucideIcon>> = {
  dispatch_failure: Lock,
  dispatch_schedule_missed: CalendarX,
  upload_stalled: CloudOff,
  carrier_webhook_stale: RadioTower,
  overdue_callback: Clock,
  unassigned_overflow: Clock,
  pending_idle: Clock,
  attempts_stalled: PhoneOff,
  price_changed: Coins,
  order_reopened: RotateCcw,
};

export interface AlertsAgent {
  id: string;
  full_name: string;
  market_id: string | null;
  role: string;
}
