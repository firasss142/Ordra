"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useTranslations, useLocale } from "next-intl";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

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
  const locale = useLocale();
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const { data } = useSWR<{ data: WithdrawalRow[] }>("/api/investor/withdrawals");
  const rows = data?.data ?? [];

  // Anything already requested or approved is spoken for, so the form reflects
  // what is genuinely left rather than letting the investor queue requests that
  // jointly exceed the balance and get rejected by the API.
  const claimed = rows
    .filter((r) => r.status === "requested" || r.status === "approved")
    .reduce((acc, r) => acc + Number(r.amount), 0);
  const spendable = Math.max(0, available - claimed);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;

    if (value > spendable) {
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
        setMessage({ kind: "error", text: body.error ?? t("exceeds") });
        return;
      }

      setAmount("");
      setMessage({ kind: "success", text: t("success") });
      await mutate("/api/investor/withdrawals");
      await mutate("/api/investor/portfolio");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-surface-card border border-line-subtle rounded-[10px] p-4 sm:p-5">
        <h2 className="m-0 mb-1 text-[15px] font-semibold text-ink-primary">{t("request")}</h2>
        <p className="m-0 mb-4 text-[12px] text-ink-secondary">
          {t("available")}: {formatCurrency(spendable, market)}
        </p>

        <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 sm:items-end">
          <label className="flex-1">
            <span className="block mb-1 text-[12px] text-ink-secondary">{t("amount")}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              max={spendable}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-[6px] border border-line-DEFAULT bg-surface-card px-3 py-2 text-[14px] tabular-nums text-ink-primary"
            />
          </label>
          <Button type="submit" disabled={submitting || spendable <= 0}>
            {t("submit")}
          </Button>
        </form>

        {message ? (
          <p
            role="status"
            className={`m-0 mt-3 text-[12px] ${
              message.kind === "error" ? "text-status-critical" : "text-status-success"
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      <section className="bg-surface-card border border-line-subtle rounded-[10px] p-4 sm:p-5">
        <h2 className="m-0 mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">
          {t("history")}
        </h2>

        {rows.length === 0 ? (
          <p className="m-0 py-6 text-center text-[13px] text-ink-secondary">{t("empty")}</p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line-subtle">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="m-0 text-[14px] font-medium tabular-nums text-ink-primary">
                    {formatCurrency(Number(row.amount), market)}
                  </p>
                  <p className="m-0 text-[12px] text-ink-secondary">
                    {formatDate(row.requested_at, locale)}
                    {row.payout_reference ? ` · ${row.payout_reference}` : ""}
                  </p>
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
