"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, NotebookText, Phone, Truck, X } from "lucide-react";
import type { WorklistRow } from "@/lib/delivery/types";
import { OUTCOMES_BY_ACTION, NOTE_MAX, type AgentActionType } from "@/lib/delivery/actions";
import { inTwoHours, tomorrowAt } from "@/lib/delivery/schedule";
import { buildWaLink, renderTemplate, suggestTemplate, TEMPLATE_KEYS, type CustomerLang, type TemplateKey } from "@/lib/delivery/whatsapp-templates";
import type { QueuedBody } from "@/hooks/useDeliveryActionQueue";
import { WhatsAppIcon } from "./ui";

/** Bottom sheet on mobile, centred dialog on desktop — one frame for both. */
function SheetFrame({ title, onClose, closeBoxed = false, children }: {
  title: string; onClose: () => void; closeBoxed?: boolean; children: React.ReactNode;
}) {
  const t = useTranslations("delivery");
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(17,24,39,0.34)] lg:items-center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-[20px] bg-white px-5 pb-6 pt-2.5 text-start outline-none lg:w-[580px] lg:rounded-2xl lg:pt-5"
      >
        <div className="mx-auto mb-3 h-[5px] w-11 rounded bg-[#D1D5DB] lg:hidden" aria-hidden />
        <div className="mb-3.5 flex items-center gap-2.5">
          <h2 id={headingId} className="text-[21px] font-bold text-[#111827]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("toast.close")}
            className={`ms-auto grid h-[34px] w-[34px] place-items-center rounded-lg text-[#374151] ${closeBoxed ? "border border-[#E5E7EB]" : ""}`}>
            <X size={22} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const Label = ({ children, extra }: { children: React.ReactNode; extra?: string }) => (
  <p className="mb-2 text-[15.5px] font-semibold text-[#111827]">
    {children}{extra && <span className="ms-1 font-normal text-[#6B7280]">{extra}</span>}
  </p>
);

type Picked = Exclude<AgentActionType, "whatsapp_customer">;
type Reminder = "in2h" | "tomorrow10" | "none";

const OUTCOME_TONE: Record<string, string> = {
  reached_will_receive: "bg-[#DCFCE7] text-[#15803D]", reached_address_fix: "bg-[#DCFCE7] text-[#15803D]",
  reattempt_promised: "bg-[#DCFCE7] text-[#15803D]", parcel_located: "bg-[#DCFCE7] text-[#15803D]",
  no_answer: "bg-[#FEF3C7] text-[#111827]", wrong_number: "bg-[#FEF3C7] text-[#111827]", phone_off: "bg-[#FEF3C7] text-[#111827]",
  courier_no_answer: "bg-[#FEF3C7] text-[#111827]", reached_wants_cancel: "bg-[#FEF3C7] text-[#111827]",
};
/** A promise of a callback suggests one; a settled outcome suggests none. */
const SUGGESTED_REMINDER: Record<string, Reminder> = {
  reached_reschedule: "in2h", no_answer: "in2h", phone_off: "in2h", courier_no_answer: "in2h", reattempt_promised: "in2h",
  reached_will_receive: "tomorrow10", reached_address_fix: "tomorrow10", parcel_located: "tomorrow10",
};

export function ActionSheet({ initialType, tz, now, onClose, onSubmit }: {
  initialType: Picked; tz: string; now: number;
  onClose: () => void; onSubmit: (body: QueuedBody) => void;
}) {
  const t = useTranslations("delivery");
  const [type, setType] = useState<Picked>(initialType);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reminder, setReminder] = useState<Reminder | null>(null);

  const tiles: [Picked, React.ReactNode][] = [
    ["call_customer", <Phone key="p" size={22} aria-hidden />],
    ["call_courier", <Truck key="t" size={22} aria-hidden />],
    ["call_branch", <Building2 key="b" size={22} aria-hidden />],
    ["note", <NotebookText key="n" size={22} aria-hidden />],
  ];
  const outcomes = type === "note" ? [] : OUTCOMES_BY_ACTION[type];
  const ready = type === "note" ? note.trim().length > 0 : outcome !== null;

  const submit = () => {
    if (!ready) return;
    const next = reminder === "in2h" ? inTwoHours(now) : reminder === "tomorrow10" ? tomorrowAt(now, tz, 10) : null;
    onSubmit({
      action_type: type,
      outcome: type === "note" ? "none" : (outcome as string),
      note: note.trim() || null,
      next_action_at: next,
      template_key: null,
    });
  };

  return (
    <SheetFrame title={t("sheet.title")} onClose={onClose}>
      <Label>{t("sheet.what")}</Label>
      <div className="mb-[18px] grid grid-cols-4 gap-2">
        {tiles.map(([k, icon]) => (
          <button key={k} type="button" aria-pressed={type === k}
            onClick={() => { setType(k); setOutcome(null); }}
            className={`flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] px-1 py-2 text-center text-sm leading-tight ${type === k ? "border-[#111111] bg-[#F3F4F6] font-medium text-[#111827]" : "border-[#E5E7EB] bg-white text-[#6B7280]"}`}>
            {icon}<span>{t(`sheet.types.${k}`)}</span>
          </button>
        ))}
      </div>

      {outcomes.length > 0 && (
        <>
          <Label>{t("sheet.result")}</Label>
          <div className="mb-[18px] flex flex-wrap gap-2">
            {outcomes.map((o) => (
              <button key={o} type="button" aria-pressed={outcome === o}
                onClick={() => { setOutcome(o); if (reminder === null) setReminder(SUGGESTED_REMINDER[o] ?? "none"); }}
                className={`h-10 whitespace-nowrap rounded-full px-[18px] text-[14.5px] ${outcome === o ? `font-semibold ${OUTCOME_TONE[o] ?? "bg-[#DBEAFE] text-[#1D4ED8]"}` : "bg-[#F3F4F6] text-[#374151]"}`}>
                {t(`sheet.outcomes.${o}`)}
              </button>
            ))}
          </div>
        </>
      )}

      <Label extra={type === "note" ? undefined : t("sheet.optional")}>{t("sheet.note")}</Label>
      <div className="relative mb-[18px]">
        <input type="text" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder={t("sheet.notePlaceholder")}
          className="h-12 w-full rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3.5 text-[15px] outline-none focus:border-[#111111] focus:bg-white" />
        {note.length > 0 && <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs tabular-nums text-[#9CA3AF]">{note.length}/{NOTE_MAX}</span>}
      </div>

      <Label>{t("sheet.reminder")}</Label>
      <div className="mb-[18px] grid grid-cols-3 gap-2">
        {([["in2h", t("sheet.in2h")], ["tomorrow10", t("sheet.tomorrow10")], ["none", t("sheet.noReminder")]] as [Reminder, string][]).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={reminder === k} onClick={() => setReminder(k)}
            className={`h-11 rounded-[10px] border text-[14.5px] ${reminder === k ? "border-[1.5px] border-[#111111] bg-[#F3F4F6] font-semibold text-[#111827]" : "border-[#D1D5DB] bg-white text-[#374151]"}`}>
            {l}
          </button>
        ))}
      </div>

      <button type="button" disabled={!ready} onClick={submit}
        className="h-[52px] w-full rounded-[10px] bg-[#111111] text-[17px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35">
        {t("sheet.save")}
      </button>
    </SheetFrame>
  );
}

export function WhatsAppSheet({ row, market, onClose, onSent }: {
  row: WorklistRow; market: "ly" | "tn";
  onClose: () => void; onSent: (body: QueuedBody) => void;
}) {
  const t = useTranslations("delivery");
  const [lang, setLang] = useState<CustomerLang>(market === "ly" ? "ar" : "fr");
  const [key, setKey] = useState<TemplateKey>(() => suggestTemplate(row));

  const parts = useMemo(() => renderTemplate(key, lang, {
    name: row.customer_name ?? "",
    amount: new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(row.total_price ?? 0).replace(/ | /g, " "),
    currency: lang === "ar" ? (market === "ly" ? "د.ل" : "د.ت") : market === "ly" ? "LYD" : "TND",
    carrier: row.carrier_name ?? "",
    courier: row.handler_name ?? "",
    address: [row.customer_address, row.customer_city].filter(Boolean).join("، "),
  }), [key, lang, market, row]);
  const text = parts.map((p) => p.text).join("");
  const link = buildWaLink(row.customer_phone, market, text) ?? buildWaLink(row.customer_phone_2, market, text);

  return (
    <SheetFrame title={t("wa.title")} onClose={onClose} closeBoxed>
      <div className="mb-4 flex justify-center">
        <div className="inline-flex rounded-full bg-[#F3F4F6] p-[3px]">
          {(["ar", "fr"] as CustomerLang[]).map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}
              className={`h-[34px] rounded-full px-[26px] text-sm ${lang === l ? "bg-white font-semibold text-[#111827] shadow-[0_0_0_1px_#D1D5DB]" : "text-[#6B7280]"}`}>
              {l === "ar" ? "العربية" : "Français"}
            </button>
          ))}
        </div>
      </div>

      <Label>{t("wa.template")}</Label>
      <div className="-mx-px mb-4 flex gap-2 overflow-x-auto p-px [scrollbar-width:none]">
        {TEMPLATE_KEYS.map((k) => (
          <button key={k} type="button" aria-pressed={key === k} onClick={() => setKey(k)}
            className={`h-10 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm ${key === k ? "border-[1.5px] border-[#1E8E5A] bg-[#E8F6EE] font-semibold text-[#14532D]" : "border-[#D1D5DB] bg-white text-[#374151]"}`}>
            {t(`wa.templates.${k}`)}
          </button>
        ))}
      </div>

      <Label>{t("wa.text")}</Label>
      <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="min-h-[150px] whitespace-pre-wrap rounded-xl border border-[#E5E7EB] px-4 py-3.5 text-[15.5px] leading-[1.75] text-[#111827]">
        {parts.map((p, i) => p.variable
          ? <mark key={i} className="rounded-[5px] bg-[#E8F6EE] px-1 font-semibold text-[#14532D]">{p.text}</mark>
          : <span key={i}>{p.text}</span>)}
      </div>
      <div className="mx-0.5 mb-4 mt-1.5 text-[12.5px] tabular-nums text-[#9CA3AF]">{text.length} / 1000</div>

      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer"
          onClick={() => onSent({ action_type: "whatsapp_customer", outcome: "sent", note: null, next_action_at: null, template_key: key })}
          className="flex h-[52px] items-center justify-center gap-2.5 rounded-[10px] bg-[#1E8E5A] text-[17px] font-semibold text-white">
          <WhatsAppIcon size={22} />{t("wa.open")}
        </a>
      ) : (
        <p className="rounded-[10px] bg-[#FEF3C7] px-4 py-3 text-sm text-[#92400E]">{t("wa.noPhone")}</p>
      )}
    </SheetFrame>
  );
}
