"use client";

import type { MarketSettings } from "@/types/settings";
import { SectionShell, SettingField, inputClass } from "./SectionShell";
import { SettingToggle } from "./SettingToggle";

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

export function AlertesSection({
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
          <b className="block">Ces seuils fabriquent l'état « en erreur » des connexions</b>
          Sans eux, un taux d'erreur élevé passe inaperçu. Ils alimentent les tuiles des autres écrans.
          <span className="ms-1 rounded bg-[#F1ECFB] px-1.5 py-0.5 text-[11px] font-medium text-[#6D48C9]">
            prise d'effet à venir
          </span>
        </div>
      </div>

      <SectionShell
        title="Seuils"
        description="Chaque seuil déclenche une alerte quand la valeur réelle le dépasse."
        onReset={readOnly ? undefined : onReset}
        onSave={readOnly ? undefined : onSave}
        saving={saving}
        successMsg={successMsg}
        errorMsg={errorMsg}
      >
        <SettingField
          label="Taux d'erreur transporteur"
          marketId={marketId}
          settingKey="carrier_error_rate_threshold"
          hint="Pourcentage d'événements en erreur sur 24 h glissantes au-delà duquel une alerte se déclenche."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={0}
              max={100}
              value={values.carrier_error_rate_threshold ?? 5}
              onChange={(e) => set("carrier_error_rate_threshold", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>% sur 24 h</span>
          </div>
        </SettingField>

        <SettingField
          label="Échecs webhook consécutifs"
          marketId={marketId}
          settingKey="webhook_failure_threshold"
          hint="Nombre d'échecs de suite avant qu'un storefront soit signalé."
        >
          <input
            type="number"
            min={1}
            max={100}
            value={values.webhook_failure_threshold ?? 3}
            onChange={(e) => set("webhook_failure_threshold", Number(e.target.value))}
            className={num}
            {...dis}
          />
        </SettingField>

        <SettingField
          label="Fraîcheur des synchronisations"
          marketId={marketId}
          settingKey="sync_staleness_hours"
          hint="Heures sans synchronisation réussie avant qu'une source soit signalée périmée."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={1}
              max={168}
              value={values.sync_staleness_hours ?? 2}
              onChange={(e) => set("sync_staleness_hours", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>heures</span>
          </div>
        </SettingField>

        <SettingField
          label="Colis immobile"
          marketId={marketId}
          settingKey="carrier_stall_days"
          hint="Jours sans événement transporteur avant qu'un colis soit signalé bloqué."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={1}
              max={90}
              value={values.carrier_stall_days ?? 5}
              onChange={(e) => set("carrier_stall_days", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>jours sans événement</span>
          </div>
        </SettingField>

        <SettingField
          label="Couverture de stock"
          marketId={marketId}
          settingKey="stockout_days_of_cover"
          hint="Jours de couverture restants sous lesquels un produit est un risque de rupture."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={0}
              max={365}
              value={values.stockout_days_of_cover ?? 7}
              onChange={(e) => set("stockout_days_of_cover", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>jours</span>
          </div>
        </SettingField>

        <SettingField
          label="Dépassement de SLA"
          marketId={marketId}
          settingKey="sla_breach_alert"
          hint="Notifie le manager lorsqu'une commande dépasse le délai de confirmation."
        >
          <div className="flex items-center gap-3 text-[13px] text-ink-primary">
            <SettingToggle
              on={values.sla_breach_alert ?? true}
              onToggle={() => set("sla_breach_alert", !(values.sla_breach_alert ?? true))}
              label="Notifier le manager sur dépassement de SLA"
              disabled={readOnly}
            />
            <span>Notifier le manager (cloche + bandeau)</span>
          </div>
        </SettingField>
      </SectionShell>
    </div>
  );
}
