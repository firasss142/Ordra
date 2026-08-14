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

export interface MarketNumberSetting {
  /** Parsed value, or null when absent / unparseable / still loading. */
  value: number | null;
  /** False until the request has answered. Distinguishes "absent" from "not yet". */
  loaded: boolean;
}

/**
 * One numeric setting for a market, read from whichever endpoint the caller's
 * role is allowed to use.
 *
 * The role split is the whole reason this exists. Agents cannot read
 * `/api/settings/:marketId` — `canReadSettings` allows only super_admin and
 * market_manager — so an agent-facing component reading settings directly would
 * fire a 403 on every mount and render nothing forever. `/api/agent/settings`
 * is the sanctioned equivalent, already scoped to the caller's own market, and
 * anything the agent queue displays has to be added to it explicitly.
 *
 * The two endpoints answer in different shapes: the agent one returns scalars
 * keyed by name, the manager one a list of setting rows.
 */
export function useMarketNumberSetting(
  marketId: string | null,
  key: string,
): MarketNumberSetting {
  const { user } = useAuth();
  const isAgent = user?.role === "agent";

  const swrKey = isAgent
    ? "/api/agent/settings"
    : marketId
      ? `/api/settings/${marketId}`
      : null;

  const { data, error } = useSWR(swrKey, fetcher, {
    revalidateOnFocus: false,
    // Per-market settings change about never; re-asking on every row render
    // would be pure noise.
    dedupingInterval: 300_000,
  });

  if (swrKey === null) return { value: null, loaded: false };
  if (data === undefined) return { value: null, loaded: Boolean(error) };

  const raw = isAgent
    ? (data as Record<string, unknown>)?.[key]
    : (((data as { data?: SettingRow[] } | undefined)?.data ?? []) as SettingRow[]).find(
        (r) => r.key === key,
      )?.value?.value;

  const parsed = typeof raw === "number" ? raw : Number(raw);

  return {
    value: Number.isFinite(parsed) ? parsed : null,
    loaded: true,
  };
}
