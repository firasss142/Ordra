"use client";

/**
 * Moving parcels from one agent to another, after upload.
 *
 * Decision 37 allowed this, which decision 1 had read as forbidden: ownership
 * until terminal now means the CURRENT owner, not the confirming agent. Two
 * ways in: an absent agent's whole live list, or a hand-picked selection when
 * one agent is drowning.
 *
 * The warning is not decoration. Decision 38 makes the delivery commission
 * follow the new owner, so every reassignment is a pay event — the manager has
 * to see that before confirming, not discover it on payday.
 *
 * Design: prototypes/suivi-livraison-manager-v1.html (the reassign sheet).
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, RotateCcw } from "lucide-react";
import type { AgentBoard } from "@/lib/delivery/board";
import type { WorklistRow } from "@/lib/delivery/types";
import { orderRef } from "@/lib/delivery/presentation";
import { Ltr, Money, OUTLINE_BTN, PRIMARY_BTN } from "./ui";

export interface ReassignSheetProps {
  /** The parcels that will move. */
  rows: WorklistRow[];
  /** Everyone who could receive them; the current owner is filtered out. */
  agents: AgentBoard[];
  market: "ly" | "tn";
  locale: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (targetAgentId: string) => void;
}

export function ReassignSheet({ rows, agents, market, locale, busy, error, onClose, onConfirm }: ReassignSheetProps) {
  const t = useTranslations("delivery");
  const [pick, setPick] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // The owners the parcels are leaving: one name when a single agent's list is
  // moving, several when the manager hand-picked across the market.
  const owners = [...new Set(rows.map((r) => r.agent_name).filter(Boolean))] as string[];
  const targets = agents.filter((a) => !(owners.length === 1 && a.name === owners[0]));

  return (
    <div role="dialog" aria-modal="true" aria-label={t("reassign.title")}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[#111827]/40 px-4">
      <div ref={ref} className={`max-h-[92vh] w-full max-w-[540px] overflow-y-auto rounded-2xl bg-white p-5 text-start shadow-[0_20px_50px_rgba(16,24,40,0.25)] ${locale === "ar" ? "font-cairo" : ""}`}>
        <h2 className="flex items-center gap-2.5 text-[19px] font-bold text-[#111827]">
          <RotateCcw size={19} aria-hidden className="text-[#6B7280]" />{t("reassign.title")}
        </h2>
        <p className="mt-1.5 text-[14px] leading-snug text-[#6B7280]">
          {t("reassign.lead", { n: rows.length, from: owners.join(", ") || "—" })}
        </p>

        <div className="mt-2.5 max-h-[150px] overflow-y-auto rounded-[10px] border border-[#E5E7EB] px-2.5 text-[13px]">
          {rows.map((r) => (
            <div key={r.order_id} className="flex items-center gap-2 border-t border-[#E5E7EB] py-1.5 first:border-t-0">
              <span className="truncate [unicode-bidi:plaintext]">{r.customer_name}</span>
              <Ltr className="shrink-0 text-[#6B7280]">#{orderRef(r)}</Ltr>
              <Money amount={r.total_price} market={market} locale={locale} className="ms-auto shrink-0 font-semibold" />
            </div>
          ))}
        </div>

        <div className="mt-4">
          <p className="mb-2 text-[13px] font-semibold text-[#111827]">{t("reassign.pick")}</p>
          <div role="radiogroup" aria-label={t("reassign.pick")} className="grid gap-1.5">
            {targets.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={pick === a.id} onClick={() => setPick(a.id)}
                className={`flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-[14px] ${pick === a.id ? "border-[#15803D] bg-[#F0FDF4]" : "border-[#E5E7EB] hover:bg-[#F9FAFB]"}`}>
                <span aria-hidden className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${pick === a.id ? "border-[#15803D] bg-[#15803D]" : "border-[#D1D5DB]"}`}>
                  {pick === a.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#F3F4F6] text-[12px] font-bold text-[#374151]" aria-hidden>
                  {(a.name.trim()[0] ?? "?").toUpperCase()}
                </span>
                <span className="truncate [unicode-bidi:plaintext]">{a.name}</span>
                <span className="ms-auto shrink-0 whitespace-nowrap text-[12.5px] text-[#6B7280]">{t("board.inFlight", { n: a.inFlight })}</span>
              </button>
            ))}
            {targets.length === 0 && <p className="text-[13px] text-[#6B7280]">{t("reassign.noTarget")}</p>}
          </div>
        </div>

        <div className="mt-3.5 flex items-start gap-2.5 rounded-[10px] bg-[#FEF3C7] px-3 py-2.5 text-[13.5px] leading-snug text-[#92400E]">
          <AlertCircle size={17} aria-hidden className="mt-px shrink-0" />
          <span>{t("reassign.warn")}</span>
        </div>
        {error && (
          <div role="alert" className="mt-2.5 rounded-[10px] bg-[#FEE2E2] px-3 py-2.5 text-[13.5px] text-[#B91C1C]">{error}</div>
        )}

        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} disabled={busy} className={`h-11 shrink-0 px-4 text-[14px] ${OUTLINE_BTN} border-[#D1D5DB] disabled:opacity-50`}>
            {t("reassign.cancel")}
          </button>
          <button type="button" onClick={() => pick && onConfirm(pick)} disabled={!pick || busy}
            className={`h-11 flex-1 text-[14.5px] ${PRIMARY_BTN} disabled:opacity-40`}>
            <RotateCcw size={17} aria-hidden />{busy ? t("reassign.working") : t("reassign.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
