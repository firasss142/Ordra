"use client";

import { Button } from "@/components/ui/Button";
import type { MarketSettings } from "@/types/settings";
import { PreviewBanner } from "../PreviewBanner";
import { SectionShell, SettingField, inputClass } from "./SectionShell";
import { OptionCards } from "./OptionCards";
import { SettingToggle } from "./SettingToggle";

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
  readOnly?: boolean;
}

/** Small violet "prise d'effet à venir" note for keys the code doesn't act on yet. */
function PendingEffect() {
  return (
    <span className="ms-2 inline-flex items-center gap-1 rounded-pill border border-[#E3D9F7] bg-[#F1ECFB] px-2 py-0.5 text-[11px] font-medium text-[#6D48C9]">
      prise d'effet à venir
    </span>
  );
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
  readOnly = false,
}: Props) {
  const retryTimes = values.attempt_retry_times ?? [];
  const num = `${inputClass} w-24 tabular-nums`;
  const time = `${inputClass} w-32 tabular-nums`;
  const dis = readOnly ? { disabled: true } : {};

  return (
    <div className="flex flex-col gap-5">
      {/* ── Confirmation ── */}
      <SectionShell
        title="Confirmation"
        description="Rythme des appels et sortie du cycle de confirmation."
        onReset={readOnly ? undefined : onReset}
        onSave={readOnly ? undefined : onSave}
        saving={saving}
        successMsg={successMsg}
        errorMsg={errorMsg}
      >
        <SettingField label="Tentatives max" marketId={marketId} settingKey="max_call_attempts">
          <input
            type="number"
            min={1}
            max={10}
            value={values.max_call_attempts}
            onChange={(e) => set("max_call_attempts", Number(e.target.value))}
            className={num}
            {...dis}
          />
          <PreviewBanner
            marketId={marketId}
            currentValue={initialValues.max_call_attempts}
            pendingValue={values.max_call_attempts}
          />
        </SettingField>

        <SettingField
          label="Après la dernière tentative"
          marketId={marketId}
          settingKey="after_max_attempts_action"
          hint="Rend explicite et réglable le rejet automatique qui se produit déjà en silence."
        >
          <OptionCards
            value={values.after_max_attempts_action ?? "none"}
            onChange={(v) => set("after_max_attempts_action", v as MarketSettings["after_max_attempts_action"])}
            disabled={readOnly}
            options={[
              { value: "reject", label: "Rejeter automatiquement", hint: "motif injoignable" },
              { value: "flag", label: "Signaler au manager", hint: "reste en file, badge" },
              { value: "none", label: "Ne rien faire", hint: "l'agent décide" },
            ]}
          />
          <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-secondary">
            <span>après</span>
            <input
              type="number"
              min={0}
              max={720}
              value={values.after_max_attempts_delay_hours ?? 24}
              onChange={(e) => set("after_max_attempts_delay_hours", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>h sans réponse</span>
            <PendingEffect />
          </div>
        </SettingField>

        <SettingField
          label="Heures de rappel automatique"
          marketId={marketId}
          settingKey="attempt_retry_times"
          hint="Jusqu'à 3 créneaux — les tentatives non répondues sont rappelées à ces heures, dans l'ordre."
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
                  className={time}
                  {...dis}
                />
                {!readOnly && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      set("attempt_retry_times", retryTimes.filter((_, i) => i !== idx))
                    }
                  >
                    Retirer
                  </Button>
                )}
              </div>
            ))}
            {!readOnly && retryTimes.length < 3 && (
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

        <SettingField
          label="Fenêtre de rappel programmé"
          marketId={marketId}
          settingKey="callback_max_days"
          hint="Borne la date qu'un agent peut choisir pour un rappel ; au-delà de la tolérance, la commande passe « rappel en retard »."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <span>au plus</span>
            <input
              type="number"
              min={1}
              max={30}
              value={values.callback_max_days ?? 3}
              onChange={(e) => set("callback_max_days", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>jours à l'avance · tolérance</span>
            <input
              type="number"
              min={0}
              max={1440}
              value={values.callback_grace_minutes ?? 15}
              onChange={(e) => set("callback_grace_minutes", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>min</span>
            <PendingEffect />
          </div>
        </SettingField>

        <SettingField
          label="Délai de confirmation — SLA (minutes)"
          marketId={marketId}
          settingKey="sla_minutes"
          hint="Alimente la pastille SLA du panneau commande. Mesure la phase de confirmation uniquement."
        >
          <input
            type="number"
            min={1}
            max={10080}
            value={values.sla_minutes ?? 120}
            onChange={(e) => set("sla_minutes", Number(e.target.value))}
            className={num}
            {...dis}
          />
        </SettingField>
      </SectionShell>

      {/* ── Réception ── */}
      <SectionShell
        title="Réception des commandes"
        description="Ce qui se passe à l'arrivée d'une commande."
        onSave={readOnly ? undefined : onSave}
        saving={saving}
      >
        <SettingField
          label="Fenêtre de doublons"
          marketId={marketId}
          settingKey="duplicate_window_hours"
          hint="Le doublon exact est déjà ignoré. Ceci couvre le client qui recommande : la seconde arrive avec le badge « doublon probable »."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <span>même téléphone + même produit sous</span>
            <input
              type="number"
              min={0}
              max={168}
              value={values.duplicate_window_hours ?? 24}
              onChange={(e) => set("duplicate_window_hours", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>h</span>
            <PendingEffect />
          </div>
        </SettingField>

        <SettingField
          label="Affectation à l'arrivée"
          marketId={marketId}
          settingKey="auto_assign_on_intake"
          hint="Désactivé : les commandes attendent dans « À affecter » et le manager distribue à la main."
        >
          <ToggleRow
            on={values.auto_assign_on_intake ?? false}
            onToggle={() => set("auto_assign_on_intake", !(values.auto_assign_on_intake ?? false))}
            label="Affecter automatiquement selon l'algorithme d'équipe"
            disabled={readOnly}
            pending
          />
        </SettingField>

        <SettingField
          label="Montant de commande"
          marketId={marketId}
          settingKey="order_amount_min"
          hint="Hors bornes : la commande arrive quand même mais est marquée « à vérifier » — jamais rejetée en silence."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <span>min</span>
            <input
              type="number"
              min={0}
              value={values.order_amount_min ?? ""}
              onChange={(e) => set("order_amount_min", e.target.value === "" ? undefined : Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>max</span>
            <input
              type="number"
              min={0}
              value={values.order_amount_max ?? ""}
              onChange={(e) => set("order_amount_max", e.target.value === "" ? undefined : Number(e.target.value))}
              className={num}
              {...dis}
            />
            <PendingEffect />
          </div>
        </SettingField>

        <SettingField
          label="Ville non reconnue"
          marketId={marketId}
          settingKey="unknown_city_policy"
          hint="La ressemblance s'appuie sur les alias persistants des correspondances."
        >
          <OptionCards
            value={values.unknown_city_policy ?? "queue"}
            onChange={(v) => set("unknown_city_policy", v as MarketSettings["unknown_city_policy"])}
            disabled={readOnly}
            options={[
              { value: "queue", label: "File Correspondances", hint: "bloque l'expédition" },
              { value: "fuzzy", label: "Meilleure ressemblance", hint: "auto, badge « à confirmer »" },
            ]}
          />
        </SettingField>
      </SectionShell>

      {/* ── Expédition & suivi ── */}
      <SectionShell
        title="Expédition & suivi"
        description="De la confirmation à la livraison."
        onSave={readOnly ? undefined : onSave}
        saving={saving}
      >
        <SettingField
          label="Heure limite d'expédition"
          marketId={marketId}
          settingKey="dispatch_cutoff_time"
          hint="Les commandes confirmées après cette heure sont téléversées le prochain jour ouvré. Le téléversement reste séparé de la confirmation."
        >
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={values.dispatch_cutoff_time ?? "16:30"}
              onChange={(e) => set("dispatch_cutoff_time", e.target.value)}
              className={time}
              {...dis}
            />
            <PendingEffect />
          </div>
        </SettingField>

        <SettingField
          label="Téléversement automatique"
          marketId={marketId}
          settingKey="auto_upload_on_confirm"
          hint="Désactivé : l'agent clique « Téléverser » manuellement. En cas d'échec API, la commande reste confirmée — jamais rétrogradée."
        >
          <ToggleRow
            on={values.auto_upload_on_confirm ?? false}
            onToggle={() => set("auto_upload_on_confirm", !(values.auto_upload_on_confirm ?? false))}
            label="Envoyer au transporteur dès la confirmation"
            disabled={readOnly}
            pending
          />
        </SettingField>

        <SettingField
          label="Colis sans nouvelle"
          marketId={marketId}
          settingKey="unverified_after_days"
          hint="Le statut « unverified » existe déjà ; ce réglage en fixe le déclencheur au lieu d'un passage manuel."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <span>marquer « unverified » après</span>
            <input
              type="number"
              min={1}
              max={90}
              value={values.unverified_after_days ?? 5}
              onChange={(e) => set("unverified_after_days", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>jours sans événement transporteur</span>
            <PendingEffect />
          </div>
        </SettingField>

        <SettingField
          label="Retours"
          marketId={marketId}
          settingKey="auto_restock_on_return_scan"
          hint="Le scan retour appelle scan_return_in (+qté, ou « endommagé »). Désactivé : le retour attend une validation entrepôt."
        >
          <ToggleRow
            on={values.auto_restock_on_return_scan ?? true}
            onToggle={() => set("auto_restock_on_return_scan", !(values.auto_restock_on_return_scan ?? true))}
            label="Réintégrer le stock automatiquement au scan"
            disabled={readOnly}
          />
        </SettingField>
      </SectionShell>

      {/* ── Cycle de vie & stock ── */}
      <SectionShell
        title="Cycle de vie & stock"
        description="Archivage et réapprovisionnement."
        onSave={readOnly ? undefined : onSave}
        saving={saving}
      >
        <SettingField
          label="Archivage automatique"
          marketId={marketId}
          settingKey="auto_archive_after_days"
          hint="Ne touche jamais le statut, seulement archived_at."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={1}
              max={365}
              value={values.auto_archive_after_days ?? 30}
              onChange={(e) => set("auto_archive_after_days", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>jours après le statut final</span>
          </div>
        </SettingField>

        <SettingField
          label="Délai fournisseur"
          marketId={marketId}
          settingKey="supplier_lead_time_days"
          hint="Lu par la console de stock pour la date de réapprovisionnement."
        >
          <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
            <input
              type="number"
              min={0}
              max={365}
              value={values.supplier_lead_time_days ?? 14}
              onChange={(e) => set("supplier_lead_time_days", Number(e.target.value))}
              className={num}
              {...dis}
            />
            <span>jours</span>
          </div>
        </SettingField>

        <div className="rounded-md border border-line-subtle bg-surface-sunken p-4">
          <div className="text-[13px] font-medium text-ink-secondary">
            Frais de livraison · Frais de retour · Coût d'emballage{" "}
            <span className="ms-1 rounded bg-status-criticalBg px-1.5 py-0.5 text-[10px] font-bold text-status-critical">
              DÉPLACÉS
            </span>
          </div>
          <p className="mt-1.5 text-[12px] text-ink-secondary">
            Les frais de livraison et de retour appartiennent désormais à chaque société de livraison,
            le coût d'emballage à chaque produit.
          </p>
        </div>
      </SectionShell>
    </div>
  );
}

function ToggleRow({
  on,
  onToggle,
  label,
  disabled,
  pending,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 text-[13px] text-ink-primary">
      <SettingToggle on={on} onToggle={onToggle} label={label} disabled={disabled} />
      <span>{label}</span>
      {pending && <PendingEffect />}
    </div>
  );
}
