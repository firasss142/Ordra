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
import {
  resolveDarbDestination,
  resolveDispatchPair,
} from "@/lib/carriers/darb-assabil-areas";
import { fetcher } from "@/lib/swr-config";

interface DarbAssabilDispatchModalProps {
  orderId: string;
  marketId: string;
  /** Required by Darb Assabil. If empty/null, dispatch is blocked. */
  customerAddress: string | null;
  /** The order's stored city — used to pre-resolve / scope the destination. */
  customerCity: string | null;
  onClose: () => void;
  onSuccess: (trackingNumber: string | null) => void;
}

interface CarrierResolution {
  id: string;
  is_active: boolean;
}

interface DarbService {
  service_id: string;
  title: string;
  attribute: string;
  surcharge: number;
  currency: string;
  is_default: boolean;
}

/**
 * OrderDetailPanel dispatch modal for Darb Assabil. Mirrors DexpressDispatchModal
 * but collects a destination city/area (sent via `extra.customer_area` + `extra.city`)
 * instead of a state id. No price summary — pricing is goods-only and the carrier
 * fee isn't surfaced here.
 *
 * Destination is resolved from the order's stored city: a single-area city is
 * pre-selected (agent just confirms); a multi-area city (طرابلس) scopes the
 * picker to its areas; an unknown city shows the full list.
 */
export function DarbAssabilDispatchModal({
  orderId,
  marketId,
  customerAddress,
  customerCity,
  onClose,
  onSuccess,
}: DarbAssabilDispatchModalProps) {
  const t = useTranslations("dispatch.darbAssabil");
  const tShip = useTranslations("dispatch.shippingEyes");
  const tDup = useTranslations("duplicateOrder.uploadGuard");
  const hasAddress = Boolean(customerAddress && customerAddress.trim());
  const panelRef = useRef<HTMLDivElement>(null);

  const resolved = resolveDarbDestination(customerCity);
  // Destination mode from the order's city:
  //  - "resolved": single-area known city → fixed, NO picker (agent can't pick
  //    a wrong city). This is the common case and the fix for the الجفرة bug.
  //  - "scoped": multi-area known city (طرابلس) → picker limited to its areas.
  //  - "full": unknown city → full picker.
  const mode: "resolved" | "scoped" | "full" =
    resolved && resolved.areas.length === 1
      ? "resolved"
      : resolved && resolved.areas.length > 1
        ? "scoped"
        : "full";
  const scopeCity = mode === "scoped" ? resolved!.city : undefined;
  const [selection, setSelection] = useState<DarbAssabilSelection>(
    mode === "resolved"
      ? { city: resolved!.city, area: resolved!.areas[0] }
      : { city: null, area: null },
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateConfirm, setDuplicateConfirm] = useState<{
    externalId: string | null;
  } | null>(null);

  // Per-order Darb options, sent via extra on dispatch (default off). Online
  // payment is native to Darb (no 10% surcharge on our side); the others map to
  // per-product flags on the shipment.
  const [options, setOptions] = useState({
    allow_inspection: false,
    is_fragile: false,
    allow_card_payment: false,
    allow_testing: false,
  });

  const { data: carrierData, isLoading: carrierLoading } = useSWR<{
    carrier: CarrierResolution | null;
  }>(`/api/carriers/active?code=darb_assabil&market_id=${marketId}`, fetcher, {
    revalidateOnFocus: false,
  });
  const carrier = carrierData?.carrier ?? null;

  // Darb service packages (توصيل رجالي / نسائي / فوري). The agent picks one per
  // dispatch; the chosen service_id rides extra.service_id (the adapter forwards
  // it as `service`). Default to the catalogue's is_default (men's courier).
  const { data: servicesData } = useSWR<{ services: DarbService[] }>(
    "/api/darb/services",
    fetcher,
    { revalidateOnFocus: false },
  );
  const services = servicesData?.services ?? [];
  const [serviceId, setServiceId] = useState<string | null>(null);
  // Seed the default once the list arrives (don't clobber a manual pick).
  useEffect(() => {
    if (serviceId == null && services.length > 0) {
      setServiceId((services.find((s) => s.is_default) ?? services[0]).service_id);
    }
  }, [services, serviceId]);

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
    // Final guard: the order's city resolution wins over the raw selection, so
    // a mismatched pair can never be dispatched (mirrors the popup path).
    const decision = resolveDispatchPair(customerCity, selection);
    if (decision.kind !== "dispatch") {
      setError(t("noResults"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier_id: carrier.id,
          extra: {
            customer_area: decision.area,
            city: decision.city,
            // Chosen service package; omitted → adapter uses default_service_id.
            ...(serviceId ? { service_id: serviceId } : {}),
            allow_inspection: options.allow_inspection,
            is_fragile: options.is_fragile,
            allow_card_payment: options.allow_card_payment,
            allow_testing: options.allow_testing,
          },
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

            {mode === "resolved" ? (
              // Fixed destination — show it, no free choice of city.
              <div className="rounded-card border border-line-subtle bg-surface-card px-4 py-3">
                <div className="text-[12px] uppercase tracking-[0.06em] text-ink-secondary">
                  {t("destinationLabel")}
                </div>
                <div
                  className="mt-1 text-[14px] font-medium text-ink-primary"
                  dir="auto"
                >
                  {selection.city}
                  {selection.area && selection.area !== selection.city
                    ? ` — ${selection.area}`
                    : ""}
                </div>
                <p className="mt-1 text-[12px] text-ink-secondary">
                  {t("resolvedFromCity")}
                </p>
              </div>
            ) : (
              <DarbAssabilLocationPicker
                value={selection}
                onChange={setSelection}
                restrictToCity={scopeCity}
              />
            )}

            {/* Service package picker (توصيل رجالي / نسائي / فوري). */}
            <fieldset className="mt-4 rounded-card border border-line-subtle px-4 py-3">
              <legend className="px-1 text-[12px] uppercase tracking-[0.06em] text-ink-secondary">
                {t("serviceLabel")}
              </legend>
              {services.length === 0 ? (
                <div className="mt-1 text-[12px] text-ink-secondary">
                  {t("loadingServices")}
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-2">
                  {services.map((s) => {
                    const active = s.service_id === serviceId;
                    return (
                      <button
                        key={s.service_id}
                        type="button"
                        onClick={() => setServiceId(s.service_id)}
                        aria-pressed={active}
                        className={`flex flex-col items-start rounded-card border px-3 py-2 text-start transition-colors duration-fast ${
                          active
                            ? "border-ink-primary bg-surface-hover"
                            : "border-line-subtle hover:bg-surface-hover"
                        }`}
                      >
                        <span className="text-[13px] font-medium text-ink-primary" dir="auto">
                          {s.title}
                        </span>
                        {s.surcharge > 0 && (
                          <span className="text-[11px] font-semibold text-ink-muted tabular-nums">
                            {t("serviceSurcharge", {
                              amount: s.surcharge,
                              currency: s.currency.toUpperCase(),
                            })}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {/* Per-order Darb options (inspection / fragile / online card / testing). */}
            <fieldset className="mt-4 rounded-card border border-line-subtle px-4 py-3">
              <legend className="px-1 text-[12px] uppercase tracking-[0.06em] text-ink-secondary">
                {t("optionsLabel")}
              </legend>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(
                  [
                    ["allow_inspection", t("optionInspection")],
                    ["is_fragile", t("optionFragile")],
                    ["allow_card_payment", t("optionCardPayment")],
                    ["allow_testing", t("optionTesting")],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-[13px] text-ink-primary"
                  >
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={(e) =>
                        setOptions((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                      className="h-4 w-4 shrink-0 accent-ink-primary"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
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
