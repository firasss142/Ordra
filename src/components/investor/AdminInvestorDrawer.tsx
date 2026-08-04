"use client";

import useSWR from "swr";
import { formatCurrency, formatDate } from "@/lib/format";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import type { InvestorBalance, LedgerEntryType } from "@/lib/calculations/investor-balance";

const TYPE_LABEL: Record<LedgerEntryType, string> = {
  accrual: "Bénéfice accumulé",
  settlement: "Règlement de période",
  reserve_hold: "Mise en réserve",
  reserve_release: "Réserve libérée",
  withdrawal: "Retrait versé",
  correction: "Correction",
  principal_return: "Capital restitué",
};

/**
 * Which way each entry type moves withdrawable money.
 *
 * Not the raw sign: `reserve_hold` is stored positive but takes money out of
 * `available`, and `correction` is signed.
 */
function direction(type: LedgerEntryType, amount: number): -1 | 0 | 1 {
  switch (type) {
    case "settlement":
    case "reserve_release":
      return 1;
    case "reserve_hold":
    case "withdrawal":
    case "principal_return":
      return -1;
    default:
      return amount < 0 ? -1 : amount > 0 ? 1 : 0;
  }
}

interface LedgerPayload {
  balance: InvestorBalance;
  entries: {
    id: string;
    entry_type: LedgerEntryType;
    amount: number;
    note: string | null;
    created_at: string;
    product_name: string | null;
  }[];
  truncated: boolean;
}

/**
 * What one investor is owed, and why.
 *
 * The operator approving withdrawals previously had no view of any investor's
 * balance or history — strictly less information than the investor themselves.
 * The balance here is folded by the same `foldLedger` the portal uses, so the
 * two gates cannot quietly disagree.
 */
export function AdminInvestorDrawer({
  investorId,
  investorName,
  marketCode,
  locale,
  onClose,
}: {
  investorId: string | null;
  investorName: string;
  marketCode: string;
  locale: string;
  onClose: () => void;
}) {
  // Mount the body only once opened, so a closed drawer costs no request and
  // no subscription — and so the ledger is re-read fresh each time it opens.
  if (!investorId) return null;
  return (
    <DrawerBody
      investorId={investorId}
      investorName={investorName}
      marketCode={marketCode}
      locale={locale}
      onClose={onClose}
    />
  );
}

function DrawerBody({
  investorId,
  investorName,
  marketCode,
  locale,
  onClose,
}: {
  investorId: string;
  investorName: string;
  marketCode: string;
  locale: string;
  onClose: () => void;
}) {
  const { data, error, isLoading, mutate } = useSWR<{ data: LedgerPayload }>(
    `/api/admin/investments/investors/${investorId}/ledger`
  );

  // Require `balance`, not merely `data` — a payload from a shared cache key or
  // a partial response would otherwise crash the whole panel.
  const payload = data?.data?.balance ? data.data : undefined;

  return (
    <Sheet open onClose={onClose} placement="end" ariaLabel={investorName}>
      <div className="flex h-[56px] shrink-0 items-center justify-between gap-3 border-b border-line-subtle px-4">
        <p className="m-0 min-w-0 truncate text-[15px] font-semibold text-ink-primary">
          {investorName}
        </p>
        <Button variant="ghost" onClick={onClose}>
          Fermer
        </Button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="rounded-card border border-line-subtle bg-surface-card p-6 text-center">
            <p className="m-0 mb-3 text-[13px] text-ink-secondary">
              Impossible de charger ce compte
            </p>
            <Button variant="secondary" onClick={() => void mutate()}>
              Réessayer
            </Button>
          </div>
        ) : isLoading || !payload ? (
          <div className="flex flex-col gap-2" role="status" aria-busy="true">
            <Skeleton className="h-[96px] w-full" />
            <Skeleton className="h-[52px] w-full" />
            <Skeleton className="h-[52px] w-full" />
          </div>
        ) : (
          <>
            <section className="rounded-card border border-line-subtle bg-surface-card p-4">
              <h3 className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                Solde
              </h3>
              <dl className="m-0 grid grid-cols-2 gap-3">
                <Bucket label="En cours" value={payload.balance.pending} market={marketCode} />
                <Bucket label="Réserve" value={payload.balance.reserve} market={marketCode} />
                <Bucket
                  label="Disponible"
                  value={payload.balance.available}
                  market={marketCode}
                  emphasis
                />
                <Bucket label="Retiré" value={payload.balance.withdrawn} market={marketCode} />
              </dl>
            </section>

            <section className="rounded-card border border-line-subtle bg-surface-card p-4">
              <h3 className="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                Mouvements
              </h3>

              {payload.entries.length === 0 ? (
                <p className="m-0 py-6 text-center text-[13px] text-ink-secondary">
                  Aucun mouvement
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y divide-line-subtle p-0">
                  {payload.entries.map((entry) => {
                    const dir = direction(entry.entry_type, entry.amount);
                    const context = [entry.product_name, entry.note].filter(Boolean).join(" · ");
                    return (
                      <li
                        key={entry.id}
                        className="flex items-start justify-between gap-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="m-0 text-[13px] font-medium text-ink-primary">
                            {TYPE_LABEL[entry.entry_type]}
                          </p>
                          <p className="m-0 mt-0.5 text-[12px] leading-snug text-ink-secondary">
                            {formatDate(entry.created_at, locale)}
                            {context ? ` · ${context}` : ""}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[13px] font-semibold tabular-nums ${
                            dir > 0
                              ? "text-status-success"
                              : dir < 0
                                ? "text-status-critical"
                                : "text-ink-secondary"
                          }`}
                        >
                          {dir > 0 ? "+" : dir < 0 ? "−" : ""}
                          {formatCurrency(Math.abs(entry.amount), marketCode)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {payload.truncated ? (
                <p className="m-0 mt-2 text-[11px] text-ink-secondary">
                  Seuls les 200 mouvements les plus récents sont listés. Le solde ci-dessus
                  compte le grand livre entier.
                </p>
              ) : null}
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
}

function Bucket({
  label,
  value,
  market,
  emphasis,
}: {
  label: string;
  value: number;
  market: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-[8px] border border-line-subtle bg-surface-page p-3">
      <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">{label}</dt>
      <dd
        className={`m-0 mt-1 text-[16px] font-semibold tabular-nums ${
          emphasis ? "text-status-success" : "text-ink-primary"
        }`}
      >
        {formatCurrency(value, market)}
      </dd>
    </div>
  );
}

export { TYPE_LABEL as LEDGER_TYPE_LABEL };
