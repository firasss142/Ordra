"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { X, ExternalLink } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import { formatDate } from "@/lib/format";
import { statusToneClass } from "@/lib/order-status-tone";
import { useCustomerHistory } from "@/hooks/useCustomerHistory";
import {
  mergeAnchorWithHistory,
  computeTrackRecord,
  ratioPercent,
  type HistoryRow,
  type Ratio,
} from "@/lib/customer-history/summary";

export interface CustomerHistoryModalProps {
  open: boolean;
  onClose: () => void;
  source: "order" | "lead";
  sourceId: string;
  currencyCode: string;
  locale?: string;
  customerPhone?: string | null;

  /** The order the panel was opened from — folded into the list and the totals. */
  anchorOrderId: string;
  anchorExternalId: string | null;
  anchorStatus: string;
  anchorCreatedAt: string;
  anchorTotalPrice: number | null;
  anchorProductName: string | null;
  anchorProductImageUrl: string | null;
  anchorQuantity: number | null;
  anchorCustomerName: string | null;
  anchorCustomerCity: string | null;
}

/**
 * The customer's orders, in the page.
 *
 * "Voir toutes les commandes" used to be an `<a target="_blank">` to a filtered
 * orders list, which threw the agent into a second tab mid-call and lost the row
 * they were on. This shows the same thing without moving them.
 *
 * Two things it refuses to do:
 *   - print a percentage without the orders it came from. One delivered parcel
 *     is "100 %" and so is a hundred.
 *   - describe the customer while leaving out the order on screen. The RPC
 *     excludes the anchor, so its `delivered_count` reads 0 for a customer whose
 *     current parcel arrived; `mergeAnchorWithHistory` puts it back.
 */
export function CustomerHistoryModal(props: CustomerHistoryModalProps) {
  const {
    open,
    onClose,
    source,
    sourceId,
    currencyCode,
    locale = "fr",
    customerPhone,
  } = props;

  const t = useTranslations("customerHistory.modal");
  const tStatuses = useTranslations("orders.statuses");

  const { detail, isLoading, error } = useCustomerHistory(source, sourceId, open);

  const rows = useMemo<HistoryRow[]>(() => {
    const anchor: HistoryRow = {
      id: props.anchorOrderId,
      external_id: props.anchorExternalId,
      created_at: props.anchorCreatedAt,
      status: props.anchorStatus,
      total_price: props.anchorTotalPrice ?? 0,
      product_name: props.anchorProductName,
      product_image_url: props.anchorProductImageUrl,
      quantity: props.anchorQuantity,
      is_anchor: true,
    };
    const history: HistoryRow[] = (detail?.orders ?? []).map((o) => ({
      id: o.id,
      external_id: o.external_id,
      created_at: o.created_at,
      status: o.status,
      total_price: o.total_price,
      product_name: o.product_name,
      product_image_url: o.product_image_url,
      quantity: o.quantity,
      is_anchor: false,
    }));
    return mergeAnchorWithHistory(anchor, history);
  }, [
    detail,
    props.anchorOrderId,
    props.anchorExternalId,
    props.anchorCreatedAt,
    props.anchorStatus,
    props.anchorTotalPrice,
    props.anchorProductName,
    props.anchorProductImageUrl,
    props.anchorQuantity,
  ]);

  const track = useMemo(() => computeTrackRecord(rows), [rows]);

  const money = (n: number) => n.toFixed(2);

  /** A rate never appears without the orders behind it. */
  const Rate = ({
    testId,
    label,
    ratio,
    basis,
  }: {
    testId: string;
    label: string;
    ratio: Ratio | null;
    basis: (r: Ratio) => string;
  }) => (
    <div data-testid={testId} className="flex-1">
      <div
        className={[
          "text-[22px] font-semibold leading-tight tabular-nums",
          ratio === null
            ? "text-ink-muted"
            : ratioPercent(ratio) >= 80
              ? "text-status-success"
              : ratioPercent(ratio) >= 50
                ? "text-status-warning"
                : "text-status-critical",
        ].join(" ")}
      >
        {ratio === null ? "—" : `${ratioPercent(ratio)} %`}
      </div>
      <div className="mt-0.5 text-[11.5px] font-semibold text-ink-secondary">{label}</div>
      <div className="mt-px text-[11.5px] tabular-nums text-ink-muted">
        {ratio === null ? t("noBasis") : basis(ratio)}
      </div>
    </div>
  );

  const seeAllHref = customerPhone
    ? `/${locale}/orders?q=${encodeURIComponent(customerPhone)}`
    : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="center"
      width="sm:w-[900px]"
      ariaLabel={t("title")}
    >
      <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-ink-primary">{t("title")}</h2>
          <p className="mt-0.5 truncate text-[13px] text-ink-secondary">
            <span dir="auto">{props.anchorCustomerName?.trim() || "—"}</span>
            {customerPhone && (
              <>
                <span className="mx-1.5 text-ink-muted">·</span>
                <span className="tabular-nums">{customerPhone}</span>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink-primary"
        >
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      {isLoading && !detail && (
        <div className="px-5 py-8 text-center text-[13px] text-ink-muted">{t("loading")}</div>
      )}

      {error && (
        <div className="px-5 py-8 text-center text-[13px] text-status-critical">
          {t("error")}
        </div>
      )}

      {!error && (!isLoading || detail) && (
        <>
          {/* Summary: what this customer is, and what their record says. */}
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
            <div className="rounded-lg border border-line-subtle px-4 py-3">
              <span className="mb-2 block text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
                {t("thisCustomer")}
              </span>
              <dl className="space-y-1 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">{t("shown")}</dt>
                  <dd data-testid="ch-shown" className="font-semibold tabular-nums">
                    {rows.length}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">{t("delivered")}</dt>
                  <dd data-testid="ch-delivered" className="font-semibold tabular-nums">
                    {track.deliveredCount} · {money(track.deliveredValue)} {currencyCode}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">{t("inFlight")}</dt>
                  <dd data-testid="ch-inflight" className="font-semibold tabular-nums">
                    {track.inFlightCount} · {money(track.inFlightValue)} {currencyCode}
                  </dd>
                </div>
                {props.anchorCustomerCity && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-muted">{t("city")}</dt>
                    <dd dir="auto" className="font-semibold">
                      {props.anchorCustomerCity}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="rounded-lg border border-line-subtle px-4 py-3">
              <span className="mb-2 block text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
                {t("trackRecord")}
                {track.isThin && (
                  <span className="ms-1.5 rounded bg-status-warningBg px-1.5 py-px text-[10.5px] font-semibold normal-case tracking-normal text-status-warning">
                    {t("thinBase")}
                  </span>
                )}
              </span>
              <div className="flex gap-5">
                <Rate
                  testId="ch-delivery-rate"
                  label={t("deliveryRate")}
                  ratio={track.delivery}
                  basis={(r) => t("deliveryBasis", { n: r.n, d: r.d })}
                />
                <Rate
                  testId="ch-confirmation-rate"
                  label={t("confirmationRate")}
                  ratio={track.confirmation}
                  basis={(r) => t("confirmationBasis", { n: r.n, d: r.d })}
                />
              </div>
            </div>
          </div>

          {/* The orders themselves. */}
          <div className="flex-1 overflow-y-auto px-5">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  {[t("colRef"), t("colProduct"), t("colDate"), t("colStatus")].map((h) => (
                    <th
                      key={h}
                      className="sticky top-0 z-[1] border-b border-line-subtle bg-surface-card px-2.5 py-2 text-start text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="sticky top-0 z-[1] border-b border-line-subtle bg-surface-card px-2.5 py-2 text-end text-[10.5px] font-semibold uppercase tracking-wide text-ink-muted">
                    {t("colTotal")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.is_anchor ? "bg-brand-bg" : undefined}>
                    <td className="border-b border-line-subtle px-2.5 py-2.5 align-middle">
                      <span
                        className="text-[12px] tabular-nums text-ink-secondary"
                        title={r.external_id ?? r.id}
                      >
                        {shortRef(r.external_id ?? r.id)}
                      </span>
                      {r.is_anchor && (
                        <span className="ms-2 rounded bg-brand/10 px-1.5 py-px text-[10.5px] font-semibold text-brand">
                          {t("thisOrder")}
                        </span>
                      )}
                    </td>
                    <td className="border-b border-line-subtle px-2.5 py-2.5 align-middle">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ProductAvatar
                          imageUrl={r.product_image_url}
                          productName={r.product_name ?? "?"}
                          size={32}
                        />
                        <span dir="auto" className="truncate text-[12.5px]">
                          {r.product_name?.trim() || t("unknownProduct")}
                        </span>
                        {typeof r.quantity === "number" && r.quantity > 1 && (
                          <span className="shrink-0 rounded bg-surface-hover px-1.5 py-px text-[11px] font-semibold tabular-nums text-ink-secondary">
                            ×{r.quantity}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="border-b border-line-subtle px-2.5 py-2.5 align-middle tabular-nums text-ink-secondary">
                      {formatDate(r.created_at, locale)}
                    </td>
                    <td className="border-b border-line-subtle px-2.5 py-2.5 align-middle">
                      <span
                        className={[
                          "rounded-pill px-2 py-0.5 text-[11.5px] font-medium",
                          statusToneClass(r.status),
                        ].join(" ")}
                      >
                        {tStatuses(r.status as Parameters<typeof tStatuses>[0])}
                      </span>
                    </td>
                    <td className="border-b border-line-subtle px-2.5 py-2.5 text-end align-middle font-semibold tabular-nums">
                      {money(Number(r.total_price) || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-line-subtle bg-surface-subtle px-5 py-3">
            <p className="text-[11.5px] leading-snug text-ink-muted">{t("cap")}</p>
            {seeAllHref && (
              <a
                href={seeAllHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] font-semibold text-ink-primary transition-colors hover:bg-surface-hover"
              >
                {t("openInOrders")}
                <ExternalLink size={12} strokeWidth={2} aria-hidden="true" />
              </a>
            )}
          </footer>
        </>
      )}
    </Sheet>
  );
}

/** Storefront ids are 24-char Mongo hexes; the middle carries no meaning. */
function shortRef(ref: string): string {
  return ref.length <= 16 ? ref : `${ref.slice(0, 8)}…${ref.slice(-4)}`;
}
