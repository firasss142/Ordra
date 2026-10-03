"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { MarketRow } from "@/lib/markets/list";
import { formatCurrency } from "@/lib/format";

/**
 * Finances › Achats.
 *
 * DEUX QUESTIONS, DANS CET ORDRE. « Qu'est-ce que je dois, et quand » est la
 * seule liste sur laquelle on agit, donc elle passe avant les fournisseurs.
 * « À qui puis-je me fier » décide du prochain achat, donc elle vient juste
 * après. Tout le reste — dépense sur 90 jours, nombre de réceptions — est de la
 * curiosité et descend en sous-ligne, là où on le lit sans le chercher.
 *
 * TROIS INDICATEURS, PAS CINQ. Un litige se traite chez quelqu'un, pas dans un
 * compteur : il est devenu une pastille sur la ligne du fournisseur concerné.
 */

interface PayableRow {
  receptionId: string;
  reference: string | null;
  supplierId: string | null;
  supplierName: string | null;
  purchasedAt: string;
  invoiceTotal: number | null;
  paid: number;
  balance: number | null;
  dueAt: string | null;
  state: "due" | "overdue";
  daysLate: number | null;
}

interface SupplierRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  receptions: number;
  spend90d: number;
  owed: number;
  overdue: number;
  fillRate: number | null;
  leadTimeDays: number | null;
  lastDeliveryAt: string | null;
}

interface Payload {
  summary: {
    owed: number;
    overdue: number;
    overdueSuppliers: number;
    unpriced: number;
    worstDaysLate: number | null;
    purchases30d: number;
    windowDays: number;
  };
  payables: PayableRow[];
  suppliers: SupplierRow[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const CARD = "rounded-xl border border-line bg-surface-card";
const LABEL = "text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted";
const NUM = "font-mono tabular-nums";

export function PurchasesClient({
  locale,
  markets,
  initialMarketId,
}: {
  locale: string;
  markets: MarketRow[];
  initialMarketId: string;
}) {
  const t = useTranslations("purchases");
  const [marketId, setMarketId] = useState(initialMarketId);
  const market = markets.find((m) => m.id === marketId);
  // `formatCurrency` compare le code EN MAJUSCULES (`market === "LY"`) et
  // retombe SILENCIEUSEMENT sur la branche tunisienne sinon — un marché libyen
  // s'afficherait alors en dinars tunisiens sans rien signaler. Le contrat est
  // documenté dans lib/format.ts ; on le respecte ici plutôt que de le découvrir
  // sur un écran d'argent.
  const code = (market?.code ?? "ly").toUpperCase();

  const { data, isLoading } = useSWR<Payload>(
    marketId ? `/api/finance/purchases?market_id=${marketId}` : null,
    fetcher,
    { keepPreviousData: true }
  );

  const money = (n: number) => formatCurrency(n, code);
  const day = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(locale === "ar" ? "ar" : "fr", {
          day: "numeric",
          month: "short",
        })
      : "—";

  /** « dans 12 jours » / « 9 jours de retard » — personne ne soustrait des dates de tête. */
  function when(row: PayableRow) {
    if (row.state === "overdue") {
      return (
        <>
          <div className="text-[12px] text-ink-secondary">{t("dueOn", { date: day(row.dueAt) })}</div>
          <div className="text-[12.5px] font-bold text-[var(--wh-bad,#D72C0D)]">
            {t("daysLate", { days: row.daysLate ?? 0 })}
          </div>
        </>
      );
    }
    if (!row.dueAt) return <div className="text-[12.5px] text-ink-muted">{t("noDueDate")}</div>;
    const days = Math.round(
      (new Date(row.dueAt).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000
    );
    return (
      <>
        <div className="text-[12px] text-ink-secondary">{t("dueOn", { date: day(row.dueAt) })}</div>
        <div className="text-[12.5px] font-bold text-ink-primary">{t("inDays", { days })}</div>
      </>
    );
  }

  const s = data?.summary;

  return (
    <div className="flex min-h-screen flex-col gap-5 bg-surface-page px-4 pb-20 pt-16 md:px-6 md:pt-6">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-ink-primary">{t("title")}</h1>
          <p className="mt-1 text-[13px] text-ink-secondary">{t("subtitle")}</p>
        </div>
        {markets.length > 1 && (
          <select
            value={marketId}
            onChange={(e) => setMarketId(e.target.value)}
            className="min-h-[38px] rounded-lg border border-line-strong bg-surface-card px-3 text-[13.5px]"
          >
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {/* ── Trois indicateurs ─────────────────────────────────────────────── */}
      <div className={`${CARD} grid gap-px overflow-hidden bg-line sm:grid-cols-3`}>
        <div className="bg-surface-card p-4">
          <div className={LABEL}>{t("owed")}</div>
          <div className={`${NUM} mt-1.5 text-[23px] font-bold tracking-tight text-ink-primary`}>
            {s ? money(s.owed) : "—"}
          </div>
          <div className="mt-1 text-[11.5px] text-ink-muted">
            {s ? t("owedSub", { count: data!.payables.length }) : ""}
          </div>
        </div>

        <div className="bg-surface-card p-4">
          <div className={LABEL}>{t("overdue")}</div>
          <div
            className={`${NUM} mt-1.5 text-[23px] font-bold tracking-tight ${
              s && s.overdue > 0 ? "text-[#D72C0D]" : "text-ink-primary"
            }`}
          >
            {s ? money(s.overdue) : "—"}
          </div>
          <div
            className={`mt-1 text-[11.5px] ${s && s.overdue > 0 ? "font-semibold text-[#D72C0D]" : "text-ink-muted"}`}
          >
            {s && s.overdue > 0
              ? t("overdueSub", { suppliers: s.overdueSuppliers, days: s.worstDaysLate ?? 0 })
              : t("overdueNone")}
          </div>
        </div>

        <div className="bg-surface-card p-4">
          <div className={LABEL}>{t("purchases", { days: s?.windowDays ?? 30 })}</div>
          <div className={`${NUM} mt-1.5 text-[23px] font-bold tracking-tight text-ink-primary`}>
            {s ? money(s.purchases30d) : "—"}
          </div>
          {/* Une facture non chiffrée est comptée à part, jamais à zéro. */}
          <div className="mt-1 text-[11.5px] text-ink-muted">
            {s && s.unpriced > 0 ? t("unpriced", { count: s.unpriced }) : t("purchasesSub")}
          </div>
        </div>
      </div>

      {/* ── À payer ───────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[14px] font-bold text-ink-primary">{t("toPay")}</h2>
          <span className="text-[12px] text-ink-secondary">{t("toPayHint")}</span>
        </div>

        <div className={`${CARD} overflow-hidden`}>
          <div className="grid grid-cols-[minmax(180px,1.3fr)_150px_minmax(150px,1fr)] gap-4 bg-surface-sunken px-5 py-2.5 md:grid-cols-[minmax(210px,1.3fr)_205px_minmax(165px,1fr)]">
            <span className={LABEL}>{t("colSupplier")}</span>
            <span className={`${LABEL} text-right`}>{t("colBalance")}</span>
            <span className={LABEL}>{t("colDue")}</span>
          </div>

          {isLoading && !data ? (
            <div className="px-5 py-8 text-center text-[13px] text-ink-muted">{t("loading")}</div>
          ) : data?.payables.length === 0 ? (
            <div className="border-t border-line px-5 py-10 text-center">
              <div className="text-[14px] font-semibold text-ink-primary">{t("nothingDue")}</div>
              <div className="mt-1 text-[12.5px] text-ink-secondary">{t("nothingDueHint")}</div>
            </div>
          ) : (
            data?.payables.map((row) => (
              <div
                key={row.receptionId}
                className="relative grid grid-cols-[minmax(180px,1.3fr)_150px_minmax(150px,1fr)] items-center gap-4 border-t border-line px-5 py-3.5 md:grid-cols-[minmax(210px,1.3fr)_205px_minmax(165px,1fr)]"
              >
                {/* Le liseré rouge ne marque que ce qui est échu. */}
                {row.state === "overdue" && (
                  <span className="absolute inset-y-0 start-0 w-[3px] bg-[#D72C0D]" />
                )}
                <div>
                  <div className="text-[14px] font-semibold text-ink-primary" dir="auto">
                    {row.supplierName ?? t("unattributed")}
                  </div>
                  <div className={`${NUM} mt-0.5 text-[11.5px] text-ink-muted`}>
                    {row.reference ?? t("noReference")} · {day(row.purchasedAt)}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`${NUM} text-[16px] font-bold ${
                      row.state === "overdue" ? "text-[#D72C0D]" : "text-ink-primary"
                    }`}
                  >
                    {money(row.balance ?? 0)}
                  </div>
                  {row.paid > 0 && (
                    <div className={`${NUM} mt-0.5 text-[11.5px] text-ink-muted`}>
                      {t("deposit", { amount: money(row.paid) })}
                    </div>
                  )}
                </div>
                <div>{when(row)}</div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Les fournisseurs ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[14px] font-bold text-ink-primary">{t("suppliers")}</h2>
          <span className="text-[12px] text-ink-secondary">{t("suppliersHint")}</span>
        </div>

        <div className={`${CARD} overflow-hidden`}>
          <div className="grid grid-cols-[minmax(200px,2fr)_150px_130px_100px] gap-3.5 bg-surface-sunken px-5 py-2.5">
            <span className={LABEL}>{t("colName")}</span>
            <span className={`${LABEL} text-right`}>{t("colOwed")}</span>
            <span className={`${LABEL} text-right`}>{t("colFillRate")}</span>
            <span className={`${LABEL} text-right`}>{t("colLeadTime")}</span>
          </div>

          {data?.suppliers.length === 0 ? (
            <div className="border-t border-line px-5 py-10 text-center">
              <div className="text-[14px] font-semibold text-ink-primary">{t("noSuppliers")}</div>
              <div className="mt-1 text-[12.5px] text-ink-secondary">{t("noSuppliersHint")}</div>
            </div>
          ) : (
            data?.suppliers.map((sup) => (
              <div
                key={sup.id}
                className="grid grid-cols-[minmax(200px,2fr)_150px_130px_100px] items-center gap-3.5 border-t border-line px-5 py-3.5"
              >
                <div>
                  <div className="text-[14px] font-semibold text-ink-primary" dir="auto">
                    {sup.name}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink-muted">
                    {[sup.category, sup.city].filter(Boolean).join(" · ")}
                    {sup.receptions > 0 && ` · ${t("nReceptions", { count: sup.receptions })}`}
                    {sup.spend90d > 0 && ` · ${t("spend90", { amount: money(sup.spend90d) })}`}
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`${NUM} text-[14px] font-semibold ${
                      sup.overdue > 0
                        ? "text-[#D72C0D]"
                        : sup.owed > 0
                          ? "text-ink-primary"
                          : "text-ink-muted"
                    }`}
                  >
                    {sup.owed > 0 ? money(sup.owed) : "—"}
                  </div>
                </div>

                {/* LE TAUX DE SERVICE VAUT « — » TANT QUE RIEN N'A ÉTÉ ANNONCÉ.
                    Ni 0 % (« il ne livre jamais »), ni 100 % (« il livre
                    toujours ») : on ne sait pas, et on le dit. */}
                <div className="text-right">
                  {sup.fillRate === null ? (
                    <span className="text-[13px] text-ink-muted">—</span>
                  ) : (
                    <>
                      <div className={`${NUM} text-[13px] font-semibold text-ink-primary`}>
                        {sup.fillRate} %
                      </div>
                      <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-line-subtle">
                        <i
                          className="block h-full rounded-full"
                          style={{
                            width: `${Math.min(sup.fillRate, 100)}%`,
                            background: sup.fillRate >= 95 ? "#15803D" : "#92600A",
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className={`${NUM} text-right text-[13px] text-ink-muted`}>
                  {sup.leadTimeDays === null ? "—" : t("nDays", { days: sup.leadTimeDays })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pourquoi deux colonnes sont vides, dit une fois et sans s'excuser. */}
        <p className="text-[12px] leading-relaxed text-ink-muted">{t("whyEmptyColumns")}</p>
      </section>
    </div>
  );
}
