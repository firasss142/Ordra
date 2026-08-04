"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { ProductAvatar } from "@/components/orders/ProductAvatar";

export interface PositionRow {
  id: string;
  investor_id: string | null;
  product_id: string;
  market_id: string;
  amount: number;
  effective_from: string;
  effective_to: string | null;
  status: string;
  products: ProductRef | ProductRef[] | null;
  investors: { legal_name: string } | { legal_name: string }[] | null;
}

type ProductRef = { name: string; image_url: string | null };

interface InvestorOption {
  id: string;
  legal_name: string | null;
  full_name: string;
  configured: boolean;
}

interface ProductOption {
  id: string;
  name: string;
  market_id: string;
}

/** Sentinel for house capital, which is stored as investor_id NULL. */
const HOUSE = "__house__";

function rel<T extends object>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const STATUS_LABEL: Record<string, string> = { active: "Active", closed: "Clôturée" };

/**
 * Capital positions.
 *
 * Every row is denominated by ITS OWN market. Formatting the table by the
 * period-close market selector rendered Tunisian capital as Libyan dinars and
 * silently re-denominated every row when an unrelated dropdown changed.
 */
export function AdminPositionsPanel({
  markets,
  locale,
}: {
  markets: { id: string; code: string; name: string }[];
  locale: string;
}) {
  const {
    data: positionsData,
    error: positionsError,
    isLoading,
    mutate: mutatePositions,
  } = useSWR<{ data: PositionRow[] }>("/api/admin/investments");
  const positions = positionsData?.data ?? [];

  const { data: investorsData } = useSWR<{ data: InvestorOption[] }>(
    "/api/admin/investments/investors"
  );
  const investors = (investorsData?.data ?? []).filter((i) => i.configured);

  const { data: productsData } = useSWR<{ data: ProductOption[] }>("/api/products");
  const products = productsData?.data ?? [];

  const [opening, setOpening] = useState(false);
  const [holder, setHolder] = useState(HOUSE);
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [closingId, setClosingId] = useState<string | null>(null);
  const [closeDate, setCloseDate] = useState("");
  const [rowError, setRowError] = useState<{ id: string; text: string; detail?: string } | null>(
    null
  );

  const marketById = new Map(markets.map((m) => [m.id, m]));

  /**
   * A product funded by investors with no house row overstates every share,
   * because the pro-rata denominator then counts only investor capital. The
   * settlement preview refuses to commit in that state; saying so here means
   * the operator finds out while they can still fix it.
   */
  const productsMissingHouse = (() => {
    const byProduct = new Map<string, { investor: boolean; house: boolean; name: string }>();
    for (const p of positions) {
      if (p.status !== "active") continue;
      const entry = byProduct.get(p.product_id) ?? {
        investor: false,
        house: false,
        name: rel(p.products)?.name ?? p.product_id,
      };
      if (p.investor_id === null) entry.house = true;
      else entry.investor = true;
      byProduct.set(p.product_id, entry);
    }
    return [...byProduct.values()].filter((e) => e.investor && !e.house).map((e) => e.name);
  })();

  async function createPosition() {
    setFormError(null);

    if (!productId) return setFormError("Choisissez un produit");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      return setFormError("Le capital doit être supérieur à zéro");
    }
    if (!effectiveFrom) return setFormError("Indiquez une date de début");

    setBusy(true);
    try {
      const res = await fetch("/api/admin/investments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // NULL is house capital — the denominator that keeps every investor's
          // share honest.
          investor_id: holder === HOUSE ? null : holder,
          product_id: productId,
          amount: value,
          effective_from: effectiveFrom,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setFormError([body.error, body.detail].filter(Boolean).join(" — ") || "Création impossible");
        return;
      }

      setOpening(false);
      setProductId("");
      setAmount("");
      setEffectiveFrom("");
      await mutatePositions();
    } finally {
      setBusy(false);
    }
  }

  async function closePosition(id: string) {
    setRowError(null);
    if (!closeDate) {
      setRowError({ id, text: "Indiquez une date de clôture" });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/investments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ effective_to: closeDate }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Both 409 and 422 carry a `detail` saying what to do instead.
        setRowError({ id, text: body.error ?? "Clôture impossible", detail: body.detail });
        return;
      }

      setClosingId(null);
      setCloseDate("");
      await mutatePositions();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Positions de capital"
      actions={
        !opening ? (
          <Button variant="secondary" onClick={() => setOpening(true)}>
            Ouvrir une position
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {productsMissingHouse.length > 0 ? (
          <div className="rounded-[8px] border border-status-warning bg-status-warningBg p-3">
            <p className="m-0 flex items-center gap-2 text-[13px] font-medium text-status-warning">
              <AlertTriangle size={16} aria-hidden="true" />
              Aucune position Maison sur {productsMissingHouse.join(", ")}
            </p>
            <p className="m-0 mt-1 text-[12px] text-status-warning">
              Sans capital Maison, le dénominateur du prorata ne compte que l&apos;argent des
              investisseurs et chaque part est surévaluée.
            </p>
          </div>
        ) : null}

        {opening ? (
          <div className="flex flex-col gap-3 rounded-[8px] border border-line-subtle bg-surface-page p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <label className="text-[12px]">
                <span className="mb-1 block text-ink-secondary">Détenteur</span>
                <select
                  value={holder}
                  onChange={(e) => setHolder(e.target.value)}
                  className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px]"
                >
                  <option value={HOUSE}>Maison (capital propre)</option>
                  {investors.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.legal_name ?? i.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[12px]">
                <span className="mb-1 block text-ink-secondary">Produit</span>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px]"
                >
                  <option value="">—</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {marketById.get(p.market_id)?.name ?? "—"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[12px]">
                <span className="mb-1 block text-ink-secondary">Capital</span>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px] tabular-nums"
                />
              </label>

              <label className="text-[12px]">
                <span className="mb-1 block text-ink-secondary">Depuis</span>
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="w-full rounded-[6px] border border-line bg-surface-card px-3 py-2 text-[14px]"
                />
              </label>
            </div>

            <p className="m-0 text-[11px] text-ink-secondary">
              Le marché suit le produit — un investisseur et un produit de marchés différents
              seront refusés. Le capital ne sera plus modifiable ensuite : une position ne peut
              être que clôturée, car les relevés déjà réglés s&apos;appuient dessus.
            </p>

            {formError ? (
              <p role="alert" className="m-0 text-[12px] text-status-critical">
                {formError}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void createPosition()}>
                Créer
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setOpening(false);
                  setFormError(null);
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        ) : null}

        {/* Error before empty: rendering "Aucune position" because the fetch
            failed tells the operator there is no capital when there may be. */}
        {positionsError ? (
          <div className="py-6 text-center">
            <p className="m-0 mb-3 text-[13px] text-ink-secondary">
              Impossible de charger les positions
            </p>
            <Button variant="secondary" onClick={() => void mutatePositions()}>
              Réessayer
            </Button>
          </div>
        ) : isLoading ? (
          <div className="flex flex-col gap-2" role="status" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[52px] w-full" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <EmptyState label="Aucune position" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line-strong">
                  <Th>Détenteur</Th>
                  <Th>Produit</Th>
                  <Th>Marché</Th>
                  <Th align="end">Capital</Th>
                  <Th>Période</Th>
                  <Th>Statut</Th>
                  <Th align="end" />
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const investor = rel(p.investors);
                  const product = rel(p.products);
                  const positionMarket = marketById.get(p.market_id);
                  const positionMarketCode = (positionMarket?.code ?? "tn").toUpperCase();
                  const isClosing = closingId === p.id;
                  const err = rowError?.id === p.id ? rowError : null;

                  return (
                    <tr key={p.id} className="border-t border-line-subtle">
                      <td className="py-2">
                        {investor?.legal_name ?? (
                          <span className="italic text-ink-secondary">Maison</span>
                        )}
                      </td>
                      <td className="py-2">
                        <span className="flex items-center gap-2">
                          <ProductAvatar
                            imageUrl={product?.image_url ?? null}
                            productName={product?.name ?? "—"}
                            size={28}
                          />
                          <span className="truncate">{product?.name ?? "—"}</span>
                        </span>
                      </td>
                      <td className="py-2">{positionMarket?.name ?? "—"}</td>
                      <td className="py-2 text-end tabular-nums">
                        {formatCurrency(Number(p.amount), positionMarketCode)}
                      </td>
                      <td className="py-2 ps-3 tabular-nums">
                        {formatDate(p.effective_from, locale)}
                        {p.effective_to ? ` → ${formatDate(p.effective_to, locale)}` : ""}
                      </td>
                      <td className="py-2">
                        <Badge tone={p.status === "active" ? "success" : "neutral"}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-end">
                        {p.status === "active" ? (
                          isClosing ? (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex items-end justify-end gap-2">
                                <label className="text-start text-[11px]">
                                  <span className="mb-1 block text-ink-secondary">
                                    Date de clôture
                                  </span>
                                  <input
                                    type="date"
                                    value={closeDate}
                                    onChange={(e) => setCloseDate(e.target.value)}
                                    className="rounded-[6px] border border-line bg-surface-card px-2 py-1.5 text-[13px]"
                                  />
                                </label>
                                {/* Not "Confirmer" — the period-close button
                                    elsewhere already says that, and two
                                    differently destructive actions sharing a
                                    verb is how the wrong one gets clicked. */}
                                <Button
                                  variant="destructive"
                                  disabled={busy}
                                  onClick={() => void closePosition(p.id)}
                                >
                                  Clôturer la position
                                </Button>
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setClosingId(null);
                                    setRowError(null);
                                  }}
                                >
                                  Annuler
                                </Button>
                              </div>
                              {/* Beside the control that raised it, not in the
                                  panel footer a screenful away. */}
                              {err ? (
                                <p
                                  role="alert"
                                  className="m-0 text-end text-[12px] text-status-critical"
                                >
                                  {err.text}
                                  {err.detail ? ` — ${err.detail}` : ""}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setClosingId(p.id);
                                setCloseDate("");
                                setRowError(null);
                              }}
                            >
                              Clôturer
                            </Button>
                          )
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Design-system §4 table header: uppercase, 0.05em tracking, bottom rule. */
function Th({ children, align }: { children?: React.ReactNode; align?: "end" }) {
  return (
    <th
      className={`py-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary ${
        align === "end" ? "text-end" : "text-start"
      }`}
    >
      {children}
    </th>
  );
}
