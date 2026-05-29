import { createClient } from "@/lib/supabase/client";

export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface RealtimeEvent<TRow = Record<string, unknown>> {
  eventType: RealtimeEventType;
  new?: TRow;
  old?: Partial<TRow>;
}

export interface SubscribeOptions {
  table: string;
  marketId: string | null;
  /** Optional extra postgres_changes filter (e.g. "assigned_to=eq.agent-1"). */
  extraFilter?: string;
}

export type RealtimeHandler<TRow = Record<string, unknown>> = (
  event: RealtimeEvent<TRow>,
) => void;

interface ChannelEntry {
  channel: ReturnType<ReturnType<typeof createClient>["channel"]>;
  handlers: Set<RealtimeHandler>;
}

function channelKey(opts: SubscribeOptions): string {
  const market = opts.marketId ?? "all";
  const extra = opts.extraFilter ? `:${opts.extraFilter}` : "";
  return `${opts.table}:${market}${extra}`;
}

function buildFilter(opts: SubscribeOptions): string | undefined {
  const parts: string[] = [];
  if (opts.marketId) parts.push(`market_id=eq.${opts.marketId}`);
  if (opts.extraFilter) parts.push(opts.extraFilter);
  return parts.length === 0 ? undefined : parts.join(",");
}

export interface RealtimeBus {
  subscribe<TRow = Record<string, unknown>>(
    opts: SubscribeOptions,
    handler: RealtimeHandler<TRow>,
  ): () => void;
}

/**
 * Create a refcounted realtime bus. Multiple subscribers for the same
 * (table, marketId, extraFilter) share a single Supabase channel; the channel
 * is closed only after the last subscriber unsubscribes.
 *
 * Intended for a single per-app instance via RealtimeProvider, but unit-testable
 * on its own.
 */
export function createRealtimeBus(): RealtimeBus {
  const supabase = createClient();
  const entries = new Map<string, ChannelEntry>();

  function openChannel(opts: SubscribeOptions): ChannelEntry {
    const key = channelKey(opts);
    const filter = buildFilter(opts);
    const channel = supabase
      .channel(`bus:${key}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: opts.table,
          ...(filter ? { filter } : {}),
        },
        (payload: RealtimeEvent) => {
          const entry = entries.get(key);
          if (!entry) return;
          for (const h of entry.handlers) {
            try {
              h(payload);
            } catch (err) {
              // One handler throwing should not break the others.
              // eslint-disable-next-line no-console
              console.error("[realtime-bus] handler error", err);
            }
          }
        },
      )
      .subscribe();

    const entry: ChannelEntry = { channel, handlers: new Set() };
    entries.set(key, entry);
    return entry;
  }

  return {
    subscribe<TRow = Record<string, unknown>>(
      opts: SubscribeOptions,
      handler: RealtimeHandler<TRow>,
    ): () => void {
      const key = channelKey(opts);
      const entry = entries.get(key) ?? openChannel(opts);
      entry.handlers.add(handler as RealtimeHandler);

      return () => {
        const current = entries.get(key);
        if (!current) return;
        current.handlers.delete(handler as RealtimeHandler);
        if (current.handlers.size === 0) {
          supabase.removeChannel(current.channel);
          entries.delete(key);
        }
      };
    },
  };
}
