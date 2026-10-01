"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { Copy, Eye, Lock, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { OrderStatusBadge } from "@/components/orders/OrderStatusBadge";
import { OwnerTag } from "@/components/queue/OwnerTag";
import { fetcher } from "@/lib/swr-config";
import { formatDateTime } from "@/lib/format";
import type { OrderPreview } from "@/lib/agent-search/preview";

interface Props {
  /** The order to show; null keeps the sheet closed. */
  orderId: string | null;
  onClose: () => void;
  /** Called when the order turns out to be the agent's own — open the real panel instead. */
  onOpenOwn: (orderId: string) => void;
}

/**
 * The read-only look at an order the agent found in the market search but
 * does not hold — a colleague's, an unassigned one, a deleted duplicate.
 *
 * Deliberately not the order panel. The panel registers the agent's presence,
 * and an agent's presence row blocks manager writes; this sheet registers
 * nothing, subscribes to nothing, and has nothing to edit. Writes are refused
 * server-side for non-owners regardless. Its one action, copying the
 * reference, is what the agent hands the manager to get the order reassigned.
 */
export function OrderPreviewSheet({ orderId, onClose, onOpenOwn }: Props) {
  const t = useTranslations("queue.preview");
  const tStatus = useTranslations("orders.statuses");
  const locale = useLocale();
  const [copied, setCopied] = useState<string | null>(null);

  const { data, error } = useSWR<{ data: OrderPreview }>(
    orderId ? `/api/agent/orders/${orderId}/preview` : null,
    fetcher,
    { keepPreviousData: false, revalidateOnFocus: false },
  );
  const p = data?.data && data.data.id === orderId ? data.data : null;

  useEffect(() => {
    if (p?.access === "full") onOpenOwn(p.id);
  }, [p?.access, p?.id, onOpenOwn]);

  useEffect(() => setCopied(null), [orderId]);

  const ref = p?.external_id ? `#${p.external_id}` : null;
  async function copyRef() {
    if (!ref) return;
    try {
      await navigator.clipboard?.writeText(ref);
    } catch {
      /* clipboard refused — the reference is on screen to read out */
    }
    setCopied(ref);
  }

  const notFound = error instanceof Error && /\b404\b/.test(error.message);

  return (
    <Sheet open={orderId !== null} onClose={onClose} placement="end" ariaLabel={t("title")}>
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-agent-outline-variant bg-agent-surface px-4">
        <h2 className="text-[15px] font-bold text-agent-on-surface">{t("title")}</h2>
        <span className="inline-flex h-6 items-center gap-1.5 rounded-pill bg-agent-surface-low px-2.5 text-[12px] font-semibold text-agent-on-surface-variant">
          <Eye size={13} strokeWidth={2} aria-hidden="true" />
          {t("readOnly")}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="ms-auto grid h-9 w-9 place-items-center rounded-lg text-agent-on-surface-variant hover:bg-agent-surface-low"
        >
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-agent-surface px-4 py-4">
        {error ? (
          <p className="py-10 text-center text-[13.5px] text-agent-ink-3">{notFound ? t("notFound") : t("error")}</p>
        ) : !p ? (
          <p className="py-10 text-center text-[13.5px] text-agent-ink-3">{t("loading")}</p>
        ) : p.access === "full" ? null : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {ref && <span className="text-[18px] font-extrabold tabular-nums text-agent-on-surface" dir="ltr">{ref}</span>}
              <OrderStatusBadge status={p.status} label={tStatus(p.status)} locale={locale} />
              <OwnerTag owner={p.owner} ownerName={p.owner_name} status={p.status} />
              {p.archived && (
                <span className="inline-flex h-[22px] items-center rounded-md bg-agent-surface-low px-2 text-[12px] font-semibold text-agent-on-surface-variant">
                  {t("archived")}
                </span>
              )}
              <span className="w-full text-[12.5px] text-agent-ink-3">
                {t("createdAt", { date: formatDateTime(p.created_at, locale) })}
              </span>
            </div>

            <div className="mb-4 flex gap-2.5 rounded-xl border border-agent-outline-variant bg-agent-surface-low px-3 py-2.5 text-[13px] leading-relaxed text-agent-on-surface">
              <Lock size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0 text-agent-on-surface-variant" />
              <span>{t("lockNotice")}</span>
            </div>

            <Section title={t("client")}>
              <dl className="grid grid-cols-[104px_1fr] gap-x-3 gap-y-1.5 px-3 py-2.5 text-[13.5px]">
                <Field label={t("name")} value={p.customer_name} />
                <Field label={t("phone")} value={p.customer_phone} number />
                <Field label={t("phone2")} value={p.customer_phone_2} number />
                <Field label={t("city")} value={p.customer_city} />
                <Field label={t("address")} value={p.customer_address} />
              </dl>
            </Section>

            <Section title={t("items")}>
              {p.items.map((it, i) => (
                <div key={i} className="flex items-center gap-2.5 border-b border-agent-outline-variant px-3 py-2.5 text-[13.5px] last:border-b-0">
                  <span className="shrink-0 font-semibold tabular-nums text-agent-ink-3" dir="ltr">{it.quantity ?? 1}×</span>
                  <span className="min-w-0 flex-1 text-agent-on-surface">
                    {it.product_name}
                    {it.variant_label ? <span className="text-agent-ink-3"> · {it.variant_label}</span> : null}
                  </span>
                  {it.line_total !== null && (
                    <span className="shrink-0 font-semibold tabular-nums text-agent-on-surface" dir="ltr">
                      {it.line_total} {p.currency ?? ""}
                    </span>
                  )}
                </div>
              ))}
              <div className="flex justify-between border-t border-agent-outline-variant bg-agent-surface-low px-3 py-2.5 text-[13.5px] font-bold text-agent-on-surface">
                <span>{t("total")}</span>
                <span className="tabular-nums" dir="ltr">{p.total_price ?? "—"} {p.currency ?? ""}</span>
              </div>
            </Section>

            {(p.carrier_name || p.tracking_number) && (
              <Section title={t("delivery")}>
                <dl className="grid grid-cols-[104px_1fr] gap-x-3 gap-y-1.5 px-3 py-2.5 text-[13.5px]">
                  <Field label={t("carrier")} value={p.carrier_name} />
                  <Field label={t("tracking")} value={p.tracking_number} number />
                </dl>
              </Section>
            )}

            <Section title={t("history")}>
              <ol aria-label={t("history")} className="px-3 py-2.5">
                {[...p.history].reverse().map((h, i) => (
                  <li key={i} className="relative pb-3 ps-4 text-[13px] last:pb-0">
                    <span aria-hidden="true" className="absolute start-0 top-[7px] h-[7px] w-[7px] rounded-full bg-agent-outline" />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <OrderStatusBadge status={h.status_to} label={tStatus(h.status_to)} locale={locale} />
                      <span className="tabular-nums text-[12px] text-agent-ink-3">{formatDateTime(h.created_at, locale)}</span>
                      <span className="text-[12px] text-agent-on-surface-variant">
                        {h.actor_name ? t("by", { name: h.actor_name }) : t("system")}
                      </span>
                    </div>
                    {h.note && (
                      <p className="mt-1 rounded-lg bg-agent-surface-low px-2.5 py-1.5 text-[12.5px] text-agent-on-surface [unicode-bidi:plaintext]">
                        {h.note}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2.5 border-t border-agent-outline-variant bg-agent-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {p && p.access === "view" && ref && (
          <button
            type="button"
            onClick={copyRef}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-agent-outline bg-agent-surface px-3.5 text-[14px] font-semibold text-agent-on-surface hover:bg-agent-surface-low"
          >
            <Copy size={16} strokeWidth={2} aria-hidden="true" />
            {t("copyRef")}
          </button>
        )}
        {copied && (
          <span role="status" className="text-[12.5px] font-medium text-agent-primary">
            {t("copied", { ref: copied })}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ms-auto inline-flex h-10 items-center rounded-lg px-3.5 text-[14px] font-semibold text-agent-on-surface-variant hover:bg-agent-surface-low"
        >
          {t("close")}
        </button>
      </div>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-agent-outline-variant">
      <h3 className="border-b border-agent-outline-variant bg-agent-surface-low px-3 py-2 text-[12px] font-bold text-agent-on-surface-variant">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({ label, value, number }: { label: string; value: string | null; number?: boolean }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-agent-ink-3">{label}</dt>
      <dd className="min-w-0 font-semibold text-agent-on-surface [overflow-wrap:anywhere]">
        {number ? <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">{value}</span> : value}
      </dd>
    </>
  );
}
