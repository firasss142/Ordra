"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { AlertTriangle, Merge } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { RelatedOrderCard } from "@/components/shared/RelatedOrderCard";
import {
  previewMergeTotal,
  shouldApplyCardSurcharge,
  type AddressChoice,
} from "@/lib/orders/merge";

export interface MergeCandidate {
  id: string;
  external_id: string | null;
  status: string;
  created_at: string;
  product_id: string | null;
  product_name: string | null;
  product_image_url: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  delivery_fee: number;
  customer_name: string | null;
  customer_address: string | null;
  customer_city: string | null;
  address_matches: boolean;
  city_matches: boolean;
}

export interface MergeSurvivor {
  id: string;
  external_id: string | null;
  customer_address: string | null;
  customer_city: string | null;
  delivery_fee: number;
  card_payment: boolean;
  dexpress_state_id: number | null;
  market_code: string;
  items: { quantity: number; unit_price: number }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  survivor: MergeSurvivor;
  locale: string;
  currencyCode: string;
  onMerged: () => void;
}

/**
 * Combining two orders of the same customer into one parcel.
 *
 * The panel exists mostly to ask one question properly. Of 187 real merge
 * candidates measured in Libya, 96 had a different delivery address and 65 a
 * different city — so when the two orders disagree, both addresses are shown in
 * full, nothing is preselected, and the confirm button stays disabled until the
 * agent says which one the parcel follows. The server refuses too.
 */
export function MergeOrderPanel({
  open,
  onClose,
  survivor,
  locale,
  currencyCode,
  onMerged,
}: Props) {
  const t = useTranslations("orderMerge");
  const tStatuses = useTranslations("orders.statuses");

  const { data } = useSWR<{
    data: { enabled: boolean; window_hours: number; candidates: MergeCandidate[] };
  }>(open ? `/api/orders/${survivor.id}/merge-candidates` : null, fetcher, {
    revalidateOnFocus: false,
  });

  const [picked, setPicked] = useState<MergeCandidate | null>(null);
  const [choice, setChoice] = useState<AddressChoice>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = data?.data.enabled ?? false;
  const windowHours = data?.data.window_hours ?? 0;
  const candidates = useMemo(() => data?.data.candidates ?? [], [data]);

  const addressesAgree = picked
    ? picked.address_matches && picked.city_matches
    : true;
  const needsChoice = !addressesAgree && choice === null;

  const preview = useMemo(() => {
    if (!picked) return null;
    return previewMergeTotal({
      survivorLines: survivor.items,
      absorbedLines: [{ quantity: picked.quantity, unit_price: picked.unit_price }],
      deliveryFee: survivor.delivery_fee,
      cardPayment: survivor.card_payment,
      applyCardSurcharge: shouldApplyCardSurcharge({
        marketCode: survivor.market_code,
        dexpressStateId: survivor.dexpress_state_id,
      }),
    });
  }, [picked, survivor]);

  const reset = () => {
    setPicked(null);
    setChoice(null);
    setError(null);
  };

  const run = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${survivor.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          absorbed_id: picked.id,
          ...(choice ? { address_choice: choice } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json?.reason === "status_not_mergeable"
            ? t("errorStatus")
            : json?.reason === "phone_mismatch"
              ? t("errorPhone")
              : json?.reason === "outside_window"
                ? t("errorWindow")
                : json?.code === "locked"
                  ? t("errorLocked")
                  : t("errorGeneric"),
        );
        return;
      }
      reset();
      onMerged();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} placement="center" ariaLabel={t("title")}>
      <div className="flex max-h-[85vh] flex-col">
        <header className="border-b border-oms-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold text-oms-ink-1">
            <Merge size={16} strokeWidth={2.25} aria-hidden="true" />
            {t("title")}
          </h2>
          <p className="mt-1 text-[13px] text-oms-ink-2">{t("subtitle")}</p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!enabled && data && (
            <p className="text-[13px] text-oms-ink-2">{t("disabled")}</p>
          )}

          {enabled && candidates.length === 0 && (
            <p className="text-[13px] text-oms-ink-2">
              {t("noCandidates", { hours: windowHours })}
            </p>
          )}

          {/* Step 1 — which order to absorb. */}
          {enabled && !picked && candidates.length > 0 && (
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li key={c.id}>
                  <RelatedOrderCard
                    id={c.id}
                    status={c.status}
                    statusLabel={tStatuses(c.status as Parameters<typeof tStatuses>[0])}
                    createdAt={c.created_at}
                    totalPrice={c.total_price}
                    currencyCode={currencyCode}
                    locale={locale}
                    customerName={c.customer_name}
                    customerAddress={c.customer_address}
                    customerCity={c.customer_city}
                    productName={c.product_name}
                    productImageUrl={c.product_image_url}
                    rightSlot={
                      <button
                        type="button"
                        onClick={() => setPicked(c)}
                        className="rounded-md bg-brand px-2.5 py-1 text-[12px] font-semibold text-white hover:opacity-90"
                      >
                        {t("mergeCta")}
                      </button>
                    }
                  />
                </li>
              ))}
            </ul>
          )}

          {/* Step 2 — confirm, and settle the address. */}
          {picked && (
            <div className="space-y-4">
              {!addressesAgree && (
                <div className="flex items-start gap-2 rounded-lg bg-oms-warn-bg px-3 py-2">
                  <AlertTriangle
                    size={14}
                    strokeWidth={2.25}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-oms-warn-ink"
                  />
                  <p className="text-[12.5px] text-oms-warn-ink">{t("addressDiffer")}</p>
                </div>
              )}

              <section>
                <h3 className="mb-2 text-[13px] font-semibold text-oms-ink-1">
                  {t("addressTitle")}
                </h3>
                {addressesAgree ? (
                  <p dir="auto" className="text-[13px] text-oms-ink-2">
                    {[survivor.customer_address, survivor.customer_city]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {/* Both addresses in full — never truncated. The agent is
                        deciding where a real parcel goes. */}
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-oms-border p-2.5">
                      <input
                        type="radio"
                        name="merge-address"
                        className="mt-0.5 accent-brand"
                        aria-label={t("addressUseSurvivor")}
                        checked={choice === "survivor"}
                        onChange={() => setChoice("survivor")}
                      />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-oms-ink-1">
                          {t("survivor")}
                        </span>
                        <span dir="auto" className="block text-[12.5px] text-oms-ink-2">
                          {[survivor.customer_address, survivor.customer_city]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-oms-border p-2.5">
                      <input
                        type="radio"
                        name="merge-address"
                        className="mt-0.5 accent-brand"
                        aria-label={t("addressUseAbsorbed")}
                        checked={choice === "absorbed"}
                        onChange={() => setChoice("absorbed")}
                      />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold text-oms-ink-1">
                          {t("absorbed")}
                        </span>
                        <span dir="auto" className="block text-[12.5px] text-oms-ink-2">
                          {[picked.customer_address, picked.customer_city]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </section>

              {/* The merged receipt: one fee, one total. */}
              {preview && (
                <section className="rounded-lg border border-oms-border p-3">
                  <h3 className="mb-2 text-[13px] font-semibold text-oms-ink-1">
                    {t("previewTitle")}
                  </h3>
                  <dl className="space-y-1 text-[12.5px]">
                    <div className="flex justify-between">
                      <dt className="text-oms-ink-2">{t("subtotal")}</dt>
                      <dd className="tabular-nums text-oms-ink-1">
                        {preview.subtotal.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-oms-ink-2">{t("deliveryFee")}</dt>
                      <dd className="tabular-nums text-oms-ink-1">
                        {preview.deliveryFee.toFixed(2)}
                      </dd>
                    </div>
                    <div className="flex justify-between border-t border-oms-border pt-1">
                      <dt className="font-semibold text-oms-ink-1">{t("total")}</dt>
                      <dd className="font-semibold tabular-nums text-oms-ink-1">
                        {preview.total.toFixed(2)}
                        <span className="ms-1 text-[11px] text-oms-ink-3">
                          {currencyCode}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </section>
              )}

              <p className="text-[12.5px] text-oms-ink-3">
                {t("consequence", { externalId: picked.external_id ?? picked.id })}
              </p>

              {error && (
                <p className="rounded-lg bg-oms-bad-bg px-3 py-2 text-[12.5px] text-oms-bad">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {picked && (
          <footer className="flex items-center justify-end gap-2 border-t border-oms-border px-5 py-3">
            <Button variant="ghost" onClick={reset} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={run} disabled={busy || needsChoice}>
              {busy ? t("merging") : t("confirm")}
            </Button>
          </footer>
        )}
      </div>
    </Sheet>
  );
}
