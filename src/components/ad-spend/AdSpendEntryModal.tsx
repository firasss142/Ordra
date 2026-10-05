"use client";

import { useState, useEffect } from "react";
import { X, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AdSpendWithMetrics } from "@/lib/ad-spend/realized-metrics";
import { isPeriodLocked } from "@/lib/ad-spend/period-lock";
import type { CampaignsProduct } from "@/hooks/useAdSpendCampaigns";

interface FormState {
  periodStart: string;
  periodEnd: string;
  amount: string;
  productId: string; // "" = market-wide
  note: string;
  confirmLocked: boolean;
}

interface AdSpendEntryModalProps {
  entry: AdSpendWithMetrics | null; // null = create new
  products: CampaignsProduct[];
  /** The market currency, beside the amount. */
  currency?: string;
  /** « Libye · LYD » under the title. */
  marketLabel?: string;
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
  onClose: () => void;
  onSave: (
    data: {
      amount: number;
      period_start: string;
      period_end: string;
      product_id: string | null;
      note: string;
    },
    confirmLockedPeriod: boolean,
    entryId?: string,
  ) => Promise<void>;
}



export function AdSpendEntryModal({
  entry,
  products,
  currency,
  marketLabel,
  defaultPeriodStart,
  defaultPeriodEnd,
  onClose,
  onSave,
}: AdSpendEntryModalProps) {
  const t = useTranslations("adSpend.modal");
  const [form, setForm] = useState<FormState>({
    periodStart: entry?.period_start ?? defaultPeriodStart,
    periodEnd: entry?.period_end ?? defaultPeriodEnd,
    amount: entry ? String(entry.amount) : "",
    productId: entry?.product_id ?? "",
    note: entry?.note ?? "",
    confirmLocked: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when entry changes
  useEffect(() => {
    setForm({
      periodStart: entry?.period_start ?? defaultPeriodStart,
      periodEnd: entry?.period_end ?? defaultPeriodEnd,
      amount: entry ? String(entry.amount) : "",
      productId: entry?.product_id ?? "",
      note: entry?.note ?? "",
      confirmLocked: false,
    });
    setError(null);
  }, [entry, defaultPeriodStart, defaultPeriodEnd]);

  const locked = entry ? isPeriodLocked(entry.period_end) : false;
  const submitDisabled = submitting || (locked && !form.confirmLocked);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      setError(t("errorAmount"));
      return;
    }
    if (!form.periodStart || !form.periodEnd) {
      setError(t("errorPeriod"));
      return;
    }
    if (form.periodStart > form.periodEnd) {
      setError(t("errorPeriodOrder"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSave(
        {
          amount,
          period_start: form.periodStart,
          period_end: form.periodEnd,
          product_id: form.productId || null,
          note: form.note,
        },
        form.confirmLocked,
        entry?.id,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mscrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox" role="dialog" aria-modal="true" aria-labelledby="ads-entry-t">
        <div className="dr-h">
          <div>
            <h2 id="ads-entry-t">{entry ? t("titleEdit") : t("titleNew")}</h2>
            {marketLabel && <p>{marketLabel}</p>}
          </div>
          <button type="button" className="dr-x" onClick={onClose} aria-label={t("cancel")}>
            <X className="ic" aria-hidden />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb">
            <div className="row2">
              <label className="fld">
                <span>{t("fieldStart")}</span>
                <input
                  type="date"
                  className="inp"
                  value={form.periodStart}
                  onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                  required
                />
              </label>
              <label className="fld">
                <span>{t("fieldEnd")}</span>
                <input
                  type="date"
                  className="inp"
                  value={form.periodEnd}
                  onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                  required
                />
              </label>
            </div>

            <label className="fld">
              <span>{t("fieldAmount")}</span>
              <span className="sufw">
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="inp"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  required
                />
                {currency && <span className="suf">{currency}</span>}
              </span>
            </label>

            <label className="fld">
              <span>{t("fieldProduct")}</span>
              <select
                className="inp"
                value={form.productId}
                onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              >
                <option value="">{t("productMarketWide")}</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="fld">
              <span>
                {t("fieldNote")} <em>· {t("notePlaceholder")}</em>
              </span>
              <input
                type="text"
                className="inp"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder={t("notePlaceholder")}
              />
            </label>

            {/* Locked-period confirmation */}
            {locked && (
              <>
                <div className="fwarn">
                  <span className="nh"><Lock className="ic" aria-hidden /></span>
                  <b>{t("lockedWarning")}</b>
                </div>
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={form.confirmLocked}
                    onChange={(e) => setForm((f) => ({ ...f, confirmLocked: e.target.checked }))}
                  />
                  {t("lockedConfirm")}
                </label>
              </>
            )}

            {error && <p role="alert" className="ferr">{error}</p>}
          </div>

          <div className="mf">
            <button type="button" className="btn2" onClick={onClose}>
              {t("cancel")}
            </button>
            <button type="submit" className="btn" disabled={submitDisabled}>
              {submitting ? "…" : t("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
