/**
 * Maps an order status to the pill background + text classes used by the
 * related-order cards (duplicate popover, repeat-buyer popover). Kept in one
 * place so the two popovers never drift apart. Tones come from the design
 * system status tokens — see docs/design-system.md §2.
 */
export function statusToneClass(status: string): string {
  if (status === "delivered") return "bg-status-successBg text-status-success";
  if (
    status === "uploaded" ||
    status === "scanned" ||
    status === "dispatched" ||
    status === "deposit" ||
    status === "in_transit"
  ) {
    return "bg-[#EAF2FB] text-status-action";
  }
  if (status === "rejected" || status === "cancelled" || status === "deleted") {
    return "bg-status-criticalBg text-status-critical";
  }
  return "bg-status-neutralBg text-ink-secondary";
}
