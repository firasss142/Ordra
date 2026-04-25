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
}

export function FinanceSection({
  values,
  marketId,
  set,
  onSave,
  onReset,
  saving,
  successMsg,
  errorMsg,
}: Props) {
  return (
    <SectionShell
      title="Finance"
      description="Frais et coûts utilisés pour le calcul de rentabilité."
      onReset={onReset}
      onSave={onSave}
      saving={saving}
      successMsg={successMsg}
      errorMsg={errorMsg}
    >
      <SettingField
        label="Frais de livraison (TND)"
        marketId={marketId}
        settingKey="delivery_fee"
      >
        <input
          type="number"
          step="0.01"
          value={values.delivery_fee}
          onChange={(e) => set("delivery_fee", Number(e.target.value))}
          className={`${inputClass} w-40 tabular-nums`}
        />
      </SettingField>

      <SettingField
        label="Frais de retour (TND)"
        marketId={marketId}
        settingKey="return_fee"
      >
        <input
          type="number"
          step="0.01"
          value={values.return_fee}
          onChange={(e) => set("return_fee", Number(e.target.value))}
          className={`${inputClass} w-40 tabular-nums`}
        />
      </SettingField>

      <SettingField
        label="Coût d'emballage (TND)"
        marketId={marketId}
        settingKey="packing_cost"
      >
        <input
          type="number"
          step="0.01"
          value={values.packing_cost}
          onChange={(e) => set("packing_cost", Number(e.target.value))}
          className={`${inputClass} w-40 tabular-nums`}
        />
      </SettingField>
    </SectionShell>
  );
}
