"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import { useShippingEyesPrice } from "@/hooks/useShippingEyesPrice";

interface ShippingPricePreviewProps {
  stateId: number | null;
  placeId: number | null;
  womenDelivery: boolean;
  /** Static delivery_fee from carriers row — used in fallback/error states */
  fallbackDeliveryFee: number;
  /** Order total (revenue) from the OMS order; we add the live shipping cost to display COD total */
  orderTotal: number;
  /** Locale-driven currency code (LY for Libyan dispatches) */
  market: "LY" | "TN";
  /** Display label for the selected destination, e.g. "Tripoli · Tajoura" */
  destinationLabel?: string;
}

export function ShippingPricePreview({
  stateId,
  placeId,
  womenDelivery,
  fallbackDeliveryFee,
  orderTotal,
  market,
  destinationLabel,
}: ShippingPricePreviewProps) {
  const t = useTranslations("dispatch.shippingEyes");

  const { effectiveShippingCost, livePrice, status, errorMessage } =
    useShippingEyesPrice({
      stateId,
      placeId,
      womenDelivery,
      fallbackDeliveryFee,
    });

  if (status === "idle") return null;

  const customerTotal = orderTotal + effectiveShippingCost;
  const showSkeleton = status === "loading" && livePrice === null;

  const caption =
    status === "loading"
      ? t("loading")
      : status === "ready"
        ? destinationLabel
          ? t("tariffFor", { place: destinationLabel })
          : t("live")
        : status === "fallback"
          ? t("standardRate")
          : t("estimationUnavailable");
  void errorMessage;

  return (
    <div
      className="mt-4 rounded-card border border-line-subtle bg-surface-card px-4 py-3"
      role="status"
      aria-live="polite"
    >
      {/* Row 1 — Shipping cost */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-ink-secondary">
          {t("deliveryFee")}
        </span>
        {showSkeleton ? (
          <span
            className="inline-block h-[18px] w-24 animate-pulse rounded bg-surface-hover"
            aria-hidden="true"
          />
        ) : (
          <span className="text-[18px] font-medium text-ink-primary tabular-nums">
            {formatCurrency(effectiveShippingCost, market)}
          </span>
        )}
      </div>

      {/* Divider */}
      <div className="my-3 h-px bg-line-subtle" />

      {/* Row 2 — Customer total */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-ink-secondary">
          {t("customerTotal")}
        </span>
        {showSkeleton ? (
          <span
            className="inline-block h-[16px] w-28 animate-pulse rounded bg-surface-hover"
            aria-hidden="true"
          />
        ) : (
          <span className="text-[14px] text-ink-primary tabular-nums">
            {formatCurrency(customerTotal, market)}
          </span>
        )}
      </div>

      {/* Caption */}
      <div className="mt-3 flex items-center gap-2 text-[12px] text-ink-secondary">
        {status === "ready" && (
          <span
            className="inline-block h-[6px] w-[6px] rounded-full bg-status-success"
            aria-hidden="true"
          />
        )}
        <span>{caption}</span>
      </div>
    </div>
  );
}
