import type { FeedbackMoment } from "./taxonomy";

const DOOR = new Set(["returning", "to_be_returned", "returned", "received"]);
const TRANSIT = new Set([
  "confirmed",
  "dispatch_scheduled",
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "at_carrier",
  "in_transit",
  "out_for_delivery",
  "delivery_delayed",
]);

/**
 * The moment the customer's voice reached us, from the order's status.
 *
 * Exact mirror of `public.feedback_moment_of` (20261002120000_customer_feedback.sql): the
 * capture window shows it before saving, the RPC decides it. « Annulée » means « at the
 * door » only once the parcel has left — in Libya Darb also cancels parcels already with a
 * courier.
 */
export function momentOf(status: string | null | undefined, shipped: boolean): FeedbackMoment {
  if (!status) return "call";
  if (status === "delivered") return "after";
  if (DOOR.has(status)) return "door";
  if (status === "cancelled" && shipped) return "door";
  if (TRANSIT.has(status)) return "transit";
  return "call";
}
