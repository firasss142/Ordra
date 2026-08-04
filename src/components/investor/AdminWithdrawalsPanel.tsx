"use client";

import { useState } from "react";
import useSWR from "swr";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Panel, EmptyState } from "@/components/dashboard/Panel";

interface WithdrawalRow {
  id: string;
  investor_id: string;
  market_id: string;
  amount: number;
  status: "requested" | "approved" | "rejected" | "paid";
  requested_at: string;
  decided_at: string | null;
  paid_at: string | null;
  payout_reference: string | null;
  note: string | null;
  investors: { legal_name: string } | { legal_name: string }[] | null;
}

type Action = "approve" | "reject" | "mark_paid";

const TONE: Record<WithdrawalRow["status"], "neutral" | "action" | "success" | "critical"> = {
  requested: "neutral",
  approved: "action",
  paid: "success",
  rejected: "critical",
};

const LABEL: Record<WithdrawalRow["status"], string> = {
  requested: "Demandé",
  approved: "Approuvé",
  rejected: "Refusé",
  paid: "Payé",
};

/** Legal transitions, mirroring the route's own guard. */
const ALLOWED: Record<WithdrawalRow["status"], Action[]> = {
  requested: ["approve", "reject"],
  approved: ["mark_paid", "reject"],
  rejected: [],
  paid: [],
};

const ACTION_LABEL: Record<Action, string> = {
  approve: "Approuver",
  reject: "Refuser",
  mark_paid: "Marquer payé",
};

function rel<T extends object>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * The withdrawal approval queue.
 *
 * PATCH .../withdrawals/[id] already implemented the full state machine, but
 * nothing listed requests — so an investor could ask for money and no operator
 * could see it. Their balance sat claimed against a request nobody could act on.
 *
 * Marking paid is the only action that moves money (it writes the `withdrawal`
 * ledger row), so it is the only one that asks for a payout reference first.
 */
export function AdminWithdrawalsPanel({
  markets,
  locale,
}: {
  markets: { id: string; code: string; name: string }[];
  locale: string;
}) {
  // The endpoint has always supported ?status= and the panel never passed it,
  // so a queue with one actionable request and fifty settled ones looked the
  // same as fifty things to do.
  const [filter, setFilter] = useState<"open" | "all">("open");

  const { data, error, isLoading, mutate } = useSWR<{ data: WithdrawalRow[] }>(
    filter === "open"
      ? "/api/admin/investments/withdrawals?status=requested,approved"
      : "/api/admin/investments/withdrawals"
  );
  const rows = data?.data ?? [];

  const [busyId, setBusyId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState<{ text: string; detail?: string } | null>(null);

  const marketById = new Map(markets.map((m) => [m.id, m]));

  async function decide(row: WithdrawalRow, action: Action) {
    setBusyId(row.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/investments/withdrawals/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          action === "mark_paid"
            ? { action, payout_reference: reference.trim() || null }
            : { action }
        ),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // A 409 here means someone else already decided it. The mark-paid
        // failure path also returns the single most important message in the
        // system — "marked paid but the ledger entry failed, the balance is
        // overstated" — whose `detail` the panel used to drop on the floor.
        setMessage({ text: body.error ?? "La décision a échoué", detail: body.detail });
        return;
      }

      setPayingId(null);
      setReference("");
      await mutate();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel
      title="Demandes de retrait"
      actions={
        <div className="flex gap-1">
          {(["open", "all"] as const).map((key) => (
            <Button
              key={key}
              variant={filter === key ? "secondary" : "ghost"}
              onClick={() => setFilter(key)}
            >
              {key === "open" ? "À traiter" : "Toutes"}
            </Button>
          ))}
        </div>
      }
    >
      {error ? (
        // Never render "no requests" because a fetch failed — that is a false
        // statement about money someone is waiting on.
        <div className="py-6 text-center">
          <p className="m-0 mb-3 text-[13px] text-ink-secondary">
            Impossible de charger les demandes
          </p>
          <Button variant="secondary" onClick={() => void mutate()}>
            Réessayer
          </Button>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[56px] w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState label="Aucune demande de retrait" />
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line-subtle">
          {rows.map((row) => {
            const investor = rel(row.investors);
            const marketCode = (marketById.get(row.market_id)?.code ?? "tn").toUpperCase();
            const actions = ALLOWED[row.status];
            const isPaying = payingId === row.id;

            return (
              <li key={row.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="m-0 text-[14px] font-medium text-ink-primary">
                      {investor?.legal_name ?? "—"}
                    </p>
                    {/* Without the market, TN and LY requests interleave with
                        only the currency symbol to tell them apart. */}
                    <p className="m-0 text-[12px] tabular-nums text-ink-secondary">
                      {marketById.get(row.market_id)?.name ?? "—"} ·{" "}
                      {formatDate(row.requested_at, locale)}
                      {row.payout_reference ? ` · ${row.payout_reference}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-[14px] font-semibold tabular-nums text-ink-primary">
                      {formatCurrency(Number(row.amount), marketCode)}
                    </span>
                    <Badge tone={TONE[row.status]}>{LABEL[row.status]}</Badge>
                  </div>
                </div>

                {actions.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {actions.map((action) =>
                      action === "mark_paid" ? (
                        <Button
                          key={action}
                          variant="primary"
                          disabled={busyId === row.id}
                          onClick={() => {
                            setPayingId(row.id);
                            setReference("");
                          }}
                        >
                          {ACTION_LABEL[action]}
                        </Button>
                      ) : (
                        // "Refuser" is terminal and was styled identically to
                        // "Approuver" sitting right beside it.
                        <Button
                          key={action}
                          variant={action === "reject" ? "destructive" : "secondary"}
                          disabled={busyId === row.id}
                          onClick={() => void decide(row, action)}
                        >
                          {ACTION_LABEL[action]}
                        </Button>
                      )
                    )}
                  </div>
                ) : null}

                {isPaying ? (
                  <div className="flex flex-wrap items-end gap-2 rounded-[8px] border border-status-critical bg-status-criticalBg p-3">
                    {/* The warning used to sit AFTER the confirm button in DOM
                        order — read only by someone who had already clicked. */}
                    <p className="m-0 w-full text-[12px] text-status-critical">
                      Écrit une écriture au grand livre — irréversible.
                    </p>
                    <label className="min-w-[200px] flex-1 text-[12px]">
                      <span className="mb-1 block text-ink-secondary">
                        Référence de versement
                      </span>
                      <input
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] text-ink-primary"
                      />
                    </label>
                    <Button
                      variant="destructive"
                      disabled={busyId === row.id}
                      onClick={() => void decide(row, "mark_paid")}
                    >
                      Confirmer
                    </Button>
                    <Button variant="secondary" onClick={() => setPayingId(null)}>
                      Annuler
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {message ? (
        <div
          role="alert"
          className="mt-3 rounded-[8px] border border-status-critical bg-status-criticalBg p-3"
        >
          <p className="m-0 text-[13px] font-medium text-status-critical">{message.text}</p>
          {message.detail ? (
            <p className="m-0 mt-1 text-[12px] text-status-critical">{message.detail}</p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
