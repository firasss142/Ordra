"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useTranslations, useLocale } from "next-intl";
import { formatCurrency, formatDate } from "@/lib/format";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";

interface WithdrawalRow {
  id: string;
  amount: number;
  status: "requested" | "approved" | "rejected" | "paid";
  requested_at: string;
  decided_at: string | null;
  paid_at: string | null;
  payout_reference: string | null;
}

const TONE: Record<WithdrawalRow["status"], "neutral" | "action" | "success" | "critical"> = {
  requested: "neutral",
  approved: "action",
  paid: "success",
  rejected: "critical",
};

export function WithdrawalsClient({
  available,
  market,
}: {
  available: number;
  market: string;
}) {
  const t = useTranslations("investor.withdrawals");
  const tc = useTranslations("investor.errors");
  const locale = useLocale();
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const {
    data,
    error: listError,
    isLoading,
    mutate: mutateList,
  } = useSWR<{ data: WithdrawalRow[] }>("/api/investor/withdrawals");
  const rows = data?.data ?? [];

  // Subscribe to the portfolio rather than trusting the SSR prop. `available`
  // was previously frozen at first render, so an admin approving or paying a
  // request in another tab never showed here — and the component mutated this
  // exact key without subscribing to it.
  const { data: portfolioData } = useSWR<{ data: { balance: { available: number } } }>(
    "/api/investor/portfolio"
  );
  const liveAvailable = portfolioData?.data?.balance?.available ?? available;

  // Anything already requested or approved is spoken for, so the form reflects
  // what is genuinely left. If the list failed to load we cannot know what is
  // claimed, so the form is disabled rather than showing an inflated figure.
  //
  // Millimes, not floats. `605.34 - (300 + 305.34)` in binary floating point is
  // 1.1368683772161603e-13, not 0 — which left the submit button enabled at a
  // displayed balance of 0,000 and, via the old `max` attribute, handed the
  // browser an absurd ceiling that blocked every submit silently.
  const claimedMillimes = rows
    .filter((r) => r.status === "requested" || r.status === "approved")
    .reduce((acc, r) => acc + toMillimes(Number(r.amount)), 0);
  const spendableMillimes = Math.max(0, toMillimes(liveAvailable) - claimedMillimes);
  const spendable = fromMillimes(spendableMillimes);
  const balanceUnknown = Boolean(listError);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;

    // Compare in millimes so a value equal to the balance is never rejected by
    // a floating-point hair.
    if (toMillimes(value) > spendableMillimes) {
      setMessage({ kind: "error", text: t("exceeds") });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/investor/withdrawals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: value }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // The API returns a stable code, not prose. Passing its raw English
        // through to an Arabic-locale investor is not an error message.
        const text =
          body.error === "AMOUNT_EXCEEDS_AVAILABLE" ? t("exceeds") : tc("generic");
        setMessage({ kind: "error", text });
        return;
      }

      setAmount("");
      setMessage({ kind: "success", text: t("success") });
      await mutateList();
      await mutate("/api/investor/portfolio");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-surface-card border border-line-subtle rounded-card p-4 sm:p-5">
        <h2 className="m-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
          {t("available")}
        </h2>
        {/* The withdrawable figure is what this screen is about, so it leads
            rather than sitting as a 12px caption above the form. */}
        <p
          className={`m-0 mt-1 text-[28px] font-bold leading-[1.1] tabular-nums ${
            spendableMillimes > 0 ? "text-status-success" : "text-ink-primary"
          }`}
        >
          {formatCurrency(spendable, market)}
        </p>

        <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1" htmlFor="withdrawal-amount">
            <span className="mb-1 block text-[12px] text-ink-secondary">{t("amount")}</span>
            {/* Deliberately NO `max`. Native constraint validation blocks
                submit before onSubmit fires, so an over-balance amount used to
                do nothing at all — no request, no message, a dead button. The
                check below owns this, and it can explain itself. */}
            <input
              id="withdrawal-amount"
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={spendableMillimes <= 0 || balanceUnknown}
              className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] tabular-nums text-ink-primary disabled:bg-surface-page disabled:text-ink-muted"
            />
          </label>
          <div className="flex gap-2">
            {/* Typing a three-decimal balance by hand to withdraw all of it is
                an invitation to fat-finger it and hit the "exceeds" error. */}
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={spendableMillimes <= 0 || balanceUnknown}
              onClick={() => setAmount(String(spendable))}
            >
              {t("all")}
            </Button>
            <Button
              type="submit"
              size="md"
              disabled={submitting || spendableMillimes <= 0 || balanceUnknown}
            >
              {t("submit")}
            </Button>
          </div>
        </form>

        {/* A disabled button that will not say why is a dead end. */}
        {!message && (spendableMillimes <= 0 || balanceUnknown) ? (
          <p className="m-0 mt-3 text-[12px] text-ink-secondary">
            {balanceUnknown ? tc("load") : t("nothingAvailable")}
          </p>
        ) : null}

        {message ? (
          <p
            role="alert"
            className={`m-0 mt-3 text-[12px] ${
              message.kind === "error" ? "text-status-critical" : "text-status-success"
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      <section className="bg-surface-card border border-line-subtle rounded-card p-4 sm:p-5">
        <h2 className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
          {t("history")}
        </h2>

        {listError ? (
          // Never render "you have no withdrawals" because a request failed —
          // that is a false statement about someone's money.
          <div className="py-6 text-center">
            <p className="m-0 mb-3 text-[13px] text-ink-secondary">{tc("load")}</p>
            <Button variant="secondary" onClick={() => void mutateList()}>
              {tc("retry")}
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[52px] w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="m-0 py-6 text-center text-[13px] text-ink-secondary">{t("empty")}</p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line-subtle">
            {rows.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="m-0 text-[14px] font-medium tabular-nums text-ink-primary">
                    {formatCurrency(Number(row.amount), market)}
                  </p>
                  {/* decided_at and paid_at were both fetched and both dropped,
                      so a request that had been approved a week ago and paid
                      yesterday displayed only the day it was asked for — the
                      one date that never changes. */}
                  <ol className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                    <li className="text-[12px] text-ink-secondary">
                      {t("requestedOn", { date: formatDate(row.requested_at, locale) })}
                    </li>
                    {row.decided_at ? (
                      <li className="text-[12px] text-ink-secondary">
                        {t("decidedOn", { date: formatDate(row.decided_at, locale) })}
                      </li>
                    ) : null}
                    {row.paid_at ? (
                      <li className="text-[12px] text-status-success">
                        {t("paidOn", { date: formatDate(row.paid_at, locale) })}
                      </li>
                    ) : null}
                    {row.payout_reference ? (
                      <li className="text-[12px] text-ink-secondary">
                        {t("reference")}: {row.payout_reference}
                      </li>
                    ) : null}
                  </ol>
                </div>
                <Badge tone={TONE[row.status]}>{t(`status.${row.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
