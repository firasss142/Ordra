"use client";

import type {
  AssignmentAlgorithm,
  MarketSettings,
  ShiftConfig,
} from "@/types/settings";
import { DEFAULT_SHIFT_CONFIG } from "@/types/settings";
import { ShiftConfigEditor } from "../ShiftConfigEditor";
import { SectionShell, SettingField, inputClass, selectClass } from "./SectionShell";
import { OptionCards } from "./OptionCards";
import { SettingToggle } from "./SettingToggle";

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
  readOnly?: boolean;
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
  readOnly = false,
}: Props) {
  const num = `${inputClass} w-24 tabular-nums`;
  const dis = readOnly ? { disabled: true } : {};

  return (
    <div className="flex flex-col gap-5">
      {/* ── Affectation ── */}
      <SectionShell
        title="Affectation"
        description="Comment une commande trouve son agent."
        onReset={readOnly ? undefined : onReset}
        onSave={readOnly ? undefined : onSave}
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
            {...dis}
          >
            {ALGORITHM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={!opt.available}>
                {opt.label}
              </option>
            ))}
          </select>
        </SettingField>

        <SettingField
          label="Plafond par agent"
          marketId={marketId}
          settingKey="max_open_orders_per_agent"
          hint="Au plafond, l'agent sort de la rotation ; les commandes restent « à affecter »."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={1}
              max={10000}
              value={values.max_open_orders_per_agent ?? 25}
              onChange={(e) => set("max_open_orders_per_agent", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>commandes ouvertes</span>
            <span className="ms-1 rounded-pill border border-[#E3D9F7] bg-[#F1ECFB] px-2 py-0.5 text-[11px] font-medium text-[#6D48C9]">
              prise d'effet à venir
            </span>
          </div>
        </SettingField>

        {values.assignment_algorithm !== "manual" && (
          <div className="flex items-center gap-3 text-[13px] text-ink-primary">
            <SettingToggle
              on={values.active_agents_only ?? false}
              onToggle={() => set("active_agents_only", !(values.active_agents_only ?? false))}
              label="Agents actifs uniquement"
              disabled={readOnly}
            />
            <span>N'affecter qu'aux agents en ligne ou inactifs — jamais hors ligne</span>
          </div>
        )}
      </SectionShell>

      {/* ── Présence & heures ouvrées ── */}
      <SectionShell
        title="Présence & heures ouvrées"
        description="Quand l'équipe est en poste et ce qui arrive en dehors."
        onSave={readOnly ? undefined : onSave}
        saving={saving}
      >
        <SettingField
          label="Seuil d'inactivité agent (minutes)"
          marketId={marketId}
          settingKey="agent_inactivity_minutes"
          hint="Les agents inactifs au-delà de ce seuil sont marqués indisponibles. « En ligne » reste fixé à 5 min."
        >
          <input
            type="number"
            min={1}
            placeholder="ex: 30"
            value={values.agent_inactivity_minutes ?? ""}
            onChange={(e) =>
              set(
                "agent_inactivity_minutes",
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
            className={num}
            {...dis}
          />
        </SettingField>

        <SettingField
          label="Files orphelines"
          marketId={marketId}
          settingKey="orphan_reassign_after_minutes"
          hint="Rend actionnable le compteur « Files orphelines » du contrôle d'équipe."
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
              <span>réaffecter les commandes d'un agent hors ligne après</span>
              <input
                type="number"
                min={1}
                max={10080}
                value={values.orphan_reassign_after_minutes ?? 60}
                onChange={(e) => set("orphan_reassign_after_minutes", Number(e.target.value))}
                className={num}
                {...dis}
              />
              <span>min</span>
            </div>
            <div className="flex items-center gap-3 text-[13px] text-ink-primary">
              <SettingToggle
                on={values.orphan_reassign_enabled ?? false}
                onToggle={() => set("orphan_reassign_enabled", !(values.orphan_reassign_enabled ?? false))}
                label="Activer la réaffectation automatique"
                disabled={readOnly}
              />
              <span>Activer la réaffectation automatique</span>
              <span className="ms-1 rounded-pill border border-[#E3D9F7] bg-[#F1ECFB] px-2 py-0.5 text-[11px] font-medium text-[#6D48C9]">
                prise d'effet à venir
              </span>
            </div>
          </div>
        </SettingField>

        <SettingField
          label="Hors heures ouvrées"
          marketId={marketId}
          settingKey="outside_hours_policy"
        >
          <OptionCards
            value={values.outside_hours_policy ?? "hold"}
            onChange={(v) => set("outside_hours_policy", v as MarketSettings["outside_hours_policy"])}
            disabled={readOnly}
            options={[
              { value: "hold", label: "Mettre en attente", hint: "affectées à l'ouverture" },
              { value: "assign", label: "Affecter quand même", hint: "l'agent la voit à sa connexion" },
            ]}
          />
        </SettingField>

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
    </div>
  );
}
