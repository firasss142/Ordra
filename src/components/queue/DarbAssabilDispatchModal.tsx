"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import useSWR from "swr";
import { Check, X, Lock, Truck, ArrowRight } from "lucide-react";
import { DarbDestinationPicker } from "@/components/shared/DarbDestinationPicker";
import { useDarbDestinations } from "@/hooks/useDarbDestinations";
import { findDestinationById } from "@/lib/carriers/darb-destination-search";
import {
  resolveDarbAny,
  resolveDispatchPair,
} from "@/lib/carriers/darb-assabil-areas";
import { fetcher } from "@/lib/swr-config";
import { useCarrierRates } from "@/hooks/useCarrierRates";
import { destinationKey } from "@/lib/carriers/destination-key";
import { formatCurrency } from "@/lib/format";

interface DarbAssabilSelection {
  city: string | null;
  area: string | null;
}

interface DarbAssabilDispatchModalProps {
  orderId: string;
  /**
   * The Darb Assabil carrier account the agent picked. Dispatch targets this
   * exact id, so the right account is used when a market has more than one.
   */
  carrierId: string;
  /** Required by Darb Assabil. If empty/null, dispatch is blocked. */
  customerAddress: string | null;
  /** The order's stored city — used to pre-resolve / scope the destination. */
  customerCity: string | null;
  /**
   * The order's goods total (COD amount), for the "à encaisser" summary row.
   * Optional — omitted callers simply don't get that row (backward compatible).
   */
  totalPrice?: number | null;
  /**
   * The Darb pair the order is already bound to (`orders.darb_destination_id`).
   * When set, it IS the destination — the agent picked it at creation or in
   * the detail panel and is not asked again.
   */
  darbDestinationId?: number | null;
  onClose: () => void;
  onSuccess: (trackingNumber: string | null) => void;
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
 * One labelled block of the dispatch form.
 *
 * Sections are separated by a hairline rather than each being its own bordered
 * card: the form is a single sequence of decisions, and nesting cards inside a
 * card gave four equal-weight boxes with no reading order.
 */
function Section({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section
      className={`px-5 py-4 ${last ? "" : "border-b border-line-subtle"}`}
    >
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {label}
      </h3>
      {children}
    </section>
  );
}

/**
 * A tile in an exclusive choice. Selection is carried by border + fill + an
 * explicit check — never fill alone, which read as "slightly grey" at a glance
 * and left agents unsure what was actually selected.
 */
function ChoiceTile({
  selected,
  disabled = false,
  title,
  hint,
  badge,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  hint?: string;
  /** Small pill under the title — the service surcharge, or "inclus". */
  badge?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-[56px] w-full items-start gap-2.5 rounded-xl border px-3 py-3 text-start transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dispatch-ok focus-visible:ring-offset-1 ${
        selected
          ? "border-dispatch-ok bg-dispatch-ok-tint"
          : "border-line-subtle hover:border-line-strong hover:bg-surface-hover"
      } ${disabled ? "cursor-not-allowed opacity-55 hover:border-line-subtle hover:bg-transparent" : ""}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          selected
            ? "border-dispatch-ok bg-dispatch-ok text-white"
            : "border-line-strong"
        }`}
      >
        {selected && <Check size={11} strokeWidth={3.5} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink-primary" dir="auto">
          {title}
        </span>
        {hint && (
          <span className="mt-1 block text-[12px] leading-[1.35] text-ink-secondary" dir="auto">
            {hint}
          </span>
        )}
        {badge && (
          <span className="mt-1.5 inline-block rounded-md bg-surface-sunken px-2 py-0.5 text-[12px] font-medium text-ink-secondary">
            {badge}
          </span>
        )}
      </span>
    </button>
  );
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
  carrierId,
  customerAddress,
  customerCity,
  totalPrice = null,
  darbDestinationId = null,
  onClose,
  onSuccess,
}: DarbAssabilDispatchModalProps) {
  const t = useTranslations("dispatch.darbAssabil");
  const tShip = useTranslations("dispatch.shippingEyes");
  const tDup = useTranslations("duplicateOrder.uploadGuard");
  const hasAddress = Boolean(customerAddress && customerAddress.trim());
  const panelRef = useRef<HTMLDivElement>(null);

  // Delivery fee for the summary bar — same per-destination quote the other
  // carrier pickers use. Fails soft: no quote yet just means no figure shown.
  const { ratesByCarrierId } = useCarrierRates(
    orderId,
    true,
    destinationKey({ darb_destination_id: darbDestinationId, customer_city: customerCity }),
  );
  const deliveryFee = ratesByCarrierId[carrierId]?.quotedFee ?? null;

  // The bound pair wins outright: it is what the agent chose from the
  // catalogue. Only an unbound order falls back to resolving its city string
  // the way intake/coverage do (exact city → area name → alias), so an
  // area-named city (شحات) or umbrella label (ضواحي طرابلس) still pre-resolves
  // instead of dropping to the full picker.
  const { destinations } = useDarbDestinations();
  const stored = findDestinationById(destinations, darbDestinationId);
  const resolved = stored
    ? { city: stored.city, area: stored.area }
    : resolveDarbAny(customerCity);
  // Destination mode:
  //  - "resolved": an exact (city, area) pair — bound, single-area city, or an
  //    area name → fixed, NO picker (agent can't pick a wrong city).
  //  - "scoped": multi-area city (طرابلس) → picker limited to its zones.
  //  - "full": unresolved → full picker.
  const mode: "resolved" | "scoped" | "full" =
    resolved && resolved.area != null
      ? "resolved"
      : resolved
        ? "scoped"
        : "full";
  const scopeCity = mode === "scoped" ? resolved!.city : undefined;
  const [selection, setSelection] = useState<DarbAssabilSelection>(
    mode === "resolved"
      ? { city: resolved!.city, area: resolved!.area }
      : { city: null, area: null },
  );
  // The catalogue may arrive a beat after mount; adopt the bound pair then.
  useEffect(() => {
    if (stored) setSelection({ city: stored.city, area: stored.area });
  }, [stored?.city, stored?.area]); // eslint-disable-line react-hooks/exhaustive-deps
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "corriger" on a resolved destination: unlocks the picker for this dispatch
  // only. One-way — re-locking would just hide a correction the agent made.
  const [overrideDestination, setOverrideDestination] = useState(false);
  const [duplicateConfirm, setDuplicateConfirm] = useState<{
    externalId: string | null;
  } | null>(null);

  // Per-order Darb options, sent via extra on dispatch. Online payment is
  // native to Darb (no 10% surcharge on our side); inspection/fragile/testing
  // map to per-product flags on the shipment. Pickup defaults ON — Darb
  // collecting from our own warehouse is the normal case — and only applies
  // in "home" fulfilment (Entrepôt Darb Assabil always forces its own
  // pickup server-side, so the checkbox is hidden there, not just default).
  // Replacement defaults off like the other optional flags.
  const [options, setOptions] = useState({
    is_pickup: true,
    allow_inspection: false,
    is_fragile: false,
    allow_card_payment: false,
    allow_testing: false,
    is_replacement: false,
  });

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
  // A paid service (surcharge > 0 → women's/express) has its fees billed to the
  // customer on top of the COD (adapter paymentBy="receiver"); the free default
  // does not. Drives extra.service_fee_on_top below.
  const serviceSurcharge =
    services.find((s) => s.service_id === serviceId)?.surcharge ?? 0;
  const chosenServiceFeeOnTop = serviceSurcharge > 0;

  // Fulfilment source. "home" = we hold the goods and Darb collects from us
  // (the long-standing default). "carrier" = Darb already holds this stock in
  // their own warehouse and picks it themselves — they force isPickup, so there
  // is deliberately no pickup control here.
  const [fulfilment, setFulfilment] = useState<"home" | "carrier">("home");

  // Can this order be fulfilled from Darb's warehouse? Every line must map to
  // carrier-side stock and they must hold enough right now. Server re-checks
  // authoritatively at upload; this is the agent-facing preview.
  const { data: availability, isLoading: availabilityLoading } = useSWR<{
    available: boolean;
    reason: string | null;
    lines: {
      product_name: string;
      sku: string | null;
      requested: number;
      available: number;
      sufficient: boolean;
    }[];
  }>(
    `/api/orders/${orderId}/warehouse-availability?carrier_id=${carrierId}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const warehouseAvailable = availability?.available === true;

  // Never leave the agent on an option that has become impossible.
  useEffect(() => {
    if (fulfilment === "carrier" && availability && !warehouseAvailable) {
      setFulfilment("home");
    }
  }, [fulfilment, availability, warehouseAvailable]);

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
    hasAddress;

  async function handleSubmit(confirmDuplicate = false) {
    if (!confirmDuplicate && !canSubmit) return;
    // Final guard: a bound pair ships as is; otherwise the order's city
    // resolution wins over the raw selection, so a mismatched pair can never
    // be dispatched (mirrors the popup path).
    const decision = stored
      ? { kind: "dispatch" as const, city: stored.city, area: stored.area }
      : resolveDispatchPair(customerCity, selection);
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
          carrier_id: carrierId,
          extra: {
            customer_area: decision.area,
            city: decision.city,
            // Chosen service package; omitted → adapter uses default_service_id.
            ...(serviceId ? { service_id: serviceId } : {}),
            // A paid special service (women's/express, surcharge > 0) bills its
            // fees to the customer on top of the COD; the free default does not.
            service_fee_on_top: chosenServiceFeeOnTop,
            // Pickup only makes sense in home mode (Darb collecting from us);
            // their own warehouse mode forces it server-side regardless, so
            // send the plain default there rather than a hidden checkbox's
            // stale value.
            is_pickup: fulfilment === "home" ? options.is_pickup : true,
            allow_inspection: options.allow_inspection,
            is_fragile: options.is_fragile,
            allow_card_payment: options.allow_card_payment,
            allow_testing: options.allow_testing,
            is_replacement: options.is_replacement,
            // Carrier-warehouse fulfilment. Sent only when chosen AND still
            // available; the server resolves the carrier-side product ids and
            // re-checks stock, refusing the dispatch on any gap.
            ...(fulfilment === "carrier" && warehouseAvailable
              ? { fulfil_from_carrier_warehouse: true }
              : {}),
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
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-5 py-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="text-[19px] font-bold tracking-[-0.01em] text-ink-primary">
                {t("pickDestinationShort")}
              </div>
              {/* Carrier identity as a pill — the modal is carrier-specific, and
                  the name belongs beside the action, not folded into the title. */}
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-dispatch-ok-bg px-2.5 py-1 text-[12px] font-semibold text-dispatch-ok-ink">
                <Truck size={13} strokeWidth={2.25} aria-hidden="true" />
                {t("carrierName")}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tShip("close")}
              className="shrink-0 rounded p-1 text-ink-secondary hover:bg-surface-hover"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {(error || !hasAddress) && (
              <div className="space-y-2 px-5 pt-4">
                {error && (
                  <div
                    role="alert"
                    className="rounded-card border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
                  >
                    {error}
                  </div>
                )}
                {!hasAddress && (
                  <div
                    role="alert"
                    className="rounded-card border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
                  >
                    {tShip("missingAddress")}
                  </div>
                )}
              </div>
            )}

            <Section label={t("destinationLabel")}>
              {mode === "resolved" && !overrideDestination ? (
                // Fixed destination: a locked field, not free text — the pair
                // came from the order's city and changing it is a deliberate
                // act, so it takes an explicit "corriger" to unlock the picker.
                <>
                  <div className="flex items-center gap-3 rounded-card bg-surface-sunken px-3.5 py-3">
                    <Lock
                      size={15}
                      strokeWidth={2}
                      aria-hidden="true"
                      className="shrink-0 text-ink-muted"
                    />
                    <p
                      className="min-w-0 flex-1 truncate text-end text-[16px] font-medium text-ink-primary"
                      dir="auto"
                    >
                      {selection.city}
                      {selection.area && selection.area !== selection.city
                        ? ` — ${selection.area}`
                        : ""}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between gap-3">
                    <p className="text-[12px] text-ink-secondary">
                      {t("resolvedFromCity")}
                    </p>
                    <button
                      type="button"
                      onClick={() => setOverrideDestination(true)}
                      className="shrink-0 text-[12px] font-medium text-dispatch-ok-ink underline underline-offset-2 hover:text-dispatch-ok-hover"
                    >
                      {t("correctDestination")}
                    </button>
                  </div>
                </>
              ) : (
                <DarbDestinationPicker
                  variant="inline"
                  destinations={destinations}
                  value={
                    selection.city && selection.area
                      ? { city: selection.city, area: selection.area }
                      : null
                  }
                  scopeCity={scopeCity}
                  onSelect={(opt) => setSelection({ city: opt.city, area: opt.area })}
                />
              )}
            </Section>

            {/* Fulfilment source: our warehouse (default) vs Darb's own. */}
            <Section label={t("fulfilmentLabel")}>
              <div
                role="radiogroup"
                aria-label={t("fulfilmentLabel")}
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <ChoiceTile
                  selected={fulfilment === "home"}
                  title={t("fulfilmentHome")}
                  hint={t("fulfilmentHomeHint")}
                  onSelect={() => setFulfilment("home")}
                />
                <ChoiceTile
                  selected={fulfilment === "carrier"}
                  disabled={!warehouseAvailable}
                  title={t("fulfilmentCarrier")}
                  hint={
                    availabilityLoading
                      ? t("fulfilmentChecking")
                      : t("fulfilmentCarrierHint")
                  }
                  onSelect={() => warehouseAvailable && setFulfilment("carrier")}
                />
              </div>

              {/* Why it is unavailable — never hide the reason from the agent.
                  Covers the check failing outright too: the SWR fetcher throws
                  on a non-2xx, leaving `availability` undefined, and without
                  this the tile would sit dead with no explanation. */}
              {!availabilityLoading && !warehouseAvailable && (
                <p className="mt-2 text-[12px] text-ink-secondary" dir="auto">
                  {availability?.reason ?? t("fulfilmentUnavailable")}
                </p>
              )}

              {/* Consequences of the carrier-warehouse choice, in a sunken well
                  so they read as detail attached to the selection rather than
                  as another peer section. Pickup is not a choice here: Darb
                  forces isPickup when fulfilling from a warehouse of theirs. */}
              {fulfilment === "carrier" && warehouseAvailable && (
                <div className="mt-2 rounded-card bg-surface-sunken px-3 py-2.5">
                  {availability?.lines?.length ? (
                    <ul className="space-y-1">
                      {availability.lines.map((line, i) => (
                        // dir="auto" belongs on the product name alone. On the
                        // row it made the first strong character (Arabic) flip
                        // the whole line, reordering the counts into
                        // "demandé(s) · 29 disponible(s) 1".
                        <li
                          key={`${line.sku ?? line.product_name}-${i}`}
                          className="flex items-center justify-between gap-3 text-[12px]"
                        >
                          <span className="truncate text-ink-primary" dir="auto">
                            {line.sku ?? line.product_name}
                          </span>
                          <span className="shrink-0 whitespace-nowrap tabular-nums text-ink-secondary">
                            {t("fulfilmentStock", {
                              requested: line.requested,
                              available: line.available,
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p
                    className={`text-[12px] leading-5 text-ink-secondary ${
                      availability?.lines?.length
                        ? "mt-2 border-t border-line-subtle pt-2"
                        : ""
                    }`}
                    dir="auto"
                  >
                    {t("fulfilmentCarrierPickupNote")}
                  </p>
                </div>
              )}
            </Section>

            {/* Service package picker (توصيل رجالي / نسائي / فوري). */}
            <Section label={t("serviceLabel")}>
              {services.length === 0 ? (
                <p className="text-[12px] text-ink-secondary">
                  {t("loadingServices")}
                </p>
              ) : (
                <div
                  role="radiogroup"
                  aria-label={t("serviceLabel")}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                >
                  {services.map((s) => (
                    <ChoiceTile
                      key={s.service_id}
                      selected={s.service_id === serviceId}
                      title={s.title}
                      // A surcharge is the price of the choice; the free default
                      // says so explicitly ("inclus") rather than staying blank,
                      // which read as "price unknown".
                      badge={
                        s.surcharge > 0
                          ? t("serviceSurcharge", {
                              amount: s.surcharge,
                              currency: s.currency.toUpperCase(),
                            })
                          : t("serviceIncluded")
                      }
                      onSelect={() => setServiceId(s.service_id)}
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* Per-order Darb options (pickup / inspection / fragile / online
                card / testing / replacement). Pickup is home-mode only: Darb's
                own warehouse mode forces its own pickup server-side, so
                showing the checkbox there would offer a choice that isn't
                one. */}
            <Section label={t("optionsLabel")} last>
              <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
                {(
                  [
                    ...(fulfilment === "home"
                      ? ([["is_pickup", t("optionPickup"), null]] as const)
                      : []),
                    ["allow_inspection", t("optionInspection"), t("optionReturnRiskHint")],
                    ["is_fragile", t("optionFragile"), null],
                    ["allow_card_payment", t("optionCardPayment"), null],
                    ["allow_testing", t("optionTesting"), t("optionReturnRiskHint")],
                    ["is_replacement", t("optionReplacement"), null],
                  ] as const
                ).map(([key, label, riskHint]) => (
                  <label
                    key={key}
                    className="group flex min-h-[40px] cursor-pointer items-start gap-3 text-[14px] text-ink-primary"
                  >
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={(e) =>
                        setOptions((prev) => ({ ...prev, [key]: e.target.checked }))
                      }
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded-[5px] accent-dispatch-ok"
                    />
                    <span>
                      <span className="block leading-snug" dir="auto">{label}</span>
                      {riskHint && (
                        <span
                          className="mt-1 block text-[12px] leading-4 text-status-warning"
                          dir="auto"
                        >
                          → {riskHint}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </Section>
          </div>

          {/* Frais de livraison + à encaisser (COD), so the agent sees the
              full money picture before confirming the send. The fee reads as
              an equation (base + service = total) because the service tile
              above can add a surcharge the agent just chose. */}
          <div className="shrink-0 border-t border-line-subtle bg-surface-card px-5 pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                  {t("feeLabel")}
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[19px] font-bold text-ink-primary">
                  {deliveryFee != null ? (
                    <>
                      <span className="tabular-nums">{formatCurrency(deliveryFee, "LY")}</span>
                      <span className="text-[15px] font-medium text-ink-secondary">+</span>
                      <span className="tabular-nums text-[15px] font-medium text-ink-secondary">
                        {formatCurrency(serviceSurcharge, "LY")}
                      </span>
                      <span className="text-[15px] font-medium text-ink-secondary">=</span>
                      <span className="tabular-nums text-dispatch-ok">
                        {formatCurrency(deliveryFee + serviceSurcharge, "LY")}
                      </span>
                    </>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </div>
              </div>
              {totalPrice != null && (
                <div className="shrink-0 text-end">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                    {t("codLabel")}
                  </div>
                  <div className="mt-1 text-[19px] font-bold tabular-nums text-ink-primary">
                    {formatCurrency(totalPrice, "LY")}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 bg-surface-card px-5 pb-5 pt-4">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => handleSubmit()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-dispatch-ok px-4 py-3.5 text-[15px] font-semibold text-white transition-colors duration-fast hover:bg-dispatch-ok-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dispatch-ok focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? tShip("uploading") : tShip("confirmDispatch")}
              {!submitting && (
                <ArrowRight
                  size={16}
                  strokeWidth={2.25}
                  aria-hidden="true"
                  className="rtl:-scale-x-100"
                />
              )}
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
