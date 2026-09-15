"use client";

/**
 * One prospect, opened on its own page.
 *
 * The old `/leads/[id]` was the last screen still wearing the pre-2026 CRM
 * look: inline styles, its own grey shell, a bare "← Prospects" link. This is
 * the same information in the console's language — the cards, the chips, the
 * situation tone, the timeline — so a manager moving between the two does not
 * feel they changed product.
 *
 * Pure: the prospect, the clock and every action arrive as props.
 * Design: prototypes/prospects-manager-v1.html (panelHTML).
 */
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Calendar, CheckCircle2, MapPin, Megaphone,
  MessageSquare, Phone, RotateCcw, ShoppingCart, User,
} from "lucide-react";
import { BUCKET_TONE, formatPhone, historyOf, situationOf } from "@/lib/prospects/presentation";
import type { ProspectRow } from "@/lib/prospects/types";
import { isTerminalLeadStatus, type LeadStatus } from "@/types/lead";
import { Chip, Ltr, Money, SIT_ICON, TONE, useDuration, useSituationLabel } from "../ui";
import { CARD, Empty, OUTLINE, PRIMARY } from "../console/ui";
import { ProspectTimeline, type TimelineEntry } from "./ProspectTimeline";

export interface ProspectDetailViewProps {
  row: ProspectRow | null;
  history: TimelineEntry[];
  isLoading: boolean;
  error: string | null;

  /** Everyone who can open this page gets every action. */
  onLogAttempt: () => void;
  onQualify: () => void;
  onConvert: () => void;
  onCallback: () => void;
  onMarkLost: () => void;
  onArchive: () => void;

  busy: boolean;
  actionError: string | null;
  marketCode: "ly" | "tn";
  tz: string;
  locale: string;
  now: number;
}

export function ProspectDetailView(props: ProspectDetailViewProps) {
  const {
    row, history, isLoading, error,
    onLogAttempt, onQualify, onConvert, onCallback, onMarkLost, onArchive,
    busy, actionError, marketCode, tz, locale, now,
  } = props;

  const t = useTranslations("prospects.console");
  const tp = useTranslations("prospects");
  const duration = useDuration();
  const situationLabel = useSituationLabel(tz, locale);

  const back = (
    <Link
      href={`/${locale}/leads`}
      className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[#6B7280] transition-colors hover:text-[#111827]"
    >
      <ArrowLeft size={15} aria-hidden className="rtl:rotate-180" />
      {tp("title")}
    </Link>
  );

  if (isLoading) {
    return (
      <Shell back={back} locale={locale}>
        <div role="status" className={`flex flex-col gap-3 p-5 ${CARD}`}>
          <span className="h-6 w-48 animate-pulse rounded-[6px] bg-[#F3F4F6]" aria-hidden />
          <span className="h-4 w-32 animate-pulse rounded-[6px] bg-[#F3F4F6]" aria-hidden />
          <span className="h-24 w-full animate-pulse rounded-[6px] bg-[#F3F4F6]" aria-hidden />
        </div>
      </Shell>
    );
  }

  if (error || !row) {
    return (
      <Shell back={back} locale={locale}>
        <div className={`px-5 py-12 text-center ${CARD}`}>
          <AlertTriangle size={34} aria-hidden className="mx-auto text-[#D1D5DB]" />
          <p className="mb-0 mt-3 text-[15px] text-[#374151]">{tp("loadError")}</p>
        </div>
      </Shell>
    );
  }

  const sit = situationOf(row, now);
  const SitIcon = SIT_ICON[sit.key];
  const hist = historyOf(row);
  const terminal = isTerminalLeadStatus(row.status as LeadStatus);
  const isWon = Boolean(row.converted_order_id);
  const canConvert = row.status === "qualified" && !terminal;

  return (
    <Shell back={back} locale={locale}>
      <div className="flex flex-col gap-3.5">
        {/* Who, and where they stand. */}
        <header className={`flex flex-wrap items-start gap-3 p-4 ${CARD}`}>
          <div className="min-w-0 flex-1">
            <h1 className="m-0 text-[24px] font-bold leading-tight tracking-[-0.02em] text-[#111827] [unicode-bidi:plaintext]">
              {row.customer_name}
            </h1>
            <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-[13.5px] text-[#6B7280]">
              <Ltr>{formatPhone(row.customer_phone)}</Ltr>
              {row.customer_city ? <span className="[unicode-bidi:plaintext]">· {row.customer_city}</span> : null}
              <span>· {t("panel.createdAgo", { when: duration(Math.max(0, (now - Date.parse(row.created_at)) / 60_000)) })}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={BUCKET_TONE[row.bucket]} icon={SitIcon}>{situationLabel(sit)}</Chip>
            {row.product_price !== null ? (
              <span className="text-end">
                <b className="block text-[22px] font-bold leading-none tabular-nums text-[#111827]">
                  <Money amount={row.product_price} market={marketCode} locale={locale} />
                </b>
                <small className="text-[12px] text-[#6B7280]">
                  {isWon ? t("panel.order") : t("panel.potential")}
                </small>
              </span>
            ) : null}
          </div>
        </header>

        {actionError ? (
          <p role="alert" className="m-0 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13.5px] text-[#B91C1C]">
            {actionError}
          </p>
        ) : null}

        {/* Who owns it. The same block the console's panel shows. */}
        <div className={`flex items-center gap-2.5 rounded-xl px-4 py-3 ${
          row.assigned_name ? CARD : "border border-[#FECACA] bg-[#FEF2F2]"
        }`}>
          {row.assigned_name ? (
            <>
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F3F4F6] text-[13px] font-bold uppercase">
                {row.assigned_name.trim().charAt(0)}
              </span>
              <b className="text-[13.5px] font-semibold text-[#111827] [unicode-bidi:plaintext]">
                {t("panel.owns", { name: row.assigned_name })}
              </b>
            </>
          ) : (
            <>
              <AlertTriangle size={18} aria-hidden className="shrink-0 text-[#B91C1C]" />
              <b className="text-[13.5px] font-semibold text-[#B91C1C]">{t("panel.noAgent")}</b>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-2">
          <section className={`p-4 ${CARD}`}>
            <h2 className="m-0 mb-2.5 text-[14px] font-bold text-[#111827]">{t("panel.client")}</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13.5px] text-[#374151]">
              <li className="flex items-center gap-2">
                <Phone size={15} aria-hidden className="shrink-0 text-[#9CA3AF]" />
                <Ltr>{formatPhone(row.customer_phone)}</Ltr>
              </li>
              {row.customer_city || row.customer_address ? (
                <li className="flex items-start gap-2">
                  <MapPin size={15} aria-hidden className="mt-0.5 shrink-0 text-[#9CA3AF]" />
                  <span className="[unicode-bidi:plaintext]">
                    {[row.customer_city, row.customer_address].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ) : null}
              <li>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-semibold ${TONE[hist.tone].chip}`}>
                  {tp(`hist.${hist.key}`, { delivered: hist.delivered, returned: hist.returned })}
                </span>
              </li>
              {row.notes ? (
                <li className="rounded-lg bg-[#F3F4F6] px-3 py-2 text-[13px] [unicode-bidi:plaintext]">{row.notes}</li>
              ) : null}
            </ul>
          </section>

          <section className={`p-4 ${CARD}`}>
            <h2 className="m-0 mb-2.5 text-[14px] font-bold text-[#111827]">{t("panel.origin")}</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13.5px] text-[#374151]">
              <li className="flex items-center gap-2">
                <MessageSquare size={15} aria-hidden className="shrink-0 text-[#9CA3AF]" />
                {tp(`sources.${row.source}`)}
              </li>
              {row.product_name || row.product_note ? (
                <li className="flex items-start gap-2">
                  <ShoppingCart size={15} aria-hidden className="mt-0.5 shrink-0 text-[#9CA3AF]" />
                  <span className="[unicode-bidi:plaintext]">
                    {row.product_name ?? row.product_note}
                    {row.product_name && row.product_note ? (
                      <small className="mt-0.5 block text-[12.5px] text-[#6B7280]">{row.product_note}</small>
                    ) : null}
                  </span>
                </li>
              ) : null}
              {row.campaign_name ? (
                <li className="flex items-start gap-2">
                  <Megaphone size={15} aria-hidden className="mt-0.5 shrink-0 text-[#9CA3AF]" />
                  <span className="[unicode-bidi:plaintext]">
                    {row.campaign_name}
                    {row.campaign_offer ? (
                      <small className="mt-0.5 block text-[12.5px] text-[#6B7280]">{row.campaign_offer}</small>
                    ) : null}
                  </span>
                </li>
              ) : null}
              {row.source_order_id ? (
                <li className="flex items-start gap-2">
                  <RotateCcw size={15} aria-hidden className="mt-0.5 shrink-0 text-[#9CA3AF]" />
                  <span>
                    {t("panel.returnOf", { ref: row.source_order_ref ?? "—" })}
                    {row.return_reason ? (
                      <small className="mt-1 block rounded-lg bg-[#F3F4F6] px-2 py-1.5 text-[12.5px] [unicode-bidi:plaintext]">
                        {row.return_reason}
                      </small>
                    ) : null}
                  </span>
                </li>
              ) : null}
            </ul>
          </section>
        </div>

        <section className={`p-4 ${CARD}`}>
          <h2 className="m-0 mb-3 text-[14px] font-bold text-[#111827]">{t("panel.history")}</h2>
          {history.length === 0 ? (
            <Empty>{t("empty.pipeline")}</Empty>
          ) : (
            <ProspectTimeline entries={history} tz={tz} locale={locale} now={now} />
          )}
        </section>

        {/* What can be done from here. Every role that reaches this page gets
            every action; the server still decides what it will accept. */}
        {!terminal ? (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-[#E5E7EB] bg-white px-4 py-3">
            <button type="button" onClick={onLogAttempt} disabled={busy} className={`h-10 px-3.5 text-[14px] ${OUTLINE}`}>
              <Phone size={15} aria-hidden />
              {tp("outcome.noAnswer")}
            </button>
            <button type="button" onClick={onCallback} disabled={busy} className={`h-10 px-3.5 text-[14px] ${OUTLINE}`}>
              <Calendar size={15} aria-hidden />
              {tp("outcome.callback")}
            </button>
            {row.status !== "qualified" ? (
              <button type="button" onClick={onQualify} disabled={busy} className={`h-10 px-3.5 text-[14px] ${OUTLINE}`}>
                <CheckCircle2 size={15} aria-hidden />
                {tp("buckets.hot")}
              </button>
            ) : null}
            <button type="button" onClick={onMarkLost} disabled={busy}
              className={`h-10 px-3.5 text-[14px] ${OUTLINE} border-[#F87171] text-[#B91C1C]`}>
              {t("panel.close")}
            </button>
            <button type="button" onClick={onArchive} disabled={busy}
              className={`h-10 px-3.5 text-[13.5px] ${OUTLINE} text-[#6B7280]`}>
              {t("detail.archive")}
            </button>
            <button
              type="button"
              onClick={onConvert}
              disabled={busy || !canConvert}
              title={canConvert ? undefined : t("detail.qualifyFirst")}
              className={`ms-auto h-10 min-w-[180px] px-4 text-[14px] ${PRIMARY}`}
            >
              <ShoppingCart size={16} aria-hidden />
              {tp("actions.convert")}
            </button>
          </div>
        ) : (
          <p className="m-0 rounded-xl bg-[#F9FAFB] px-4 py-3 text-center text-[13.5px] text-[#6B7280]">
            {isWon
              ? t("panel.seeOrder", { ref: row.converted_order_ref ?? "—" })
              : t("panel.lostFor", { reason: row.status })}
          </p>
        )}
      </div>
    </Shell>
  );
}

/** The page frame: the back link, then the content, on the app's own ground. */
function Shell({ back, locale, children }: { back: React.ReactNode; locale: string; children: React.ReactNode }) {
  return (
    <div className={`mx-auto flex w-full max-w-[1100px] flex-col gap-3 px-4 pb-10 pt-4 text-start lg:px-5 ${
      locale === "ar" ? "font-cairo" : ""
    }`}>
      {back}
      {children}
    </div>
  );
}
