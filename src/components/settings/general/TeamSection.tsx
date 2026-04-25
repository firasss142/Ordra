"use client";

import type {
  AssignmentAlgorithm,
  MarketSettings,
  ShiftConfig,
} from "@/types/settings";
import { DEFAULT_SHIFT_CONFIG } from "@/types/settings";
import { ShiftConfigEditor } from "../ShiftConfigEditor";
import { SectionShell, SettingField, selectClass } from "./SectionShell";

const ALGORITHM_OPTIONS: {
  value: AssignmentAlgorithm;
  label: string;
  available: boolean;
}[] = [
  { value: "manual", label: "Manuel", available: true },
  { value: "round_robin", label: "Round Robin", available: true },
  { value: "workload", label: "Charge de travail", available: true },
  {
    value: "product_based",
    label: "Par produit — bientôt disponible",
    available: false,
  },
  {
    value: "region_based",
    label: "Par région — bientôt disponible",
    available: false,
  },
];

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

export function TeamSection({
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
      title="Équipe"
      description="Comment les commandes sont réparties et quand l'équipe est en poste."
      onReset={onReset}
      onSave={onSave}
      saving={saving}
      successMsg={successMsg}
      errorMsg={errorMsg}
    >
      <SettingField
        label="Algorithme d'affectation"
        marketId={marketId}
        settingKey="assignment_algorithm"
      >
        <select
          value={values.assignment_algorithm}
          onChange={(e) =>
            set("assignment_algorithm", e.target.value as AssignmentAlgorithm)
          }
          className={`${selectClass} w-72`}
        >
          {ALGORITHM_OPTIONS.map((opt) => (
            <option
              key={opt.value}
              value={opt.value}
              disabled={!opt.available}
            >
              {opt.label}
            </option>
          ))}
        </select>
      </SettingField>

      {values.assignment_algorithm !== "manual" && (
        <label className="flex items-center gap-2 text-[13px] text-ink-primary">
          <input
            type="checkbox"
            checked={values.active_agents_only ?? false}
            onChange={(e) => set("active_agents_only", e.target.checked)}
            className="h-4 w-4 rounded border-line accent-ink-primary"
          />
          <span>Agents actifs uniquement</span>
        </label>
      )}

      <SettingField
        label="Heures ouvrées"
        marketId={marketId}
        settingKey="shift_config"
      >
        <ShiftConfigEditor
          value={values.shift_config ?? DEFAULT_SHIFT_CONFIG}
          onChange={(next: ShiftConfig) => set("shift_config", next)}
        />
      </SettingField>
    </SectionShell>
  );
}
