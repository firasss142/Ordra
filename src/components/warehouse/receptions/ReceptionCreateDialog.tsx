"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { X, Plus, Trash2 } from "lucide-react";
import type { Role } from "@/types";
import { canSeeReceptionCosts } from "@/lib/receptions/permissions";
import { WH_LABEL, WH_BTN, WH_BTN_PRIMARY } from "@/components/warehouse/console/tokens";
import { ProductSearchPanel, MIN_QUERY, type SearchableProduct } from "./ProductSearchPanel";

/**
 * Créer une réception.
 *
 * Elle naît en BROUILLON : rien n'entre en stock ici, et c'est la validation
 * seule qui écrit le registre. On peut donc l'annoncer à l'avance avec les
 * quantités prévues — c'est le bon de commande léger, et c'est ce qui alimente
 * « en route » sur l'écran Niveaux.
 *
 * LA COLONNE COÛT N'EXISTE PAS POUR UN AGENT D'ENTREPÔT. Elle n'est pas rendue,
 * et surtout la route force `unit_cost` à NULL quand l'appelant est un agent :
 * l'écran n'est pas l'autorité.
 */

interface Draft {
  key: string;
  product_id: string;
  product_name: string;
  product_sku: string | null;
  product_image_url: string | null;
  /** Le stock actuel, au moment du choix : « ce réassort est-il nécessaire ? » */
  product_stock: number;
  expected_qty: string;
  unit_cost: string;
}

interface SitesResponse {
  sites: { id: string; code: string; name: string; isDefault: boolean }[];
  mine: string | null;
  pinned: boolean;
  unassigned: boolean;
}

type ProductRow = SearchableProduct;

const fetcher = (u: string) => fetch(u).then((r) => r.json());

export function ReceptionCreateDialog({
  role,
  onClose,
  onCreated,
}: {
  role: Role;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const t = useTranslations("warehouse.receptions");
  const withCosts = canSeeReceptionCosts(role);

  const { data: sites } = useSWR<SitesResponse>("/api/warehouse/sites", fetcher);
  const [warehouseId, setWarehouseId] = useState("");
  const [supplier, setSupplier] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [lines, setLines] = useState<Draft[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLSelectElement>(null);
  const search = useRef<HTMLInputElement>(null);

  // Un agent est épinglé à son bâtiment ; un manager choisit.
  useEffect(() => {
    if (!sites || warehouseId) return;
    const preset = sites.mine ?? sites.sites.find((s) => s.isDefault)?.id ?? sites.sites[0]?.id;
    if (preset) setWarehouseId(preset);
  }, [sites, warehouseId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    first.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { data: found, isLoading: searching } = useSWR<{ data: ProductRow[] }>(
    query.trim().length >= MIN_QUERY
      ? `/api/products/search?q=${encodeURIComponent(query.trim())}`
      : null,
    fetcher,
    // Les résultats précédents restent affichés pendant la requête suivante : un
    // panneau qui se vide à chaque frappe est illisible.
    { keepPreviousData: true },
  );

  const chosen = useMemo(() => new Set(lines.map((l) => l.product_id)), [lines]);

  function addLine(p: ProductRow) {
    setLines((prev) => [
      ...prev,
      {
        key: `${p.id}-${Date.now()}`,
        product_id: p.id,
        product_name: p.name,
        product_sku: p.sku ?? null,
        product_image_url: p.image_url ?? null,
        product_stock: p.current_stock,
        expected_qty: "",
        unit_cost: "",
      },
    ]);
    setQuery("");
  }

  function patch(key: string, field: "expected_qty" | "unit_cost", value: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  }

  const canSubmit = warehouseId !== "" && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/warehouse/receptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse_id: warehouseId,
          supplier_name: supplier.trim() || undefined,
          supplier_ref: supplierRef.trim() || undefined,
          expected_at: expectedAt || null,
          lines: lines
            .filter((l) => l.product_id)
            .map((l) => {
              const qty = Number.parseInt(l.expected_qty, 10);
              const cost = Number.parseFloat(l.unit_cost.replace(",", "."));
              return {
                product_id: l.product_id,
                // Rien de saisi reste NULL — « non annoncé », pas zéro.
                expected_qty: Number.isInteger(qty) && qty >= 0 ? qty : null,
                unit_cost: withCosts && Number.isFinite(cost) && cost >= 0 ? cost : null,
              };
            }),
        }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setError(b.error ?? String(res.status));
        return;
      }
      const body = (await res.json()) as { id: string };
      onCreated(body.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "network");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-[rgba(21,26,31,.5)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("new")}
    >
      <div className="w-full max-w-[700px] overflow-hidden rounded-[12px] bg-wh-surface shadow-[0_8px_32px_rgba(16,24,40,.18)]">
        <div className="flex items-center justify-between gap-3 border-b border-wh-border px-5 py-4">
          <h3 className="text-[16px] font-bold">{t("new")}</h3>
          <button type="button" onClick={onClose} aria-label={t("cancel")} className="text-wh-ink-2">
            <X size={17} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="grid gap-3.5 md:grid-cols-2">
            <label>
              <span className={WH_LABEL}>{t("fieldSite")}</span>
              <select
                ref={first}
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                disabled={sites?.pinned}
                className="mt-1.5 w-full rounded-[6px] border border-wh-border px-2.5 py-2 text-[13.5px] disabled:bg-wh-sunken"
              >
                {(sites?.sites ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="mt-1.5 block text-[11.5px] text-wh-ink-3">{t("hintSite")}</span>
            </label>

            <label>
              <span className={WH_LABEL}>
                {t("fieldExpectedAt")}{" "}
                <span className="font-normal normal-case tracking-normal text-wh-ink-3">
                  ({t("optional")})
                </span>
              </span>
              <input
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
                className="mt-1.5 w-full rounded-[6px] border border-wh-border px-2.5 py-2 text-[13.5px]"
              />
              <span className="mt-1.5 block text-[11.5px] text-wh-ink-3">{t("hintExpectedAt")}</span>
            </label>
          </div>

          <div className="grid gap-3.5 md:grid-cols-2">
            <label>
              <span className={WH_LABEL}>{t("fieldSupplier")}</span>
              <input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                dir="auto"
                className="mt-1.5 w-full rounded-[6px] border border-wh-border px-2.5 py-2 text-[13.5px]"
              />
              <span className="mt-1.5 block text-[11.5px] text-wh-ink-3">{t("hintSupplier")}</span>
            </label>
            <label>
              <span className={WH_LABEL}>{t("fieldSupplierRef")}</span>
              <input
                value={supplierRef}
                onChange={(e) => setSupplierRef(e.target.value)}
                className="mt-1.5 w-full rounded-[6px] border border-wh-border px-2.5 py-2 font-mono text-[13.5px]"
              />
              <span className="mt-1.5 block text-[11.5px] text-wh-ink-3">
                {t("hintSupplierRef")}
              </span>
            </label>
          </div>

          <div className="overflow-hidden rounded-[8px] border border-wh-border">
            <div className={`${WH_LABEL} border-b border-wh-border bg-wh-sunken px-3.5 py-2.5`}>
              {t("expectedLines")}
            </div>

            {lines.map((l) => (
              <div
                key={l.key}
                className={`grid items-center gap-x-2.5 border-b border-wh-border px-3.5 py-2.5 ${
                  withCosts ? "grid-cols-[1fr_88px_96px_28px]" : "grid-cols-[1fr_88px_28px]"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium" dir="auto">
                    {l.product_name}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-wh-ink-3">
                    {l.product_sku ? `${l.product_sku} · ` : ""}
                    {t("inStock", { count: l.product_stock })}
                  </span>
                </span>
                <input
                  inputMode="numeric"
                  placeholder="—"
                  value={l.expected_qty}
                  onChange={(e) => patch(l.key, "expected_qty", e.target.value)}
                  className="w-full rounded-[6px] border border-wh-border px-2 py-1.5 text-end font-mono text-[13.5px] tabular-nums"
                />
                {withCosts ? (
                  <input
                    inputMode="decimal"
                    placeholder="—"
                    value={l.unit_cost}
                    onChange={(e) => patch(l.key, "unit_cost", e.target.value)}
                    className="w-full rounded-[6px] border border-wh-border px-2 py-1.5 text-end font-mono text-[13.5px] tabular-nums"
                  />
                ) : null}
                <button
                  type="button"
                  aria-label={t("removeLine")}
                  onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                  className="grid place-items-center text-wh-ink-3 hover:text-wh-bad"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

            {/*
             * LA RANGÉE GRISE PORTE LA RECHERCHE ET LES EN-TÊTES À LA FOIS.
             * Les deux champs numériques d'une ligne sont indiscernables sans
             * libellé : « 150 » et « 40,000 » côte à côte ne disent pas lequel
             * est une quantité. Les nommer ici les nomme pour toutes les lignes.
             */}
            <ProductSearchPanel
              query={query}
              onQueryChange={setQuery}
              results={found?.data ?? []}
              isLoading={searching}
              chosenIds={chosen}
              onPick={addLine}
              inputRef={search}
              gridClassName={
                withCosts ? "grid-cols-[1fr_88px_96px_28px]" : "grid-cols-[1fr_88px_28px]"
              }
              trailing={
                <>
                  <span className={`${WH_LABEL} text-end`}>{t("colQuantity")}</span>
                  {withCosts ? (
                    <span className={`${WH_LABEL} text-end`}>{t("colUnitCost")}</span>
                  ) : null}
                  <span />
                </>
              }
            />

            {/*
             * L'affordance explicite. Un champ de recherche seul n'annonce pas
             * qu'une réception peut porter plusieurs lignes ; ce bouton le dit, et
             * amène le curseur là où il faut taper.
             */}
            <button
              type="button"
              onClick={() => search.current?.focus()}
              className="flex w-full items-center gap-2.5 border-t border-wh-border bg-wh-surface px-3.5 py-2.5 text-[13px] font-semibold text-wh-ok hover:bg-wh-sunken"
            >
              <Plus size={16} strokeWidth={2.2} />
              {t("addLine")}
            </button>
          </div>

          {error ? (
            <p className="rounded-[6px] border border-wh-bad-edge bg-wh-bad-bg px-3 py-2 text-[13px] font-medium text-wh-bad">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-wh-border bg-wh-sunken px-5 py-3.5">
          <button type="button" className={WH_BTN} onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className={WH_BTN_PRIMARY}
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            <Plus size={16} />
            {t("create")}
          </button>
        </div>
      </div>
    </div>
  );
}
