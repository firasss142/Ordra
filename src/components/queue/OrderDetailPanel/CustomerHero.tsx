"use client";

import { useTranslations } from "next-intl";
import { Phone as PhoneIcon, Copy, Check, MapPin } from "lucide-react";
import { InlineField } from "@/components/ui/InlineField";

export interface CustomerHeroProps {
  name: string;
  /** Primary phone — always present on an order. */
  phone: string;
  /** Secondary phone — optional. */
  phone2: string | null;
  city: string | null;
  /** True when the panel is on a terminal status — mutes hero treatment. */
  terminal: boolean;
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
 * Hero card for the order panel. Anchors the customer's identity:
 * `User name` as the visual lead (22px semibold), city + dark phone capsule
 * with inline call + copy + edit, and an optional secondary phone row.
 *
 * On terminal statuses the name softens to ink-secondary and the dark phone
 * capsule is replaced by a flat row — the order is closed, the call action
 * is no longer meaningful.
 */
export function CustomerHero({
  name,
  phone,
  phone2,
  city,
  terminal,
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
    <section
      className="mx-4 mt-3 rounded-card bg-surface-card border border-line-subtle px-4 py-4 shadow-panel-elevated"
      aria-label={t("client")}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted mb-1.5">
        {t("client")}
      </span>
      <div className="mb-3">
        <InlineField
          value={name}
          onCommit={(v) => onCommitName(v)}
          displayMode
          readOnly={!canEdit}
          displayClassName={[
            "text-[22px] font-semibold leading-tight",
            terminal ? "text-ink-secondary" : "text-ink-primary",
          ].join(" ")}
        />
      </div>

      {city ? (
        <div className="flex items-center gap-1.5 mb-3 text-[12px] text-ink-secondary">
          <MapPin size={12} strokeWidth={2} aria-hidden="true" />
          <span>{city}</span>
        </div>
      ) : null}

      {terminal ? (
        <div className="flex items-center gap-2 w-full rounded-card bg-surface-page border border-line-subtle ps-3 pe-3 py-2.5 text-[14px] font-semibold tabular-nums tracking-wide text-ink-secondary">
          <PhoneIcon size={13} strokeWidth={2} aria-hidden="true" className="flex-shrink-0" />
          <span className="truncate">{phone}</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 w-full rounded-card bg-ink-primary text-white ps-3 pe-2 py-2.5 transition-colors duration-fast">
          <a
            href={`tel:${phone}`}
            aria-label={`${t("callAction")} ${phone}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors duration-fast flex-shrink-0"
          >
            <PhoneIcon size={14} strokeWidth={2} aria-hidden="true" />
          </a>
          <div className="flex-1 min-w-0">
            <InlineField
              value={phone}
              onCommit={(v) => onCommitPhone(v.trim())}
              validate={validatePhone}
              type="tel"
              displayMode
              readOnly={!canEdit}
              placeholder={t("fieldPhone")}
              className="text-[15px] font-semibold tabular-nums tracking-wide"
              displayClassName="text-[15px] font-semibold tabular-nums tracking-wide !text-white hover:bg-white/10 focus:bg-white/10"
            />
          </div>
          <button
            type="button"
            onClick={onCopyPhone}
            aria-label={t("copyPhone")}
            className="inline-flex items-center justify-center w-7 h-7 rounded-card text-white/60 hover:text-white hover:bg-white/10 transition-colors duration-fast flex-shrink-0"
          >
            {phoneCopied ? (
              <Check size={13} strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Copy size={13} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        </div>
      )}

      {(phone2 || canEdit) && !terminal ? (
        <div className="flex items-center gap-2 mt-2.5">
          <InlineField
            value={phone2 ?? ""}
            onCommit={(v) => onCommitPhone2(v || null)}
            type="tel"
            displayMode
            readOnly={!canEdit}
            // Empty + editable reads as "add one", not as a label for a missing field.
            placeholder={canEdit ? (phone2 ? t("fieldPhone2") : t("addPhone2")) : ""}
            displayClassName="text-[13px] text-ink-secondary tabular-nums"
          />
          {phone2 ? (
            <a
              href={`tel:${phone2}`}
              aria-label="Call secondary"
              className="inline-flex items-center justify-center w-7 h-7 rounded-card border border-line-subtle text-ink-secondary hover:text-ink-primary hover:bg-surface-hover transition-colors duration-fast flex-shrink-0"
            >
              <PhoneIcon size={12} strokeWidth={2} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Voluntarily silent unused-prop guard for isLibyaOrder so the caller
          contract stays explicit; validate already encodes the rule. */}
      <span aria-hidden="true" data-is-libya={isLibyaOrder ? "1" : "0"} hidden />
    </section>
  );
}
