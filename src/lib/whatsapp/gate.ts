/**
 * The one place that says whether a message may leave.
 *
 * Both the synchronous agent path (send.ts) and the outbox drain (outbox.ts)
 * call this immediately before any `client.send*`. Nothing outside
 * src/lib/whatsapp/** may import the Graph client, so nothing can skip it.
 */
import type { ConfigStatus } from "./types";
import { isServiceWindowOpen } from "./window";

export type SendMode = "template" | "text" | "image";

export type GateRefusal = "config_inactive" | "invalid_phone" | "opted_out" | "undeliverable" | "window_closed" | "deferred";

export interface GateInput {
  configStatus: ConfigStatus | null;
  phoneE164: string | null;
  optedOutAt: string | null;
  undeliverableAt: string | null;
  lastInboundAt: string | null;
  mode: SendMode;
  /** Outbox pacing / send window; null for a live agent send. */
  notBefore?: string | null;
  now?: Date;
}

export type GateResult = { ok: true; windowOpen: boolean } | { ok: false; reason: GateRefusal; windowOpen: boolean };

export function assertSendAllowed(input: GateInput): GateResult {
  const now = input.now ?? new Date();
  const windowOpen = isServiceWindowOpen(input.lastInboundAt, now);
  const refuse = (reason: GateRefusal): GateResult => ({ ok: false, reason, windowOpen });

  if (input.configStatus !== "active") return refuse("config_inactive");
  if (!input.phoneE164) return refuse("invalid_phone");
  if (input.optedOutAt) return refuse("opted_out");
  if (input.undeliverableAt) return refuse("undeliverable");
  // Meta's rule: free-form content only inside 24 h of the customer's last
  // message. A template is allowed at any time.
  if (input.mode !== "template" && !windowOpen) return refuse("window_closed");
  if (input.notBefore && new Date(input.notBefore).getTime() > now.getTime()) return refuse("deferred");
  return { ok: true, windowOpen };
}
