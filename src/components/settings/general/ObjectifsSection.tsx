"use client";

import type { MarketSettings } from "@/types/settings";
import { SectionShell, SettingField, inputClass } from "./SectionShell";

interface Props {
  values: MarketSettings;
  marketId: string;
  set: <K extends keyof MarketSettings>(key: K, value: MarketSettings[K]) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  successMsg: string;
  errorMsg: string;
  readOnly?: boolean;
}

export function ObjectifsSection({
  values,
  marketId,
  set,
  onSave,
  onReset,
  saving,
  successMsg,
  errorMsg,
  readOnly = false,
}: Props) {
  const num = `${inputClass} w-24 tabular-nums`;
  const dis = readOnly ? { disabled: true } : {};

  return (
    <SectionShell
      title="Objectifs d'équipe"
      description="Cibles lues par le tableau de bord d'équipe et la fiche agent."
      onReset={readOnly ? undefined : onReset}
      onSave={readOnly ? undefined : onSave}
      saving={saving}
      successMsg={successMsg}
      errorMsg={errorMsg}
    >
      <SettingField
        label="Commandes traitées / agent / jour"
        marketId={marketId}
        settingKey="goal_daily_treated"
      >
        <input
          type="number"
          min={0}
          value={values.goal_daily_treated ?? 12}
          onChange={(e) => set("goal_daily_treated", Number(e.target.value))}
          className={num}
          {...dis}
        />
      </SettingField>

      <SettingField
        label="Taux de confirmation minimal"
        marketId={marketId}
        settingKey="goal_min_rate"
        hint="Sert de seuil aux tuiles de marché."
      >
        <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
          <input
            type="number"
            min={0}
            max={100}
            value={values.goal_min_rate ?? 40}
            onChange={(e) => set("goal_min_rate", Number(e.target.value))}
            className={num}
            {...dis}
          />
          <span>%</span>
        </div>
      </SettingField>

      <SettingField
        label="Confirmations / heure"
        marketId={marketId}
        settingKey="goal_conf_per_hour"
      >
        <input
          type="number"
          min={0}
          step="0.1"
          value={values.goal_conf_per_hour ?? 3}
          onChange={(e) => set("goal_conf_per_hour", Number(e.target.value))}
          className={num}
          {...dis}
        />
      </SettingField>

      <SettingField
        label="Confirmations hebdomadaires · équipe"
        marketId={marketId}
        settingKey="goal_team_weekly_conf"
      >
        <input
          type="number"
          min={0}
          value={values.goal_team_weekly_conf ?? 150}
          onChange={(e) => set("goal_team_weekly_conf", Number(e.target.value))}
          className={num}
          {...dis}
        />
      </SettingField>
    </SectionShell>
  );
}
