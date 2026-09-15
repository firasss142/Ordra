"use client";

/**
 * The two short sheets: give these prospects to one agent, or close them with
 * a reason.
 *
 * Closing is soft on purpose. The prospect leaves the agent's queue and can be
 * reopened any time — a manager tidying a list should not be able to destroy
 * a customer record. There is no hard delete anywhere on this page.
 *
 * Design: prototypes/prospects-manager-v1.html (the assign and lost sheets).
 */
import { useTranslations } from "next-intl";
import { LEAD_LOST_REASONS, type LeadLostReason } from "@/types/lead";
import { Avatar, DARK, Field, fmt, INPUT, OUTLINE, PRIMARY, Sheet, Toggle } from "./ui";

export interface AssignSheetProps {
  count: number;
  agents: { id: string; name: string; open_leads: number; hot_waiting: number; calls_today: number }[];
  cap: number;
  value: string | null;
  onValue: (id: string) => void;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  locale: string;
}

export function AssignSheet({
  count, agents, cap, value, onValue, busy, error, onConfirm, onClose, locale,
}: AssignSheetProps) {
  const t = useTranslations("prospects.console");

  return (
    <Sheet
      title={t("a.t")}
      sub={t("a.sub", { n: count })}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`ms-auto h-11 px-4 text-[14px] ${OUTLINE}`}>
            {t("panel.cancel")}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || !value}
            className={`h-11 min-w-[140px] px-4 text-[14px] ${PRIMARY}`}>
            {t("a.go")}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-[13.5px] text-[#B91C1C]">
          {error}
        </p>
      ) : null}

      <Field label={t("a.to")}>
        <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
          {agents.map((a, i) => {
            const on = value === a.id;
            return (
              <label
                key={a.id}
                data-on={on}
                className={`grid cursor-pointer grid-cols-[auto_28px_1fr_auto] items-center gap-2.5 px-3 py-2.5 text-[13.5px] ${
                  i > 0 ? "border-t border-[#F3F4F6]" : ""
                } ${on ? "bg-[#F1FAF4]" : ""}`}
              >
                <input type="radio" name="assign-to" checked={on} onChange={() => onValue(a.id)} className="accent-[#15803D]" />
                <Avatar name={a.name} size="sm" />
                <span className="min-w-0">
                  <b className="block truncate font-semibold text-[#111827] [unicode-bidi:plaintext]">{a.name}</b>
                  <small className="text-[12px] text-[#6B7280]">
                    {t("a.queue", { n: fmt(a.open_leads, locale) })}
                    {a.hot_waiting > 0
                      ? ` · ${t("agt.hotWait", { n: a.hot_waiting, minutes: 0 })}`
                      : ` · ${t("a.none")}`}
                  </small>
                </span>
                <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-[#374151]">
                  {t("agt.cap", { calls: a.calls_today, cap })}
                </span>
              </label>
            );
          })}
        </div>
      </Field>
    </Sheet>
  );
}

export interface CloseSheetProps {
  count: number;
  reason: LeadLostReason | null;
  onReason: (r: LeadLostReason) => void;
  note: string;
  onNote: (s: string) => void;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function CloseSheet({
  count, reason, onReason, note, onNote, busy, error, onConfirm, onClose,
}: CloseSheetProps) {
  const t = useTranslations("prospects.console");
  const tLost = useTranslations("prospects.lost");

  // `autre` without a note violates a CHECK on `leads`; the button waits.
  const needsNote = reason === "autre" && note.trim() === "";

  return (
    <Sheet
      title={t("l.t")}
      sub={t("l.sub", { n: count })}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={`ms-auto h-11 px-4 text-[14px] ${OUTLINE}`}>
            {t("panel.cancel")}
          </button>
          <button type="button" onClick={onConfirm} disabled={busy || !reason || needsNote}
            className={`h-11 min-w-[130px] px-4 text-[14px] ${DARK}`}>
            {t("l.go")}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-[13.5px] text-[#B91C1C]">
          {error}
        </p>
      ) : null}

      <Field label={t("l.reason")}>
        <div className="flex flex-wrap gap-1.5">
          {LEAD_LOST_REASONS.map((r) => (
            <Toggle key={r} on={reason === r} onClick={() => onReason(r)}>
              {tLost(r)}
            </Toggle>
          ))}
        </div>
      </Field>

      <Field
        label={t("l.note")}
        hint={needsNote ? t("cb.errors.empty") : undefined}
      >
        <textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          className={`${INPUT} h-auto min-h-[72px] py-2`}
        />
      </Field>
    </Sheet>
  );
}
