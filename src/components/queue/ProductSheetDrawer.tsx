"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  FlaskConical,
  MessageCircle,
  ShieldAlert,
  SprayCan,
  X,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { buildWhatsappUrl, type MarketCode } from "@/lib/products/whatsapp";
import type { SheetCheckSeverity } from "@/lib/products/sheet-checks";
import type { ProductSheetPayload } from "@/types/product-sheet";
import { ProductSheetHero } from "./ProductSheetHero";
import { ProductSheetSignals } from "./ProductSheetSignals";
import { ProductSheetPacks } from "./ProductSheetPacks";
import { ProductSheetCrossSell } from "./ProductSheetCrossSell";

export interface ProductSheetDrawerProps {
  open: boolean;
  onClose: () => void;
  data: ProductSheetPayload | null;
  isLoading: boolean;
  isError: boolean;
  /** Customer number for the WhatsApp deep link. */
  customerPhone: string | null;
  market: MarketCode;
  locale: "fr" | "ar";
  /** Re-keys the sheet to a cross-sell alternative. */
  onOpenProduct?: (productId: string | null) => void;
}

const CHECK_TONE: Record<SheetCheckSeverity, string> = {
  critical: "bg-status-criticalBg text-status-critical",
  warning: "bg-status-warningBg text-status-warning",
  info: "bg-surface-page text-ink-secondary",
};

/**
 * The full product sheet. Editorial layout per docs/design-system.md §4.16:
 * a 1:1 hero, one KPI-scale figure (the price), status colour on rate figures
 * only, and a 20px reading rhythm.
 *
 * Reading order is what an agent reaches for, not the shape of the data —
 * packs sit above the prose because price is the question that interrupts a
 * call. Share actions live in a sticky footer because the page scrolls.
 *
 * Stacks over OrderDetailPanel; the panel suspends its own Escape handling
 * while this is open so one Escape closes one layer.
 */
export function ProductSheetDrawer({
  open,
  onClose,
  data,
  isLoading,
  isError,
  customerPhone,
  market,
  locale,
  onOpenProduct,
}: ProductSheetDrawerProps) {
  const t = useTranslations("productSheet");

  const [activeMedia, setActiveMedia] = useState(0);
  const [copied, setCopied] = useState(false);

  const productId = data?.product?.id;

  // Reset per-product view state whenever the sheet is reopened or swapped.
  useEffect(() => {
    setActiveMedia(0);
    setCopied(false);
  }, [open, productId]);

  if (!open) return null;

  const product = data?.product ?? null;
  const media = data?.media ?? [];
  const cover = media[activeMedia] ?? media[0] ?? null;
  const currency = data?.currency ?? "";
  const price = product?.default_price ?? null;

  const whatsappUrl =
    product && cover
      ? buildWhatsappUrl(
          customerPhone,
          market,
          t("whatsappMessage", {
            name: product.name,
            price: price ?? "",
            currency,
            url: cover.url,
          }),
        )
      : null;

  async function handleCopy() {
    if (!cover) return;
    try {
      await navigator.clipboard.writeText(cover.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied (insecure context / permissions) — leave the label
      // unchanged rather than claiming a copy that did not happen.
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(locale === "ar" ? "ar-LY" : "fr-TN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  const hasBody =
    Boolean(product?.description?.trim()) ||
    Boolean(product?.agent_notes?.trim()) ||
    Boolean(product?.agent_composition?.trim()) ||
    Boolean(product?.agent_usage?.trim()) ||
    Boolean(product?.agent_contraindications?.trim()) ||
    (data?.variants.length ?? 0) > 0 ||
    Boolean(data?.signals?.hasAny);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="end"
      width="w-full sm:w-[440px]"
      ariaLabel={t("title")}
    >
      {/* §4.13 header band */}
      <header className="flex h-[56px] flex-shrink-0 items-center gap-2 border-b border-line-subtle px-4">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-primary">
          {t("title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink-primary"
        >
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="px-4 py-6 text-[13px] text-ink-muted">{t("loading")}</p>}

        {!isLoading && isError && (
          <p className="px-4 py-6 text-[13px] text-status-critical">{t("loadError")}</p>
        )}

        {!isLoading && !isError && !product && (
          <div className="px-4 py-6">
            <div className="flex items-start gap-2 rounded-card bg-status-warningBg px-3 py-3 text-[12px] text-status-warning">
              <AlertTriangle
                size={14}
                strokeWidth={2}
                className="mt-0.5 flex-shrink-0"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold">{t("unmappedTitle")}</p>
                <p className="mt-1">{t("unmappedBody", { name: data?.raw_product_name ?? "" })}</p>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !isError && product && (
          <div className="flex flex-col gap-5 px-4 py-4 pb-6">
            {/* Viewing an alternative rather than the ordered product */}
            {data?.is_cross_sell_view && (
              <div className="flex items-center gap-2 rounded-card bg-surface-page px-3 py-2 text-[12px] text-ink-secondary">
                <span className="min-w-0 flex-1">{t("viewingAlternative")}</span>
                {onOpenProduct && (
                  <button
                    type="button"
                    onClick={() => onOpenProduct(null)}
                    className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] font-medium text-ink-primary underline underline-offset-2 hover:no-underline"
                  >
                    <ArrowLeft size={11} strokeWidth={2} aria-hidden="true" className="rtl:rotate-180" />
                    {t("backToOrdered")}
                  </button>
                )}
              </div>
            )}

            <ProductSheetHero
              name={product.name}
              price={price}
              currency={currency}
              currentStock={product.current_stock}
              lowStockThreshold={product.low_stock_threshold}
              media={media}
              activeIndex={activeMedia}
              onSelectMedia={setActiveMedia}
            />

            {(data?.checks.length ?? 0) > 0 && (
              <div className="flex flex-col gap-1.5">
                {data!.checks.map((c) => (
                  <div
                    key={c.code}
                    className={`flex items-start gap-2 rounded-card px-3 py-2 text-[12px] ${CHECK_TONE[c.severity]}`}
                  >
                    <AlertTriangle
                      size={13}
                      strokeWidth={2}
                      className="mt-0.5 flex-shrink-0"
                      aria-hidden="true"
                    />
                    <span>{t(`checks.${c.code}`, c.values ?? {})}</span>
                  </div>
                ))}
              </div>
            )}

            <ProductSheetSignals signals={data?.signals ?? null} />

            <ProductSheetPacks
              variants={data?.variants ?? []}
              floorPrice={product.floor_price}
              currency={currency}
            />

            <Prose title={t("description")} hint={t("descriptionHint")} body={product.description} />
            <Prose
              title={t("agentNotes")}
              hint={t("agentNotesHint")}
              body={product.agent_notes}
              emphasis
            />
            <Prose title={t("composition")} icon={<FlaskConical size={12} strokeWidth={2} />} body={product.agent_composition} />
            <Prose title={t("usage")} icon={<SprayCan size={12} strokeWidth={2} />} body={product.agent_usage} />

            {/* A contraindication is a warning, i.e. status — so it earns colour. */}
            {product.agent_contraindications?.trim() && (
              <section className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <ShieldAlert
                    size={12}
                    strokeWidth={2}
                    aria-hidden="true"
                    className="text-status-critical"
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-status-critical">
                    {t("contraindications")}
                  </span>
                </div>
                <p className="whitespace-pre-wrap rounded-card bg-status-criticalBg px-3 py-2 text-[13px] leading-relaxed text-status-critical">
                  {product.agent_contraindications}
                </p>
              </section>
            )}

            <ProductSheetCrossSell
              crossSell={data?.cross_sell ?? null}
              currency={currency}
              onOpen={(id) => onOpenProduct?.(id)}
            />

            {!hasBody && <p className="text-[13px] text-ink-muted">{t("noContent")}</p>}

            {product.agent_content_updated_at && (
              <p className="text-[11px] text-ink-muted">
                {t("updatedAt", { date: formatDate(product.agent_content_updated_at) })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Sticky footer — the editorial layout scrolls, so sharing must stay
          reachable without scrolling back up (§4.13 footer band). */}
      {!isLoading && !isError && product && cover && (
        <div className="flex flex-shrink-0 items-center gap-2 border-t border-line-subtle bg-surface-card px-4 py-3">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-card border border-line-subtle text-[12px] font-medium text-ink-secondary transition-colors duration-fast hover:bg-surface-hover"
          >
            {copied ? (
              <Check size={12} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Copy size={12} strokeWidth={2} aria-hidden="true" />
            )}
            {copied ? t("copied") : t("copyImage")}
          </button>
          {whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-card bg-ink-primary text-[12px] font-semibold text-white transition-colors duration-fast hover:bg-[#2A2A2A]"
            >
              <MessageCircle size={12} strokeWidth={2} aria-hidden="true" />
              {t("sendWhatsapp")}
            </a>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Prose({
  title,
  hint,
  body,
  icon,
  emphasis = false,
}: {
  title: string;
  hint?: string;
  body: string | null | undefined;
  icon?: ReactNode;
  emphasis?: boolean;
}) {
  if (!body?.trim()) return null;
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5">
        {icon && (
          <span aria-hidden="true" className="self-center text-ink-muted">
            {icon}
          </span>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          {title}
        </span>
        {hint && <span className="text-[10px] text-ink-muted">· {hint}</span>}
      </div>
      <p
        className={`whitespace-pre-wrap text-[13px] leading-relaxed ${
          emphasis ? "text-ink-primary" : "text-ink-secondary"
        }`}
      >
        {body}
      </p>
    </section>
  );
}
