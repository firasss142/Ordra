"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import useSWR from "swr";
import { X } from "lucide-react";
import {
  DexpressLocationPicker,
  type DexpressSelection,
} from "./DexpressLocationPicker";
import { fetcher } from "@/lib/swr-config";
import { formatCurrency } from "@/lib/format";

interface DexpressDispatchModalProps {
  orderId: string;
  marketId: string;
  /** total_price from the OMS order — goods-only, customer pays this + delivery_fee */
  orderTotal: number;
  market: "LY" | "TN";
  /** Required by Dexpress. If empty/null, dispatch is blocked. */
  customerAddress: string | null;
  /**
   * Dexpress destination chosen at order-creation time. When set, the picker
   * is skipped and the agent only confirms the price summary.
   */
  presetStateId?: number | null;
  presetStateName?: string | null;
  onClose: () => void;
  onSuccess: (trackingNumber: string | null) => void;
}

interface CarrierResolution {
  id: string;
  delivery_fee: number;
  is_active: boolean;
  /**
   * "1" → customer pays delivery (added to the amount due on delivery).
   * "0" → seller covers delivery (customer pays goods value only).
   * Defaults to "1" when the API doesn't supply it.
   */
  cost_type?: string;
}

const initialSelection: DexpressSelection = {
  stateId: null,
  stateName: "",
};

export function DexpressDispatchModal({
  orderId,
  marketId,
  orderTotal,
  market,
  customerAddress,
  presetStateId,
  presetStateName,
  onClose,
  onSuccess,
}: DexpressDispatchModalProps) {
  const t = useTranslations("dispatch.shippingEyes");
  const hasAddress = Boolean(customerAddress && customerAddress.trim());
  const hasPreset = typeof presetStateId === "number" && presetStateId > 0;
  const panelRef = useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<DexpressSelection>(
    hasPreset
      ? { stateId: presetStateId ?? null, stateName: presetStateName ?? "" }
      : initialSelection,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: carrierData, isLoading: carrierLoading } = useSWR<{
    carrier: CarrierResolution | null;
  }>(`/api/carriers/active?code=dexpress&market_id=${marketId}`, fetcher, {
    revalidateOnFocus: false,
  });
  const carrier = carrierData?.carrier ?? null;
  const deliveryFee = carrier?.delivery_fee ?? 0;
  // cost_type "0" = seller covers delivery, so the customer pays goods only.
  // Anything else (incl. unset) = customer pays goods + delivery.
  const sellerCoversDelivery = carrier?.cost_type === "0";
  const customerTotal = sellerCoversDelivery
    ? orderTotal
    : orderTotal + deliveryFee;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit =
    selection.stateId != null &&
    !submitting &&
    carrier !== null &&
    carrier.is_active &&
    hasAddress;

  async function handleSubmit() {
    if (!canSubmit || !carrier) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier_id: carrier.id,
          extra: { state_id: selection.stateId },
        }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        setError(
          typeof json?.error === "string" ? json.error : t("dispatchFailed")
        );
        return;
      }
      const trackingNumber: string | null =
        typeof json?.data?.tracking_number === "string"
          ? json.data.tracking_number
          : null;
      onSuccess(trackingNumber);
    } catch {
      setError(t("dispatchFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-primary/50"
      onClick={onClose}
    >
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          fallbackFocus: () => panelRef.current ?? document.body,
        }}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[90vh] w-[520px] max-w-[92vw] overflow-y-auto rounded-card bg-surface-card shadow-floating"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line-subtle px-5 py-4">
            <div>
              <div className="text-[16px] font-semibold text-ink-primary">
                {t("modalTitle")}
              </div>
              <div className="mt-0.5 text-[12px] text-ink-secondary">
                {t("modalSubtitle")}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="rounded p-1 text-ink-secondary hover:bg-surface-hover"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4">
            {error && (
              <div
                role="alert"
                className="mb-3 rounded border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
              >
                {error}
              </div>
            )}

            {carrierLoading && (
              <div className="mb-3 text-[13px] text-ink-secondary">
                {t("loadingCarrier")}
              </div>
            )}

            {!carrierLoading && (!carrier || !carrier.is_active) && (
              <div
                role="alert"
                className="mb-3 rounded border border-status-warning/30 bg-status-warningBg px-3 py-2 text-[13px] text-status-warning"
              >
                {t("noActiveCarrier")}
              </div>
            )}

            {!hasAddress && (
              <div
                role="alert"
                className="mb-3 rounded border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
              >
                {t("missingAddress")}
              </div>
            )}

            {hasPreset ? (
              <div className="rounded-card border border-line-subtle bg-surface-card px-4 py-3">
                <div className="text-[12px] uppercase tracking-[0.06em] text-ink-secondary">
                  {t("destinationLabel")}
                </div>
                <div
                  className="mt-1 text-[14px] font-medium text-ink-primary"
                  dir="auto"
                >
                  {presetStateName?.trim() || t("destinationFromOrder")}
                </div>
              </div>
            ) : (
              <DexpressLocationPicker value={selection} onChange={setSelection} />
            )}

            {/* Static price summary — Dexpress has no live pricing. */}
            <div className="mt-4 rounded-card border border-line-subtle bg-surface-card px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink-secondary">
                  {t("goodsValue")}
                </span>
                <span className="text-[13px] text-ink-primary tabular-nums">
                  {formatCurrency(orderTotal, market)}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-ink-secondary">
                  {t("deliveryFee")}
                </span>
                {sellerCoversDelivery ? (
                  <span className="text-[13px] text-ink-secondary">
                    {t("deliveryFeeSellerCovered")}
                  </span>
                ) : (
                  <span className="text-[13px] text-ink-primary tabular-nums">
                    {formatCurrency(deliveryFee, market)}
                  </span>
                )}
              </div>
              <div className="my-3 h-px bg-line-subtle" />
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-ink-secondary">
                  {t("customerTotal")}
                </span>
                <span className="text-[16px] font-medium text-ink-primary tabular-nums">
                  {formatCurrency(customerTotal, market)}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="mt-5 w-full rounded bg-ink-primary px-4 py-2.5 text-[14px] font-medium text-surface-card disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? t("uploading") : t("confirmDispatch")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
