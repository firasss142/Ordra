"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_DELEGATION, toXDeliveryGovernorate } from "@/lib/carriers/xdelivery/destinations";
import {
  searchXDeliveryPlaces,
  xdeliveryGovernorates,
  type LocalityTree,
  type PlaceOption,
} from "@/lib/carriers/xdelivery/place-search";
import { XDELIVERY_DELEGATION_EXTRA, XDELIVERY_GOVERNORATE_EXTRA } from "@/lib/carriers/xdelivery/adapter";

/**
 * « Envoyer à X-Delivery » — prototypes/xdelivery-v1.html, screen 3.
 *
 * Tunisian orders carry a governorate only, and that is what must be right: X-Delivery
 * routes to a depot by governorate. The delegation is optional; without a pick the
 * adapter sends the main town (owner decision 1), so `extra` carries a delegation only
 * when the agent chose another one. A governorate X-Delivery does not know is never
 * guessed — the agent picks it, and the button waits.
 */

interface Props {
  orderId: string;
  carrierId: string;
  customerName: string | null;
  customerCity: string | null;
  totalPrice: number | null;
  onClose: () => void;
  onSuccess: (trackingNumber: string | null) => void;
}

export function XDeliveryDispatchModal({
  orderId,
  carrierId,
  customerName,
  customerCity,
  totalPrice,
  onClose,
  onSuccess,
}: Props) {
  const t = useTranslations("dispatch.xdelivery");
  const tDup = useTranslations("duplicateOrder.uploadGuard");
  const ids = { title: useId(), gov: useId(), del: useId(), dup: useId() };
  const panelRef = useRef<HTMLDivElement>(null);

  const fromOrder = useMemo(() => toXDeliveryGovernorate(customerCity), [customerCity]);
  const [governorate, setGovernorate] = useState<string>(fromOrder ?? "");
  const [chosen, setChosen] = useState<PlaceOption | null>(null);
  const [query, setQuery] = useState("");
  const [localities, setLocalities] = useState<LocalityTree | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ externalId: string | null } | null>(null);

  // 78 KB of quartier names, fetched only once someone types.
  useEffect(() => {
    if (!query.trim() || localities) return;
    let live = true;
    import("@/lib/carriers/xdelivery/localities").then((m) => {
      if (live) setLocalities(m.XDELIVERY_LOCALITIES);
    });
    return () => {
      live = false;
    };
  }, [query, localities]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const governorates = useMemo(() => {
    const all = xdeliveryGovernorates();
    return fromOrder ? [fromOrder, ...all.filter((g) => g !== fromOrder)] : all;
  }, [fromOrder]);

  const options = useMemo(
    () => (governorate ? searchXDeliveryPlaces({ governorate, query, localities }) : []),
    [governorate, query, localities],
  );
  const fallback = governorate ? DEFAULT_DELEGATION[governorate] : null;

  const isSelected = (o: PlaceOption) => (chosen ? chosen.key === o.key : o.isDefault);

  async function send(confirmDuplicate = false) {
    if (!governorate) return;
    setSubmitting(true);
    setError(null);
    try {
      const extra: Record<string, string> = { [XDELIVERY_GOVERNORATE_EXTRA]: governorate };
      if (chosen && chosen.delegation !== fallback) extra[XDELIVERY_DELEGATION_EXTRA] = chosen.delegation;
      const res = await fetch(`/api/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier_id: carrierId,
          extra,
          ...(confirmDuplicate ? { confirm_duplicate: true } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (res.status === 409 && json?.needsConfirmation) {
        setDuplicate({ externalId: json?.duplicate?.external_id ?? null });
        return;
      }
      if (!res.ok) {
        setError(typeof json?.error === "string" ? json.error : t("failed"));
        return;
      }
      onSuccess(typeof json?.data?.tracking_number === "string" ? json.data.tracking_number : null);
    } catch {
      setError(t("failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const orderLine = t("orderLine", {
    name: customerName ?? "—",
    total: totalPrice != null ? formatCurrency(totalPrice, "TN") : "—",
    city: customerCity ?? "—",
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-primary/50 p-4" onClick={onClose}>
      <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => panelRef.current ?? document.body }}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={ids.title}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="flex max-h-[90dvh] w-[460px] max-w-full flex-col overflow-hidden rounded-[14px] border border-line-subtle bg-surface-card"
        >
          <header className="shrink-0 border-b border-line-subtle px-[18px] py-3.5">
            <h3 id={ids.title} className="text-[16px] font-bold text-ink-primary">
              {t("title")}
            </h3>
            <p className="mt-0.5 text-[13px] text-ink-secondary">{orderLine}</p>
          </header>

          <div className="flex-1 overflow-y-auto px-[18px] py-3.5">
            {error ? (
              <p
                role="alert"
                className="mb-3 rounded-card border border-status-critical/30 bg-status-criticalBg px-3 py-2 text-[13px] text-status-critical"
              >
                {error}
              </p>
            ) : null}

            <div className="mb-3.5">
              <label htmlFor={ids.gov} className="mb-1.5 block text-[12.5px] font-semibold text-ink-secondary">
                {t("governorate")}
              </label>
              <select
                id={ids.gov}
                value={governorate}
                onChange={(e) => {
                  setGovernorate(e.target.value);
                  setChosen(null);
                  setQuery("");
                }}
                className="h-[38px] w-full rounded-[10px] border border-line-subtle bg-surface-card px-3 text-[14px] text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dispatch-ok"
              >
                {fromOrder ? null : (
                  <option value="" disabled>
                    {t("governoratePick")}
                  </option>
                )}
                {governorates.map((g) => (
                  <option key={g} value={g}>
                    {g === fromOrder ? t("governorateFromOrder", { name: g }) : g}
                  </option>
                ))}
              </select>
              {fromOrder ? null : (
                <p className="mt-2 text-[12.5px] text-status-warning">
                  {t("governorateUnknown", { city: customerCity ?? "—" })}
                </p>
              )}
            </div>

            {governorate ? (
              <div>
                <label htmlFor={ids.del} className="mb-1.5 block text-[12.5px] font-semibold text-ink-secondary">
                  {t("delegation")} <span className="font-normal text-ink-muted">{t("optional")}</span>
                </label>
                <input
                  id={ids.del}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("search")}
                  autoComplete="off"
                  className="h-[38px] w-full rounded-[10px] border border-line-subtle bg-surface-card px-3 text-[14px] text-ink-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-dispatch-ok"
                />
                {options.length > 0 ? (
                  <ul
                    role="listbox"
                    aria-label={t("delegation")}
                    className="mt-1.5 max-h-[236px] overflow-y-auto rounded-[10px] border border-line-subtle"
                  >
                    {options.map((o) => (
                      <li
                        key={o.key}
                        role="option"
                        aria-selected={isSelected(o)}
                        tabIndex={0}
                        onClick={() => setChosen(o)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setChosen(o);
                          }
                        }}
                        className={`flex cursor-pointer items-center justify-between gap-3 border-b border-line-subtle px-3 py-2 text-[14px] last:border-b-0 focus:outline-none focus-visible:bg-surface-hover ${
                          isSelected(o) ? "bg-dispatch-ok-bg font-semibold text-dispatch-ok-ink" : "text-ink-primary hover:bg-surface-hover"
                        }`}
                      >
                        <span className="min-w-0 truncate">{o.locality ?? o.delegation}</span>
                        {o.locality ? (
                          <span className="shrink-0 text-[11.5px] font-semibold text-ink-muted">{o.delegation}</span>
                        ) : o.isDefault ? (
                          <span className="shrink-0 text-[11.5px] font-semibold text-ink-muted">{t("byDefault")}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[12.5px] text-ink-secondary">{t("noMatch")}</p>
                )}
                {fallback ? (
                  <p className="mt-2 text-[12.5px] text-ink-secondary">
                    {t.rich("defaultNote", { delegation: fallback, b: (chunks) => <b>{chunks}</b> })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <footer className="flex shrink-0 justify-end gap-2 border-t border-line-subtle bg-surface-sunken px-[18px] py-3">
            <button
              type="button"
              onClick={onClose}
              className="h-9 rounded-[10px] border border-line-subtle bg-surface-card px-3.5 text-[13.5px] font-semibold text-ink-primary hover:bg-surface-hover"
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              disabled={!governorate || submitting}
              onClick={() => send()}
              className="h-9 rounded-[10px] bg-dispatch-ok px-3.5 text-[13.5px] font-semibold text-white hover:bg-dispatch-ok-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? t("sending") : t("send")}
            </button>
          </footer>

          {duplicate ? (
            <div
              className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
              onClick={(e) => {
                e.stopPropagation();
                setDuplicate(null);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={ids.dup}
                className="w-full max-w-sm rounded-lg border border-line-subtle bg-surface-card p-5"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id={ids.dup} className="mb-2 text-[15px] font-semibold text-status-warning">
                  {tDup("title")}
                </h2>
                <p className="mb-4 text-[13.5px] leading-relaxed text-ink-secondary">
                  {tDup("body", { externalId: duplicate.externalId ?? "—" })}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDuplicate(null)}
                    className="inline-flex flex-1 items-center justify-center rounded-md border border-line-strong bg-surface-card px-4 py-2.5 text-[14px] font-medium text-ink-primary hover:bg-surface-hover"
                  >
                    {tDup("cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setDuplicate(null);
                      send(true);
                    }}
                    className="inline-flex flex-1 items-center justify-center rounded-md bg-ink-primary px-4 py-2.5 text-[14px] font-medium text-surface-card disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tDup("confirm")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </FocusTrap>
    </div>
  );
}
