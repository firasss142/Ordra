"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import useSWR from "swr";
import { X } from "lucide-react";
import {
  DarbAssabilLocationPicker,
  type DarbAssabilSelection,
} from "./DarbAssabilLocationPicker";
import { fetcher } from "@/lib/swr-config";

interface DarbAssabilDispatchModalProps {
  orderId: string;
  marketId: string;
  /** Required by Darb Assabil. If empty/null, dispatch is blocked. */
  customerAddress: string | null;
  onClose: () => void;
  onSuccess: (trackingNumber: string | null) => void;
}

interface CarrierResolution {
  id: string;
  is_active: boolean;
}

const initialSelection: DarbAssabilSelection = { city: null, area: null };

/**
 * OrderDetailPanel dispatch modal for Darb Assabil. Mirrors DexpressDispatchModal
 * but collects a destination city/area (sent via `extra.customer_area` + `extra.city`)
 * instead of a state id. No price summary — pricing is goods-only and the carrier
 * fee isn't surfaced here.
 */
export function DarbAssabilDispatchModal({
  orderId,
  marketId,
  customerAddress,
  onClose,
  onSuccess,
}: DarbAssabilDispatchModalProps) {
  const t = useTranslations("dispatch.darbAssabil");
  const tShip = useTranslations("dispatch.shippingEyes");
  const tDup = useTranslations("duplicateOrder.uploadGuard");
  const hasAddress = Boolean(customerAddress && customerAddress.trim());
  const panelRef = useRef<HTMLDivElement>(null);

  const [selection, setSelection] = useState<DarbAssabilSelection>(initialSelection);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState<{
    externalId: string | null;
  } | null>(null);

  const { data: carrierData, isLoading: carrierLoading } = useSWR<{
    carrier: CarrierResolution | null;
  }>(`/api/carriers/active?code=darb_assabil&market_id=${marketId}`, fetcher, {
    revalidateOnFocus: false,
  });
  const carrier = carrierData?.carrier ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const canSubmit =
    selection.area != null &&
    selection.city != null &&
    !submitting &&
    carrier !== null &&
    carrier.is_active &&
    hasAddress;

  async function handleSubmit(confirmDuplicate = false) {
    if (!carrier) return;
    if (!confirmDuplicate && !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier_id: carrier.id,
          extra: { customer_area: selection.area, city: selection.city },
          ...(confirmDuplicate ? { confirm_duplicate: true } : {}),
        }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.status === 409 && json?.needsConfirmation) {
        setDuplicateConfirm({ externalId: json?.duplicate?.external_id ?? null });
        return;
      }
      if (!res.ok) {
        setError(
          typeof json?.error === "string" ? json.error : tShip("dispatchFailed")
        );
        return;
      }
      const trackingNumber: string | null =
        typeof json?.data?.tracking_number === "string"
          ? json.data.tracking_number
          : null;
      setDuplicateConfirm(null);
      onSuccess(trackingNumber);
    } catch {
      setError(tShip("dispatchFailed"));
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
          className="flex max-h-[90dvh] w-[520px] max-w-[92vw] flex-col rounded-card bg-surface-card shadow-floating"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-line-subtle px-5 py-4">
            <div className="text-[16px] font-semibold text-ink-primary">
              {t("pickDestination")}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tShip("close")}
              className="rounded p-1 text-ink-secondary hover:bg-surface-hover"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
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
                {tShip("loadingCarrier")}
              </div>
            )}

            {!carrierLoading && (!carrier || !carrier.is_active) && (
              <div
                role="alert"
                className="mb-3 rounded border border-status-warning/30 bg-status-warningBg px-3 py-2 text-[13px] text-status-warning"
              >
                {tShip("noActiveCarrier")}
              </div>
            )}

            {!hasAddress && (
              <div
                role="alert"
                className="mb-3 rounded border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
              >
                {tShip("missingAddress")}
              </div>
            )}

            <DarbAssabilLocationPicker value={selection} onChange={setSelection} />
          </div>

          <div className="shrink-0 border-t border-line-subtle px-5 py-4">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => handleSubmit()}
              className="w-full rounded bg-ink-primary px-4 py-2.5 text-[14px] font-medium text-surface-card disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? tShip("uploading") : tShip("confirmDispatch")}
            </button>
          </div>

          {duplicateConfirm && (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
              role="dialog"
              aria-modal="true"
              onClick={(e) => {
                e.stopPropagation();
                setDuplicateConfirm(null);
              }}
            >
              <div
                className="w-full max-w-sm rounded-lg border border-line-subtle bg-surface-card p-5 shadow-floating"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="mb-2 text-[15px] font-semibold text-status-warning">
                  {tDup("title")}
                </h2>
                <p className="mb-4 text-[13.5px] leading-relaxed text-ink-secondary">
                  {tDup("body", { externalId: duplicateConfirm.externalId ?? "—" })}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex flex-1 items-center justify-center rounded-md border border-line-strong bg-surface-card px-4 py-2.5 text-[14px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-hover"
                    onClick={() => setDuplicateConfirm(null)}
                  >
                    {tDup("cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    className="inline-flex flex-1 items-center justify-center rounded-md bg-ink-primary px-4 py-2.5 text-[14px] font-medium text-surface-card disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      setDuplicateConfirm(null);
                      handleSubmit(true);
                    }}
                  >
                    {submitting ? tShip("uploading") : tDup("confirm")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </FocusTrap>
    </div>
  );
}
