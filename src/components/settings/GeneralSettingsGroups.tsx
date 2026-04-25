"use client";

// TODO(i18n): migrate strings to useTranslations('settings.general') in a follow-up.

import { useState } from "react";
import type { MarketSettings } from "@/types/settings";
import { DEFAULT_MARKET_SETTINGS, DEFAULT_SHIFT_CONFIG } from "@/types/settings";
import type { Role } from "@/types";
import { canEditCosts } from "@/lib/role-permissions";
import { SettingsTabNav } from "./general/SettingsTabNav";
import { OperationsSection } from "./general/OperationsSection";
import { FinanceSection } from "./general/FinanceSection";
import { TeamSection } from "./general/TeamSection";
import { LabelsSection } from "./general/LabelsSection";

type Group = "operations" | "finance" | "team" | "labels";

const GROUPS: { key: Group; label: string; description: string }[] = [
  {
    key: "operations",
    label: "Opérations",
    description: "Tentatives, rappels, inactivité",
  },
  {
    key: "finance",
    label: "Finance",
    description: "Frais et coûts par commande",
  },
  { key: "team", label: "Équipe", description: "Affectation et heures ouvrées" },
  {
    key: "labels",
    label: "Libellés",
    description: "Noms des statuts dans chaque langue",
  },
];

interface Props {
  initialValues: MarketSettings;
  marketId: string;
  role: Role;
}

export function GeneralSettingsGroups({
  initialValues,
  marketId,
  role,
}: Props) {
  const showCosts = canEditCosts(role);
  const [group, setGroup] = useState<Group>("operations");
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

  async function saveGroup(g: Group) {
    setSaving(g);
    setSuccessMsg("");
    setErrorMsg("");

    const payload: Partial<MarketSettings> = {};
    if (g === "operations") {
      payload.max_call_attempts = values.max_call_attempts;
      payload.attempt_retry_times = values.attempt_retry_times ?? [];
      if (values.agent_inactivity_minutes !== undefined) {
        payload.agent_inactivity_minutes = values.agent_inactivity_minutes;
      }
    } else if (g === "finance") {
      payload.delivery_fee = values.delivery_fee;
      payload.return_fee = values.return_fee;
      payload.packing_cost = values.packing_cost;
    } else if (g === "team") {
      payload.assignment_algorithm = values.assignment_algorithm;
      payload.active_agents_only = values.active_agents_only ?? false;
      if (values.shift_config) payload.shift_config = values.shift_config;
    }

    const full: MarketSettings = {
      ...DEFAULT_MARKET_SETTINGS,
      ...values,
      ...payload,
    };

    try {
      const res = await fetch(`/api/settings/${marketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(full),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(
          (body as { error?: string }).error ??
            "Erreur lors de l'enregistrement",
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
    setValues((v) => {
      const next = { ...v };
      if (g === "operations") {
        next.max_call_attempts = DEFAULT_MARKET_SETTINGS.max_call_attempts;
        next.attempt_retry_times = [];
        next.agent_inactivity_minutes = undefined;
      } else if (g === "finance") {
        next.delivery_fee = 0;
        next.return_fee = 0;
        next.packing_cost = 0;
      } else if (g === "team") {
        next.assignment_algorithm = "manual";
        next.active_agents_only = false;
        next.shift_config = DEFAULT_SHIFT_CONFIG;
      }
      return next;
    });
  }

  const visibleTabs = GROUPS.filter((g) => g.key !== "finance" || showCosts);

  return (
    <div className="flex flex-col gap-5">
      <SettingsTabNav
        tabs={visibleTabs}
        active={group}
        onChange={setGroup}
      />

      {group === "operations" && (
        <OperationsSection
          values={values}
          initialValues={initialValues}
          marketId={marketId}
          set={set}
          onSave={() => saveGroup("operations")}
          onReset={() => resetGroup("operations")}
          saving={saving === "operations"}
          successMsg={successMsg}
          errorMsg={errorMsg}
        />
      )}

      {group === "finance" && showCosts && (
        <FinanceSection
          values={values}
          marketId={marketId}
          set={set}
          onSave={() => saveGroup("finance")}
          onReset={() => resetGroup("finance")}
          saving={saving === "finance"}
          successMsg={successMsg}
          errorMsg={errorMsg}
        />
      )}

      {group === "team" && (
        <TeamSection
          values={values}
          marketId={marketId}
          set={set}
          onSave={() => saveGroup("team")}
          onReset={() => resetGroup("team")}
          saving={saving === "team"}
          successMsg={successMsg}
          errorMsg={errorMsg}
        />
      )}

      {group === "labels" && <LabelsSection marketId={marketId} />}
    </div>
  );
}
