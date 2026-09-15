"use client";

/**
 * The panel on the right of the pipeline: who this person is, where they came
 * from, and who owns them.
 *
 * The owner block sits above everything else and turns red when nobody owns
 * the prospect, because that is the manager's question about any given row.
 * They supervise, edit and reassign here — they never call; that is the
 * agent's worklist.
 *
 * Design: prototypes/prospects-manager-v1.html (panelHTML).
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle, MapPin, Megaphone, MessageSquare, Phone, RotateCcw, User,
} from "lucide-react";
import { BUCKET_TONE, formatPhone, historyOf, situationOf } from "@/lib/prospects/presentation";
import type { ProspectRow } from "@/lib/prospects/types";
import { Chip, Ltr, Money, SIT_ICON, TONE, useDuration, useSituationLabel } from "../ui";
import { CARD, Field, INPUT, OUTLINE, PRIMARY } from "./ui";

export interface ProspectPanelProps {
  row: ProspectRow | null;
  onClose: () => void;
  onAssign: (id: string) => void;
  onCloseLead: (id: string) => void;
  onReopen: (id: string) => void;
  onSave: (id: string, patch: Partial<ProspectRow>) => Promise<void>;
  marketCode: "ly" | "tn";
  tz: string;
  locale: string;
  now: number;
}

type Draft = Pick<ProspectRow, "customer_name" | "customer_phone" | "customer_city" | "customer_address" | "notes">;

export function ProspectPanel({
  row, onClose, onAssign, onCloseLead, onReopen, onSave, marketCode, tz, locale, now,
}: ProspectPanelProps) {
  const t = useTranslations("prospects.console");
  const tp = useTranslations("prospects");
  const duration = useDuration();
  const situationLabel = useSituationLabel(tz, locale);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  // A different prospect means a different form; never carry one row's edits
  // onto another.
  useEffect(() => {
    setEditing(false);
    setDraft(null);
  }, [row?.id]);

  if (!row) {
    return (
      <aside className={`hidden min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center xl:flex ${CARD}`}>
        <User size={40} aria-hidden className="text-[#D1D5DB]" />
        <p className="m-0 text-[14.5px] text-[#6B7280]">{t("panel.pick")}</p>
      </aside>
    );
  }

  const sit = situationOf(row, now);
  const SitIcon = SIT_ICON[sit.key];
  const hist = historyOf(row);
  const isLost = row.status === "lost";
  const isWon = Boolean(row.converted_order_id);

  const start = () => {
    setDraft({
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      customer_city: row.customer_city,
      customer_address: row.customer_address,
      notes: row.notes,
    });
    setEditing(true);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await onSave(row.id, draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className={`flex flex-col gap-3 p-4 xl:sticky xl:top-4 ${CARD}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[21px] font-bold text-[#111827] [unicode-bidi:plaintext]">
            {row.customer_name}
          </h2>
          <p className="m-0 mt-0.5 text-[13px] text-[#6B7280]">
            <Ltr>{formatPhone(row.customer_phone)}</Ltr>
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={tp("close")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#374151] hover:bg-[#F3F4F6]">
          <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={BUCKET_TONE[row.bucket]} icon={SitIcon}>{situationLabel(sit)}</Chip>
        <span className="rounded-full border border-[#D1D5DB] px-2 py-0.5 text-[12px] font-medium text-[#374151]">
          {tp(`sources.${row.source}`)}
        </span>
        {row.product_price !== null ? (
          <span className="ms-auto text-end">
            <b className="block text-[22px] font-bold tabular-nums text-[#111827]">
              <Money amount={row.product_price} market={marketCode} locale={locale} />
            </b>
            <small className="text-[12px] text-[#6B7280]">
              {isWon ? t("panel.order") : t("panel.potential")}
            </small>
          </span>
        ) : null}
      </div>

      {/* Who owns this. The manager's first question about any row. */}
      <div className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 ${
        row.assigned_name ? "bg-[#F9FAFB]" : "border border-[#FECACA] bg-[#FEF2F2]"
      }`}>
        {row.assigned_name ? (
          <>
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#F3F4F6] text-[13px] font-bold uppercase">
              {row.assigned_name.trim().charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[13.5px] font-semibold text-[#111827] [unicode-bidi:plaintext]">
                {t("panel.owns", { name: row.assigned_name })}
              </b>
              <small className="text-[12.5px] text-[#6B7280]">
                {t("panel.createdAgo", { when: duration(Math.max(0, (now - Date.parse(row.created_at)) / 60_000)) })}
              </small>
            </span>
            <button type="button" onClick={() => onAssign(row.id)} className={`h-8 shrink-0 px-2.5 text-[13px] ${OUTLINE}`}>
              {t("panel.reassign")}
            </button>
          </>
        ) : (
          <>
            <AlertTriangle size={18} aria-hidden className="shrink-0 text-[#B91C1C]" />
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] font-semibold text-[#B91C1C]">{t("panel.noAgent")}</b>
              <small className="text-[12.5px] text-[#374151]">
                {t("panel.createdAgo", { when: duration(Math.max(0, (now - Date.parse(row.created_at)) / 60_000)) })}
              </small>
            </span>
            <button type="button" onClick={() => onAssign(row.id)} className={`h-8 shrink-0 px-2.5 text-[13px] ${PRIMARY}`}>
              {t("panel.assign")}
            </button>
          </>
        )}
      </div>

      {editing && draft ? (
        <div className={`flex flex-col gap-2.5 p-3 ${CARD}`}>
          <Field label={t("panel.name")}>
            <input className={INPUT} value={draft.customer_name}
              onChange={(e) => setDraft({ ...draft, customer_name: e.target.value })} />
          </Field>
          <Field label={t("panel.phone")}>
            <input className={INPUT} dir="ltr" value={draft.customer_phone}
              onChange={(e) => setDraft({ ...draft, customer_phone: e.target.value })} />
          </Field>
          <Field label={t("panel.area")}>
            <input className={INPUT} value={draft.customer_city ?? ""}
              onChange={(e) => setDraft({ ...draft, customer_city: e.target.value || null })} />
          </Field>
          <Field label={t("panel.note")}>
            <textarea className={`${INPUT} h-auto min-h-[64px] py-2`} value={draft.notes ?? ""}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} />
          </Field>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className={`h-9 flex-1 text-[13.5px] ${PRIMARY}`}>
              {t("panel.save")}
            </button>
            <button type="button" onClick={() => setEditing(false)} className={`h-9 px-3 text-[13.5px] ${OUTLINE}`}>
              {t("panel.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-1">
          <section className={`p-3 ${CARD}`}>
            <h3 className="m-0 mb-2 flex items-center gap-2 text-[13.5px] font-bold text-[#111827]">
              {t("panel.client")}
              <button type="button" onClick={start} className="ms-auto text-[12.5px] font-semibold text-[#2563EB] hover:underline">
                {t("panel.edit")}
              </button>
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] text-[#374151]">
              <li className="flex items-center gap-2">
                <Phone size={14} aria-hidden className="shrink-0 text-[#9CA3AF]" />
                <Ltr>{formatPhone(row.customer_phone)}</Ltr>
              </li>
              {row.customer_city || row.customer_address ? (
                <li className="flex items-start gap-2">
                  <MapPin size={14} aria-hidden className="mt-0.5 shrink-0 text-[#9CA3AF]" />
                  <span className="[unicode-bidi:plaintext]">
                    {[row.customer_city, row.customer_address].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ) : null}
              <li>
                {/* The customer's own record, in the tone presentation.ts chose. */}
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-semibold ${TONE[hist.tone].chip}`}>
                  {tp(`hist.${hist.key}`, { delivered: hist.delivered, returned: hist.returned })}
                </span>
              </li>
              {row.notes ? (
                <li className="rounded-lg bg-[#F3F4F6] px-2.5 py-2 text-[12.5px] [unicode-bidi:plaintext]">
                  {row.notes}
                </li>
              ) : null}
            </ul>
          </section>

          <section className={`p-3 ${CARD}`}>
            <h3 className="m-0 mb-2 text-[13.5px] font-bold text-[#111827]">{t("panel.origin")}</h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px] text-[#374151]">
              <li className="flex items-center gap-2">
                <MessageSquare size={14} aria-hidden className="shrink-0 text-[#9CA3AF]" />
                {tp(`sources.${row.source}`)}
              </li>
              {row.campaign_name ? (
                <li className="flex items-start gap-2">
                  <Megaphone size={14} aria-hidden className="mt-0.5 shrink-0 text-[#9CA3AF]" />
                  <span className="[unicode-bidi:plaintext]">
                    {row.campaign_name}
                    {row.campaign_offer ? <small className="block text-[12px] text-[#6B7280]">{row.campaign_offer}</small> : null}
                  </span>
                </li>
              ) : null}
              {row.source_order_id ? (
                <li className="flex items-start gap-2">
                  <RotateCcw size={14} aria-hidden className="mt-0.5 shrink-0 text-[#9CA3AF]" />
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
      )}

      {/* What a manager may do from here. Never "call". */}
      <div className="flex gap-2 border-t border-[#E5E7EB] pt-3">
        {isLost ? (
          <button type="button" onClick={() => onReopen(row.id)} className={`h-10 flex-1 text-[14px] ${OUTLINE} border-[#86EFAC] text-[#15803D]`}>
            {t("panel.reopen")}
          </button>
        ) : isWon ? (
          <span className="flex-1 text-center text-[13.5px] text-[#6B7280]">
            {t("panel.seeOrder", { ref: row.converted_order_ref ?? "—" })}
          </span>
        ) : (
          <>
            <button type="button" onClick={() => onAssign(row.id)} className={`h-10 flex-1 text-[14px] ${OUTLINE}`}>
              {row.assigned_name ? t("panel.reassign") : t("panel.assign")}
            </button>
            <button type="button" onClick={() => onCloseLead(row.id)} className={`h-10 px-3.5 text-[14px] ${OUTLINE} border-[#F87171] text-[#B91C1C]`}>
              {t("panel.close")}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
