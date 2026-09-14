"use client";

/**
 * The call outcome: four buttons, then whatever the chosen one needs. A
 * bottom sheet on the phone, a centred dialog on desktop — one frame for both,
 * the way the delivery worklist does it.
 *
 * "Veut commander" is not an outcome saved here: it opens the pre-filled
 * order, and the prospect becomes converted when that order is created.
 *
 * Design: prototypes/prospects-v3.html (screen 3).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, Calendar, CheckCircle2, ShoppingCart, X, XCircle } from "lucide-react";
import { callbackChoices } from "@/lib/prospects/presentation";
import type { Outcome } from "@/lib/prospects/worklist";
import type { ProspectRow } from "@/lib/prospects/types";
import { OUTLINE_BTN, PRIMARY_BTN } from "./ui";

/** What the view hands back: the outcome plus the note the agent typed. */
export type OutcomeDraft =
  | { kind: "no_answer"; note: string | null }
  | { kind: "callback"; at: string; note: string | null }
  | { kind: "lost"; reason: string; note: string | null };

const LOST_REASONS = ["price", "not_interested", "competitor", "wrong_number", "autre"] as const;

interface Props {
  row: ProspectRow;
  now: number;
  tz: string;
  locale: string;
  onClose: () => void;
  onSave: (draft: OutcomeDraft) => void;
  onConvert: (row: ProspectRow) => void;
}

export function OutcomeSheet({ row, now, tz, locale, onClose, onSave, onConvert }: Props) {
  const t = useTranslations("prospects");
  const panel = useRef<HTMLDivElement>(null);
  const [kind, setKind] = useState<"no_answer" | "callback" | "lost" | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choices = callbackChoices(now, tz);
  const ready = kind === "no_answer" || (kind === "callback" && at !== null) || (kind === "lost" && reason !== null);

  const save = () => {
    if (!ready || !kind) return;
    const trimmed = note.trim() === "" ? null : note.trim();
    if (kind === "no_answer") onSave({ kind, note: trimmed });
    else if (kind === "callback" && at) onSave({ kind, at, note: trimmed });
    else if (kind === "lost" && reason) onSave({ kind, reason, note: trimmed });
  };

  const option = (
    value: "no_answer" | "callback" | "lost" | "order",
    label: string,
    Icon: typeof Ban,
    active: string,
  ) => (
    <button
      type="button"
      aria-pressed={kind === value}
      onClick={() => {
        if (value === "order") { onConvert(row); return; }
        setKind(value);
        setAt(null);
        setReason(null);
      }}
      className={[
        "flex h-16 flex-col items-center justify-center gap-1.5 rounded-[10px] border px-2 text-center text-[13.5px] font-semibold leading-tight transition-colors",
        kind === value ? `${active} ring-2 ring-[#111827] ring-offset-1` : active,
      ].join(" ")}
    >
      <Icon size={19} aria-hidden />
      <span>{label}</span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(17,24,39,0.34)] lg:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("outcome.title")}
        className={`max-h-[88vh] w-full overflow-y-auto rounded-t-[20px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-2.5 text-start outline-none lg:w-[560px] lg:rounded-2xl lg:pb-6 lg:pt-5 ${locale === "ar" ? "font-cairo" : ""}`}
      >
        <div className="mx-auto mb-3 h-[5px] w-11 rounded bg-[#D1D5DB] lg:hidden" aria-hidden />

        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[18px] font-bold text-[#111827]">{t("outcome.title")}</h2>
            <p className="mt-0.5 mb-0 truncate text-[13.5px] text-[#6B7280] [unicode-bidi:plaintext]">{row.customer_name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("close")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#6B7280] hover:bg-[#F3F4F6]">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {option("order", t("outcome.order"), ShoppingCart, "border-[#86EFAC] bg-[#DCFCE7] text-[#15803D]")}
          {option("callback", t("outcome.callback"), Calendar, "border-[#93C5FD] bg-[#DBEAFE] text-[#1D4ED8]")}
          {option("no_answer", t("outcome.noAnswer"), XCircle, "border-[#D1D5DB] bg-white text-[#374151]")}
          {option("lost", t("outcome.lost"), Ban, "border-[#F87171] bg-[#FEE2E2] text-[#B91C1C]")}
        </div>

        {kind === "callback" ? (
          <fieldset className="mt-4 rounded-[10px] border border-dashed border-[#D1D5DB] p-3">
            <legend className="px-1 text-[13px] font-semibold text-[#374151]">{t("outcome.when")}</legend>
            <div className="flex flex-wrap gap-2">
              {choices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={at === c.at}
                  onClick={() => setAt(c.at)}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13.5px] font-medium ${
                    at === c.at ? "border-[#111827] bg-[#111827] text-white" : "border-[#D1D5DB] bg-white text-[#374151]"
                  }`}
                >
                  <Calendar size={15} aria-hidden />
                  {t(`when.${c.key}`)}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {kind === "lost" ? (
          <fieldset className="mt-4 rounded-[10px] border border-dashed border-[#D1D5DB] p-3">
            <legend className="px-1 text-[13px] font-semibold text-[#374151]">{t("outcome.why")}</legend>
            <div className="flex flex-wrap gap-2">
              {LOST_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={reason === r}
                  onClick={() => setReason(r)}
                  className={`inline-flex h-9 items-center rounded-lg border px-3 text-[13.5px] font-medium ${
                    reason === r ? "border-[#111827] bg-[#111827] text-white" : "border-[#D1D5DB] bg-white text-[#374151]"
                  }`}
                >
                  {t(`lost.${r}`)}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-semibold text-[#374151]">{t("outcome.note")}</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("outcome.notePlaceholder")}
            rows={2}
            className="w-full resize-y rounded-lg border border-[#D1D5DB] px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-[#15803D] focus:ring-2 focus:ring-[#15803D]/20"
          />
        </label>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className={`h-12 flex-1 border-[#E5E7EB] ${OUTLINE_BTN}`}>
            {t("outcome.cancel")}
          </button>
          <button type="button" disabled={!ready} onClick={save} className={`h-12 flex-1 text-[15px] ${PRIMARY_BTN}`}>
            <CheckCircle2 size={18} aria-hidden />
            {t("outcome.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
