"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { MarketSettings } from "@/types/settings";
import { PreviewBanner } from "../PreviewBanner";
import { SectionShell, SettingField, inputClass } from "./SectionShell";

interface Props {
  values: MarketSettings;
  initialValues: MarketSettings;
  marketId: string;
  set: <K extends keyof MarketSettings>(key: K, value: MarketSettings[K]) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  successMsg: string;
  errorMsg: string;
}

export function OperationsSection({
  values,
  initialValues,
  marketId,
  set,
  onSave,
  onReset,
  saving,
  successMsg,
  errorMsg,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const retryTimes = values.attempt_retry_times ?? [];

  return (
    <SectionShell
      title="Opérations"
      description="Nombre maximal de tentatives d'appel et plages de rappel."
      onReset={onReset}
      onSave={onSave}
      saving={saving}
      successMsg={successMsg}
      errorMsg={errorMsg}
    >
      <SettingField
        label="Tentatives max"
        marketId={marketId}
        settingKey="max_call_attempts"
      >
        <input
          type="number"
          min={1}
          max={10}
          value={values.max_call_attempts}
          onChange={(e) => set("max_call_attempts", Number(e.target.value))}
          className={`${inputClass} w-32 tabular-nums`}
        />
        <PreviewBanner
          marketId={marketId}
          currentValue={initialValues.max_call_attempts}
          pendingValue={values.max_call_attempts}
        />
      </SettingField>

      <SettingField
        label="Heures de rappel automatique"
        marketId={marketId}
        settingKey="attempt_retry_times"
        hint="Jusqu'à 3 créneaux — les tentatives non répondues sont rappelées à ces heures."
      >
        <div className="flex flex-col gap-2">
          {retryTimes.map((t, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="time"
                value={t}
                onChange={(e) => {
                  const next = [...retryTimes];
                  next[idx] = e.target.value;
                  set("attempt_retry_times", next);
                }}
                className={`${inputClass} w-36 tabular-nums`}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  set(
                    "attempt_retry_times",
                    retryTimes.filter((_, i) => i !== idx),
                  )
                }
              >
                Retirer
              </Button>
            </div>
          ))}
          {retryTimes.length < 3 && (
            <button
              type="button"
              onClick={() => set("attempt_retry_times", [...retryTimes, ""])}
              className="self-start h-9 px-3 rounded-md border border-dashed border-line-strong bg-transparent text-[13px] text-ink-primary hover:bg-surface-hover transition-colors duration-fast"
            >
              + Ajouter un créneau
            </button>
          )}
        </div>
      </SettingField>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="p-0 bg-transparent border-0 text-[13px] text-status-action cursor-pointer hover:underline"
        >
          {showAdvanced
            ? "− Masquer les paramètres avancés"
            : "+ Afficher les paramètres avancés"}
        </button>
      </div>

      {showAdvanced && (
        <SettingField
          label="Seuil d'inactivité agent (minutes)"
          marketId={marketId}
          settingKey="agent_inactivity_minutes"
          hint="Les agents inactifs au-delà de ce seuil sont marqués comme indisponibles pour l'assignation automatique."
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
            className={`${inputClass} w-32 tabular-nums`}
          />
        </SettingField>
      )}
    </SectionShell>
  );
}
