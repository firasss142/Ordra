"use client";

import { useTranslations } from "next-intl";
import { Phone as PhoneIcon, Copy, Check } from "lucide-react";
import { InlineField } from "@/components/ui/InlineField";

export interface CustomerHeroProps {
  name: string;
  /** Primary phone — always present on an order. */
  phone: string;
  /** Secondary phone — optional. */
  phone2: string | null;
  city: string | null;
  /** True when the panel is on a terminal status — the call action is moot. */
  terminal: boolean;
  /** True when the agent / manager can inline-edit the customer fields. */
  canEdit: boolean;
  /** When true, validate primary phone against Libyan format. */
  isLibyaOrder: boolean;
  /** Street address — shown under the phone so it is never a tab away. */
  address?: string | null;
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
 * Phone and address live here rather than in a tab: an agent mid-call must be
 * able to read them without navigating away from whatever they are looking at.
 */
export function CustomerHero({
  name,
  phone,
  phone2,
  city,
  terminal,
  canEdit,
  isLibyaOrder,
  address,
  onCommitName,
  onCommitPhone,
  onCommitPhone2,
  onCopyPhone,
  phoneCopied,
  validatePhone,
}: CustomerHeroProps) {
  const t = useTranslations("orders.detail");

  return (
    <section className="px-4 pb-1 pt-5" aria-label={t("client")}>
      <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.085em] text-ink-muted">
        {t("client")}
      </span>

      <InlineField
        value={name}
        onCommit={(v) => onCommitName(v)}
        displayMode
        readOnly={!canEdit}
        displayClassName={[
          "text-[21px] font-semibold leading-[1.3] tracking-[-0.018em]",
          terminal ? "text-ink-secondary" : "text-ink-primary",
        ].join(" ")}
      />

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
            className="text-[16px] font-semibold tabular-nums tracking-[0.01em]"
            displayClassName="text-[16px] font-semibold tabular-nums tracking-[0.01em] text-ink-primary"
          />
        </div>

        {!terminal && (
          <a
            href={`tel:${phone}`}
            aria-label={`${t("callAction")} ${phone}`}
            className="inline-flex h-[30px] flex-shrink-0 items-center gap-1.5 rounded-card border border-line-subtle bg-surface-card px-2.5 text-[12px] font-semibold text-ink-secondary transition-colors duration-fast hover:border-accent hover:text-ink-primary"
          >
            <PhoneIcon size={12} strokeWidth={2} aria-hidden="true" />
            {t("callAction")}
          </a>
        )}
        <button
          type="button"
          onClick={onCopyPhone}
          aria-label={t("copyPhone")}
          className="inline-flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-card border border-line-subtle bg-surface-card text-ink-secondary transition-colors duration-fast hover:border-accent hover:text-ink-primary"
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
            displayClassName="text-[13px] tabular-nums text-ink-secondary"
          />
          {phone2 ? (
            <a
              href={`tel:${phone2}`}
              aria-label={`${t("callAction")} ${phone2}`}
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-card border border-line-subtle text-ink-secondary transition-colors duration-fast hover:border-accent hover:text-ink-primary"
            >
              <PhoneIcon size={12} strokeWidth={2} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* dir="auto" per node so an Arabic address resolves its own direction
          inside otherwise-LTR chrome. */}
      {(address || city) && (
        <p className="mt-2.5 text-[13.5px] leading-[1.5] text-ink-secondary" dir="auto">
          {[address, city].filter(Boolean).join(" · ")}
        </p>
      )}

      <span aria-hidden="true" data-is-libya={isLibyaOrder ? "1" : "0"} hidden />
    </section>
  );
}
