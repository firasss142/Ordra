"use client";

import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { MetaAdsSection } from "@/components/settings/MetaAdsSection";
import type { AuthUser } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

export function IntegrationsClient({ user, markets }: { user: AuthUser; markets: Market[] }) {
  const isRtl = user.direction === "rtl";

  return (
    <div
      className="bg-surface-page min-h-screen p-6"
      style={{ direction: isRtl ? "rtl" : "ltr" }}
    >
      <SettingsPageHeader
        title="Intégrations"
        description="Comptes des plateformes que l'OMS interroge automatiquement."
        isRtl={isRtl}
      />
      <MetaAdsSection markets={markets} />
    </div>
  );
}
