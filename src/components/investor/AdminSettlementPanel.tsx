"use client";

import { useState } from "react";
import { mutate } from "swr";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/dashboard/Panel";

interface ReconciliationRow {
  productId: string;
  netProfit: number;
  allocated: number;
  unallocated: number;
}

interface SettlementPreview {
  dryRun: true;
  period: { start: string; end: string };
  productsSettled: number;
  marketWideAdSpend: number;
  ledgerEntries: number;
  totalPayable: number;
  reserveReleaseAfter: string;
  alreadySettled: boolean;
  reconciliation: ReconciliationRow[];
  unreconciled: ReconciliationRow[];
  statements: {
    investor_id: string;
    product_id: string;
    share_pct: number;
    net_profit: number;
    investor_share: number;
    reserve_held: number;
  }[];
}

/**
 * Closing a period, staged.
 *
 * The endpoint has always returned `alreadySettled`, `unreconciled` and a full
 * per-product reconciliation, and the panel showed three numbers and discarded
 * the rest. An operator could preview a period that was already settled, read a
 * clean-looking total, click confirm, and meet a raw 409 rendered in the same
 * red 12px line as a network blip. Everything the server knows about the risk
 * is now on screen before the irreversible button becomes usable.
 */
export function AdminSettlementPanel({
  markets,
  locale,
}: {
  markets: { id: string; code: string; name: string }[];
  locale: string;
}) {
  const [marketId, setMarketId] = useState(markets[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; detail?: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const marketCode = (markets.find((m) => m.id === marketId)?.code ?? "tn").toUpperCase();
  const canRun = Boolean(marketId && periodStart && periodEnd) && !busy;

  // A preview that is already settled, or that does not reconcile, must never
  // reach the commit button — the server would reject it anyway, and finding
  // out by 409 after clicking is not a review step.
  const blocked = Boolean(preview && (preview.alreadySettled || preview.unreconciled.length > 0));

  /** Any edit invalidates the preview the confirm button is gated on. */
  function invalidate<T>(setter: (v: T) => void) {
    return (value: T) => {
      setPreview(null);
      setConfirming(false);
      setDone(null);
      setter(value);
    };
  }

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
        // Both 409 and 422 carry a `detail` explaining what to do instead. The
        // panel used to read only `error` and drop it.
        setError({ text: body.error ?? "La clôture a échoué", detail: body.detail });
        return;
      }

      if (dryRun) {
        setPreview(body as SettlementPreview);
        setConfirming(false);
      } else {
        setPreview(null);
        setConfirming(false);
        setDone(
          `Période close — ${formatCurrency(Number(body.totalPayable ?? 0), marketCode)} versés au grand livre.`
        );
        await mutate("/api/admin/investments");
      }
    } catch (e) {
      setError({ text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Clôture de période">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-[13px]">
            <span className="mb-1 block text-ink-secondary">Marché</span>
            <select
              value={marketId}
              onChange={(e) => invalidate(setMarketId)(e.target.value)}
              className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2"
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            <span className="mb-1 block text-ink-secondary">Début</span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => invalidate(setPeriodStart)(e.target.value)}
              className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2"
            />
          </label>
          <label className="text-[13px]">
            <span className="mb-1 block text-ink-secondary">Fin</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => invalidate(setPeriodEnd)(e.target.value)}
              className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!canRun} onClick={() => void runSettlement(true)}>
            Prévisualiser
          </Button>
          {preview && !blocked && !confirming ? (
            <Button variant="destructive" disabled={busy} onClick={() => setConfirming(true)}>
              Clôturer la période
            </Button>
          ) : null}
        </div>

        <p className="m-0 text-[11px] text-ink-secondary">
          Le grand livre est immuable : une clôture ne peut pas être annulée, seulement corrigée
          par une écriture ultérieure. Prévisualisez toujours d&apos;abord.
        </p>

        {error ? (
          <div
            role="alert"
            className="rounded-[8px] border border-status-critical bg-status-criticalBg p-3"
          >
            <p className="m-0 text-[13px] font-medium text-status-critical">{error.text}</p>
            {error.detail ? (
              <p className="m-0 mt-1 text-[12px] text-status-critical">{error.detail}</p>
            ) : null}
          </div>
        ) : null}

        {done ? (
          <p
            role="status"
            className="m-0 flex items-center gap-2 text-[13px] font-medium text-status-success"
          >
            <CheckCircle2 size={16} aria-hidden="true" />
            {done}
          </p>
        ) : null}

        {preview ? (
          <div className="flex flex-col gap-3">
            {/* The two conditions that make a commit fail, stated before it is
                attempted rather than after. */}
            {preview.alreadySettled ? (
              <Blocker
                title="Cette période est déjà réglée"
                body="Des relevés existent pour cet intervalle. Postez une correction — les règlements sont immuables."
              />
            ) : null}

            {preview.unreconciled.length > 0 ? (
              <Blocker
                title={`${preview.unreconciled.length} produit(s) ne réconcilient pas`}
                body="Les parts allouées ne totalisent pas le bénéfice net. Il manque probablement une position Maison, dont le capital est le dénominateur du prorata."
              >
                <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
                  {preview.unreconciled.map((r) => (
                    <li
                      key={r.productId}
                      className="flex items-baseline justify-between gap-2 text-[12px] tabular-nums"
                    >
                      <span className="truncate">{r.productId}</span>
                      <span>
                        {formatCurrency(r.allocated, marketCode)} /{" "}
                        {formatCurrency(r.netProfit, marketCode)} — reste{" "}
                        <strong>{formatCurrency(r.unallocated, marketCode)}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </Blocker>
            ) : null}

            <div className="rounded-[8px] border border-line-subtle bg-surface-page p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 text-[13px] font-medium text-ink-primary">
                  Aperçu — {preview.statements.length} relevé(s), {preview.ledgerEntries}{" "}
                  écriture(s)
                </p>
                <Badge tone={blocked ? "critical" : "success"}>
                  {blocked ? "Bloqué" : "Prêt"}
                </Badge>
              </div>

              <dl className="m-0 grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-4">
                <Stat label="Produits" value={String(preview.productsSettled)} />
                <Stat
                  label="Pub. marché allouée"
                  value={formatCurrency(preview.marketWideAdSpend, marketCode)}
                />
                <Stat
                  label="Réserve libérée le"
                  value={formatDate(preview.reserveReleaseAfter, locale)}
                />
                <Stat
                  label="Total à verser"
                  value={formatCurrency(preview.totalPayable, marketCode)}
                  emphasis
                />
              </dl>

              {preview.reconciliation.length > 0 ? (
                <div className="mt-3 border-t border-line-subtle pt-3">
                  <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                    Réconciliation par produit
                  </p>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {preview.reconciliation.map((r) => (
                      <li
                        key={r.productId}
                        className="flex items-baseline justify-between gap-2 text-[12px]"
                      >
                        <span className="min-w-0 truncate text-ink-secondary">{r.productId}</span>
                        <span
                          className={`shrink-0 tabular-nums ${
                            Math.abs(r.unallocated) > 0.0005
                              ? "text-status-critical"
                              : "text-ink-primary"
                          }`}
                        >
                          {formatCurrency(r.allocated, marketCode)} /{" "}
                          {formatCurrency(r.netProfit, marketCode)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            {confirming ? (
              <div className="flex flex-col gap-2 rounded-[8px] border border-status-critical bg-status-criticalBg p-3">
                <p className="m-0 text-[12px] text-status-critical">
                  {preview.statements.length} relevé(s) et {preview.ledgerEntries} écriture(s)
                  seront écrits au grand livre pour {formatDate(preview.period.start, locale)} —{" "}
                  {formatDate(preview.period.end, locale)}. Total{" "}
                  <strong>{formatCurrency(preview.totalPayable, marketCode)}</strong>. C&apos;est
                  irréversible.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void runSettlement(false)}
                  >
                    Oui, clôturer
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirming(false)}>
                    Annuler
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function Blocker({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-[8px] border border-status-warning bg-status-warningBg p-3"
    >
      <p className="m-0 flex items-center gap-2 text-[13px] font-medium text-status-warning">
        <AlertTriangle size={16} aria-hidden="true" />
        {title}
      </p>
      <p className="m-0 mt-1 text-[12px] text-status-warning">{body}</p>
      {children}
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-secondary">{label}</dt>
      <dd
        className={`m-0 mt-0.5 tabular-nums ${
          emphasis ? "text-[15px] font-semibold text-status-success" : "text-[13px] text-ink-primary"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
