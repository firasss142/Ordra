/**
 * Explicit Journaux events → public.journal_record() (plans/journaux-redesign.md §3.2).
 *
 * For what changes no row: an export, a campaign sent. With the SESSION client
 * the event is recorded as the signed-in user (journal_record allows only
 * auth.login and export.* there); with createAdminClient({ actorId }) the
 * service role may record any `domain.verb` and names the actor by header.
 *
 * Never throws, never changes its caller's result, and never holds it for
 * more than `timeoutMs`: an export or a campaign does not wait on its journal.
 */

export interface JournalEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  marketId?: string | null;
  context?: Record<string, unknown>;
  orderId?: string | null;
}

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<unknown> };

export async function recordJournalEvent(client: RpcClient, e: JournalEvent, timeoutMs = 1500): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = Promise.resolve(
      client.rpc("journal_record", {
        p_action: e.action,
        p_entity_type: e.entityType,
        p_entity_id: e.entityId ?? null,
        p_entity_label: e.entityLabel ?? null,
        p_market_id: e.marketId ?? null,
        p_context: e.context ?? {},
        p_order_id: e.orderId ?? null,
      }),
    ).catch(() => undefined);
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([call, timeout]);
  } catch {
    // The journal must never turn an export or a campaign into an error.
  } finally {
    if (timer) clearTimeout(timer);
  }
}
