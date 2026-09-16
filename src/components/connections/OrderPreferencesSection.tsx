"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import {
  ORDER_OPTION_KEYS,
  CODED_DEFAULTS,
  CODED_FULFILMENT_MODES,
  isFulfilmentModeChangeValid,
  type OrderOptionKey,
  type ResolvedOrderPreferences,
  type ResolvedFulfilmentModes,
} from "@/lib/carriers/order-preferences";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Les six options, avec ce qu'elles veulent dire pour l'agent au téléphone.
 * Le libellé est celui du modal de dispatch — deux vocabulaires pour la même
 * case seraient une source d'erreur.
 */
const OPTION_LABELS: Record<OrderOptionKey, { label: string; hint: string }> = {
  is_pickup: {
    label: "Ramassage",
    hint: "Darb passe chercher le colis dans notre entrepôt.",
  },
  allow_inspection: {
    label: "Ouverture du colis",
    hint: "Le client peut ouvrir avant de payer — augmente le risque de retour.",
  },
  is_fragile: {
    label: "Fragile",
    hint: "Manipulation signalée au transporteur.",
  },
  allow_card_payment: {
    label: "Paiement par carte",
    hint: "Le client peut payer en ligne au lieu du comptant.",
  },
  allow_testing: {
    label: "Essai",
    hint: "Le client peut tester le produit — augmente le risque de retour.",
  },
  is_replacement: {
    label: "Remplacement / échange",
    hint: "Le colis remplace une commande précédente.",
  },
};

/** Ce que le tiroir enregistre : la politique d'options ET les deux modes. */
export interface OrderPreferencesDraft {
  preferences: ResolvedOrderPreferences;
  fulfilmentModes: ResolvedFulfilmentModes;
}

interface Props {
  carrierId: string;
  canManage: boolean;
  /** Remonte l'état courant pour que le tiroir puisse l'enregistrer. */
  onChange: (draft: OrderPreferencesDraft | null) => void;
}

/**
 * Éditeur de la politique d'options, par transporteur.
 *
 * Deux contrôles par option : la valeur par défaut, et si l'agent peut encore
 * y toucher. Verrouiller une option la fait disparaître du modal de dispatch —
 * en gardant sa valeur, y compris « oui ». C'est dit à l'écran, parce que
 * « masquée » se lit spontanément comme « désactivée ».
 */
export function OrderPreferencesSection({ carrierId, canManage, onChange }: Props) {
  const { data, isLoading } = useSWR<{
    data: ResolvedOrderPreferences;
    fulfilmentModes?: ResolvedFulfilmentModes;
  }>(carrierId ? `/api/carriers/${carrierId}/order-preferences` : null, fetcher);

  const [prefs, setPrefs] = useState<ResolvedOrderPreferences | null>(null);
  const [modes, setModes] = useState<ResolvedFulfilmentModes>(
    CODED_FULFILMENT_MODES,
  );

  useEffect(() => {
    if (data?.data) {
      const nextModes = data.fulfilmentModes ?? CODED_FULFILMENT_MODES;
      setPrefs(data.data);
      setModes(nextModes);
      onChange({ preferences: data.data, fulfilmentModes: nextModes });
    }
    // onChange est stable côté appelant ; le relancer bouclerait.
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(key: OrderOptionKey, patch: Partial<{ value: boolean; canOverride: boolean }>) {
    if (!prefs || !canManage) return;
    const next: ResolvedOrderPreferences = {
      ...prefs,
      [key]: { ...prefs[key], ...patch },
    };
    setPrefs(next);
    onChange({ preferences: next, fulfilmentModes: modes });
  }

  /**
   * Bascule un mode d'expédition.
   *
   * Éteindre le dernier mode actif est refusé ici même : le tiroir ne doit pas
   * pouvoir atteindre un état que la route rejettera. L'interrupteur du dernier
   * mode restant est désactivé, et la raison est écrite sous les deux.
   */
  function toggleMode(which: keyof ResolvedFulfilmentModes) {
    if (!prefs || !canManage) return;
    const next = { ...modes, [which]: !modes[which] };
    if (!isFulfilmentModeChangeValid(next)) return;
    setModes(next);
    onChange({ preferences: prefs, fulfilmentModes: next });
  }

  if (isLoading || !prefs) {
    return (
      <div className="rounded-md border border-line-subtle bg-surface-sunken p-3 text-[12.5px] text-ink-secondary">
        Chargement des préférences…
      </div>
    );
  }

  const lockedCount = ORDER_OPTION_KEYS.filter((k) => !prefs[k].canOverride).length;

  const lastModeStanding =
    [modes.home, modes.carrier].filter(Boolean).length === 1;

  const MODE_META: Array<{
    key: keyof ResolvedFulfilmentModes;
    label: string;
    hint: string;
  }> = [
    {
      key: "home",
      label: "Notre entrepôt",
      hint: "Nous détenons le stock ; Darb vient le chercher.",
    },
    {
      key: "carrier",
      label: "Entrepôt Darb Assabil",
      hint: "Darb détient le stock et le prélève lui-même.",
    },
  ];

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2.5">
        <h3 className="text-[13px] font-semibold text-ink-primary">
          Modes d&apos;expédition
        </h3>
        <p className="text-[12px] leading-snug text-ink-secondary">
          D&apos;où part le colis. Un mode désactivé disparaît de l&apos;écran de
          l&apos;agent.
        </p>

        <div className="overflow-hidden rounded-md border border-line-subtle">
          {MODE_META.map(({ key, label, hint }, i) => {
            const on = modes[key];
            const isLast = on && lastModeStanding;
            return (
              <div
                key={key}
                className={`flex items-start gap-3 px-3 py-2.5 ${
                  i > 0 ? "border-t border-line-subtle" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <span className="text-[13px] font-medium text-ink-primary">
                    {label}
                  </span>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-ink-secondary">
                    {hint}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={label}
                  disabled={!canManage || isLast}
                  onClick={() => toggleMode(key)}
                  className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-pill transition-colors ${
                    on ? "bg-brand" : "bg-line-strong"
                  } ${!canManage || isLast ? "opacity-50" : ""}`}
                >
                  <span
                    className={`absolute top-0.5 h-[18px] w-[18px] rounded-pill bg-white shadow-hover-row transition-all ${
                      on ? "start-[18px]" : "start-0.5"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>

        {lastModeStanding && (
          <p className="text-[11.5px] leading-snug text-ink-secondary">
            Au moins un mode doit rester actif — sinon ce transporteur n&apos;a
            plus aucun entrepôt d&apos;où partir.
          </p>
        )}
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-ink-primary">
          Préférences de commande
        </h3>
        {lockedCount > 0 && (
          <span className="text-[11.5px] text-ink-secondary">
            {lockedCount} verrouillée{lockedCount > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <p className="text-[12px] leading-snug text-ink-secondary">
        Ce que l&apos;agent voit au moment d&apos;envoyer la commande au transporteur.
        Une option verrouillée disparaît de son écran et garde la valeur choisie ici.
      </p>

      <div className="overflow-hidden rounded-md border border-line-subtle">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-sunken text-[11px] uppercase tracking-[0.06em] text-ink-secondary">
              <th className="px-3 py-2 text-start font-bold">Option</th>
              <th className="w-[92px] px-3 py-2 text-center font-bold">Par défaut</th>
              <th className="w-[112px] px-3 py-2 text-center font-bold">Modifiable</th>
            </tr>
          </thead>
          <tbody>
            {ORDER_OPTION_KEYS.map((key) => {
              const opt = prefs[key];
              const meta = OPTION_LABELS[key];
              const changed = opt.value !== CODED_DEFAULTS[key] || !opt.canOverride;

              return (
                <tr key={key} className="border-t border-line-subtle align-top">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink-primary">{meta.label}</span>
                      {changed && (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-pill bg-brand"
                          aria-label="Différent du réglage d'origine"
                        />
                      )}
                    </div>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-ink-secondary">
                      {meta.hint}
                    </p>
                    {!opt.canOverride && (
                      <p className="mt-1 text-[11.5px] font-medium text-ink-secondary">
                        Masquée pour l&apos;agent — envoyée à «&nbsp;
                        {opt.value ? "oui" : "non"}&nbsp;».
                      </p>
                    )}
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={opt.value}
                      disabled={!canManage}
                      onChange={(e) => update(key, { value: e.target.checked })}
                      aria-label={`${meta.label} — valeur par défaut`}
                      className="h-[18px] w-[18px] cursor-pointer rounded-[5px] accent-brand disabled:cursor-not-allowed"
                    />
                  </td>

                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={opt.canOverride}
                      aria-label={`${meta.label} — modifiable par l'agent`}
                      disabled={!canManage}
                      onClick={() => update(key, { canOverride: !opt.canOverride })}
                      className={`relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors ${
                        opt.canOverride ? "bg-brand" : "bg-line-strong"
                      } ${!canManage ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`absolute top-0.5 h-[18px] w-[18px] rounded-pill bg-white shadow-hover-row transition-all ${
                          opt.canOverride ? "start-[18px]" : "start-0.5"
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
