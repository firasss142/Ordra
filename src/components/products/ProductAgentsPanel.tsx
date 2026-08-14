"use client";

import { useLocale, useTranslations } from "next-intl";
import { CheckCheck, ClipboardCheck, Phone, Truck, Users } from "lucide-react";
import { AgentRankTable, type AgentRankRow } from "./AgentRankTable";
import { formatCount, formatPercent } from "./ProductFunnelChevrons";

/* ─────────────────────────────────────────────────────────────────────────────
   SECTION AGENTS — quatre tuiles, puis le classement.

   CHAQUE TUILE PORTE SON DÉNOMINATEUR. « 1 450 appels » ne veut rien dire ;
   « 1 450 appels sur 519 commandes appelées, soit 2,8 par commande » se juge.
   C'est la même règle que les cellules du classement : un effectif nu n'est pas
   une mesure tant qu'on ne sait pas sur quoi il porte.

   LA TUILE « LIVRÉES » PORTE LE NOMBRE EN VOL. Le taux se calcule sur tout ce
   qui a été uploadé ; sans le nombre encore chez le transporteur, un manager
   lit « trois quarts des colis se perdent » au lieu de « trois quarts ne sont
   pas encore arrivés ».
   ────────────────────────────────────────────────────────────────────────── */

const DASH = "—";

export interface ProductAgentsTotals {
  /** Σ des lignes attempt_1/2/3 — exact, ce sont des lignes d'historique. */
  calls: number;
  /**
   * Σ des commandes distinctes appelées PAR AGENT. Exact tant qu'une commande
   * n'est appelée que par un seul agent, majorant sinon. Le total distinct
   * côté serveur reste à ajouter (cf. contrat /agents · totals.called_orders).
   */
  ordersCalled: number | null;
  /** Idem : Σ par agent des commandes distinctes traitées. */
  treated: number | null;
  /** Serveur — confirmedCount. */
  confirmed: number;
  /** Serveur — dispatchedCount (order_history status_to='uploaded'). */
  uploaded: number;
  /** Serveur — deliveredCount. */
  delivered: number;
  /** Σ des commandes attribuées encore chez le transporteur — attribution 1:1. */
  inFlight: number | null;
  /** Serveur — totalLeads. */
  leads: number;
}

export interface ProductAgentsPanelProps {
  rows: AgentRankRow[];
  totals: ProductAgentsTotals;
  /** Serveur : confirmedCount / totalLeads × 100. */
  confirmationRate: number;
  /** Serveur : deliveredCount / dispatchedCount × 100. */
  deliveryRate: number;
  formatMoney: (n: number) => string;
  isLoading?: boolean;
}

export function ProductAgentsPanel({
  rows,
  totals,
  confirmationRate,
  deliveryRate,
  formatMoney,
  isLoading = false,
}: ProductAgentsPanelProps) {
  const t = useTranslations("products.sheet");
  const locale = useLocale();

  const decimal = new Intl.NumberFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
    maximumFractionDigits: 2,
  });
  const callsPerOrder =
    totals.ordersCalled && totals.ordersCalled > 0
      ? totals.calls / totals.ordersCalled
      : null;
  /* Repli exact quand le total distinct manque : `calls` et `confirmed` se
     somment tous les deux sans recouvrement (une confirmation appartient à un
     seul agent, un appel est une ligne d'historique). */
  const callsPerConfirmation =
    totals.confirmed > 0 ? totals.calls / totals.confirmed : null;
  const treatedShare =
    totals.treated !== null && totals.leads > 0
      ? (totals.treated / totals.leads) * 100
      : null;
  const confirmedOfTreated =
    totals.treated && totals.treated > 0
      ? (totals.confirmed / totals.treated) * 100
      : null;

  const tiles = [
    {
      key: "calls",
      icon: <Phone size={13} strokeWidth={2.2} aria-hidden />,
      holder: "bg-prod-info-bg text-status-action",
      label: t("agents.kpi.calls"),
      value: totals.calls,
      caption:
        totals.ordersCalled !== null && callsPerOrder !== null
          ? t("agents.kpi.callsSub", {
              count: formatCount(totals.ordersCalled, locale),
              avg: decimal.format(callsPerOrder),
            })
          : callsPerConfirmation !== null
            ? t("agents.kpi.callsSubPerConfirmation", {
                avg: decimal.format(callsPerConfirmation),
                count: formatCount(totals.confirmed, locale),
              })
            : t("agents.kpi.unavailable"),
    },
    {
      key: "treated",
      icon: <ClipboardCheck size={13} strokeWidth={2.2} aria-hidden />,
      holder: "bg-prod-neutral-bg text-ink-secondary",
      label: t("agents.kpi.treated"),
      value: totals.treated,
      caption:
        treatedShare === null
          ? t("agents.kpi.treatedUnavailable")
          : t("agents.kpi.treatedSub", {
              rate: formatPercent(treatedShare, locale),
              total: formatCount(totals.leads, locale),
            }),
    },
    {
      key: "confirmed",
      icon: <CheckCheck size={13} strokeWidth={2.4} aria-hidden />,
      holder: "bg-prod-brand-soft text-prod-brand",
      label: t("agents.kpi.confirmed"),
      value: totals.confirmed,
      caption:
        confirmedOfTreated === null
          ? t("agents.kpi.confirmedSubNoTreated", {
              rate: formatPercent(confirmationRate, locale),
            })
          : t("agents.kpi.confirmedSub", {
              rate: formatPercent(confirmationRate, locale),
              treatedRate: formatPercent(confirmedOfTreated, locale),
            }),
    },
    {
      key: "delivered",
      icon: <Truck size={13} strokeWidth={2.2} aria-hidden />,
      holder: "bg-prod-brand-soft text-prod-brand",
      label: t("agents.kpi.delivered"),
      value: totals.delivered,
      caption:
        totals.inFlight === null
          ? t("agents.kpi.deliveredSubNoFlight", {
              rate: formatPercent(deliveryRate, locale),
              uploaded: formatCount(totals.uploaded, locale),
            })
          : t("agents.kpi.deliveredSub", {
              rate: formatPercent(deliveryRate, locale),
              uploaded: formatCount(totals.uploaded, locale),
              inFlight: formatCount(totals.inFlight, locale),
            }),
    },
  ];

  return (
    <section>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <span className="grid h-[25px] w-[25px] place-items-center rounded-[8px] bg-prod-info-bg text-status-action">
          <Users size={13} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[15px] font-semibold tracking-[-0.014em] text-ink-primary">
          {t("agents.title")}
        </h2>
        <span className="ms-auto text-[12px] text-ink-muted">
          {/* Le seau non attribué (actor_id null) n'est pas une personne. */}
          {t("agents.meta", {
            count: formatCount(
              rows.filter((r) => r.actor_id !== null).length,
              locale,
            ),
          })}
        </span>
      </div>

      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="flex flex-col gap-0.5 rounded-[16px] border border-line-subtle bg-surface-card px-[17px] py-4 shadow-hover-row"
          >
            <div className="mb-1.5 flex items-center gap-2.5">
              <span className={`grid h-[25px] w-[25px] place-items-center rounded-[8px] ${tile.holder}`}>
                {tile.icon}
              </span>
              <span className="text-[12.5px] font-semibold text-ink-secondary">
                {tile.label}
              </span>
            </div>
            <span className="text-[26px] font-bold leading-[1.1] tracking-[-0.032em] tabular-nums text-ink-primary">
              {isLoading || tile.value === null
                ? DASH
                : formatCount(tile.value, locale)}
            </span>
            <span className="text-[11.5px] text-ink-secondary">{tile.caption}</span>
          </div>
        ))}
      </div>

      <AgentRankTable rows={rows} formatMoney={formatMoney} />
    </section>
  );
}
