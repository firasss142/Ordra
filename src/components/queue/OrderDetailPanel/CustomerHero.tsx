"use client";

import { useTranslations } from "next-intl";
import { InlineField } from "@/components/ui/InlineField";
import { Ic } from "@/components/orders/commandes/ui";
import type { ReliabilityChip } from "@/lib/orders/row-signals";

export interface CustomerHeroProps {
  name: string;
  /** Primary phone — always present on an order. */
  phone: string;
  /** Secondary phone — optional. */
  phone2: string | null;
  /** True when the panel is on a terminal status — the call action is moot. */
  terminal: boolean;
  /**
   * The customer's record before this order (`reliabilityChip`). `null` while
   * it loads — the chip stays out rather than flashing a verdict it may revise.
   */
  reliability: ReliabilityChip | null;
  /** True when the agent / manager can inline-edit the customer fields. */
  canEdit: boolean;
  onCommitName: (v: string) => void;
  onCommitPhone: (v: string) => void;
  onCommitPhone2: (v: string | null) => void;
  onCopyPhone: () => void;
  phoneCopied: boolean;
  /** Returns null to mean "valid" — same contract as InlineField. */
  validatePhone: (v: string) => string | null;
  /** Opens the Messages tab. */
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
 * The client block (prototypes/commandes-v4.html `.pc`): the name as the
 * panel's title, WhatsApp and Appeler on the right across two rows, then the
 * number with its copy glyph and the reliability chip, then the second phone.
 */
export function CustomerHero({
  name,
  phone,
  phone2,
  terminal,
  reliability,
  canEdit,
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
    <section className="pc" aria-label={t("client")}>
      <div className="pc-n">
        <h2 dir="auto">
          <InlineField value={name} onCommit={(v) => onCommitName(v)} displayMode readOnly={!canEdit} displayClassName="!text-[22px] !leading-[1.2] !text-[#0F1728]" />
        </h2>
      </div>

      {!terminal && (
        <div className="pc-btns">
          {whatsappState && onWhatsApp && (
            <button
              type="button"
              className="btn2 wa"
              data-state={whatsappState}
              aria-disabled={whatsappState === "opted_out" || undefined}
              aria-label={tWa("button")}
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
            >
              <Ic n="wa" />
              {tWa("button")}
              {whatsappState === "active" && whatsappUnread > 0 && <em>{whatsappUnread}</em>}
            </button>
          )}
          <a className="btn" href={`tel:${phone}`} aria-label={`${t("callAction")} ${phone}`}>
            <Ic n="phone" />
            {t("callAction")}
          </a>
        </div>
      )}

      <div className="pc-ph">
        <span className="num">
          <InlineField
            value={phone}
            onCommit={(v) => onCommitPhone(v.trim())}
            validate={validatePhone}
            type="tel"
            displayMode
            readOnly={!canEdit}
            placeholder={t("fieldPhone")}
            displayClassName="!text-[14px] !text-[#475467] tabular-nums"
          />
        </span>
        <button type="button" className="mini" onClick={onCopyPhone} aria-label={t("copyPhone")}>
          <Ic n={phoneCopied ? "check" : "copy"} />
        </button>
        {reliability && <RelChip chip={reliability} />}
      </div>

      {!terminal && phone2 ? (
        <div className="pc-add pc-2nd">
          <span className="num">
            <InlineField
              value={phone2}
              onCommit={(v) => onCommitPhone2(v || null)}
              type="tel"
              displayMode
              readOnly={!canEdit}
              placeholder={t("fieldPhone2")}
              displayClassName="!text-[13px] !text-[#475467] tabular-nums"
            />
          </span>
          <a className="mini" href={`tel:${phone2}`} aria-label={`${t("callAction")} ${phone2}`}>
            <Ic n="phone" />
          </a>
        </div>
      ) : !terminal && canEdit ? (
        <div className="pc-add">
          <span className="lnk">
            <Ic n="plus" />
            <InlineField
              value=""
              onCommit={(v) => onCommitPhone2(v || null)}
              type="tel"
              displayMode
              placeholder={t("addPhone2")}
              displayClassName="!text-[12.5px] !text-[#15803D] !not-italic font-bold"
            />
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** « À risque · 2 sur 5 non livrées » red · « Fiable · 4 livrées » green · « Nouveau client » (prototype `relChip`). */
function RelChip({ chip }: { chip: ReliabilityChip }) {
  const t = useTranslations("orders.detail");
  if (chip.kind === "risk") {
    return (
      <span className="rel h-red" data-testid="customer-reliability" data-verdict="risk">
        <Ic n="alert" />
        {t("relRisk", { lost: chip.lost, of: chip.of })}
      </span>
    );
  }
  if (chip.kind === "ok") {
    return (
      <span className="rel h-green" data-testid="customer-reliability" data-verdict="ok">
        <Ic n="check" />
        {t("relOk", { n: chip.delivered })}
      </span>
    );
  }
  return (
    <span className="rel h-neutral" data-testid="customer-reliability" data-verdict="new">
      {t("relNew")}
    </span>
  );
}
