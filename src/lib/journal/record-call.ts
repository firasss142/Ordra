/**
 * Outside calls → public.integration_calls (plans/journaux-redesign.md §3.2).
 *
 * Until now a refused carrier upload was written nowhere: the agent saw the
 * error once and it was gone. One row per call, success or not. The recorder
 * never throws and never changes its caller's result — a journal that cannot
 * write must not turn a shipment into an error.
 *
 * No customer data: the excerpts stay NULL, and the carrier's message is
 * cleaned of phones, e-mails and token-looking strings before it is kept.
 */
import { redact } from "./app-errors";

export type IntegrationOperation = "upload" | "void" | "bind" | "verify" | "quote" | "stock_read" | "send" | "test";
export type IntegrationCallStatus = "ok" | "error" | "timeout" | "refused";

export interface IntegrationCallInput {
  /** The outside system, e.g. the carrier code (`navex`, `darb_assabil`). */
  system: string;
  /** The account the call went through, e.g. `carriers.id`. */
  connectionId?: string | null;
  operation: IntegrationOperation;
  status: IntegrationCallStatus;
  httpStatus?: number | null;
  errorCode?: string | null;
  message?: string | null;
  durationMs?: number | null;
  attempt?: number;
  orderId?: string | null;
  marketId?: string | null;
  actorId?: string | null;
}

type InsertOnly = {
  from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<unknown> };
};

const MESSAGE_MAX = 300;

export async function recordIntegrationCall(admin: InsertOnly, input: IntegrationCallInput): Promise<void> {
  try {
    await admin.from("integration_calls").insert({
      system: input.system,
      connection_id: input.connectionId ?? null,
      operation: input.operation,
      status: input.status,
      http_status: input.httpStatus ?? null,
      error_code: input.errorCode ?? null,
      message: redact(input.message, MESSAGE_MAX),
      duration_ms: input.durationMs == null ? null : Math.round(input.durationMs),
      attempt: input.attempt ?? 1,
      order_id: input.orderId ?? null,
      market_id: input.marketId ?? null,
      actor_id: input.actorId ?? null,
      request_excerpt: null,
      response_excerpt: null,
    });
  } catch {
    // The journal must never turn a carrier answer into another error.
  }
}
