"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, ChevronsUpDown, Info, Truck } from "lucide-react";
import { formatCount, formatPercent } from "./ProductFunnelChevrons";

/* ─────────────────────────────────────────────────────────────────────────────
   CLASSEMENT DES AGENTS SUR UN PRODUIT.

   SIX COLONNES, PAS ONZE. Une colonne par NOMBRE donnait onze colonnes que
   personne ne lisait ; ici chaque colonne porte une mesure, SON dénominateur et
   une jauge. « 39,6 % · 105 sur 265 traitées » se vérifie sans table de
   référence, « 105 » et « 265 » côte à côte ne se vérifient pas.

   MANAGERS ET ADMINISTRATEURS HORS CLASSEMENT. Ils confirment en lot sans
   appeler : les laisser dans le tri les placerait en tête sur la confirmation
   et en queue sur les appels, ce qui ne compare rien. Ils restent affichés,
   dans un groupe repliable — les retirer casserait l'identité
   « confirmées = livrées + retours + en cours + autres » sur le produit.

   LE REPÈRE DE CHAQUE JAUGE EST LA MÉDIANE DE L'ÉQUIPE, calculée sur les seuls
   agents. Une cible inventée (« 50 % ») dirait ce qu'on voudrait ; la médiane
   dit où se tient réellement l'équipe, et rend chaque ligne lisible en
   « au-dessus / en dessous » sans légende.

   TAUX DE LIVRAISON AGENT = LIVRÉES ÷ CONFIRMÉES. C'est la transposition à
   l'agent du taux produit (livrées ÷ uploadées) : un agent n'uploade pas, il
   confirme. Les commandes encore chez le transporteur comptent comme
   non-livrées — d'où la pastille « en cours », qui dit ce qui peut encore
   remonter. Sans elle, un agent récent paraît mauvais alors qu'il est jeune.
   ────────────────────────────────────────────────────────────────────────── */

const DASH = "—";

/**
 * Ligne d'agrégation agent × produit.
 *
 * Volontairement redéclarée ici, avec des types LARGES (`string`, `string|null`)
 * plutôt qu'importée de `@/types/product-agents` : ce lot ne possède pas ce
 * fichier, et une largeur supérieure rend l'affectation depuis le type du lot 2
 * sûre par typage structurel. Les noms de champs sont le contrat, à l'octet.
 */
export interface AgentRankRow {
  actor_id: string | null;
  full_name: string | null;
  role: string | null;
  calls: number;
  orders_called: number;
  orders_treated: number;
  confirmed: number;
  delivered: number;
  returned: number;
  in_flight: number;
  other: number;
  revenue: number;
}

export interface AgentRates {
  /** confirmées ÷ traitées × 100. null = dénominateur nul, PAS zéro. */
  confirmationRate: number | null;
  /** livrées ÷ confirmées × 100. null = dénominateur nul, PAS zéro. */
  deliveryRate: number | null;
}

export function computeAgentRates(row: AgentRankRow): AgentRates {
  return {
    confirmationRate: row.orders_treated
      ? (row.confirmed / row.orders_treated) * 100
      : null,
    deliveryRate: row.confirmed ? (row.delivered / row.confirmed) * 100 : null,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Un agent est classé ; tout autre rôle est un compte d'encadrement. */
export function isRanked(row: AgentRankRow): boolean {
  return row.role === "agent";
}

export interface TeamMedians {
  calls: number;
  confirmationRate: number;
  deliveryRate: number;
}

/**
 * Médianes de l'équipe — agents uniquement, dénominateurs nuls exclus.
 * Un taux `null` compté comme 0 tirerait la médiane vers le bas et
 * flatterait tout le monde.
 */
export function teamMedians(rows: AgentRankRow[]): TeamMedians {
  const agents = rows.filter(isRanked);
  const rates = agents.map(computeAgentRates);
  return {
    calls: median(agents.map((a) => a.calls)),
    confirmationRate: median(
      rates.map((r) => r.confirmationRate).filter((v): v is number => v !== null),
    ),
    deliveryRate: median(
      rates.map((r) => r.deliveryRate).filter((v): v is number => v !== null),
    ),
  };
}

type Tone = "ok" | "warn" | "bad";

function tone(value: number, good: number, ok: number): Tone {
  return value >= good ? "ok" : value >= ok ? "warn" : "bad";
}

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-prod-pos",
  warn: "text-status-warning",
  bad: "text-status-critical",
};

const TONE_FILL: Record<Tone, string> = {
  ok: "bg-prod-brand",
  warn: "bg-status-warning",
  bad: "bg-status-critical",
};

/* Médailles. Or / argent / bronze empruntés aux jetons existants : var(--brand)
   à 5,0:1, --fin-gold-ink #8F5608 à 6,0:1, --oms-warn #A9670C à 4,5:1 — tous
   porteurs de blanc au sens AA. Aucun hexadécimal nouveau. */
const MEDAL: Record<number, string> = {
  1: "border-prod-brand bg-prod-brand text-white",
  2: "border-fin-gold-ink bg-fin-gold-ink text-white",
  3: "border-oms-warn bg-oms-warn text-white",
};

type SortKey = "rank" | "calls" | "confirmationRate" | "deliveryRate" | "revenue";
type SortDir = "asc" | "desc";

interface ColumnDef {
  key: SortKey | "agent";
  labelKey: string;
  tipKey: string;
  sortable: boolean;
  numeric: boolean;
  width?: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "rank", labelKey: "rank", tipKey: "rank", sortable: true, numeric: false, width: "78px" },
  { key: "agent", labelKey: "agent", tipKey: "agent", sortable: false, numeric: false },
  { key: "calls", labelKey: "calls", tipKey: "calls", sortable: true, numeric: false },
  { key: "confirmationRate", labelKey: "confirmation", tipKey: "confirmation", sortable: true, numeric: false },
  { key: "deliveryRate", labelKey: "delivery", tipKey: "delivery", sortable: true, numeric: false },
  { key: "revenue", labelKey: "revenue", tipKey: "revenue", sortable: true, numeric: true },
];

const SUPERVISORS_ID = "product-agents-supervisors";

export interface AgentRankTableProps {
  rows: AgentRankRow[];
  /** Injecté : le formatage monétaire vit dans lib/format, pas ici. */
  formatMoney: (n: number) => string;
  onOpenAgent?: (actorId: string) => void;
}

export function AgentRankTable({ rows, formatMoney, onOpenAgent }: AgentRankTableProps) {
  const t = useTranslations("products.sheet");
  const locale = useLocale();
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [supervisorsOpen, setSupervisorsOpen] = useState(true);

  const medians = useMemo(() => teamMedians(rows), [rows]);
  const maxCalls = useMemo(
    () => Math.max(1, ...rows.filter(isRanked).map((r) => r.calls)),
    [rows],
  );

  const ranked = useMemo(() => {
    const list = rows.filter(isRanked);
    const value = (row: AgentRankRow): number => {
      if (sortKey === "rank" || sortKey === "revenue") return row.revenue;
      if (sortKey === "calls") return row.calls;
      // Un dénominateur nul ne vaut pas zéro : il se range en dernier, quel
      // que soit le sens du tri, plutôt que de simuler la pire performance.
      return computeAgentRates(row)[sortKey] ?? -1;
    };
    return [...list].sort((a, b) =>
      sortDir === "desc" ? value(b) - value(a) : value(a) - value(b),
    );
  }, [rows, sortKey, sortDir]);

  const supervisors = useMemo(
    () => rows.filter((r) => !isRanked(r)).sort((a, b) => b.revenue - a.revenue),
    [rows],
  );

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (rows.length === 0) {
    return (
      <div className="overflow-hidden rounded-[16px] border border-line-subtle bg-surface-card shadow-hover-row">
        <TableHeading />
        <p className="px-[17px] py-10 text-center text-[13px] text-ink-secondary">
          {t("agents.table.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[16px] border border-line-subtle bg-surface-card shadow-hover-row">
      <TableHeading />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[940px] border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">{t("agents.table.caption")}</caption>
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = col.sortable && col.key === sortKey;
                const label = t(`agents.columns.${col.labelKey}`);
                const tipId = `product-agents-tip-${col.labelKey}`;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width } : undefined}
                    aria-sort={
                      active ? (sortDir === "desc" ? "descending" : "ascending") : undefined
                    }
                    className={
                      "whitespace-nowrap border-b border-line-subtle bg-surface-sunken px-4 py-3 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-muted " +
                      (col.numeric ? "text-end" : "text-start")
                    }
                  >
                    <span className="relative inline-flex items-center gap-2">
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => handleSort(col.key as SortKey)}
                          className={
                            "inline-flex items-center gap-1.5 rounded-[4px] bg-transparent p-0 font-[inherit] tracking-[inherit] transition-colors duration-fast hover:text-ink-primary " +
                            (active ? "text-prod-brand" : "text-inherit")
                          }
                        >
                          {label}
                          {active ? (
                            <ChevronDown
                              size={12}
                              strokeWidth={2.6}
                              aria-hidden
                              className={sortDir === "asc" ? "rotate-180" : ""}
                            />
                          ) : (
                            <ChevronsUpDown
                              size={12}
                              strokeWidth={2}
                              aria-hidden
                              className="opacity-40"
                            />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                      <span className="group relative inline-flex">
                        <button
                          type="button"
                          aria-label={t("agents.tipLabel", { column: label })}
                          aria-describedby={tipId}
                          className="peer grid h-4 w-4 place-items-center rounded-pill bg-transparent p-0 text-ink-muted transition-colors duration-fast hover:text-ink-primary"
                        >
                          <Info size={13} strokeWidth={2.2} aria-hidden />
                        </button>
                        <span
                          role="tooltip"
                          id={tipId}
                          className="pointer-events-none invisible absolute top-[calc(100%+9px)] z-30 w-[248px] whitespace-normal rounded-card bg-ink-primary px-3 py-2.5 text-start text-[11.5px] font-normal normal-case leading-[1.55] tracking-normal text-white opacity-0 shadow-floating transition-opacity duration-fast group-hover:visible group-hover:opacity-100 peer-focus-visible:visible peer-focus-visible:opacity-100"
                          style={{ insetInlineStart: "-8px" }}
                        >
                          {t(`agents.tips.${col.tipKey}`)}
                        </span>
                      </span>
                    </span>
                  </th>
                );
              })}
              <th scope="col" style={{ width: "52px" }} className="border-b border-line-subtle bg-surface-sunken px-4 py-3">
                <span className="sr-only">{t("agents.openAgentColumn")}</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {ranked.map((row, index) => (
              <AgentRow
                key={row.actor_id ?? `ranked-${index}`}
                row={row}
                rank={index + 1}
                medians={medians}
                maxCalls={maxCalls}
                formatMoney={formatMoney}
                onOpenAgent={onOpenAgent}
              />
            ))}
          </tbody>

          {supervisors.length > 0 ? (
            <>
              <tbody>
                <tr>
                  <td colSpan={COLUMNS.length + 1} className="bg-surface-sunken p-0">
                    <button
                      type="button"
                      aria-expanded={supervisorsOpen}
                      aria-controls={SUPERVISORS_ID}
                      onClick={() => setSupervisorsOpen((v) => !v)}
                      className="flex w-full items-center gap-2.5 bg-transparent px-4 py-2.5 text-start text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-muted transition-colors duration-fast hover:text-ink-primary"
                    >
                      {supervisorsOpen ? (
                        <ChevronDown size={14} strokeWidth={2.4} aria-hidden />
                      ) : (
                        <ChevronRight size={14} strokeWidth={2.4} aria-hidden className="rtl:rotate-180" />
                      )}
                      {t("agents.supervisorsGroup")}
                    </button>
                  </td>
                </tr>
              </tbody>
              <tbody id={SUPERVISORS_ID}>
                {supervisorsOpen
                  ? supervisors.map((row, index) => (
                      <AgentRow
                        key={row.actor_id ?? `supervisor-${index}`}
                        row={row}
                        rank={null}
                        medians={medians}
                        maxCalls={maxCalls}
                        formatMoney={formatMoney}
                        onOpenAgent={onOpenAgent}
                      />
                    ))
                  : null}
              </tbody>
            </>
          ) : null}
        </table>
      </div>

      <p className="border-t border-line-subtle px-[17px] py-3.5 text-[11.5px] leading-[1.65] text-ink-muted">
        {t("agents.readingNote")}
      </p>
    </div>
  );
}

function TableHeading() {
  const t = useTranslations("products.sheet");
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line-subtle px-[17px] py-3.5">
      <h3 className="text-[14.5px] font-semibold text-ink-primary">
        {t("agents.table.title")}
      </h3>
      <span className="text-[11.5px] text-ink-muted">{t("agents.table.subtitle")}</span>
    </div>
  );
}

function initials(name: string | null): string {
  if (!name) return "??";
  return name.trim().slice(0, 2).toUpperCase();
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function Gauge({
  percent,
  medianPercent,
  fill,
  medianLabel,
}: {
  percent: number;
  medianPercent: number;
  fill: string;
  medianLabel: string;
}) {
  return (
    <span className="relative mt-2 block h-[5px] w-[170px] rounded-[3px] bg-surface-sunken">
      <span
        aria-hidden
        className={`block h-full rounded-[3px] ${fill}`}
        style={{ width: `${clampPercent(percent).toFixed(1)}%` }}
      />
      <span
        title={medianLabel}
        className="absolute -bottom-1 -top-1 w-[2px] rounded-[1px] bg-ink-muted opacity-60"
        style={{ insetInlineStart: `${clampPercent(medianPercent).toFixed(1)}%` }}
      />
    </span>
  );
}

function AgentRow({
  row,
  rank,
  medians,
  maxCalls,
  formatMoney,
  onOpenAgent,
}: {
  row: AgentRankRow;
  rank: number | null;
  medians: TeamMedians;
  maxCalls: number;
  formatMoney: (n: number) => string;
  onOpenAgent?: (actorId: string) => void;
}) {
  const t = useTranslations("products.sheet");
  const locale = useLocale();
  const dim = rank === null;
  const { confirmationRate, deliveryRate } = computeAgentRates(row);
  const confTone = confirmationRate === null ? null : tone(confirmationRate, 55, 40);
  const delTone = deliveryRate === null ? null : tone(deliveryRate, 30, 20);
  const medianLabel = t("agents.teamMedian");
  const name = row.full_name ?? t("agents.unknownAgent");

  return (
    <tr className={dim ? "opacity-80" : "transition-colors duration-fast hover:bg-surface-hover"}>
      <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3.5 align-middle">
        {dim ? (
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-card border border-line bg-surface-card text-[12.5px] font-bold text-ink-muted"
          >
            ·
          </span>
        ) : (
          <span
            className={
              "grid h-7 w-7 place-items-center rounded-card border text-[12.5px] font-bold " +
              (MEDAL[rank] ?? "border-line bg-surface-card text-ink-secondary")
            }
          >
            {rank}
          </span>
        )}
      </td>

      <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3.5 align-middle">
        <span className="flex items-center gap-3">
          <span
            aria-hidden
            className={
              "grid h-[38px] w-[38px] flex-none place-items-center rounded-pill text-[12px] font-bold " +
              (dim ? "bg-prod-neutral-bg text-ink-secondary" : "bg-prod-brand-soft text-prod-brand")
            }
          >
            {initials(row.full_name)}
          </span>
          <span className="min-w-0">
            <span dir="auto" className="block text-[14px] font-semibold tracking-[-0.01em] text-ink-primary">
              {name}
            </span>
            <span className="block text-[11.5px] text-ink-muted">
              {t(`agents.roles.${row.role ?? "unknown"}`)}
            </span>
          </span>
        </span>
      </td>

      <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3.5 align-middle">
        {row.calls > 0 ? (
          <span className="block">
            <span className="block text-[16px] font-bold leading-[1.2] tracking-[-0.02em] tabular-nums text-ink-primary">
              {formatCount(row.calls, locale)}
            </span>
            <span className="mt-px block text-[11.5px] tabular-nums text-ink-muted">
              {t("agents.callsDen", { count: formatCount(row.orders_called, locale) })}
            </span>
            <Gauge
              percent={(row.calls / maxCalls) * 100}
              medianPercent={(medians.calls / maxCalls) * 100}
              fill="bg-prod-brand"
              medianLabel={medianLabel}
            />
          </span>
        ) : (
          <span className="block">
            <span className="block text-[16px] font-bold leading-[1.2] tabular-nums text-ink-muted">
              {DASH}
            </span>
            <span className="mt-px block text-[11.5px] text-ink-muted">
              {t("agents.noCalls")}
            </span>
          </span>
        )}
      </td>

      <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3.5 align-middle">
        {confirmationRate === null || confTone === null ? (
          <span className="block text-[16px] font-bold leading-[1.2] tabular-nums text-ink-muted">
            {DASH}
          </span>
        ) : (
          <span className="block">
            <span
              className={`block text-[16px] font-bold leading-[1.2] tracking-[-0.02em] tabular-nums ${TONE_TEXT[confTone]}`}
            >
              {formatPercent(confirmationRate, locale)}
            </span>
            <span className="mt-px block text-[11.5px] tabular-nums text-ink-muted">
              {t("agents.confirmationDen", {
                confirmed: formatCount(row.confirmed, locale),
                treated: formatCount(row.orders_treated, locale),
              })}
            </span>
            <Gauge
              percent={confirmationRate}
              medianPercent={medians.confirmationRate}
              fill={TONE_FILL[confTone]}
              medianLabel={medianLabel}
            />
          </span>
        )}
      </td>

      <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3.5 align-middle">
        <span className="flex items-center">
          {deliveryRate === null || delTone === null ? (
            <span className="block">
              <span className="block text-[16px] font-bold leading-[1.2] tabular-nums text-ink-muted">
                {DASH}
              </span>
              <span className="mt-px block text-[11.5px] text-ink-muted">
                {t("agents.noConfirmation")}
              </span>
            </span>
          ) : (
            <span className="block">
              <span
                className={`block text-[16px] font-bold leading-[1.2] tracking-[-0.02em] tabular-nums ${TONE_TEXT[delTone]}`}
              >
                {formatPercent(deliveryRate, locale)}
              </span>
              <span className="mt-px block text-[11.5px] tabular-nums text-ink-muted">
                {row.returned > 0
                  ? t("agents.deliveryDenWithReturns", {
                      delivered: formatCount(row.delivered, locale),
                      returned: formatCount(row.returned, locale),
                    })
                  : t("agents.deliveryDen", {
                      delivered: formatCount(row.delivered, locale),
                    })}
              </span>
              <Gauge
                percent={deliveryRate}
                medianPercent={medians.deliveryRate}
                fill={TONE_FILL[delTone]}
                medianLabel={medianLabel}
              />
            </span>
          )}
          <span
            title={t("agents.inFlightTitle")}
            className={
              "ms-3.5 inline-flex h-[30px] items-center gap-1.5 rounded-pill border border-line bg-surface-card px-3 align-middle text-[12px] font-semibold " +
              (row.in_flight > 0 ? "text-status-action" : "text-ink-muted")
            }
          >
            <Truck size={13} strokeWidth={2.1} aria-hidden />
            {row.in_flight > 0
              ? t("agents.inFlightPill", { count: formatCount(row.in_flight, locale) })
              : t("agents.inFlightNone")}
          </span>
        </span>
      </td>

      <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3.5 text-end align-middle">
        {row.revenue !== 0 ? (
          <span className="text-[16px] font-bold tabular-nums text-ink-primary">
            {formatMoney(row.revenue)}
          </span>
        ) : (
          <span className="text-[16px] font-normal text-ink-muted">{DASH}</span>
        )}
      </td>

      <td className="whitespace-nowrap border-b border-line-subtle px-4 py-3.5 text-end align-middle">
        {!dim && onOpenAgent && row.actor_id ? (
          <button
            type="button"
            onClick={() => onOpenAgent(row.actor_id as string)}
            aria-label={t("agents.openAgent", { name })}
            className="grid h-7 w-7 place-items-center rounded-card bg-transparent text-ink-muted transition-colors duration-fast hover:bg-prod-neutral-bg hover:text-ink-primary"
          >
            <ChevronRight size={16} strokeWidth={2.2} aria-hidden className="rtl:rotate-180" />
          </button>
        ) : null}
      </td>
    </tr>
  );
}
