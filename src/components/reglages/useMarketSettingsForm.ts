"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { assembleMarketSettings, type SettingRow } from "@/lib/settings/assembleMarketSettings";
import { isValidMarketSettings, type MarketSettings } from "@/types/settings";
import { useRegisterSaver } from "./form-context";

type Key = keyof MarketSettings;

/**
 * A topic's market settings: what is stored, what the user changed, and one
 * saver registered with the page's save bar. The PATCH carries only the
 * changed keys (the route validates them against the whole object).
 */
export function useMarketSettingsForm(marketId: string, saverId = "settings") {
  const t = useTranslations("reglages");
  const { data, mutate } = useSWR<{ data: SettingRow[] }>(`/api/settings/${marketId}`);
  const stored = useMemo(() => assembleMarketSettings(data?.data ?? []), [data]);
  const [edits, setEdits] = useState<Partial<MarketSettings>>({});

  const value = useCallback(<K extends Key>(key: K): MarketSettings[K] => (key in edits ? (edits[key] as MarketSettings[K]) : stored[key]), [edits, stored]);

  const set = useCallback(
    <K extends Key>(key: K, next: MarketSettings[K] | null) => {
      setEdits((prev) => {
        const copy = { ...prev } as Record<string, unknown>;
        if (JSON.stringify(next) === JSON.stringify(stored[key])) delete copy[key];
        else copy[key] = next;
        return copy as Partial<MarketSettings>;
      });
    },
    [stored],
  );

  const isDirty = useCallback((key: Key) => key in edits, [edits]);

  const save = useCallback(async () => {
    const candidate = { ...stored, ...edits };
    if (!isValidMarketSettings(candidate)) throw new Error(t("save.invalid"));
    const res = await fetch(`/api/settings/${marketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(edits),
    });
    if (!res.ok) {
      throw new Error(res.status === 403 ? t("save.forbidden") : res.status === 400 ? t("save.invalid") : t("save.failed"));
    }
    await mutate();
    setEdits({});
  }, [edits, stored, marketId, mutate, t]);

  const reset = useCallback(() => setEdits({}), []);

  useRegisterSaver(saverId, { count: Object.keys(edits).length, save, reset });

  return { loaded: !!data, stored, value, set, isDirty, rows: data?.data ?? [] };
}

export type MarketSettingsForm = ReturnType<typeof useMarketSettingsForm>;
