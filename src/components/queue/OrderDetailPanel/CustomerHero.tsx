"use client";

import { useTranslations } from "next-intl";
import { Phone as PhoneIcon, Copy, Check, Package, Undo2 } from "lucide-react";
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
}: CustomerHeroProps) {
  const t = useTranslations("orders.detail");

  return (
    <section className="px-[18px] pb-1 pt-5" aria-label={t("client")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="mb-[7px] block text-[10.5px] font-[650] uppercase tracking-[0.085em] text-oms-ink-3">
            {t("client")}
          </span>

          <InlineField
            value={name}
            onCommit={(v) => onCommitName(v)}
            displayMode
            readOnly={!canEdit}
            displayClassName={[
              "text-[21px] font-[650] leading-[1.3] tracking-[-0.018em] [overflow-wrap:anywhere]",
              terminal ? "text-oms-ink-2" : "text-oms-ink-1",
            ].join(" ")}
          />
        </div>

        <ReliabilityStrip stats={reliability ?? null} />
      </div>

      {/* Number first, actions to the trailing edge — one control per job. */}
      <div className="mt-3.5 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <InlineField
            value={phone}
            onCommit={(v) => onCommitPhone(v.trim())}
            validate={validatePhone}
            type="tel"
            displayMode
            readOnly={!canEdit}
            placeholder={t("fieldPhone")}
            className="text-[16px] font-[650] tabular-nums tracking-[0.01em]"
            displayClassName="text-[16px] font-[650] tabular-nums tracking-[0.01em] text-oms-ink-1"
          />
        </div>

        {!terminal && (
          <a
            href={`tel:${phone}`}
            aria-label={`${t("callAction")} ${phone}`}
            className="inline-flex h-[30px] flex-shrink-0 items-center gap-1.5 rounded-[8px] border border-oms-border bg-oms-surface px-[11px] text-[12px] font-semibold text-oms-ink-2 transition-colors duration-fast hover:border-oms-accent hover:bg-oms-accent-bg hover:text-oms-accent-ink"
          >
            <PhoneIcon size={12} strokeWidth={2} aria-hidden="true" />
            {t("callAction")}
          </a>
        )}
        <button
          type="button"
          onClick={onCopyPhone}
          aria-label={t("copyPhone")}
          className="inline-flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[8px] border border-oms-border bg-oms-surface text-oms-ink-2 transition-colors duration-fast hover:border-oms-accent hover:bg-oms-accent-bg hover:text-oms-accent-ink"
        >
          {phoneCopied ? (
            <Check size={13} strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <Copy size={13} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
      </div>

      {(phone2 || canEdit) && !terminal ? (
        <div className="mt-2 flex items-center gap-2">
          <InlineField
            value={phone2 ?? ""}
            onCommit={(v) => onCommitPhone2(v || null)}
            type="tel"
            displayMode
            readOnly={!canEdit}
            // Empty + editable reads as "add one", not as a label for a missing field.
            placeholder={canEdit ? (phone2 ? t("fieldPhone2") : t("addPhone2")) : ""}
            displayClassName="text-[13px] tabular-nums text-oms-ink-2"
          />
          {phone2 ? (
            <a
              href={`tel:${phone2}`}
              aria-label={`${t("callAction")} ${phone2}`}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] border border-oms-border text-oms-ink-2 transition-colors duration-fast hover:border-oms-accent hover:text-oms-accent-ink"
            >
              <PhoneIcon size={12} strokeWidth={2} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

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
