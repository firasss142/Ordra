"use client";

import useSWR from "swr";
import { GeneralSettingsGroups } from "@/components/settings/GeneralSettingsGroups";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { useMarketScope } from "@/context/market-scope";
import { assembleMarketSettings, type SettingRow } from "@/lib/settings/assembleMarketSettings";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
  /** Manager view: everything visible, all controls disabled. */
  readOnly?: boolean;
}

export function GeneralSettingsClient({ user, readOnly = false }: Props) {
  const isRtl = user.direction === "rtl";
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = scopeMarketId ?? user.market_id ?? "";

  const { data } = useSWR<{ data: SettingRow[] }>(
    marketId ? `/api/settings/${marketId}` : null,
  );

  const initialValues = assembleMarketSettings(data?.data ?? []);

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="min-h-screen bg-surface-page p-4 sm:p-6"
    >
      <SettingsPageHeader
        title="Paramètres"
        description="Le comportement de l'OMS pour ce marché. Chaque modification est tracée dans le journal d'audit."
        isRtl={isRtl}
      />

      {data ? (
        <GeneralSettingsGroups
          key={`${marketId}:${data?.data?.length ?? 0}`}
          initialValues={initialValues}
          marketId={marketId}
          role={user.role}
          readOnly={readOnly}
        />
      ) : (
        <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
          <div className="h-9 w-64 animate-pulse rounded-md bg-surface-selected" />
          <div className="h-48 animate-pulse rounded-card border border-line-subtle bg-surface-card" />
          <div className="h-64 animate-pulse rounded-card border border-line-subtle bg-surface-card" />
          <span className="sr-only">Chargement…</span>
        </div>
      )}
    </div>
  );
}
