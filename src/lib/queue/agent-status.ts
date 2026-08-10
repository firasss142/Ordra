import {
  presentStatus,
  type StatusHue,
  type StatusIconName,
  type StatusWeight,
} from "@/lib/orders/status-presentation";
import { bucketFor } from "@/lib/carriers/buckets";
import { isReferenceDeletedUpload } from "@/lib/order-permissions";
import type { QueueOrder } from "@/types/queue";

/**
 * How an order's status looks in the agent queue.
 *
 * This is a thin wrapper over `lib/orders/status-presentation`, not a second
 * map — a per-surface `STATUS_TONE` is exactly how the queue and the orders
 * console drifted apart before (see that module's docstring). The queue adds
 * three things the console does not need:
 *
 *   1. Reference-deleted uploads, which are agent work and outrank the
 *      carrier's view of the order.
 *   2. The carrier lifecycle bucket, so a closed order shows what the carrier
 *      portal actually says rather than the raw OMS status.
 *   3. A datum — the attempt counter, or a scheduled time — because a queue
 *      row has to answer "when" as well as "what".
 *
 * Hue, icon and weight always come from the shared map.
 */

export type AgentDatum =
  | { kind: "counter"; value: string }
  | { kind: "time"; at: string }
  | { kind: "overdue" }
  | null;

export type AgentStatusLabel =
  | {
      ns:
        | "orders.statuses"
        | "orders.detail"
        | "orders.rejectionSubreasonsShort"
        | "orders.rejectionReasons";
      key: string;
    }
  /** Free text that has no key — currently only an `autre` rejection note. */
  | { ns: "literal"; text: string };

/**
 * What a rejected row should say.
 *
 * Not "Rejeté". The row is already unmistakably a rejection from the red hue and
 * the cross icon, so spending the one readable field on the word "rejected"
 * repeats what colour and shape already said, and hides the only thing a human
 * actually wants: *why*. That used to require hovering a tooltip that overlapped
 * the rows beneath it.
 *
 * Falls back through decreasing specificity, because 93 rows carry no reason at
 * all and 339 carry a group with no sub-reason.
 */
function rejectionLabel(order: QueueOrder): AgentStatusLabel {
  if (order.rejection_subreason) {
    return { ns: "orders.rejectionSubreasonsShort", key: order.rejection_subreason };
  }
  // `autre` keeps its detail in free text — that is the whole point of it.
  if (order.rejection_reason === "autre" && order.rejection_note?.trim()) {
    return { ns: "literal", text: order.rejection_note.trim() };
  }
  if (order.rejection_reason) {
    return { ns: "orders.rejectionReasons", key: order.rejection_reason };
  }
  return { ns: "orders.statuses", key: "bucket.rejected" };
}

export interface AgentStatusPresentation {
  hue: StatusHue;
  weight: StatusWeight;
  icon: StatusIconName;
  /** Where the visible words come from. The lib never resolves i18n itself. */
  label: AgentStatusLabel;
  datum: AgentDatum;
}

export interface AgentStatusContext {
  /** The market's `max_call_attempts`; null until settings load. */
  maxAttempts?: number | null;
  nowMs?: number;
}

export function presentAgentStatus(
  order: QueueOrder,
  { maxAttempts = null, nowMs = Date.now() }: AgentStatusContext = {},
): AgentStatusPresentation {
  // 1. The agent owes a re-upload. Agent work outranks the carrier-side view,
  //    so this is checked before the lifecycle bucket.
  if (isReferenceDeletedUpload(order)) {
    return {
      hue: "amber",
      weight: "loud",
      icon: "uploaded",
      // The key lives under orders.detail, not queue — OrderCard used to ask
      // the queue namespace for it and rendered the raw key as a result.
      label: { ns: "orders.detail", key: "statusReferenceDeleted" },
      datum: null,
    };
  }

  // 2. A rejection says why, not that it happened — see rejectionLabel. This
  //    sits before the bucket lookup because `bucketFor` also resolves rejected
  //    orders, and it would answer with the generic word.
  if (order.status === "rejected") {
    const base = presentStatus("rejected");
    return {
      hue: base.hue,
      weight: base.weight,
      icon: base.icon,
      label: rejectionLabel(order),
      datum: null,
    };
  }

  // 3. Closed orders follow the (status, carrier, portal slug) triple rather
  //    than orders.status alone. Bucket names are themselves keys in the
  //    shared map, so hue/glyph/weight still come from one place.
  const bucket = bucketFor({
    status: order.status,
    carrierCode: order.carrier_code,
    dexpressStatusSlug: order.dexpress_status_slug,
    dexpressStatusAccepted: order.dexpress_status_accepted,
    carrierStatusSlug: order.carrier_status_slug,
  });
  if (bucket) {
    const base = presentStatus(bucket);
    return {
      hue: base.hue,
      weight: base.weight,
      icon: base.icon,
      label: { ns: "orders.statuses", key: `bucket.${bucket}` },
      datum: null,
    };
  }

  // 3. Everything still in the agent's hands.
  const base = presentStatus(order.status, {
    attemptsCount: order.attempt_count,
    maxAttempts,
  });

  let hue = base.hue;
  let weight = base.weight;
  let datum: AgentDatum = base.counter
    ? { kind: "counter", value: base.counter }
    : null;

  // A schedule that has come and gone is a live problem, so it earns the same
  // loud treatment as exhausted attempts — and red, because nobody acted.
  if (order.status === "callback_scheduled" && order.callback_time) {
    if (new Date(order.callback_time).getTime() <= nowMs) {
      hue = "red";
      weight = "loud";
      datum = { kind: "overdue" };
    } else {
      datum = { kind: "time", at: order.callback_time };
    }
  }

  // A past-due dispatch keeps its violet — the cron may still take it, so it
  // is late rather than failed — but it stops being quiet.
  if (order.status === "dispatch_scheduled" && order.scheduled_dispatch_at) {
    if (new Date(order.scheduled_dispatch_at).getTime() <= nowMs) {
      weight = "loud";
      datum = { kind: "overdue" };
    } else {
      datum = { kind: "time", at: order.scheduled_dispatch_at };
    }
  }

  return {
    hue,
    weight,
    icon: base.icon,
    label: { ns: "orders.statuses", key: order.status },
    datum,
  };
}
