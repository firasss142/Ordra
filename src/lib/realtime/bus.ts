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

/** A private Broadcast topic, e.g. `orders:market:<uuid>`, and the event on it. */
export interface BroadcastOptions {
  topic: string;
  event: string;
}

export type BroadcastHandler<TPayload = Record<string, unknown>> = (payload: TPayload) => void;

/**
 * What the socket says about a topic. `SUBSCRIBED` is the only state in which
 * events are flowing; everything else means the page must fall back to
 * polling and revalidate once the channel comes back.
 */
export type BroadcastStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | "JOINING";

export type BroadcastStatusListener = (topic: string, status: BroadcastStatus) => void;

type SupabaseClient = ReturnType<typeof createClient>;
type Channel = ReturnType<SupabaseClient["channel"]>;

interface ChannelEntry {
  channel: Channel;
  handlers: Set<RealtimeHandler>;
}

interface BroadcastEntry {
  channel: Channel | null;
  handlers: Set<BroadcastHandler>;
  status: BroadcastStatus;
  /** Set while the async join is in flight, so a fast unsubscribe can cancel it. */
  cancelled: boolean;
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
  /**
   * Join a private Broadcast topic. Refcounted like `subscribe`: the channel is
   * opened on the first subscriber and closed after the last one leaves.
   */
  subscribeBroadcast<TPayload = Record<string, unknown>>(
    opts: BroadcastOptions,
    handler: BroadcastHandler<TPayload>,
  ): () => void;
  /** Current socket status of a topic; `CLOSED` when nobody has joined it. */
  getBroadcastStatus(topic: string): BroadcastStatus;
  /** Notified on every status change of every Broadcast topic. */
  onBroadcastStatus(listener: BroadcastStatusListener): () => void;
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
  const broadcasts = new Map<string, BroadcastEntry>();
  const statusListeners = new Set<BroadcastStatusListener>();

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

  function setStatus(topic: string, status: BroadcastStatus) {
    const entry = broadcasts.get(topic);
    if (!entry || entry.status === status) return;
    entry.status = status;
    for (const l of statusListeners) {
      try {
        l(topic, status);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[realtime-bus] status listener error", err);
      }
    }
  }

  /**
   * Private channels are authorised with the session token at join time.
   * supabase-js keeps the socket's token current on its own (it is wired to
   * TOKEN_REFRESHED), but the very first join can race the initial session
   * load, so the token is pushed once, explicitly, before joining. No
   * argument: passing one flips the client into manual-token mode and stops
   * the automatic refresh.
   */
  async function ensureSocketAuth(): Promise<void> {
    const rt = (supabase as { realtime?: { setAuth?: () => Promise<void> | void } }).realtime;
    try {
      await rt?.setAuth?.();
    } catch {
      // Join anyway; the server answers CHANNEL_ERROR and the page polls.
    }
  }

  async function openBroadcast(opts: BroadcastOptions, entry: BroadcastEntry) {
    await ensureSocketAuth();
    if (entry.cancelled) return;

    const channel = supabase
      .channel(opts.topic, { config: { private: true } } as never)
      .on(
        "broadcast" as never,
        { event: opts.event } as never,
        ((message: { payload?: Record<string, unknown> }) => {
          const current = broadcasts.get(opts.topic);
          if (!current) return;
          for (const h of current.handlers) {
            try {
              h(message?.payload ?? {});
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error("[realtime-bus] broadcast handler error", err);
            }
          }
        }) as never,
      )
      .subscribe((status: string) => {
        setStatus(opts.topic, status as BroadcastStatus);
      });

    entry.channel = channel;
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

    subscribeBroadcast<TPayload = Record<string, unknown>>(
      opts: BroadcastOptions,
      handler: BroadcastHandler<TPayload>,
    ): () => void {
      let entry = broadcasts.get(opts.topic);
      if (!entry) {
        entry = { channel: null, handlers: new Set(), status: "JOINING", cancelled: false };
        broadcasts.set(opts.topic, entry);
        void openBroadcast(opts, entry);
      }
      entry.handlers.add(handler as BroadcastHandler);

      return () => {
        const current = broadcasts.get(opts.topic);
        if (!current) return;
        current.handlers.delete(handler as BroadcastHandler);
        if (current.handlers.size === 0) {
          current.cancelled = true;
          if (current.channel) supabase.removeChannel(current.channel);
          broadcasts.delete(opts.topic);
          for (const l of statusListeners) l(opts.topic, "CLOSED");
        }
      };
    },

    getBroadcastStatus(topic: string): BroadcastStatus {
      return broadcasts.get(topic)?.status ?? "CLOSED";
    },

    onBroadcastStatus(listener: BroadcastStatusListener): () => void {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
  };
}
