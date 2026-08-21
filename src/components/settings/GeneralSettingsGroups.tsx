"use client";

// Hardcoded French by convention — the settings/general subsystem predates the
// settings.general i18n namespace (see the redesign plan). Kept consistent here
// rather than half-migrating one workspace.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { canSetCommissionRates } from "@/lib/role-permissions";
import { CommissionsSection } from "./general/CommissionsSection";
import type { MarketSettings } from "@/types/settings";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_SHIFT_CONFIG } from "@/types/settings";
import type { Role } from "@/types";
import { SettingsTabNav } from "./general/SettingsTabNav";
import { OperationsSection } from "./general/OperationsSection";
import { AlertesSection } from "./general/AlertesSection";
import { TeamSection } from "./general/TeamSection";
import { ObjectifsSection } from "./general/ObjectifsSection";

type Group = "operations" | "alertes" | "team" | "objectifs" | "commissions";

const GROUPS: { key: Group; label: string; description: string }[] = [
  { key: "operations", label: "Opérations", description: "Confirmation, réception, expédition, cycle de vie" },
  { key: "alertes", label: "Alertes", description: "Seuils qui déclenchent les alertes" },
  { key: "team", label: "Équipe", description: "Affectation, présence, heures ouvrées" },
  { key: "objectifs", label: "Objectifs", description: "Cibles de l'équipe" },
  { key: "commissions", label: "Commissions", description: "Ce qu'un agent gagne par commande livrée" },
];

interface Props {
  initialValues: MarketSettings;
  marketId: string;
  role: Role;
  /** Manager view: everything is visible but read-only. */
  readOnly?: boolean;
}

export function GeneralSettingsGroups({
  initialValues,
  marketId,
  role,
  readOnly = false,
}: Props) {
  const showCommissions = canSetCommissionRates(role);
  const searchParams = useSearchParams();
  const requestedTab = searchParams?.get("tab");
  const initialTab: Group =
    requestedTab && GROUPS.some((g) => g.key === requestedTab)
      ? (requestedTab as Group)
      : "operations";
  const [group, setGroup] = useState<Group>(
    initialTab === "commissions" && !showCommissions ? "operations" : initialTab,
  );
  const locale = useLocale();
  const tMarkets = useTranslations("nav.markets");
  const marketCode = marketIdToCode(marketId);
  const marketName = marketCode ? tMarkets(marketCode) : marketId;
  const [values, setValues] = useState<MarketSettings>({
    ...DEFAULT_MARKET_SETTINGS,
    ...initialValues,
    shift_config: initialValues.shift_config ?? DEFAULT_SHIFT_CONFIG,
  });
  const [saving, setSaving] = useState<Group | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const set = <K extends keyof MarketSettings>(
    key: K,
    value: MarketSettings[K],
  ) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  // Keys owned by each tab — saved together when that tab's "Enregistrer" fires.
  // saveGroup always PATCHes the full assembled object (the route validates the
  // whole shape), so listing keys here documents ownership more than it gates.
  const GROUP_KEYS: Record<Group, (keyof MarketSettings)[]> = {
    operations: [
      "max_call_attempts",
      "attempt_retry_times",
      "after_max_attempts_action",
      "after_max_attempts_delay_hours",
      "callback_max_days",
      "callback_grace_minutes",
      "dispatch_cutoff_time",
      "sla_minutes",
      "duplicate_window_hours",
      "auto_assign_on_intake",
      "order_amount_min",
      "order_amount_max",
      "unknown_city_policy",
      "auto_upload_on_confirm",
      "unverified_after_days",
      "auto_restock_on_return_scan",
      "auto_archive_after_days",
      "supplier_lead_time_days",
    ],
    alertes: [
      "carrier_error_rate_threshold",
      "webhook_failure_threshold",
      "sync_staleness_hours",
      "carrier_stall_days",
      "stockout_days_of_cover",
      "sla_breach_alert",
    ],
    team: [
      "assignment_algorithm",
      "active_agents_only",
      "agent_inactivity_minutes",
      "max_open_orders_per_agent",
      "orphan_reassign_after_minutes",
      "orphan_reassign_enabled",
      "outside_hours_policy",
      "shift_config",
    ],
    objectifs: [
      "goal_daily_treated",
      "goal_min_rate",
      "goal_conf_per_hour",
      "goal_team_weekly_conf",
    ],
    commissions: [],
  };

  async function saveGroup(g: Group) {
    if (readOnly) return;
    setSaving(g);
    setSuccessMsg("");
    setErrorMsg("");

    // The route validates and upserts the whole MarketSettings; sending `values`
    // (seeded from defaults) keeps every key valid and only the touched ones changed.
    const full: MarketSettings = { ...DEFAULT_MARKET_SETTINGS, ...values };

    try {
      const res = await fetch(`/api/settings/${marketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(full),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(
          (body as { error?: string }).error ?? "Erreur lors de l'enregistrement",
        );
      } else {
        setSuccessMsg("Paramètres enregistrés");
        setTimeout(() => setSuccessMsg(""), 3000);
      }
    } catch {
      setErrorMsg("Erreur réseau — veuillez réessayer");
    } finally {
      setSaving(null);
    }
  }

  function resetGroup(g: Group) {
    if (readOnly) return;
    setValues((v) => {
      const next = { ...v };
      for (const key of GROUP_KEYS[g]) {
        (next as unknown as Record<string, unknown>)[key] = (
          DEFAULT_MARKET_SETTINGS as unknown as Record<string, unknown>
        )[key];
      }
      return next;
    });
  }

  const visibleTabs = GROUPS.filter(
    (g) => g.key !== "commissions" || showCommissions,
  );

  const common = {
    values,
    marketId,
    set,
    saving: false,
    successMsg,
    errorMsg,
    readOnly,
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsTabNav tabs={visibleTabs} active={group} onChange={setGroup} />

      {group === "operations" && (
        <OperationsSection
          {...common}
          initialValues={initialValues}
          onSave={() => saveGroup("operations")}
          onReset={() => resetGroup("operations")}
          saving={saving === "operations"}
        />
      )}

      {group === "alertes" && (
        <AlertesSection
          {...common}
          onSave={() => saveGroup("alertes")}
          onReset={() => resetGroup("alertes")}
          saving={saving === "alertes"}
        />
      )}

      {group === "team" && (
        <TeamSection
          {...common}
          onSave={() => saveGroup("team")}
          onReset={() => resetGroup("team")}
          saving={saving === "team"}
        />
      )}

      {group === "objectifs" && (
        <ObjectifsSection
          {...common}
          onSave={() => saveGroup("objectifs")}
          onReset={() => resetGroup("objectifs")}
          saving={saving === "objectifs"}
        />
      )}

      {group === "commissions" && showCommissions && (
        <CommissionsSection
          marketId={marketId}
          marketName={marketName}
          tz={marketTimezone(marketId)}
          locale={locale}
        />
      )}
    </div>
  );
}
