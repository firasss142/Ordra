"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { balanceAfterPayout, fmtCommission, payoutCrossesZero } from "@/lib/commissions/view-models";
import { PAYOUT_METHODS, type PayoutMethod } from "@/lib/commissions/types";

export interface PayoutRequest {
  agent_id: string;
  amount: number;
  paid_at: string;
  method: PayoutMethod;
  reference: string | null;
  note: string | null;
  allow_negative: boolean;
}

interface Props {
  open: boolean;
  agent: { id: string; name: string; balance: number } | null;
  marketCode: string;
  currency: string;
  tz: string;
  locale: string;
  onClose: () => void;
  /** resolves { ok } — the caller owns the API call and the toast */
  onSubmit: (req: PayoutRequest) => Promise<{ ok: boolean }>;
}

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * "Enregistrer un paiement". Money leaves the company here, so the modal is
 * explicit about two things: the payment is dated the day the cash changed
 * hands (not today), and paying more than the agent has earned needs a
 * checked confirmation — the server refuses it otherwise.
 */
export function PayoutModal({ open, agent, marketCode, currency, tz, locale, onClose, onSubmit }: Props) {
  const t = useTranslations("team.commissions.payout");
  const tm = useTranslations("team.commissions.method");
  const [amount, setAmount] = useState<string>("");
  const [date, setDate] = useState<string>(() => todayIn(tz));
  const [method, setMethod] = useState<PayoutMethod>("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [confirmNeg, setConfirmNeg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !agent) return;
    setAmount(agent.balance > 0 ? String(agent.balance) : "");
    setDate(todayIn(tz));
    setMethod("cash");
    setReference("");
    setNote("");
    setConfirmNeg(false);
    setError(null);
  }, [open, agent, tz]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const parsed = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [amount]);
  const after = agent && parsed !== null ? balanceAfterPayout(agent.balance, parsed) : null;
  const crosses = agent && parsed !== null ? payoutCrossesZero(agent.balance, parsed) : false;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date);

  if (!open || !agent) return null;

  async function submit() {
    if (!agent) return;
    if (parsed === null || !dateOk) { setError(t("invalid")); return; }
    if (crosses && !confirmNeg) return;
    setBusy(true);
    setError(null);
    const r = await onSubmit({
      agent_id: agent.id,
      amount: parsed,
      paid_at: `${date}T12:00:00.000Z`,
      method,
      reference: reference.trim() || null,
      note: note.trim() || null,
      allow_negative: crosses,
    });
    setBusy(false);
    if (r.ok) onClose();
    else setError(t("failed"));
  }

  const inputCls = "h-9 w-full rounded-md border border-line bg-surface-card px-3 text-[14px] text-ink-primary tabular-nums";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(26,26,26,0.5)]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="payout-title"
        className="w-[460px] max-w-[94vw] rounded-lg bg-surface-card p-5 shadow-floating"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="payout-title" className="text-[16px] font-semibold text-ink-primary" dir="auto">{t("title", { name: agent.name })}</h3>
        <p className="mt-1 text-[12.5px] text-ink-secondary">{t("hint", { balance: fmtCommission(agent.balance, marketCode, { signed: true }) })}</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-primary">
            {t("amount", { currency })}
            <input type="number" min="0" step="0.5" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-primary">
            {t("date")}
            <input type="date" value={date} max={todayIn(tz)} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-primary">
            {t("method")}
            <select value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)} className={`${inputCls} cursor-pointer`}>
              {PAYOUT_METHODS.map((m) => <option key={m} value={m}>{tm(m)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-primary">
            {t("reference")} <span className="font-normal text-ink-muted">{t("optional")}</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("refPlaceholder")} className={inputCls} />
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1 text-[12.5px] font-medium text-ink-primary">
          {t("note")} <span className="font-normal text-ink-muted">{t("optional")}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} rows={2} className="rounded-md border border-line bg-surface-card px-3 py-2 text-[14px] text-ink-primary" />
        </label>

        <div className="mt-4 flex items-center justify-between border-t border-line-subtle pt-3 text-[13.5px]">
          <span>{t("after")}</span>
          <b className={`text-[16px] tabular-nums ${after !== null && after < 0 ? "text-status-critical" : "text-ink-primary"}`}>
            {after === null ? "—" : fmtCommission(after, marketCode, { signed: true })}
          </b>
        </div>

        {crosses && after !== null && (
          <div className="mt-3 rounded-md border border-[#F0D48A] bg-status-warningBg px-3 py-2.5 text-[12.5px] text-hue-amber-ink">
            {t("warn", { after: fmtCommission(after, marketCode, { signed: true }) })}
            <label className="mt-2 flex items-center gap-2 font-medium text-ink-primary">
              <input type="checkbox" checked={confirmNeg} onChange={(e) => setConfirmNeg(e.target.checked)} />
              {t("confirmNegative")}
            </label>
          </div>
        )}
        {error && <p className="mt-2 text-[12.5px] text-status-critical">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-surface-hover">{t("cancel")}</button>
          <button
            type="button"
            disabled={busy || parsed === null || !dateOk || (crosses && !confirmNeg)}
            onClick={() => void submit()}
            className="rounded-md bg-brand px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-brand-hover disabled:cursor-default disabled:opacity-60"
          >
            {busy ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
