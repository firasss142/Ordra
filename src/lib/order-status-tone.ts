/**
 * Maps an order status to the pill background + text classes used across the
 * order popovers (duplicate, repeat-buyer, status-history). Kept in one place so
 * the popovers never drift apart. Tones come from the design system status
 * tokens — see docs/design-system.md §2.
 *
 * Coverage by lifecycle phase:
 *   success  (green)  → delivered
 *   action   (blue)   → confirmed + every post-confirmation carrier status
 *   warning  (amber)  → in-confirmation: pending/assigned/attempts/callback/unverified/to_be_returned
 *   critical (red)    → terminal-bad: rejected/cancelled/deleted/returned
 *   neutral  (gray)   → anything unrecognised
 */
export function statusToneClass(status: string): string {
  if (status === "delivered") return "bg-status-successBg text-status-success";

  if (
    status === "confirmed" ||
    status === "dispatch_scheduled" ||
    status === "uploaded" ||
    status === "scanned" ||
    status === "dispatched" ||
    status === "deposit" ||
    status === "in_transit" ||
    status === "received"
  ) {
    return "bg-[#EAF2FB] text-status-action";
  }

  if (
    status === "rejected" ||
    status === "cancelled" ||
    status === "deleted" ||
    status === "returned"
  ) {
    return "bg-status-criticalBg text-status-critical";
  }

  if (
    status === "pending" ||
    status === "assigned" ||
    status === "attempt_1" ||
    status === "attempt_2" ||
    status === "attempt_3" ||
    status === "callback_scheduled" ||
    status === "unverified" ||
    status === "to_be_returned"
  ) {
    return "bg-status-warningBg text-status-warning";
  }

  return "bg-status-neutralBg text-ink-secondary";
}
