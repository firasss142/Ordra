"use client";

/**
 * The prospect panel: who they are, why they are in front of you, and the one
 * thing to do about it. Exported twice — a sticky aside on desktop, a
 * full-screen page with a sticky action bar on the phone — because a side
 * panel and a phone screen share almost nothing but their content.
 *
 * Design: prototypes/prospects-v3.html (the three phone screens).
 */
import { ChevronLeft, ChevronRight, Megaphone, Package, Phone, RotateCcw, ShoppingCart, User, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  BUCKET_TONE, formatPhone, historyOf, moveFor, nextActionOf, situationOf,
} from "@/lib/prospects/presentation";
import type { ProspectRow } from "@/lib/prospects/types";
import {
  Chip, EDGE, Ltr, Money, OUTLINE_BTN, PRIMARY_BTN, SIT_ICON, TONE,
  WhatsAppIcon, timeOnMarketClock, useSituationLabel,
} from "./ui";

export interface DetailHandlers {
  onCall: (row: ProspectRow) => void;
  onWhatsApp: (row: ProspectRow) => void;
  onOutcome: (row: ProspectRow) => void;
  onConvert: (row: ProspectRow) => void;
  onOpenOrder: (row: ProspectRow) => void;
}

interface Props extends DetailHandlers {
  row: ProspectRow;
  market: "ly" | "tn";
  locale: string;
  tz: string;
  now: number;
}

const card = "rounded-xl border border-[#E5E7EB] bg-white px-4 py-3.5";
const kvRow = "flex items-center justify-between gap-3 border-t border-[#F3F4F6] py-2 text-[14px] first:border-t-0";

function KeyValue({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className={kvRow}>
      <span className="shrink-0 text-[#6B7280]">{k}</span>
      <span className="min-w-0 text-end font-medium text-[#111827]">{children}</span>
    </div>
  );
}

/** Everything between the header and the action bar. Shared by both shells. */
function DetailBody({ row, market, locale, tz, now, onCall, onWhatsApp }: Props) {
  const t = useTranslations("prospects");
  const situationLabel = useSituationLabel(tz, locale);

  const tone = BUCKET_TONE[row.bucket];
  const sit = situationOf(row, now);
  const next = nextActionOf(row, now);
  const move = moveFor(row, now);
  const history = historyOf(row);
  const SitIcon = SIT_ICON[sit.key];

  // The number to dial: the second one when the first has stopped answering.
  const dial = move.dial;

  return (
    <div className="flex flex-col gap-3">
      {/* Who, at a glance. */}
      <div className={`${card} ${EDGE} ${TONE[tone].edge}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="m-0 text-[19px] font-bold text-[#111827] [unicode-bidi:plaintext]">{row.customer_name}</h3>
            <p className="mt-1 text-[14px] text-[#374151] [unicode-bidi:plaintext]">{row.customer_city ?? "—"}</p>
          </div>
          {row.product_price !== null ? (
            <div className="text-end">
              <Money amount={row.product_price} market={market} locale={locale} className="text-[22px] font-bold text-[#111827]" />
              <div className="mt-0.5 text-[12px] text-[#6B7280]">
                {row.bucket === "converted" ? t("value.order") : t("value.potential")}
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Chip tone={tone} icon={SitIcon}>{situationLabel(sit)}</Chip>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E5E7EB] px-2.5 py-1 text-[13px] text-[#374151]">
            {t(`sources.${row.source}`)}
          </span>
        </div>
      </div>

      {/* What to do, and why now. */}
      <div className={`${card} ${EDGE} ${TONE[tone].edge} ${TONE[tone].soft} border-0`}>
        <p className="m-0 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]">
          {t("outcome.title")}
        </p>
        <p className="mt-1 mb-0 text-[18px] font-bold leading-tight text-[#111827]">{t(next.titleKey)}</p>
        <p className="mt-1.5 mb-0 text-[14px] leading-snug text-[#374151]">
          {t(next.whyKey, next.whyValues)}
        </p>
      </div>

      {/* The message they actually sent. */}
      {row.notes ? (
        <div className="rounded-xl border border-[#CBEBC3] bg-[#E7F8E2] px-4 py-3 text-[14px] leading-relaxed text-[#111827] [unicode-bidi:plaintext]">
          <p className="m-0 mb-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#4B7A45]">{t("message")}</p>
          {row.notes}
        </div>
      ) : null}

      {/* The client. */}
      <section className={card}>
        <h4 className="m-0 mb-1 flex items-center gap-2 text-[15px] font-bold text-[#111827]">
          <User size={16} aria-hidden className="text-[#6B7280]" />
          {t("client.title")}
        </h4>
        <KeyValue k={t("client.phone")}>
          <span className="inline-flex items-center gap-2">
            <Ltr>{formatPhone(row.customer_phone)}</Ltr>
            {dial === row.customer_phone ? (
              <span className="rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[12px] font-semibold text-[#15803D]">
                {t("client.recommended")}
              </span>
            ) : null}
          </span>
        </KeyValue>
        <KeyValue k={t("client.city")}>
          <span className="line-clamp-1 [unicode-bidi:plaintext]">
            {row.last_known_address ?? row.customer_address ?? row.customer_city ?? "—"}
          </span>
        </KeyValue>
        <KeyValue k={t("client.history")}>
          <span className={history.tone === "red" ? "text-[#B91C1C]" : history.tone === "green" ? "text-[#15803D]" : "text-[#374151]"}>
            {t(`hist.${history.key}`, { delivered: history.delivered, returned: history.returned })}
          </span>
        </KeyValue>
      </section>

      {/* Where it came from. */}
      <section className={card}>
        <h4 className="m-0 mb-1 flex items-center gap-2 text-[15px] font-bold text-[#111827]">
          <Megaphone size={16} aria-hidden className="text-[#6B7280]" />
          {t("origin.title")}
        </h4>
        <KeyValue k={t("origin.source")}>{t(`sources.${row.source}`)}</KeyValue>
        {row.assigned_name ? <KeyValue k={t("origin.agent")}>{row.assigned_name}</KeyValue> : null}
        <KeyValue k={t("origin.created")}>
          <Ltr>{timeOnMarketClock(row.created_at, tz, locale)}</Ltr>
        </KeyValue>
        {row.campaign_name ? <KeyValue k={t("origin.campaign")}>{row.campaign_name}</KeyValue> : null}
        {row.campaign_offer ? (
          <KeyValue k={t("origin.offer")}>
            <span className="rounded-md bg-[#EDE9FE] px-2 py-0.5 text-[13px] font-semibold text-[#5B21B6]">
              {row.campaign_offer}
            </span>
          </KeyValue>
        ) : null}
        {row.converted_order_ref ? <KeyValue k={t("origin.order")}><Ltr>{row.converted_order_ref}</Ltr></KeyValue> : null}
        {row.return_reason ? (
          <KeyValue k={t("origin.reason")}>
            <span className="line-clamp-2 text-[13.5px] [unicode-bidi:plaintext]">{row.return_reason}</span>
          </KeyValue>
        ) : null}
      </section>

      {/* The product, only when there is one. */}
      {row.product_name ? (
        <section className={`${card} flex items-center gap-3`}>
          <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-[#E5E7EB] bg-[#F3F4F6]">
            {row.product_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.product_image_url} alt={row.product_name} width={44} height={44} loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <Package size={20} aria-hidden className="text-[#9CA3AF]" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-[#111827]">{row.product_name}</span>
            {row.product_note ? <span className="block truncate text-[13px] text-[#6B7280]">{row.product_note}</span> : null}
          </span>
          {row.product_price !== null ? (
            <Money amount={row.product_price} market={market} locale={locale} className="text-[16px] font-bold text-[#111827]" />
          ) : null}
        </section>
      ) : null}

      {/* The campaign script — only a campaign has one. */}
      {row.campaign_script ? (
        <section className="rounded-xl border border-[#DDD6FE] bg-[#EDE9FE] px-4 py-3.5">
          <h4 className="m-0 mb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#5B21B6]">{t("script")}</h4>
          <p className="m-0 whitespace-pre-wrap text-[14px] leading-relaxed text-[#3B1E7A] [unicode-bidi:plaintext]">
            {row.campaign_script}
          </p>
        </section>
      ) : null}

      {/* WhatsApp lives in the body on desktop; the phone has it in the bar. */}
      <button
        type="button"
        onClick={() => onWhatsApp(row)}
        className={`hidden h-11 w-full border-[#86EFAC] text-[#15803D] lg:inline-flex ${OUTLINE_BTN}`}
      >
        <WhatsAppIcon size={18} />
        {t("actions.whatsapp")}
      </button>
    </div>
  );
}

/** The action bar: the call, then the outcome. Identical in both shells. */
function DetailActions({ row, now, onCall, onOutcome, onOpenOrder, onConvert }: Props) {
  const t = useTranslations("prospects");
  const move = moveFor(row, now);

  if (row.bucket === "converted") {
    return (
      <button type="button" onClick={() => onOpenOrder(row)} className={`h-12 w-full text-[16px] ${PRIMARY_BTN}`}>
        <ShoppingCart size={19} aria-hidden />
        {t("moves.order")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={() => onCall(row)} className={`h-12 w-full text-[16px] ${PRIMARY_BTN}`}>
        {move.kind === "resend" ? <RotateCcw size={19} aria-hidden /> : <Phone size={19} aria-hidden />}
        <Ltr>{formatPhone(move.dial)}</Ltr>
      </button>
      <div className="flex gap-2">
        <button type="button" onClick={() => onConvert(row)} className={`h-11 flex-1 border-[#86EFAC] text-[#15803D] ${OUTLINE_BTN}`}>
          <ShoppingCart size={17} aria-hidden />
          {t("actions.convert")}
        </button>
        <button type="button" onClick={() => onOutcome(row)} className={`h-11 flex-1 border-[#E5E7EB] ${OUTLINE_BTN}`}>
          {t("outcome.title")}
        </button>
      </div>
    </div>
  );
}

/** Desktop: the sticky aside beside the list. */
export function ProspectDetailPanel(props: Props & { onClose: () => void }) {
  const t = useTranslations("prospects");
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-[#F9FAFB]">
      <div className="flex items-center gap-2 border-b border-[#E5E7EB] bg-white px-4 py-3">
        <h2 className="m-0 flex-1 text-[16px] font-bold text-[#111827]">{t("detail")}</h2>
        <button type="button" onClick={props.onClose} aria-label={t("close")} className="grid h-8 w-8 place-items-center rounded-lg text-[#6B7280] hover:bg-[#F3F4F6]">
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        <DetailBody {...props} />
      </div>
      <div className="border-t border-[#E5E7EB] bg-white p-3.5">
        <DetailActions {...props} />
      </div>
    </div>
  );
}

/** Phone: the full screen, with the action bar pinned above the home bar. */
export function ProspectDetailScreen(props: Props & { onBack: () => void }) {
  const t = useTranslations("prospects");
  const Back = props.locale === "ar" ? ChevronRight : ChevronLeft;
  return (
    <div className={`fixed inset-0 z-[60] flex flex-col bg-[#F5F6F8] lg:hidden ${props.locale === "ar" ? "font-cairo" : ""}`}>
      <div className="flex items-center gap-2 border-b border-[#E5E7EB] bg-white px-2.5 py-2.5">
        <button type="button" onClick={props.onBack} aria-label={t("back")} className="grid h-9 w-9 place-items-center rounded-lg text-[#111827] hover:bg-[#F3F4F6]">
          <Back size={20} aria-hidden />
        </button>
        <h2 className="m-0 flex-1 text-center text-[17px] font-bold text-[#111827]">{t("detail")}</h2>
        <span className="h-9 w-9" aria-hidden />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5">
        <DetailBody {...props} />
      </div>
      <div className="border-t border-[#E5E7EB] bg-white px-3.5 pt-3 pb-[max(14px,env(safe-area-inset-bottom))]">
        <DetailActions {...props} />
      </div>
    </div>
  );
}
