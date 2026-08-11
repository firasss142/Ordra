import useSWR from "swr";
import { useAuth } from "@/context/auth";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch settings");
    return res.json();
  });

interface SettingRow {
  key: string;
  value: { value?: unknown } | null;
}

/**
 * The market's call-attempt ceiling.
 *
 * Needed because the status enum stops at `attempt_3` while the real limit is
 * configurable — Libya's is 8. Rendering "3/3" off the status string would tell
 * an agent they were out of attempts with five still to go, so the denominator
 * has to come from here or not be shown at all.
 *
 * Returns `null` until it loads. Callers must fall back to the bare count, and
 * never to a guessed maximum.
 */
export function useMaxCallAttempts(marketId: string | null): number | null {
  const { user } = useAuth();
  const isAgent = user?.role === "agent";

  // Agents cannot read /api/settings/:marketId — canReadSettings allows only
  // super_admin and market_manager, so OrderDetailPanel was firing a 403 on
  // every open and this hook returned null forever. /api/agent/settings is the
  // sanctioned equivalent, already scoped to the caller's own market (so it
  // needs no marketId), and QueuePage already populates the same SWR key.
  const key = isAgent
    ? "/api/agent/settings"
    : marketId
      ? `/api/settings/${marketId}`
      : null;

  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    // A per-market limit changes about never; re-asking on every row render
    // would be pure noise.
    dedupingInterval: 300_000,
  });

  // The two endpoints answer in different shapes: the agent one returns the
  // scalar directly, the manager one a list of setting rows.
  const raw = isAgent
    ? (data as { max_call_attempts?: unknown } | undefined)?.max_call_attempts
    : (((data as { data?: SettingRow[] } | undefined)?.data ?? []) as SettingRow[]).find(
        (r) => r.key === "max_call_attempts",
      )?.value?.value;

  const parsed = typeof raw === "number" ? raw : Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
