"use client";

import { WhatsAppGlyph } from "@/components/whatsapp/WhatsAppGlyph";
import { useTranslations } from "next-intl";
import { Phone as PhoneIcon, Copy, Check, Package, Plus, Undo2 } from "lucide-react";
import { InlineField } from "@/components/ui/InlineField";
import {
  classifyCustomerReliability,
  type CustomerReliability,
} from "@/lib/orders/customer-reliability";

/** The three counts the strip reads from `/api/customer-history`. */
export interface CustomerReliabilityInput {
  total_orders: number;
  delivered_count: number;
  returned_count: number;
}

const VERDICT_DOT: Record<CustomerReliability, string> = {
  reliable: "bg-oms-ok",
  average: "bg-oms-warn",
  risky: "bg-oms-bad",
  unknown: "bg-oms-ink-3",
};

export interface CustomerHeroProps {
  name: string;
  /** Primary phone — always present on an order. */
  phone: string;
  /** Secondary phone — optional. */
  phone2: string | null;
  /** True when the panel is on a terminal status — the call action is moot. */
  terminal: boolean;
  /**
   * Customer's delivery record. `null` while the history is still loading —
   * the strip stays out rather than flashing a verdict it may revise.
   */
  reliability?: CustomerReliabilityInput | null;
  /** True when the agent / manager can inline-edit the customer fields. */
  canEdit: boolean;
  /** When true, validate primary phone against Libyan format. */
  isLibyaOrder: boolean;
  onCommitName: (v: string) => void;
  onCommitPhone: (v: string) => void;
  onCommitPhone2: (v: string | null) => void;
  onCopyPhone: () => void;
  phoneCopied: boolean;
  /** Returns null to mean "valid" — same contract as InlineField. */
  validatePhone: (v: string) => string | null;
  /**
   * Opens the Messages tab. A secondary outline button beside the call CTA,
   * never louder than it (prototype whatsapp-agent-v1.html, hero).
   */
  onWhatsApp?: () => void;
  /**
   * null hides the button (unknown yet). "not_connected" keeps it visible and
   * muted — the owner chose "show it disabled" over "hide it" — and it still
   * opens the tab, where the banner says why. "opted_out" is inert.
   */
  whatsappState?: "active" | "not_connected" | "opted_out" | null;
  /** Unread replies, on the button's corner. */
  whatsappUnread?: number;
}

/**
 * Identity block. The panel's title is the customer's name; everything else
 * supports it.
 *
 * It replaces a raised card whose loudest element was a full-width black
 * capsule around the phone — heavier than the name, the status and the total
 * put together. The number is now simply legible (16px tabular), and calling
 * and copying are two separate, labelled controls rather than one bar that did
 * both ambiguously.
 *
 * The phone lives here rather than in a tab: an agent mid-call must be able to
 * read it without navigating away from whatever they are looking at. The
 * address moved down to the facts grid, where it sits beside the city that
 * decides whether the order can ship at all.
 *
 * The reliability strip is the one piece of judgement on this surface. It is a
 * single line — a verdict in one word, then the three counts behind it — because
 * the alternative was a card the size of the customer's name arguing for
 * attention the name should win.
 */
export function CustomerHero({
  name,
  phone,
  phone2,
  terminal,
  reliability,
  canEdit,
  isLibyaOrder,
  onCommitName,
  onCommitPhone,
  onCommitPhone2,
  onCopyPhone,
  phoneCopied,
  validatePhone,
  onWhatsApp,
  whatsappState = null,
  whatsappUnread = 0,
}: CustomerHeroProps) {
  const t = useTranslations("orders.detail");
  const tWa = useTranslations("whatsapp");

  return (
    // Phone: the call and WhatsApp buttons get their own row under the
    // identity. Sharing one with the name and the `flex-none` reliability
    // pill left the name ~0px wide — one letter a line — on a 375px screen.
    <section className="px-[18px] pb-3 pt-3.5 max-lg:px-3.5" aria-label={t("client")}>
      <div className="flex items-start gap-3 max-lg:flex-col max-lg:items-stretch">
        <div className="min-w-0 flex-1">
          {/* The pill stays beside a short name and wraps under a long one:
              `flex-[1_1_auto]` lets the name claim its real width first. */}
          <div className="flex items-start gap-3 max-lg:flex-wrap max-lg:gap-y-1.5">
            <div className="min-w-0 flex-1 max-lg:flex-[1_1_auto]">
              <span className="block text-[12.5px] text-oms-ink-3">{t("client")}</span>

              <InlineField
                value={name}
                onCommit={(v) => onCommitName(v)}
                displayMode
                readOnly={!canEdit}
                displayClassName={[
                  "text-[22px] font-bold leading-[1.2] tracking-[-0.018em] [overflow-wrap:anywhere]",
                  "max-lg:text-[20px]",
                  terminal ? "text-oms-ink-2" : "text-oms-ink-1",
                ].join(" ")}
              />
            </div>

            <ReliabilityStrip stats={reliability ?? null} />
          </div>

          {/* The number, with copying as a glyph on it rather than as a second
              control the size of the one that places the call. */}
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={onCopyPhone}
              aria-label={t("copyPhone")}
              className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-[6px] text-oms-ink-3 transition-colors duration-fast hover:bg-oms-sunken hover:text-oms-ink-1"
            >
              {phoneCopied ? (
                <Check size={15} strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <Copy size={15} strokeWidth={2} aria-hidden="true" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <InlineField
                value={phone}
                onCommit={(v) => onCommitPhone(v.trim())}
                validate={validatePhone}
                type="tel"
                displayMode
                readOnly={!canEdit}
                placeholder={t("fieldPhone")}
                className="text-[15px] font-semibold tabular-nums tracking-[0.01em]"
                displayClassName="text-[15px] font-semibold tabular-nums tracking-[0.01em] text-oms-ink-1"
              />
            </div>
          </div>

          {(phone2 || canEdit) && !terminal ? (
            <div className="mt-1.5 flex items-center gap-1.5">
              {!phone2 && canEdit ? (
                <Plus size={13} strokeWidth={2.4} aria-hidden="true" className="text-brand" />
              ) : null}
              <InlineField
                value={phone2 ?? ""}
                onCommit={(v) => onCommitPhone2(v || null)}
                type="tel"
                displayMode
                readOnly={!canEdit}
                // Empty + editable reads as "add one", not as a label for a missing field.
                placeholder={canEdit ? (phone2 ? t("fieldPhone2") : t("addPhone2")) : ""}
                displayClassName={
                  phone2
                    ? "text-[13px] tabular-nums text-oms-ink-2"
                    : "text-[13px] font-semibold text-brand"
                }
              />
              {phone2 ? (
                <a
                  href={`tel:${phone2}`}
                  aria-label={`${t("callAction")} ${phone2}`}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border border-oms-border text-oms-ink-2 transition-colors duration-fast hover:border-brand hover:text-brand"
                >
                  <PhoneIcon size={12} strokeWidth={2} aria-hidden="true" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        {!terminal && (
          <div className="flex flex-shrink-0 items-center gap-2 self-center max-lg:self-stretch">
            {whatsappState && onWhatsApp && (
              <button
                type="button"
                data-state={whatsappState}
                aria-disabled={whatsappState === "opted_out" || undefined}
                title={
                  whatsappState === "not_connected"
                    ? tWa("composer.noConfig")
                    : whatsappState === "opted_out"
                      ? tWa("composer.optedOut")
                      : undefined
                }
                onClick={() => {
                  if (whatsappState !== "opted_out") onWhatsApp();
                }}
                aria-label={tWa("button")}
                className={`relative inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[8px] border px-3.5 text-[14px] font-bold transition-colors duration-fast max-lg:h-11 ${
                  whatsappState === "active"
                    ? "border-[#BBF7D0] bg-white text-[#15803D] hover:bg-[#F0FDF4]"
                    : "border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF]"
                } ${whatsappState === "opted_out" ? "cursor-not-allowed" : ""}`}
              >
                <WhatsAppGlyph size={17} strokeWidth={2} />
                {tWa("button")}
                {whatsappState === "active" && whatsappUnread > 0 && (
                  <span className="absolute -top-[7px] end-[-7px] grid h-[19px] min-w-[19px] place-items-center rounded-full bg-[#15803D] px-[5px] text-[11px] font-bold tabular-nums text-white shadow-[0_0_0_2px_#fff]">
                    {whatsappUnread}
                  </span>
                )}
              </button>
            )}
            <a
              href={`tel:${phone}`}
              aria-label={`${t("callAction")} ${phone}`}
              className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-2 rounded-[8px] bg-brand px-[18px] text-[15px] font-bold text-white transition-colors duration-fast hover:bg-brand-hover max-lg:h-11 max-lg:flex-1"
            >
              <PhoneIcon size={16} strokeWidth={2.2} aria-hidden="true" />
              {t("callAction")}
            </a>
          </div>
        )}
      </div>

      <span aria-hidden="true" data-is-libya={isLibyaOrder ? "1" : "0"} hidden />
    </section>
  );
}

/**
 * Verdict, then evidence, on one line.
 *
 * The glyphs do the labelling — carton for orders placed, check for delivered,
 * return arrow for returns — so the words only appear on hover. Colour is never
 * the sole carrier of meaning: the verdict is spelled out next to the dot, and
 * the whole reading is composed into the strip's accessible name.
 */
function ReliabilityStrip({ stats }: { stats: CustomerReliabilityInput | null }) {
  const t = useTranslations("orders.detail");

  if (!stats || stats.total_orders <= 0) return null;

  const verdict = classifyCustomerReliability(stats);
  const count = (noun: "orders" | "delivered" | "returned", value: number) =>
    t(`reliability.${noun}${value === 1 ? "One" : ""}` as Parameters<typeof t>[0], {
      count: value,
    });

  const orders = count("orders", stats.total_orders);
  const delivered = count("delivered", stats.delivered_count);
  const returned = count("returned", stats.returned_count);
  const summary = `${t(`reliability.${verdict}` as Parameters<typeof t>[0])} — ${orders}, ${delivered}, ${returned}`;

  return (
    <div
      data-testid="customer-reliability"
      data-verdict={verdict}
      aria-label={summary}
      title={summary}
      className="inline-flex h-7 flex-none items-center gap-2 rounded-pill border border-oms-border px-2.5"
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold text-oms-ink-2">
        <span
          aria-hidden="true"
          className={`h-[7px] w-[7px] flex-none rounded-full ${VERDICT_DOT[verdict]}`}
        />
        {t(`reliability.${verdict}` as Parameters<typeof t>[0])}
      </span>

      <span aria-hidden="true" className="h-3.5 w-px flex-none bg-oms-border" />

      <Figure title={orders} value={stats.total_orders}>
        <Package size={13} strokeWidth={1.9} aria-hidden="true" />
      </Figure>
      <Figure title={delivered} value={stats.delivered_count} tone="text-oms-ok">
        <Check size={13} strokeWidth={2.1} aria-hidden="true" />
      </Figure>
      <Figure title={returned} value={stats.returned_count} tone="text-oms-bad">
        <Undo2 size={13} strokeWidth={2.1} aria-hidden="true" />
      </Figure>
    </div>
  );
}

function Figure({
  title,
  value,
  tone = "text-oms-ink-2",
  children,
}: {
  title: string;
  value: number;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-[3.5px] text-[12px] font-[650] tabular-nums ${tone}`}
    >
      {children}
      {value}
    </span>
  );
}
