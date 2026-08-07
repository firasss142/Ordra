import useSWR from "swr";

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
  const { data } = useSWR(
    marketId ? `/api/settings/${marketId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      // A per-market limit changes about never; re-asking on every row render
      // would be pure noise.
      dedupingInterval: 300_000,
    },
  );

  const rows = (data?.data ?? []) as SettingRow[];
  const raw = rows.find((r) => r.key === "max_call_attempts")?.value?.value;
  const parsed = typeof raw === "number" ? raw : Number(raw);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
