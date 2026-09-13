"use client";

// Hardcoded French, like the rest of settings/general (see the note at the top
// of GeneralSettingsGroups.tsx).

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

/**
 * Thresholds the post-upload delivery worklist ranks on.
 *
 * These exist so nothing in lib/delivery hardcodes a number. The old code did
 * exactly that — "stuck" was written as 3, 4 and 5 days in three different
 * files — and no manager could change any of them.
 */
export function LivraisonSection({
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
      <div className="flex gap-3 rounded-md border border-[#CBDDF5] bg-status-actionBg px-4 py-3 text-[13px] text-[#1B4C93]">
        <span aria-hidden>ℹ️</span>
        <div>
          <b className="block">Ces seuils décident de ce que l&apos;agent voit en premier</b>
          Suivi livraison classe chaque colis par « à traiter maintenant ». Ces valeurs
          disent ce que « maintenant » veut dire, et quel client mérite un appel avant
          la livraison.
        </div>
      </div>

      <SectionShell
        title="Colis à risque"
        description="Ce qui déclenche un appel préventif quand le colis part en livraison."
        onReset={readOnly ? undefined : onReset}
        onSave={readOnly ? undefined : onSave}
        saving={saving}
        successMsg={successMsg}
        errorMsg={errorMsg}
      >
        <SettingField
          label="Commande à valeur élevée"
          marketId={marketId}
          settingKey="high_value_threshold"
          hint="Montant à partir duquel un colis mérite un appel avant livraison. 0 = désactivé."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={0}
              step={1}
              value={values.high_value_threshold ?? 0}
              onChange={(e) => set("high_value_threshold", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>0 = aucun seuil de valeur</span>
          </div>
        </SettingField>

        <SettingField
          label="Client déjà en échec"
          marketId={marketId}
          settingKey="risk_min_prior_failures"
          hint="Nombre de retours ou refus passés à partir duquel un client est considéré à risque. Un nouveau client n'est jamais un risque."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={1}
              max={100}
              value={values.risk_min_prior_failures ?? 1}
              onChange={(e) => set("risk_min_prior_failures", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>échecs passés</span>
          </div>
        </SettingField>

        <SettingField
          label="Zone à faible livraison"
          marketId={marketId}
          settingKey="zone_low_delivery_rate_pct"
          hint="Taux de livraison sous lequel une destination est considérée difficile."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={0}
              max={100}
              value={values.zone_low_delivery_rate_pct ?? 60}
              onChange={(e) =>
                set("zone_low_delivery_rate_pct", Number(e.target.value))
              }
              className={num}
              {...dis}
            />
            <span>% de livraisons réussies</span>
          </div>
        </SettingField>

        <SettingField
          label="Échantillon minimum d'une zone"
          marketId={marketId}
          settingKey="zone_min_sample"
          hint="Commandes terminées nécessaires avant de juger une zone. En dessous, le taux ne veut rien dire."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={1}
              max={100000}
              value={values.zone_min_sample ?? 20}
              onChange={(e) => set("zone_min_sample", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>commandes terminées</span>
          </div>
        </SettingField>

        <SettingField
          label="Durée de l'appel préventif"
          marketId={marketId}
          settingKey="proactive_call_window_hours"
          hint="Temps laissé à l'agent pour passer l'appel préventif avant que la tâche expire."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={1}
              max={72}
              value={values.proactive_call_window_hours ?? 4}
              onChange={(e) =>
                set("proactive_call_window_hours", Number(e.target.value))
              }
              className={num}
              {...dis}
            />
            <span>heures</span>
          </div>
        </SettingField>

        <SettingField
          label="Colis terminés visibles"
          marketId={marketId}
          settingKey="delivery_done_window_hours"
          hint="Durée pendant laquelle un colis livré ou retourné reste dans « Terminées ». L'agent peut encore y enregistrer l'appel qui l'a clos."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={1}
              max={168}
              value={values.delivery_done_window_hours ?? 24}
              onChange={(e) =>
                set("delivery_done_window_hours", Number(e.target.value))
              }
              className={num}
              {...dis}
            />
            <span>heures après la fin</span>
          </div>
        </SettingField>
      </SectionShell>

      <div className="rounded-md border border-line bg-surface-sunken px-4 py-3 text-[13px] text-ink-secondary">
        <b className="block text-ink-primary">Deux seuils vivent ailleurs</b>
        « Colis immobile » (jours sans événement transporteur) et « Non vérifié » sont
        dans <i>Alertes</i> et <i>Opérations</i>. Suivi livraison les lit tels quels — ce
        sont les mêmes colis bloqués, il ne peut pas y en avoir deux définitions.
      </div>
    </div>
  );
}
