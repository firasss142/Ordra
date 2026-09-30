"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  CheckCheck,
  Copy,
  FlaskConical,
  Info,
  Loader2,
  ShieldAlert,
  SprayCan,
  X,
} from "lucide-react";
import { WhatsAppGlyph } from "@/components/whatsapp/WhatsAppGlyph";
import { StatusGlyph } from "@/components/whatsapp/StatusGlyph";
import { errorReasonKey } from "@/lib/whatsapp/compose";
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
  /**
   * When the market's WhatsApp business number is live, « Envoyer sur
   * WhatsApp » sends the cover image from it (free-form inside the 24 h
   * window, the approved « Fiche produit » template outside) instead of
   * opening wa.me on the agent's phone. Needs the order to address it.
   */
  orderId?: string | null;
  customerName?: string | null;
  whatsappActive?: boolean;
  /** The market's connection is known: not connected then shows the banner (owner decision: shown, not hidden). */
  whatsappKnown?: boolean;
  /** The customer asked for no more messages: the send is disabled and says why. */
  customerOptedOut?: boolean;
  customerLanguage?: "ar" | "fr";
  onWhatsAppSent?: () => void;
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
  orderId = null,
  customerName = null,
  whatsappActive = false,
  whatsappKnown = false,
  customerOptedOut = false,
  customerLanguage,
  onWhatsAppSent,
}: ProductSheetDrawerProps) {
  const t = useTranslations("productSheet");
  const tw = useTranslations("whatsapp");

  const [activeMedia, setActiveMedia] = useState(0);
  const [copied, setCopied] = useState(false);
  const [waState, setWaState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [waHow, setWaHow] = useState<"text" | "template" | null>(null);
  const [waError, setWaError] = useState<{ error: string | null; code: number | null; kind: string | null } | null>(null);
  const [waCaption, setWaCaption] = useState<string | null>(null);

  const productId = data?.product?.id;

  // Reset per-product view state whenever the sheet is reopened or swapped.
  useEffect(() => {
    setActiveMedia(0);
    setCopied(false);
    setWaState("idle");
    setWaHow(null);
    setWaError(null);
    setWaCaption(null);
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

  async function handleWhatsAppSend() {
    if (!product || !cover || !orderId || waState === "sending" || customerOptedOut) return;
    setWaState("sending");
    setWaError(null);
    const caption = t("whatsappMessage", { name: product.name, price: price ?? "", currency, url: cover.url });
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { order_id: orderId },
          language: customerLanguage ?? (market === "ly" ? "ar" : "fr"),
          mode: "image",
          image_url: cover.url,
          caption,
          product: { name: product.name, price, currency },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWaState("failed");
        setWaError({ error: body?.error ?? null, code: typeof body?.code === "number" ? body.code : null, kind: body?.kind ?? null });
        return;
      }
      setWaCaption(caption);
      setWaHow(body?.data?.kind === "template" ? "template" : "text");
      setWaState("sent");
      onWhatsAppSent?.();
    } catch {
      setWaState("failed");
      setWaError({ error: "generic", code: null, kind: null });
    }
  }

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

      {/* After a send (prototype whatsapp-agent-v1.html, screen `product`):
          who got it, the caption as sent, and how it went out. */}
      {whatsappActive && waState === "sent" && (
        <div role="status" data-testid="product-wa-sent" className="mx-4 mb-4 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-3">
          <div className="flex items-center gap-2 text-[13.5px] font-bold text-[#14532D]">
            <WhatsAppGlyph size={15} />
            <span>{tw("product.sentTo", { name: customerName ?? "—" })}</span>
            <StatusGlyph status="sent" />
          </div>
          {waCaption && <div className="mt-2 whitespace-pre-wrap text-[13px] leading-[1.5] text-[#374151] [unicode-bidi:plaintext]">{waCaption}</div>}
          <div className="mt-2 text-[12px] text-[#6B7280]">{waHow === "template" ? tw("product.howTemplate") : tw("product.howText")}</div>
        </div>
      )}
      {whatsappActive && waState === "failed" && waError && (
        <p role="alert" className="mx-4 mb-2 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]">
          <b className="font-bold">{tw("composer.failed")}</b>
          {" · "}
          {waError.code
            ? tw("composer.failedMeta", { code: waError.code, reason: tw(`errors.${errorReasonKey(waError)}` as Parameters<typeof tw>[0]) })
            : tw(`errors.${errorReasonKey(waError)}` as Parameters<typeof tw>[0])}
        </p>
      )}
      {whatsappActive && customerOptedOut && (
        <div role="status" className="mx-4 mb-3 flex items-start gap-2.5 rounded-xl border border-[#FCD34D] bg-[#FFFBEB] px-[13px] py-[11px] text-[13.5px] text-[#B45309]">
          <Ban size={17} className="mt-px shrink-0" aria-hidden="true" />
          <b className="font-bold">{tw("composer.optedOut")}</b>
        </div>
      )}
      {!whatsappActive && whatsappKnown && (
        <div role="status" className="mx-4 mb-3 flex items-start gap-2.5 rounded-xl border border-[#E5E7EB] bg-[#F3F4F6] px-[13px] py-[11px] text-[13.5px] leading-[1.45] text-[#374151]">
          <Info size={17} className="mt-px shrink-0" aria-hidden="true" />
          <div>
            <b className="mb-px block font-bold">{tw("composer.noConfig")}</b>
            {tw("composer.noConfigSub")}
          </div>
        </div>
      )}

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
          {whatsappActive && orderId ? (
            <button
              type="button"
              onClick={handleWhatsAppSend}
              disabled={waState === "sending" || customerOptedOut}
              data-state={waState}
              className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-card text-[12px] font-bold transition-colors duration-fast disabled:cursor-not-allowed ${
                customerOptedOut ? "bg-[#111111] text-white opacity-40" : waState === "sent" ? "border border-[#BBF7D0] bg-[#F0FDF4] text-[#14532D]" : "bg-[#111111] text-white hover:bg-[#2A2A2A]"
              }`}
            >
              {waState === "sending" ? (
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
              ) : waState === "sent" ? (
                <CheckCheck size={13} strokeWidth={2.4} aria-hidden="true" />
              ) : (
                <WhatsAppGlyph size={13} strokeWidth={2} />
              )}
              {waState === "sending" ? tw("composer.sending") : waState === "sent" ? tw("product.sentTo", { name: (customerName ?? "").split(" ")[0] || "—" }) : tw("product.send")}
            </button>
          ) : whatsappUrl ? (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-card bg-ink-primary text-[12px] font-semibold text-white transition-colors duration-fast hover:bg-[#2A2A2A]"
            >
              <WhatsAppGlyph size={13} strokeWidth={2} />
              {whatsappKnown ? tw("sheet.open") : t("sendWhatsapp")}
            </a>
          ) : null}
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
