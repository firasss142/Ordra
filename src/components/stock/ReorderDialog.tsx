"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useWarehouseSites } from "@/hooks/useWarehouseSites";

/**
 * COMMANDER, DEPUIS LE MANQUE — maquette v4 §6.
 *
 * « Personne n'écrira jamais un bon de commande dans un formulaire vide, et
 * c'est pour ça qu'`expected_qty` de la v3 serait éternellement NULL. » En
 * naissant du réassort, le bon est PRÉ-REMPLI : produit, quantité, date
 * voulue — il ne reste que le fournisseur à nommer.
 *
 * TOUT EST MODIFIABLE. La quantité proposée est un point de départ, pas une
 * décision : l'écran montre ce qu'elle cherche à couvrir pour qu'on puisse la
 * contredire en connaissance de cause.
 *
 * LE PRIX RESTE FACULTATIF ET `null` SI VIDE. On commande souvent sans prix
 * convenu, et un zéro écrit à sa place ferait un engagement de zéro dinar.
 */

export interface ReorderTarget {
  productId: string;
  productName: string;
  marketId: string;
  /** Jours de couverture, `null` quand la demande est trop mince pour juger. */
  daysOfCover: number | null;
  /** Le jour de la rupture — ce qu'on veut devancer, donc la date voulue. */
  stockOutDate: string | null;
  freeToSell: number;
  /** Déjà commandé et pas encore arrivé. `null`, jamais 0. */
  onOrder: number | null;
  /** `null` quand on refuse de proposer — voir src/lib/purchases/suggest.ts. */
  suggestedQty: number | null;
  targetDays: number;
}

interface SuppliersPayload {
  suppliers: Array<{ id: string; name: string; is_active: boolean }>;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ReorderDialog({
  target,
  onClose,
  onDone,
}: {
  target: ReorderTarget;
  onClose: () => void;
  onDone: () => Promise<unknown>;
}) {
  const t = useTranslations("inventory.reorder");
  const { sites } = useWarehouseSites(target.marketId);
  const { data: supplierData } = useSWR<SuppliersPayload>(
    `/api/suppliers?market_id=${encodeURIComponent(target.marketId)}`,
    fetcher,
  );

  const suppliers = useMemo(
    () => (supplierData?.suppliers ?? []).filter((s) => s.is_active),
    [supplierData],
  );

  const [supplierId, setSupplierId] = useState("");
  // Le bâtiment par défaut, parce que c'est là que la marchandise arrive
  // d'habitude ; les deux entrepôts libyens sont à 1 000 km l'un de l'autre et
  // le choix compte, donc il reste visible.
  const [warehouseId, setWarehouseId] = useState("");
  const [qty, setQty] = useState(
    target.suggestedQty === null ? "" : String(target.suggestedQty),
  );
  const [unitCost, setUnitCost] = useState("");
  const [wantedBy, setWantedBy] = useState(target.stockOutDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const site =
    warehouseId ||
    sites.find((s) => s.isDefault)?.id ||
    sites[0]?.id ||
    "";

  async function submit() {
    const n = Number.parseInt(qty, 10);
    if (!supplierId || !site || !Number.isInteger(n) || n <= 0 || busy) return;

    // La virgule décimale est acceptée : c'est ce qu'on tape en français.
    const costRaw = unitCost.trim().replace(",", ".");
    const cost = costRaw === "" ? null : Number(costRaw);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/purchases/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: supplierId,
          warehouse_id: site,
          wanted_by: wantedBy || null,
          lines: [
            {
              product_id: target.productId,
              variant_id: null,
              qty: n,
              unit_cost: cost,
            },
          ],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t("errorGeneric"));
        return;
      }
      await onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-[460px] overflow-hidden rounded-xl border border-line bg-surface-card">
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-ink-primary">{t("title")}</h2>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-ink-primary" dir="auto">
              {target.productName}
            </p>
            {/* CE QUI A DÉCLENCHÉ LE GESTE, redit ici : sans la situation sous
                les yeux, la quantité proposée n'est qu'un nombre. */}
            <p className="mt-1 text-[12px] text-ink-secondary">
              {target.daysOfCover === null
                ? t("situationNoCover")
                : t("situation", { days: target.daysOfCover, free: target.freeToSell })}
              {target.onOrder !== null ? ` · ${t("onOrderAlready", { units: target.onOrder })}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("cancel")}
            className="rounded-[6px] p-1 text-ink-muted hover:bg-surface-sunken hover:text-ink-primary"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          <Field label={t("supplier")} htmlFor="reorder-supplier">
            <select
              id="reorder-supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="h-9 w-full rounded-[8px] border border-line bg-surface-card px-2.5 text-[13px] text-ink-primary"
            >
              <option value="">{t("supplierPick")}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {suppliers.length === 0 ? (
              <p className="mt-1 text-[11.5px] text-ink-muted">{t("noSuppliers")}</p>
            ) : null}
          </Field>

          <Field label={t("warehouse")} htmlFor="reorder-warehouse">
            <select
              id="reorder-warehouse"
              value={site}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="h-9 w-full rounded-[8px] border border-line bg-surface-card px-2.5 text-[13px] text-ink-primary"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("qty")} htmlFor="reorder-qty">
              <input
                id="reorder-qty"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
                className="h-9 w-full rounded-[8px] border border-line bg-surface-card px-2.5 font-mono text-[14px] font-semibold tabular-nums text-ink-primary"
              />
              <p className="mt-1 text-[11.5px] text-ink-muted">
                {target.suggestedQty === null
                  ? t("noDemand")
                  : t("covers", { days: target.targetDays })}
              </p>
            </Field>

            <Field label={t("unitCost")} htmlFor="reorder-cost">
              <input
                id="reorder-cost"
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-line bg-surface-card px-2.5 font-mono text-[14px] tabular-nums text-ink-primary"
              />
              <p className="mt-1 text-[11.5px] text-ink-muted">{t("unitCostHint")}</p>
            </Field>
          </div>

          <Field label={t("wantedBy")} htmlFor="reorder-wanted">
            <input
              id="reorder-wanted"
              type="date"
              value={wantedBy}
              onChange={(e) => setWantedBy(e.target.value)}
              className="h-9 w-full rounded-[8px] border border-line bg-surface-card px-2.5 text-[13px] text-ink-primary"
            />
            <p className="mt-1 text-[11.5px] text-ink-muted">{t("wantedByHint")}</p>
          </Field>

          {error ? (
            <p className="rounded-[8px] border border-[#D72C0D] bg-[#FFF4F4] px-3 py-2 text-[12.5px] text-[#D72C0D]">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-[8px] border border-line px-3.5 text-[13px] font-semibold text-ink-primary"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="h-9 rounded-[8px] bg-[#15803D] px-4 text-[13px] font-bold text-white disabled:opacity-50"
          >
            {t("submit")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
