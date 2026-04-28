"use client";

import useSWR from "swr";
import { GeneralSettingsGroups } from "@/components/settings/GeneralSettingsGroups";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { useMarketScope } from "@/context/market-scope";
import type { AuthUser } from "@/types";
import type { MarketSettings } from "@/types/settings";

interface Props {
  user: AuthUser;
}

export function GeneralSettingsClient({ user }: Props) {
  const isRtl = user.direction === "rtl";
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = scopeMarketId ?? user.market_id ?? "";

  const { data } = useSWR<{
    data: { key: string; value: { value: unknown } }[];
  }>(marketId ? `/api/settings/${marketId}` : null);

  const settingsMap = Object.fromEntries(
    (data?.data ?? []).map((row) => [row.key, row.value?.value ?? row.value]),
  );

  const initialValues: MarketSettings = {
    delivery_fee:
      typeof settingsMap.delivery_fee === "number"
        ? settingsMap.delivery_fee
        : 0,
    return_fee:
      typeof settingsMap.return_fee === "number" ? settingsMap.return_fee : 0,
    packing_cost:
      typeof settingsMap.packing_cost === "number"
        ? settingsMap.packing_cost
        : 0,
    max_call_attempts:
      typeof settingsMap.max_call_attempts === "number"
        ? settingsMap.max_call_attempts
        : 3,
    assignment_algorithm:
      typeof settingsMap.assignment_algorithm === "string"
        ? (settingsMap.assignment_algorithm as MarketSettings["assignment_algorithm"])
        : "manual",
    active_agents_only: settingsMap.active_agents_only === true,
    attempt_retry_times: Array.isArray(settingsMap.attempt_retry_times)
      ? (settingsMap.attempt_retry_times as string[]).filter(
          (v) => typeof v === "string",
        )
      : [],
    agent_inactivity_minutes:
      typeof settingsMap.agent_inactivity_minutes === "number"
        ? settingsMap.agent_inactivity_minutes
        : undefined,
    shift_config:
      settingsMap.shift_config && typeof settingsMap.shift_config === "object"
        ? (settingsMap.shift_config as MarketSettings["shift_config"])
        : undefined,
  };

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="min-h-screen bg-surface-page p-4 sm:p-6"
    >
      <SettingsPageHeader
        title="Paramètres généraux"
        description="Configurez les paramètres opérationnels, financiers et d'équipe de ce marché."
        isRtl={isRtl}
      />

      {data ? (
        <GeneralSettingsGroups
          key={`${marketId}:${data?.data?.length ?? 0}`}
          initialValues={initialValues}
          marketId={marketId}
          role={user.role}
        />
      ) : (
        <div
          className="flex flex-col gap-4"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="h-9 w-64 animate-pulse rounded-md bg-surface-selected" />
          <div className="h-48 animate-pulse rounded-card border border-line-subtle bg-surface-card" />
          <div className="h-64 animate-pulse rounded-card border border-line-subtle bg-surface-card" />
          <span className="sr-only">Chargement…</span>
        </div>
      )}
    </div>
  );
}
