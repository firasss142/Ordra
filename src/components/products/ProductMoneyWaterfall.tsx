"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatCount } from "./ProductFunnelChevrons";

/* ─────────────────────────────────────────────────────────────────────────────
   CASCADE — du chiffre d'affaires au profit net.

   POURQUOI UNE CASCADE ET PAS DES PARTS EMPILÉES : la question posée par un
   manager n'est pas « quelle part du CA part en COGS » mais « où est passé
   l'argent entre le haut et le bas ». Une barre flottante répond en montrant à
   la fois le montant retiré ET le solde courant ; un empilement ne montre que
   le premier.

   LES POSTES À ZÉRO NE SONT PAS TRACÉS, MAIS ILS SONT DITS. Une barre de trois
   pixels de haut se lit comme une erreur de rendu, et l'absence pure et simple
   se lit comme un oubli du calcul. Ils sont donc nommés sous le graphique avec
   leur valeur.

   AUCUN MONTANT N'EST CALCULÉ ICI. Le profit net arrive du serveur et n'est
   JAMAIS déduit de revenue − Σ coûts : le serveur connaît des postes que cette
   cascade ne trace pas (frais transporteur sommés commande par commande au
   tarif de SON transporteur, cf. lib/calculations/product-profitability.ts).
   Fermer la cascade sur une soustraction client afficherait un profit net
   différent de celui de la carte héros, à quelques dinars près.

   LES SEULS STYLES EN LIGNE SONT DES OFFSETS GÉOMÉTRIQUES CALCULÉS (bottom,
   height, insetInlineStart, width). Couleurs, rayons et typographie passent par
   les jetons — une valeur en pixels dépendant des données ne peut pas être une
   classe utilitaire.
   ────────────────────────────────────────────────────────────────────────── */

/** Hauteur du tracé, en px. Fixe : les colonnes se comparent entre elles. */
const PLOT_HEIGHT = 230;

export type WaterfallCostKey =
  | "cogs"
  | "delivery"
  | "returns"
  | "packing"
  | "processing"
  | "ads";

export interface WaterfallCost {
  key: WaterfallCostKey;
  /** Magnitude positive du poste de coût. */
  value: number;
}

export interface ProductMoneyWaterfallProps {
  revenue: number;
  costs: WaterfallCost[];
  /** Serveur. Jamais recalculé à partir de revenue − Σ costs. */
  netProfit: number;
  deliveredCount: number;
  formatMoney: (n: number) => string;
  formatSignedMoney: (n: number) => string;
}

/* Chaque poste emprunte un jeton existant : rouge = ce qui coûte le plus cher
   à l'unité, ambre = transport, violet = publicité. Aucun hexadécimal. */
const COST_FILL: Record<WaterfallCostKey, string> = {
  cogs: "bg-status-critical",
  delivery: "bg-status-warning",
  returns: "bg-status-critical/55",
  packing: "bg-ink-muted",
  processing: "bg-status-neutral",
  ads: "bg-oms-accent",
};

interface Segment {
  key: string;
  label: string;
  /** Signé : positif pour le CA et un profit, négatif pour un coût. */
  amount: number;
  /** Bas et haut de la barre, en unités monétaires. */
  low: number;
  high: number;
  /** Solde courant APRÈS l'étape — origine du trait de liaison. */
  after: number | null;
  fill: string;
  text: string;
  isTotal: boolean;
}

export function ProductMoneyWaterfall({
  revenue,
  costs,
  netProfit,
  deliveredCount,
  formatMoney,
  formatSignedMoney,
}: ProductMoneyWaterfallProps) {
  const t = useTranslations("products.sheet");
  const locale = useLocale();

  const plotted = costs.filter((c) => c.value !== 0);
  const zeroed = costs.filter((c) => c.value === 0);

  const netFill = netProfit < 0 ? "bg-status-critical" : "bg-prod-pos";
  const netText = netProfit < 0 ? "text-status-critical" : "text-prod-pos";

  const segments: Segment[] = [];
  let running = revenue;
  segments.push({
    key: "revenue",
    label: t("money.waterfall.revenue"),
    amount: revenue,
    low: 0,
    high: revenue,
    after: revenue,
    fill: "bg-prod-pos",
    text: "text-prod-pos",
    isTotal: true,
  });
  for (const cost of plotted) {
    const high = running;
    running -= cost.value;
    segments.push({
      key: cost.key,
      label: t(`money.waterfall.${cost.key}`),
      amount: -cost.value,
      low: running,
      high,
      after: running,
      fill: COST_FILL[cost.key],
      text: "text-ink-secondary",
      isTotal: false,
    });
  }
  segments.push({
    key: "netProfit",
    label: t("money.waterfall.netProfit"),
    amount: netProfit,
    low: Math.min(0, netProfit),
    high: Math.max(0, netProfit),
    after: null,
    fill: netFill,
    text: netText,
    isTotal: true,
  });

  /* Échelle : le plus haut des sommets atteints, marge de 6 % pour que
     l'étiquette du sommet ne touche pas le bord. Garde-fou à 1 pour ne jamais
     diviser par zéro sur un produit sans activité. */
  const ceiling =
    Math.max(1, ...segments.map((s) => Math.max(Math.abs(s.high), Math.abs(s.low)))) *
    1.06;
  const y = (value: number) => (value / ceiling) * PLOT_HEIGHT;

  const columns = `repeat(${segments.length}, minmax(0, 1fr))`;

  return (
    <div className="rounded-[16px] border border-line-subtle bg-surface-card px-5 pb-4 pt-5 shadow-hover-row">
      <div
        aria-hidden
        className="relative mb-0.5 grid items-end gap-3"
        style={{ height: `${PLOT_HEIGHT}px`, gridTemplateColumns: columns }}
      >
        {segments.map((segment, index) => {
          const barHeight = Math.max(3, y(segment.high - segment.low));
          return (
            <div key={segment.key} className="relative h-full">
              <div
                className={`absolute inset-x-[19%] rounded-[4px] ${segment.fill}`}
                style={{
                  bottom: `${y(segment.low).toFixed(1)}px`,
                  height: `${barHeight.toFixed(1)}px`,
                }}
              />
              <div
                className={`absolute inset-x-0 whitespace-nowrap text-center text-[11.5px] font-bold tabular-nums ${segment.text}`}
                style={{ bottom: `${(y(segment.high) + 7).toFixed(1)}px` }}
              >
                {/* Le CA n'est pas une variation : il ne porte pas de signe.
                    Les coûts et le solde final en portent un, c'est ce qui
                    rend la soustraction lisible sans légende. */}
                {segment.key === "revenue"
                  ? formatMoney(segment.amount)
                  : formatSignedMoney(segment.amount)}
              </div>
              {index < segments.length - 1 && segment.after !== null ? (
                <div
                  className="absolute h-0 border-t border-dashed border-line-strong"
                  style={{
                    bottom: `${y(segment.after).toFixed(1)}px`,
                    insetInlineStart: "81%",
                    width: "38%",
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <ol
        aria-label={t("money.waterfall.chartLabel")}
        className="grid list-none gap-3 border-t border-line-subtle pt-2.5"
        style={{ gridTemplateColumns: columns }}
      >
        {segments.map((segment) => (
          <li
            key={segment.key}
            className={
              "text-center text-[11.5px] leading-[1.35] " +
              (segment.key === "netProfit"
                ? "font-bold text-ink-primary"
                : "text-ink-secondary")
            }
          >
            {segment.label}
            {/* Le tracé est aria-hidden : sans ce doublon, un lecteur d'écran
                entendrait la liste des postes sans un seul montant. */}
            <span className="sr-only">
              {" : "}
              {segment.key === "revenue"
                ? formatMoney(segment.amount)
                : formatSignedMoney(segment.amount)}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[11.5px] leading-[1.55] text-ink-muted">
        {t("money.waterfall.note", { count: formatCount(deliveredCount, locale) })}
      </p>
      {zeroed.length > 0 ? (
        <p className="mt-1 text-[11.5px] leading-[1.55] text-ink-muted">
          {t("money.waterfall.zeroNote", {
            posts: zeroed.map((c) => t(`money.waterfall.${c.key}`)).join(", "),
            value: formatMoney(0),
          })}
        </p>
      ) : null}
    </div>
  );
}
