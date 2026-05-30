"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Plus } from "lucide-react";
import { InlineField } from "@/components/ui/InlineField";
import { type ComboboxOption } from "@/components/ui/Combobox";
import { CityPicker, type DexpressState } from "./CityPicker";

export interface AddressAlertProps {
  /** Customer note from checkout — quoted inline as context, if present. */
  note: string | null;
  /** Drives the "Tentative N" pill; 0 hides it. */
  attemptsCount: number;
  canEdit: boolean;
  isLibyaOrder: boolean;
  dexpressStates: DexpressState[];
  loadCities: (query: string) => Promise<ComboboxOption[]>;
  onCommitAddress: (v: string) => void;
  onCommitCity: (cityId: string) => void;
  onCommitDexpressState: (stateId: number) => void;
}

/**
 * The missing-delivery-address headline. For a COD order a missing address is
 * a hard blocker — it cannot ship — so we surface it as the loudest thing on
 * the panel: an amber alert carrying the customer's own note for context, the
 * current call-attempt count, and a one-tap inline form to resolve it.
 *
 * The parent gates *whether* this renders (non-terminal + no address); this
 * component only owns presentation + the resolve form. The form reuses the
 * exact market-aware city editor (`CityPicker`) so Tunisia (`cities`) and
 * Libya (Dexpress states) logic stays in one place — never a free-text city.
 *
 * Inspired by the Claude Design prototype's missing-address block, adapted to
 * the OMS light/white design system (amber status tokens, no dark/mint).
 */
export function AddressAlert({
  note,
  attemptsCount,
  canEdit,
  isLibyaOrder,
  dexpressStates,
  loadCities,
  onCommitAddress,
  onCommitCity,
  onCommitDexpressState,
}: AddressAlertProps) {
  const t = useTranslations("orders.detail");
  const [formOpen, setFormOpen] = useState(false);

  return (
    <section
      className="mx-4 mt-3 rounded-card border border-status-warning/30 bg-status-warningBg overflow-hidden"
      aria-label={t("addressMissingTitle")}
    >
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-2.5">
          <AlertTriangle
            size={18}
            strokeWidth={2}
            aria-hidden="true"
            className="flex-shrink-0 mt-0.5 text-status-warning"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[13px] font-semibold text-status-warning leading-snug">
                {t("addressMissingTitle")}
              </h3>
              {attemptsCount > 0 ? (
                <span className="flex-shrink-0 inline-flex items-center h-[20px] px-2 rounded-pill border border-status-warning/30 bg-surface-card text-[11px] font-semibold tabular-nums text-status-warning whitespace-nowrap">
                  {t("addressAlertAttempt", { count: attemptsCount })}
                </span>
              ) : null}
            </div>
            {note ? (
              <p
                className="mt-1.5 text-[12px] text-ink-secondary leading-relaxed [text-wrap:pretty]"
                dir="auto"
              >
                «&#8239;{note}&#8239;»
              </p>
            ) : null}
          </div>
        </div>

        {canEdit ? (
          !formOpen ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-card bg-status-warning text-white text-[13px] font-semibold hover:brightness-105 transition-[filter] duration-fast"
            >
              <Plus size={15} strokeWidth={2.25} aria-hidden="true" />
              {t("addAddress")}
            </button>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5 rounded-card bg-surface-card border border-status-warning/25 p-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink-secondary">
                  {t("fieldAddress")}
                </span>
                <InlineField
                  value=""
                  onCommit={(v) => {
                    onCommitAddress(v);
                  }}
                  placeholder={t("fieldAddress")}
                  className="text-[13px]"
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-ink-secondary">
                  {t("fieldCity")}
                </span>
                <CityPicker
                  city={null}
                  canEdit={canEdit}
                  isLibyaOrder={isLibyaOrder}
                  dexpressStates={dexpressStates}
                  loadCities={loadCities}
                  onCommitCity={onCommitCity}
                  onCommitDexpressState={onCommitDexpressState}
                  startOpen={isLibyaOrder}
                />
              </div>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
