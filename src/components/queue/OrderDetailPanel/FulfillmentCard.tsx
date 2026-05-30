"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Truck } from "lucide-react";
import { SectionCard } from "./SectionCard";

export const FULFILLMENT_STATUS_VALUES = [
  "deposit",
  "in_transit",
  "to_be_returned",
  "delivered",
  "returned",
] as const;

export type FulfillmentStatusValue = (typeof FULFILLMENT_STATUS_VALUES)[number];

export interface FulfillmentCardProps {
  /**
   * Localised status labels resolved by the parent (it owns the `ts`
   * namespace) so this component stays presentation-only.
   */
  statusLabels: Record<FulfillmentStatusValue, string>;
  /**
   * Single async submit handler. Parent owns the POST + mutate + error
   * surfacing. Returns the user-facing error message, or null on success.
   */
  onSubmit: (input: {
    status: FulfillmentStatusValue;
    note: string;
    isDamaged: boolean;
  }) => Promise<string | null>;
  /**
   * Optional anchor id used by the ActionFooter overflow to scroll the card
   * into view when the manager picks "Mettre à jour le fulfillment".
   */
  anchorId?: string;
}

/**
 * Manager-only override block for the fulfillment lifecycle. Lets a manager
 * push the order to any post-scan status (deposit/in_transit/delivered/etc).
 * Hosted as a SectionCard so it shares the section grammar.
 */
export function FulfillmentCard({
  statusLabels,
  onSubmit,
  anchorId,
}: FulfillmentCardProps) {
  const t = useTranslations("orders.detail");
  const [status, setStatus] = useState<FulfillmentStatusValue | "">("");
  const [note, setNote] = useState("");
  const [isDamaged, setIsDamaged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleApply() {
    if (!status) return;
    if (!note.trim()) {
      setError(t("fulfillmentNoteRequired"));
      return;
    }
    setLoading(true);
    setError(null);
    const message = await onSubmit({
      status,
      note: note.trim(),
      isDamaged: status === "returned" && isDamaged,
    });
    setLoading(false);
    if (message) {
      setError(message);
      return;
    }
    setStatus("");
    setNote("");
    setIsDamaged(false);
  }

  return (
    <div id={anchorId} data-fulfillment-card="true">
      <SectionCard title={t("fulfillmentTitle")} icon={Truck}>
        <div className="flex flex-col gap-2.5 pt-1">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as FulfillmentStatusValue | "")}
            className="w-full h-10 px-3 text-[13px] rounded-card border border-line-subtle bg-surface-card text-ink-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">{t("fulfillmentPlaceholder")}</option>
            {FULFILLMENT_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {statusLabels[value]}
              </option>
            ))}
          </select>
          {status === "returned" && (
            <label className="inline-flex items-center gap-2 text-[13px] text-ink-primary cursor-pointer">
              <input
                type="checkbox"
                checked={isDamaged}
                onChange={(e) => setIsDamaged(e.target.checked)}
                className="w-4 h-4 rounded border-line-strong accent-ink-primary"
              />
              {t("fulfillmentDamaged")}
            </label>
          )}
          <input
            type="text"
            placeholder={t("fulfillmentNote")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full h-10 px-3 text-[13px] rounded-card border border-line-subtle bg-surface-card text-ink-primary placeholder:text-ink-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          {error && <div className="text-[12px] text-status-critical">{error}</div>}
          <button
            type="button"
            disabled={!status || loading}
            onClick={handleApply}
            className="inline-flex items-center justify-center h-10 px-4 text-[13px] font-semibold rounded-card bg-ink-primary text-white hover:bg-[#2A2A2A] transition-colors duration-fast disabled:bg-line-strong disabled:text-ink-muted disabled:cursor-not-allowed"
          >
            {loading ? t("fulfillmentUpdating") : t("fulfillmentApply")}
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
