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
import { ShippingPricePreview } from "./ShippingPricePreview";
import { useShippingEyesPrice } from "@/hooks/useShippingEyesPrice";
import { fetcher } from "@/lib/swr-config";

interface DexpressDispatchModalProps {
  orderId: string;
  marketId: string;
  /** total_price from the OMS order — used to display the customer COD total */
  orderTotal: number;
  market: "LY" | "TN";
  onClose: () => void;
  onSuccess: (trackingNumber: string | null) => void;
}

interface CarrierResolution {
  id: string;
  delivery_fee: number;
  is_active: boolean;
}

const initialSelection: DexpressSelection = {
  stateId: null,
  stateName: "",
  placeId: null,
  womenDelivery: false,
};

export function DexpressDispatchModal({
  orderId,
  marketId,
  orderTotal,
  market,
  onClose,
  onSuccess,
}: DexpressDispatchModalProps) {
  const t = useTranslations("dispatch.shippingEyes");
  const panelRef = useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<DexpressSelection>(initialSelection);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: carrierData, isLoading: carrierLoading } = useSWR<{
    carrier: CarrierResolution | null;
  }>(`/api/carriers/active?code=dexpress&market_id=${marketId}`, fetcher, {
    revalidateOnFocus: false,
  });
  const carrier = carrierData?.carrier ?? null;
  const fallbackDeliveryFee = carrier?.delivery_fee ?? 0;

  // Live shipping cost — passed to the adapter via shipping_cost_override
  const { effectiveShippingCost, livePrice } = useShippingEyesPrice({
    stateId: selection.stateId,
    placeId: selection.placeId,
    womenDelivery: selection.womenDelivery,
    fallbackDeliveryFee,
    enabled: carrier?.is_active === true,
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit =
    selection.stateId != null && !submitting && carrier !== null && carrier.is_active;

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
          extra: {
            state_id: selection.stateId,
            place_id: selection.placeId,
            women_delivery: selection.womenDelivery ? 1 : 0,
            shipping_cost_override:
              livePrice !== null ? livePrice : effectiveShippingCost,
          },
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

  const destinationLabel = selection.stateName || "";

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

            <DexpressLocationPicker value={selection} onChange={setSelection} />

            <ShippingPricePreview
              stateId={selection.stateId}
              placeId={selection.placeId}
              womenDelivery={selection.womenDelivery}
              fallbackDeliveryFee={fallbackDeliveryFee}
              orderTotal={orderTotal}
              market={market}
              destinationLabel={destinationLabel || undefined}
            />

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
