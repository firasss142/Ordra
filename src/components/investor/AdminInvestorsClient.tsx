"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Panel, EmptyState } from "@/components/dashboard/Panel";

interface PositionRow {
  id: string;
  investor_id: string | null;
  product_id: string;
  amount: number;
  effective_from: string;
  effective_to: string | null;
  status: string;
  products: { name: string } | { name: string }[] | null;
  investors: { legal_name: string } | { legal_name: string }[] | null;
}

interface SettlementPreview {
  dryRun: true;
  productsSettled: number;
  marketWideAdSpend: number;
  ledgerEntries: number;
  totalPayable: number;
  statements: {
    investor_id: string;
    product_id: string;
    share_pct: number;
    net_profit: number;
    investor_share: number;
    reserve_held: number;
  }[];
}

function rel<T extends object>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * Admin surface for investor capital and settlements.
 *
 * Settlement defaults to a DRY RUN. Committing writes to an append-only ledger,
 * so a mistaken run cannot be edited away — only corrected forward with another
 * entry. Making preview the default path is the cheapest guard against that.
 */
export function AdminInvestorsClient({
  markets,
  locale,
}: {
  markets: { id: string; code: string; name: string }[];
  locale: string;
}) {
  const { data: positionsData } = useSWR<{ data: PositionRow[] }>("/api/admin/investments");
  const positions = positionsData?.data ?? [];

  const [marketId, setMarketId] = useState(markets[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marketCode = (markets.find((m) => m.id === marketId)?.code ?? "tn").toUpperCase();

  async function runSettlement(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/investments/settlements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          market_id: marketId,
          period_start: periodStart,
          period_end: periodEnd,
          dry_run: dryRun,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Settlement failed");
        return;
      }

      if (dryRun) {
        setPreview(body as SettlementPreview);
      } else {
        setPreview(null);
        await mutate("/api/admin/investments");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canRun = Boolean(marketId && periodStart && periodEnd) && !busy;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Clôture de période">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-[13px]">
              <span className="block mb-1 text-ink-secondary">Marché</span>
              <select
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
                className="w-full rounded-[6px] border border-line-DEFAULT bg-surface-card px-3 py-2"
              >
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[13px]">
              <span className="block mb-1 text-ink-secondary">Début</span>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="w-full rounded-[6px] border border-line-DEFAULT bg-surface-card px-3 py-2"
              />
            </label>
            <label className="text-[13px]">
              <span className="block mb-1 text-ink-secondary">Fin</span>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="w-full rounded-[6px] border border-line-DEFAULT bg-surface-card px-3 py-2"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!canRun} onClick={() => runSettlement(true)}>
              Prévisualiser
            </Button>
            <Button
              variant="primary"
              disabled={!canRun || !preview}
              onClick={() => runSettlement(false)}
            >
              Confirmer la clôture
            </Button>
          </div>

          <p className="m-0 text-[11px] text-ink-muted">
            Le grand livre est immuable : une clôture ne peut pas être annulée, seulement corrigée
            par une écriture ultérieure. Prévisualisez toujours d&apos;abord.
          </p>

          {error ? (
            <p role="alert" className="m-0 text-[12px] text-status-critical">
              {error}
            </p>
          ) : null}

          {preview ? (
            <div className="rounded-[8px] bg-surface-sunken p-3">
              <p className="m-0 mb-2 text-[13px] font-medium text-ink-primary">
                Aperçu — {preview.statements.length} relevé(s), {preview.ledgerEntries} écriture(s)
              </p>
              <dl className="m-0 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[12px]">
                <div>
                  <dt className="text-ink-secondary">Produits</dt>
                  <dd className="m-0 tabular-nums">{preview.productsSettled}</dd>
                </div>
                <div>
                  <dt className="text-ink-secondary">Pub. marché allouée</dt>
                  <dd className="m-0 tabular-nums">
                    {formatCurrency(preview.marketWideAdSpend, marketCode)}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-secondary">Total à verser</dt>
                  <dd className="m-0 font-semibold tabular-nums text-accent">
                    {formatCurrency(preview.totalPayable, marketCode)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Positions de capital">
        {positions.length === 0 ? (
          <EmptyState label="Aucune position" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-start text-ink-secondary">
                  <th className="text-start font-medium py-2">Détenteur</th>
                  <th className="text-start font-medium py-2">Produit</th>
                  <th className="text-end font-medium py-2">Capital</th>
                  <th className="text-start font-medium py-2 ps-3">Depuis</th>
                  <th className="text-start font-medium py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const investor = rel(p.investors);
                  const product = rel(p.products);
                  return (
                    <tr key={p.id} className="border-t border-line-subtle">
                      <td className="py-2">
                        {/* investor_id NULL = house capital, which is what keeps
                            the pro-rata denominator honest. */}
                        {investor?.legal_name ?? (
                          <span className="text-ink-secondary italic">Maison</span>
                        )}
                      </td>
                      <td className="py-2">{product?.name ?? "—"}</td>
                      <td className="py-2 text-end tabular-nums">
                        {formatCurrency(Number(p.amount), marketCode)}
                      </td>
                      <td className="py-2 ps-3 tabular-nums">
                        {formatDate(p.effective_from, locale)}
                      </td>
                      <td className="py-2">
                        <Badge tone={p.status === "active" ? "success" : "neutral"}>
                          {p.status}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
