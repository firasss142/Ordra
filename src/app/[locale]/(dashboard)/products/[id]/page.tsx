"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import {
  Boxes,
  ChevronRight,
  Coins,
  FileText,
  Filter,
  Home,
  Package,
  Pencil,
  Power,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useAuth } from "@/context/auth";
import { ProductCostsReferenceCard } from "@/components/products/ProductCostsReferenceCard";
import { StockHistoryPanel } from "@/components/products/StockHistoryPanel";
import {
  StockAdjustModal,
  type StockAdjustState,
} from "@/components/products/StockAdjustModal";
import {
  ProductFunnelChevrons,
  formatCount,
  formatPercent,
} from "@/components/products/ProductFunnelChevrons";
import { ProductMoneyWaterfall } from "@/components/products/ProductMoneyWaterfall";
import { ProductAgentsPanel } from "@/components/products/ProductAgentsPanel";
import type { AgentRankRow } from "@/components/products/AgentRankTable";
import { PeriodSelector, type Period } from "@/components/shared/PeriodSelector";
import { computePreviousPeriod, lastNDaysPeriod } from "@/lib/date";
import { formatCurrency, formatCurrencySigned } from "@/lib/format";
import type { ProductProfitabilityData } from "@/types/profitability";
/* Fournis par le lot 2. Le hook n'est consommé que pour ses lignes : les
   totaux affichés sont soit dérivés de ces lignes (attribution 1:1), soit lus
   sur la réponse rentabilité — ne pas dépendre d'une forme de `totals`. */
import { useProductAgents } from "@/hooks/useProductAgents";
import type { ProductAgentRow } from "@/types/product-agents";

/* ─────────────────────────────────────────────────────────────────────────────
   FICHE PRODUIT.

   PÉRIODE PAR DÉFAUT — 30 JOURS, PAS « AUJOURD'HUI ». La page démarrait sur
   todayPeriod() : ouverte un matin, elle affichait une fiche entièrement à
   zéro, ce qui se lit comme une panne et non comme une absence de ventes du
   jour. C'est un choix produit assumé, pas un effet de bord.

   AUCUN CALCUL FINANCIER ICI. Tous les postes (CA, COGS, transport, retours,
   emballage, traitement, pub, profit net, coût par livrée) arrivent calculés
   par /api/profitability/product/[id] — un recalcul client ne saurait pas
   exprimer les frais transporteur, qui sont sommés commande par commande au
   tarif du transporteur de CHAQUE commande. Les seules arithmétiques tolérées,
   déjà pratiquées sur cette surface, sont des rapports d'effectifs et la valeur
   de stock (current_stock × unit_cogs).

   is_low_stock SE LIT SUR stock_summary. La page lisait `product.is_low_stock`,
   qui n'existe pas sur le fil : le badge « stock bas » n'a jamais pu s'allumer.
   Le corriger fait apparaître des badges sur des produits qui n'en montraient
   pas — ce n'est pas une régression.
   ────────────────────────────────────────────────────────────────────────── */

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const DASH = "—";

interface ProductVariant {
  id: string;
  label: string;
  quantity: number;
  display_price: number;
  is_active: boolean;
}

interface ProductData {
  id: string;
  market_id: string;
  name: string;
  sku: string | null;
  description: string | null;
  image_url: string | null;
  unit_cogs: number;
  packing_cost: number;
  confirmation_processing_cost: number | null;
  default_price: number | null;
  floor_price: number | null;
  initial_stock: number;
  current_stock: number;
  low_stock_threshold: number;
  damaged_return_count: number;
  is_active: boolean;
  agent_brief: string | null;
  agent_notes: string | null;
  agent_composition: string | null;
  agent_contraindications: string | null;
  agent_usage: string | null;
  cross_sell_product_id: string | null;
  variants: ProductVariant[];
  stock_summary?: {
    current_stock: number;
    low_stock_threshold: number;
    damaged_return_count: number;
    is_low_stock: boolean;
  };
}

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const locale = (params.locale as string) ?? "fr";
  const intlLocale = useLocale();
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>(() => lastNDaysPeriod(30));
  const [stockModal, setStockModal] = useState<StockAdjustState | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const t = useTranslations("products.sheet");
  const tProducts = useTranslations("products");
  const tPnl = useTranslations("productPnl");

  const canView =
    user?.role === "super_admin" ||
    user?.role === "market_manager" ||
    user?.role === "warehouse_agent";
  const canViewProfitability =
    user?.role === "market_manager" || user?.role === "super_admin";
  const canManage = user?.role === "super_admin";
  const canToggleActive =
    user?.role === "super_admin" ||
    user?.role === "market_manager" ||
    user?.role === "warehouse_agent";
  const canEditContent =
    user?.role === "super_admin" || user?.role === "market_manager";

  useEffect(() => {
    if (user && !canView) router.replace(`/${locale}/products`);
  }, [user, canView, locale, router]);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 4000);
    return () => window.clearTimeout(id);
  }, [banner]);

  const {
    data: productRes,
    isLoading: productLoading,
    mutate: mutateProduct,
  } = useSWR<{ data: ProductData }>(`/api/products/${productId}`, fetcher);

  const previousPeriod = useMemo(
    () => computePreviousPeriod(period.from_date, period.to_date),
    [period.from_date, period.to_date],
  );

  /* Clé unique portant TOUS les paramètres serveur : la scinder laisserait,
     le temps d'un rendu, l'entonnoir d'une période sous l'argent d'une autre. */
  const profitabilityKey =
    canViewProfitability && period.from_date && period.to_date
      ? `/api/profitability/product/${productId}?` +
        new URLSearchParams({
          from_date: period.from_date,
          to_date: period.to_date,
          previous_from_date: previousPeriod.from_date,
          previous_to_date: previousPeriod.to_date,
        }).toString()
      : null;

  const { data: perfRes, isLoading: perfLoading } = useSWR<{
    data: ProductProfitabilityData;
  }>(profitabilityKey, fetcher, { revalidateOnFocus: false, keepPreviousData: true });

  const { rows: agents, isLoading: agentsLoading } = useProductAgents({
    productId,
    period,
    enabled: canViewProfitability,
  });

  const product = productRes?.data;
  const perf = perfRes?.data ?? null;
  /* Affectation NON castée, volontairement : c'est le compilateur qui vérifie
     que le contrat du lot 2 (ProductAgentRow) reste compatible avec la ligne
     que la table sait afficher. Un `as` avalerait une dérive de champ. */
  const agentRows: AgentRankRow[] = agents satisfies ProductAgentRow[];

  /* Le code MARCHÉ, pas le code devise : formatCurrency attend "TN" | "LY".
     Sans réponse rentabilité (warehouse_agent) on retombe sur la locale, seule
     information de marché disponible côté client. */
  const market = perf?.currency
    ? perf.currency.toUpperCase() === "LYD"
      ? "LY"
      : "TN"
    : locale === "ar"
      ? "LY"
      : "TN";
  const money = useMemo(() => (n: number) => formatCurrency(n, market), [market]);
  const moneySigned = useMemo(
    () => (n: number) => formatCurrencySigned(n, market),
    [market],
  );

  if (user && !canView) return null;

  if (productLoading) {
    return (
      <div className="min-h-screen bg-surface-page p-4 sm:p-6 lg:p-8">
        <div className="py-16 text-center text-[14px] text-ink-secondary">
          {tPnl("loading")}
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-surface-page p-4 sm:p-6 lg:p-8">
        <div className="py-16 text-center text-[14px] text-ink-secondary">
          {tPnl("empty")}
        </div>
      </div>
    );
  }

  const stockSummary = product.stock_summary;
  const currentStock = stockSummary?.current_stock ?? product.current_stock;
  const lowThreshold = stockSummary?.low_stock_threshold ?? product.low_stock_threshold;
  const damaged = stockSummary?.damaged_return_count ?? product.damaged_return_count ?? 0;
  const isLowStock =
    stockSummary?.is_low_stock ?? (currentStock <= lowThreshold && lowThreshold > 0);
  const stockValue = currentStock * Number(product.unit_cogs ?? 0);

  const inFlightTotal = agentRows.length
    ? agentRows.reduce((sum, row) => sum + (row.in_flight ?? 0), 0)
    : null;
  const callsTotal = agentRows.reduce((sum, row) => sum + (row.calls ?? 0), 0);
  /* Le seau non attribué porte actor_id null : c'est une commande sans
     acteur, pas une personne de plus dans l'équipe. */
  const agentsInvolved = agentRows.filter((row) => row.actor_id !== null).length;
  /* orders_called et orders_treated NE SE SOMMENT PAS : deux agents qui
     appellent la même commande la comptent chacun, si bien que le total de
     colonne majore les commandes distinctes touchées (cf. l'avertissement de
     src/types/product-agents.ts). Tant que la route n'expose pas les totaux
     distincts, ces deux mesures restent nulles et l'UI affiche un tiret
     plutôt qu'un nombre faux. */
  const ordersCalledTotal: number | null = null;
  const treatedTotal: number | null = null;

  const settled = perf ? perf.deliveredCount + perf.returnedCount : 0;
  const settledRate = settled > 0 && perf ? (perf.deliveredCount / settled) * 100 : null;

  const grossProfit = perf ? perf.revenue - perf.totalCogs : 0;
  const margin = perf && perf.revenue > 0 ? (perf.simplifiedNetProfit / perf.revenue) * 100 : 0;
  const netPerDelivery =
    perf && perf.deliveredCount > 0 ? perf.simplifiedNetProfit / perf.deliveredCount : null;

  const hasAgentContent = Boolean(
    (product.description ?? "").trim() ||
      (product.agent_brief ?? "").trim() ||
      (product.agent_notes ?? "").trim() ||
      (product.agent_composition ?? "").trim() ||
      (product.agent_contraindications ?? "").trim() ||
      (product.agent_usage ?? "").trim() ||
      product.cross_sell_product_id,
  );

  async function handleToggleActive() {
    if (!product) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/products/${productId}/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // On envoie la NÉGATION de la valeur réelle. Lire un is_active absent
        // donnerait !undefined === true, et le produit ne se désactiverait
        // jamais — régression déjà vécue sur la liste.
        body: JSON.stringify({ is_active: !product.is_active }),
      });
      if (!res.ok) {
        setBanner(tProducts("errors.generic", { status: res.status }));
        return;
      }
      await mutateProduct();
    } catch {
      setBanner(tProducts("errors.generic", { status: 0 }));
    } finally {
      setToggling(false);
    }
  }

  async function handleStockSubmit() {
    if (!stockModal) return;
    const change = Number.parseInt(stockModal.change, 10);
    if (!Number.isInteger(change) || change === 0) {
      setStockModal({ ...stockModal, error: tProducts("stockModal.errorQuantity") });
      return;
    }
    if (!stockModal.note.trim()) {
      setStockModal({ ...stockModal, error: tProducts("stockModal.errorNote") });
      return;
    }
    setStockModal({ ...stockModal, loading: true, error: null });
    try {
      const res = await fetch(`/api/products/${productId}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          change,
          reason: stockModal.reason,
          note: stockModal.note.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStockModal((s) =>
          s ? { ...s, loading: false, error: json?.error ?? null } : s,
        );
        return;
      }
      setStockModal(null);
      await mutateProduct();
    } catch {
      setStockModal((s) =>
        s ? { ...s, loading: false, error: tProducts("errors.generic", { status: 0 }) } : s,
      );
    }
  }

  return (
    <div className="min-h-screen bg-surface-page px-4 pb-16 pt-5 sm:px-6 lg:px-8">
      <nav
        aria-label={t("breadcrumb.label")}
        className="mb-3.5 flex items-center gap-2 text-[12.5px] text-ink-secondary"
      >
        <span className="grid h-[25px] w-[25px] place-items-center rounded-[8px] bg-prod-neutral-bg text-ink-secondary">
          <Home size={13} strokeWidth={2.1} aria-hidden />
        </span>
        <Link href={`/${locale}/products`} className="hover:text-ink-primary hover:underline">
          {tProducts("title")}
        </Link>
        <ChevronRight size={13} strokeWidth={2} aria-hidden className="rtl:rotate-180" />
        <span aria-current="page">{t("breadcrumb.current")}</span>
      </nav>

      {banner ? (
        <div
          role="alert"
          className="mb-4 rounded-card border border-status-critical/30 bg-status-criticalBg px-4 py-3 text-[13px] text-status-critical"
        >
          {banner}
        </div>
      ) : null}

      {/* ── En-tête ───────────────────────────────────────────────────── */}
      <header className="mb-5 flex flex-wrap items-start gap-5 rounded-[16px] border border-line-subtle bg-surface-card px-[22px] py-5 shadow-hover-row">
        <div
          role="img"
          aria-label={t("header.thumbAlt")}
          className="h-[92px] w-[92px] flex-none rounded-[16px] border border-line-subtle bg-surface-sunken bg-cover bg-center bg-no-repeat"
          style={
            product.image_url ? { backgroundImage: `url('${product.image_url}')` } : undefined
          }
        />
        <div className="min-w-0 flex-1">
          {/* dir="auto" sur le NŒUD DU NOM seulement : le chrome reste LTR
              pendant qu'un nom arabe résout sa propre direction. */}
          <h1
            dir="auto"
            className="text-start text-[23px] font-semibold leading-[1.28] tracking-[-0.024em] text-ink-primary"
          >
            {product.name}
          </h1>
          <div className="mt-2.5 flex flex-wrap gap-[7px]">
            <span
              className={
                "inline-flex h-6 items-center rounded-[8px] px-2.5 text-[11.5px] font-semibold " +
                (product.is_active
                  ? "bg-prod-brand-soft text-prod-brand"
                  : "bg-prod-neutral-bg text-ink-secondary")
              }
            >
              {product.is_active ? tProducts("activeLabel") : tProducts("inactive")}
            </span>
            {isLowStock ? (
              <span className="inline-flex h-6 items-center rounded-[8px] bg-status-criticalBg px-2.5 text-[11.5px] font-semibold text-status-critical">
                {tProducts("lowStock")}
              </span>
            ) : null}
            {product.sku ? (
              <span
                dir="auto"
                className="inline-flex h-6 items-center rounded-[8px] border border-line-subtle bg-surface-sunken px-2.5 font-mono text-[11px] font-medium text-ink-secondary"
              >
                {product.sku}
              </span>
            ) : null}
            {product.default_price !== null ? (
              <span className="inline-flex h-6 items-center gap-1.5 rounded-[8px] bg-prod-info-bg px-2.5 text-[11.5px] font-semibold text-status-action">
                <span className="tabular-nums">{money(Number(product.default_price))}</span>
                {t("header.catalogPrice")}
              </span>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap border-t border-line-subtle pt-3.5">
            <HeaderStat
              icon={<Package size={13} strokeWidth={2.1} aria-hidden />}
              holder="bg-prod-neutral-bg text-ink-secondary"
              label={t("header.stock")}
              value={
                <>
                  {formatCount(currentStock, intlLocale)}{" "}
                  <span className="text-[12px] font-normal text-ink-muted">
                    {t("header.stockThreshold", {
                      value: formatCount(lowThreshold, intlLocale),
                    })}
                  </span>
                </>
              }
            />
            <HeaderStat
              icon={<Coins size={13} strokeWidth={2.1} aria-hidden />}
              holder="bg-prod-brand-soft text-prod-brand"
              label={t("header.stockValue")}
              value={money(stockValue)}
            />
            <HeaderStat
              icon={<Boxes size={13} strokeWidth={2.1} aria-hidden />}
              holder="bg-prod-neutral-bg text-ink-secondary"
              label={t("header.orders")}
              value={perf ? formatCount(perf.totalLeads, intlLocale) : DASH}
            />
            <HeaderStat
              icon={<Users size={13} strokeWidth={2.1} aria-hidden />}
              holder="bg-prod-info-bg text-status-action"
              label={t("header.agentsInvolved")}
              value={
                canViewProfitability && agentsInvolved > 0
                  ? formatCount(agentsInvolved, intlLocale)
                  : DASH
              }
            />
            <HeaderStat
              icon={<ShieldAlert size={13} strokeWidth={2.1} aria-hidden />}
              holder="bg-prod-neutral-bg text-ink-secondary"
              label={t("header.damaged")}
              value={formatCount(damaged, intlLocale)}
            />
          </div>
        </div>

        <div className="ms-auto flex flex-none flex-wrap gap-2.5">
          {canManage ? (
            <Link
              href={`/${locale}/products/${productId}/edit`}
              className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-prod-brand bg-prod-brand px-4 text-[13.5px] font-semibold text-white shadow-hover-row transition-colors duration-fast hover:border-prod-brand-hover hover:bg-prod-brand-hover"
            >
              <Pencil size={14} strokeWidth={2} aria-hidden />
              {tPnl("edit")}
            </Link>
          ) : null}
          {canManage ? (
            <button
              type="button"
              onClick={() =>
                setStockModal({
                  productId,
                  productName: product.name,
                  change: "",
                  reason: "manual_adjustment",
                  note: "",
                  loading: false,
                  error: null,
                })
              }
              className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-line bg-surface-card px-4 text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken"
            >
              <Package size={14} strokeWidth={2} aria-hidden />
              {tProducts("adjustStock")}
            </button>
          ) : null}
          {canToggleActive ? (
            <button
              type="button"
              onClick={handleToggleActive}
              disabled={toggling}
              className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-line bg-surface-card px-4 text-[13.5px] font-medium text-ink-primary transition-colors duration-fast hover:border-line-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:border-line-subtle disabled:bg-surface-sunken disabled:text-ink-muted"
            >
              <Power size={14} strokeWidth={2} aria-hidden />
              {product.is_active ? tProducts("deactivate") : tProducts("activate")}
            </button>
          ) : null}
        </div>
      </header>

      {canViewProfitability ? (
        <>
          {/* ── Entonnoir ───────────────────────────────────────────── */}
          <section className="mb-6">
            <SectionHead
              icon={<Filter size={13} strokeWidth={2.2} aria-hidden />}
              holder="bg-prod-neutral-bg text-ink-secondary"
              title={t("funnel.title")}
            >
              <PeriodSelector period={period} onChange={setPeriod} />
            </SectionHead>

            {perf ? (
              <>
                <ProductFunnelChevrons
                  leads={perf.totalLeads}
                  treated={treatedTotal}
                  confirmed={perf.confirmedCount}
                  uploaded={perf.dispatchedCount}
                  delivered={perf.deliveredCount}
                  inFlight={inFlightTotal}
                  confirmationRate={perf.confirmationRate}
                  deliveryRate={perf.deliveryRate}
                />
                {/* Sans la seconde valeur — la convergence sur les commandes
                    déjà réglées — la page se lit « trois quarts des colis se
                    perdent » au lieu de « trois quarts ne sont pas arrivés ». */}
                <div className="mt-3 flex items-start gap-3 rounded-[12px] border border-status-action/20 bg-prod-info-bg px-4 py-3 text-[12.5px] leading-[1.6] text-status-action">
                  <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-pill bg-surface-card text-status-action">
                    <ShieldAlert size={14} strokeWidth={2.3} aria-hidden />
                  </span>
                  <p>
                    {t("callout.text", {
                      inFlight:
                        inFlightTotal === null ? DASH : formatCount(inFlightTotal, intlLocale),
                    })}{" "}
                    {settledRate !== null
                      ? t("callout.convergence", {
                          settled: formatCount(settled, intlLocale),
                          rate: formatPercent(settledRate, intlLocale),
                        })
                      : t("callout.noSettled")}
                  </p>
                </div>
              </>
            ) : (
              <SectionPlaceholder
                text={perfLoading ? tPnl("loading") : tPnl("empty")}
              />
            )}
          </section>

          {/* ── Argent ──────────────────────────────────────────────── */}
          <section className="mb-6">
            <SectionHead
              icon={<Coins size={13} strokeWidth={2.2} aria-hidden />}
              holder="bg-prod-brand-soft text-prod-brand"
              title={t("money.title")}
            >
              <span className="text-[12px] text-ink-muted">{t("money.meta")}</span>
            </SectionHead>

            {perf ? (
              <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[330px_minmax(0,1fr)]">
                <div className="rounded-[16px] border border-line-subtle bg-surface-card px-[22px] py-5 shadow-hover-row">
                  <span className="text-[11.5px] font-semibold text-ink-secondary">
                    {t("money.netProfit")}
                  </span>
                  <div
                    className={
                      "mt-1.5 text-[34px] font-bold leading-none tracking-[-0.034em] tabular-nums " +
                      (perf.simplifiedNetProfit < 0 ? "text-status-critical" : "text-prod-pos")
                    }
                  >
                    {moneySigned(perf.simplifiedNetProfit)}
                  </div>
                  <span
                    aria-hidden
                    className={
                      "my-3 block h-[3px] w-16 rounded-[2px] " +
                      (perf.simplifiedNetProfit < 0 ? "bg-status-critical" : "bg-prod-pos")
                    }
                  />
                  <span className="text-[11.5px] text-ink-secondary">
                    {t("money.netProfitSub", {
                      margin: formatPercent(margin, intlLocale),
                      count: formatCount(perf.deliveredCount, intlLocale),
                    })}
                  </span>
                  <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                    <MiniStat label={t("money.revenue")} value={money(perf.revenue)} />
                    <MiniStat label={t("money.grossProfit")} value={moneySigned(grossProfit)} />
                    <MiniStat
                      label={t("money.netMargin")}
                      value={formatPercent(margin, intlLocale)}
                    />
                    <MiniStat
                      label={t("money.netPerDelivery")}
                      value={netPerDelivery === null ? DASH : moneySigned(netPerDelivery)}
                    />
                  </div>
                </div>

                <ProductMoneyWaterfall
                  revenue={perf.revenue}
                  costs={[
                    { key: "cogs", value: perf.totalCogs },
                    { key: "delivery", value: perf.totalDeliveryCost },
                    { key: "returns", value: perf.totalReturnCost },
                    { key: "packing", value: perf.totalPackingCost },
                    { key: "processing", value: perf.totalProcessingCost },
                    { key: "ads", value: perf.totalAdSpend },
                  ]}
                  netProfit={perf.simplifiedNetProfit}
                  deliveredCount={perf.deliveredCount}
                  formatMoney={money}
                  formatSignedMoney={moneySigned}
                />
              </div>
            ) : (
              <SectionPlaceholder text={perfLoading ? tPnl("loading") : tPnl("empty")} />
            )}
          </section>

          {/* ── Agents ──────────────────────────────────────────────── */}
          <div className="mb-6">
            <ProductAgentsPanel
              rows={agentRows}
              isLoading={agentsLoading}
              totals={{
                calls: callsTotal,
                ordersCalled: ordersCalledTotal,
                treated: treatedTotal,
                confirmed: perf?.confirmedCount ?? 0,
                uploaded: perf?.dispatchedCount ?? 0,
                delivered: perf?.deliveredCount ?? 0,
                inFlight: inFlightTotal,
                leads: perf?.totalLeads ?? 0,
              }}
              confirmationRate={perf?.confirmationRate ?? 0}
              deliveryRate={perf?.deliveryRate ?? 0}
              formatMoney={money}
            />
          </div>
        </>
      ) : null}

      {/* ── Stock ─────────────────────────────────────────────────────── */}
      <section className="mb-6">
        <SectionHead
          icon={<Package size={13} strokeWidth={2.2} aria-hidden />}
          holder="bg-prod-neutral-bg text-ink-secondary"
          title={t("stock.title")}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KvCard label={t("stock.current")} value={formatCount(currentStock, intlLocale)} />
          <KvCard label={t("stock.threshold")} value={formatCount(lowThreshold, intlLocale)} />
          <KvCard
            label={t("stock.initial")}
            value={formatCount(product.initial_stock ?? 0, intlLocale)}
          />
          <KvCard label={t("stock.value")} value={money(stockValue)} />
          <KvCard label={t("stock.damaged")} value={formatCount(damaged, intlLocale)} />
          {/* deliveredUnits = Σ orders.quantity des commandes livrées. Le
              serveur ne l'expose pas encore ; surtout ne PAS le dériver de
              totalCogs / unit_cogs — plusieurs produits ont unit_cogs = 0. */}
          <KvCard label={t("stock.deliveredUnits")} value={DASH} muted />
        </div>
      </section>

      {/* ── Modèle de coût ────────────────────────────────────────────── */}
      <section className="mb-6">
        <ProductCostsReferenceCard
          unitCogs={Number(product.unit_cogs)}
          packingCost={Number(product.packing_cost)}
          processingCost={Number(product.confirmation_processing_cost ?? 0)}
          variants={product.variants ?? []}
        />
      </section>

      {/* ── Fiche agent ───────────────────────────────────────────────── */}
      <section className="mb-6">
        <SectionHead
          icon={<FileText size={13} strokeWidth={2.2} aria-hidden />}
          holder="bg-prod-info-bg text-status-action"
          title={t("agentContent.title")}
        >
          <span className="text-[12px] text-ink-muted">{t("agentContent.meta")}</span>
        </SectionHead>
        {hasAgentContent ? (
          <div className="rounded-[16px] border border-line-subtle bg-surface-card px-[22px] py-5 shadow-hover-row">
            {product.agent_brief ? (
              <>
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
                  {t("agentContent.briefLabel")}
                </span>
                <p dir="auto" className="mt-1 text-start text-[13.5px] leading-[1.6] text-ink-primary">
                  {product.agent_brief}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-ink-secondary">{t("agentContent.written")}</p>
            )}
            {canEditContent ? (
              <Link
                href={`/${locale}/products/${productId}/edit`}
                className="mt-3.5 inline-flex h-[33px] items-center rounded-card border border-line bg-surface-card px-3 text-[12.5px] font-medium text-ink-primary transition-colors duration-fast hover:bg-surface-sunken"
              >
                {t("agentContent.editCta")}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-line-strong bg-surface-sunken px-[22px] py-8 text-center">
            <span className="mx-auto mb-3 grid h-[46px] w-[46px] place-items-center rounded-pill bg-prod-neutral-bg text-ink-secondary">
              <FileText size={20} strokeWidth={1.9} aria-hidden />
            </span>
            <b className="mb-1.5 block text-[14px] font-semibold text-ink-primary">
              {t("agentContent.emptyTitle")}
            </b>
            <p className="mx-auto mb-4 max-w-[470px] text-[13px] leading-[1.6] text-ink-secondary">
              {t("agentContent.emptyBody")}
            </p>
            {canEditContent ? (
              <Link
                href={`/${locale}/products/${productId}/edit`}
                className="inline-flex h-[33px] items-center rounded-card border border-prod-brand bg-prod-brand px-3 text-[12.5px] font-semibold text-white transition-colors duration-fast hover:border-prod-brand-hover hover:bg-prod-brand-hover"
              >
                {t("agentContent.emptyCta")}
              </Link>
            ) : null}
          </div>
        )}
      </section>

      {/* ── Historique de stock ───────────────────────────────────────
          Visible aussi pour le warehouse_agent : GET /api/products/[id]/stock
          l'autorise déjà (canViewProducts), et c'est précisément le rôle qui
          a besoin du journal. L'écart précédent était un oubli, pas une règle. */}
      <StockHistoryPanel productId={productId} locale={locale} />

      {stockModal ? (
        <StockAdjustModal
          state={stockModal}
          onChange={(patch) => setStockModal((s) => (s ? { ...s, ...patch } : s))}
          onSubmit={handleStockSubmit}
          onClose={() => setStockModal(null)}
        />
      ) : null}
    </div>
  );
}

function SectionHead({
  icon,
  holder,
  title,
  children,
}: {
  icon: React.ReactNode;
  holder: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
      <span className={`grid h-[25px] w-[25px] place-items-center rounded-[8px] ${holder}`}>
        {icon}
      </span>
      <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-ink-primary">
        {title}
      </h2>
      {children ? <div className="ms-auto flex items-center gap-2.5">{children}</div> : null}
    </div>
  );
}

function SectionPlaceholder({ text }: { text: string }) {
  return (
    <div className="rounded-[16px] border border-line-subtle bg-surface-card p-12 text-center text-[14px] text-ink-secondary">
      {text}
    </div>
  );
}

/* Les deux lignes s'empilent : en inline, « STOCK » et « 216 » se collaient
   en « STOCK216 ». */
function HeaderStat({
  icon,
  holder,
  label,
  value,
}: {
  icon: React.ReactNode;
  holder: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-s border-line-subtle px-[22px] first:border-s-0 first:ps-0">
      <span className={`grid h-[25px] w-[25px] flex-none place-items-center rounded-[8px] ${holder}`}>
        {icon}
      </span>
      <span>
        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          {label}
        </span>
        <span className="mt-px block text-[16px] font-bold leading-[1.25] tracking-[-0.02em] tabular-nums text-ink-primary">
          {value}
        </span>
      </span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-line-subtle bg-surface-sunken px-3.5 py-2.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </span>
      <span className="text-[15px] font-bold tracking-[-0.018em] tabular-nums text-ink-primary">
        {value}
      </span>
    </div>
  );
}

function KvCard({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[16px] border border-line-subtle bg-surface-card px-4 py-3 shadow-hover-row">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </span>
      <span
        className={
          "text-[15px] tracking-[-0.018em] tabular-nums " +
          (muted ? "font-normal text-ink-muted" : "font-bold text-ink-primary")
        }
      >
        {value}
      </span>
    </div>
  );
}
