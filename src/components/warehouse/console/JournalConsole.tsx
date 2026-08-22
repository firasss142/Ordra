"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Copy, Download, Search, Info } from "lucide-react";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";
import { WhCard, WhKpiCard, WhKpiGrid } from "./primitives";
import { WH_BTN, WH_LABEL, WH_TONE, type WhTone } from "./tokens";

/**
 * Journal — the append-only ledger.
 *
 * Follows docs/design/entrepot/entrepot-light.html §Journal. The prototype
 * shows eight filters; six ship. "Réceptions" (supplier intake) and
 * "Transferts" (stock moved to the carrier's warehouse) have no source at all
 * — neither flow exists in the data model — so they are absent rather than
 * present and permanently empty. "Remises" is real: it reads order_history
 * for the uploaded → dispatched step.
 */

type Kind = "all" | "scan" | "handover" | "return" | "adjust" | "print";

const FILTERS: Kind[] = ["all", "scan", "handover", "return", "adjust", "print"];

const FILTER_KEY: Record<Kind, string> = {
  all: "filterAll",
  scan: "filterScan",
  handover: "filterHandover",
  return: "filterReturn",
  adjust: "filterAdjust",
  print: "filterPrint",
};

/** Row kind → the chip's family and wording. */
const KIND_STYLE: Record<WarehouseHistoryRow["kind"], { tone: WhTone; key: string }> = {
  scan: { tone: "scan", key: "typeScan" },
  handover: { tone: "move", key: "typeHandover" },
  return: { tone: "warn", key: "typeReturn" },
  writeoff: { tone: "bad", key: "typeWriteoff" },
  adjust: { tone: "muted", key: "typeAdjust" },
  print: { tone: "muted", key: "typePrint" },
};

const fetcher = (u: string) => fetch(u).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

function startOfDay(d: Date): number {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function JournalConsole({ locale }: { locale: string }) {
  const t = useTranslations("warehouse.journal");
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const key = `/api/warehouse/history?limit=100&kind=${kind}${
    query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""
  }`;
  const { data } = useSWR<{ rows: WarehouseHistoryRow[]; nextCursor: string | null }>(
    key,
    fetcher,
    { revalidateOnFocus: true },
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);

  /** Day label + how many rows fall on that day, for the sticky bands. */
  const days = useMemo(() => {
    const today = startOfDay(new Date());
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(startOfDay(new Date(r.at)), (counts.get(startOfDay(new Date(r.at))) ?? 0) + 1);
    const label = (ms: number) => {
      if (ms === today) return t("today");
      if (ms === today - 86_400_000) return t("yesterday");
      return new Date(ms).toLocaleDateString(locale === "ar" ? "ar" : "fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    };
    return { counts, label, today };
  }, [rows, t, locale]);

  const stats = useMemo(() => {
    const todayRows = rows.filter((r) => startOfDay(new Date(r.at)) === days.today);
    const movements = rows.filter((r) => r.qty_change !== null);
    const anomalies = rows.filter((r) => r.anomalies.length > 0);
    const withActor = rows.filter((r) => r.actor !== null);
    const operators = new Set(rows.map((r) => r.actor?.id).filter(Boolean));
    const gap = anomalies.reduce((n, r) => n + (r.qty_change ?? 0), 0);
    return {
      today: todayRows.length,
      todayScans: todayRows.filter((r) => r.kind === "scan").length,
      movements: movements.length,
      anomalies: anomalies.length,
      gap,
      operators: operators.size,
      withoutActor: rows.length - withActor.length,
      // A ledger with no rows is fully traceable, not 0 % traceable.
      traceability: rows.length === 0 ? 100 : Math.round((withActor.length / rows.length) * 100),
    };
  }, [rows, days.today]);

  const exportCsv = useCallback(() => {
    const header = ["date", "heure", "type", "evenement", "operateur", "delta", "solde"];
    const body = rows.map((r) => [
      new Date(r.at).toISOString().slice(0, 10),
      timeOf(r.at),
      r.kind,
      r.detail.replace(/"/g, '""'),
      r.actor?.full_name ?? "",
      r.qty_change ?? "",
      r.balance_after ?? "",
    ]);
    const csv = [header, ...body].map((line) => line.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-entrepot-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  const copyRef = useCallback((r: WarehouseHistoryRow) => {
    const text = r.order_number ? `#${r.order_number}` : r.id;
    void navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(r.id);
    setTimeout(() => setCopied(null), 1600);
  }, []);

  let lastDay: number | null = null;

  return (
    <div className="mx-auto w-full max-w-[1460px] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-wh-ink-1">{t("title")}</h1>
          <p className="mt-[5px] text-[13px] text-wh-ink-2">{t("subtitle")}</p>
        </div>
        <button type="button" onClick={exportCsv} className={`${WH_BTN} ms-auto`}>
          <Download size={16} aria-hidden="true" />
          {t("exportCsv")}
        </button>
      </header>

      <div className="mb-[18px]">
        <WhKpiGrid min={280}>
          <WhKpiCard
            id="events"
            label={t("kpiEvents")}
            value={stats.today}
            unit={t("kpiEventsUnit")}
            note={t("kpiEventsNote")}
            foot={[
              { value: stats.todayScans, label: t("footScans") },
              { value: stats.movements, label: t("footMoves") },
            ]}
          />
          <WhKpiCard
            id="anomalies"
            label={t("kpiAnomalies")}
            value={stats.anomalies}
            edge={stats.anomalies > 0 ? "warn" : undefined}
            dim={stats.anomalies === 0}
            note={
              stats.anomalies > 0
                ? t("kpiAnomaliesNote", { count: stats.anomalies })
                : t("kpiAnomaliesNone")
            }
            foot={[
              { value: `${stats.gap > 0 ? "+" : ""}${stats.gap} u`, label: t("footGap") },
              { value: stats.anomalies, label: t("footReview") },
            ]}
          />
          <WhKpiCard
            id="trace"
            label={t("kpiTraceability")}
            value={stats.traceability}
            unit="%"
            edge={stats.withoutActor === 0 ? "ok" : "warn"}
            note={t("kpiTraceabilityNote")}
            foot={[
              { value: stats.operators, label: t("footOperators") },
              { value: stats.withoutActor, label: t("footNoActor") },
            ]}
          />
        </WhKpiGrid>
      </div>

      <WhCard
        title={t("eventsTitle")}
        hint={<span className="font-mono tabular-nums">{rows.length}</span>}
        actions={
          <div className="flex flex-wrap gap-[7px]">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                data-testid={`wh-filter-${f}`}
                aria-pressed={kind === f}
                onClick={() => setKind(f)}
                className={`rounded-pill border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                  kind === f
                    ? "border-wh-ok bg-wh-ok text-white"
                    : "border-wh-border bg-wh-surface text-wh-ink-2 hover:border-wh-border-strong"
                }`}
              >
                {t(FILTER_KEY[f])}
              </button>
            ))}
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center gap-3.5">
            <span>{t("footNote")}</span>
            <span className="ms-auto flex flex-wrap gap-3.5">
              {(["scan", "handover", "return", "adjust"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-pill ${WH_TONE[KIND_STYLE[k].tone].fill}`} />
                  {t(KIND_STYLE[k].key)}
                </span>
              ))}
            </span>
          </div>
        }
      >
        <div className="border-b border-wh-border px-[18px] py-3">
          <div className="flex max-w-[380px] items-center gap-2.5 rounded-[10px] border border-wh-border bg-wh-surface px-3.5 py-2.5 shadow-sm">
            <Search size={15} className="shrink-0 text-wh-ink-3" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("search")}
              aria-label={t("search")}
              className="w-full border-none bg-transparent text-[13px] outline-none placeholder:text-wh-ink-3"
            />
          </div>
        </div>

        <div className="max-h-[640px] overflow-y-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[76px] border-b border-wh-border px-3.5 py-2.5 text-start ${WH_LABEL}`}>
                  {t("colTime")}
                </th>
                <th className={`w-[120px] border-b border-wh-border px-3.5 py-2.5 text-start ${WH_LABEL}`}>
                  {t("colType")}
                </th>
                <th className={`border-b border-wh-border px-3.5 py-2.5 text-start ${WH_LABEL}`}>
                  {t("colEvent")}
                </th>
                <th className={`w-[110px] border-b border-wh-border px-3.5 py-2.5 text-start ${WH_LABEL}`}>
                  {t("colOperator")}
                </th>
                <th className={`w-[130px] border-b border-wh-border px-3.5 py-2.5 text-end ${WH_LABEL}`}>
                  <span className="inline-flex items-center gap-1.5">
                    {t("colDelta")}
                    <span title={t("deltaHint")} className="inline-flex">
                      <Info size={12} aria-hidden="true" />
                    </span>
                  </span>
                </th>
                <th className="w-[44px] border-b border-wh-border" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3.5 py-8 text-center text-[13px] text-wh-ink-3">
                    {t("empty")}
                  </td>
                </tr>
              ) : (
                rows.flatMap((r) => {
                  const day = startOfDay(new Date(r.at));
                  const band =
                    day !== lastDay ? (
                      <tr key={`d-${day}`} data-testid={`wh-day-${day}`}>
                        <td
                          colSpan={6}
                          className="sticky top-0 z-[5] border-b border-wh-border bg-wh-sunken px-3.5 py-[7px] text-[11px] font-semibold uppercase tracking-[0.07em] text-wh-ink-2"
                        >
                          {days.label(day)}
                          <span className="ms-2 rounded-pill border border-wh-border bg-wh-surface px-[7px] font-mono text-[10.5px] tabular-nums">
                            {days.counts.get(day) ?? 0}
                          </span>
                        </td>
                      </tr>
                    ) : null;
                  lastDay = day;

                  const style = KIND_STYLE[r.kind];
                  const anomalous = r.anomalies.length > 0;

                  return [
                    band,
                    <tr
                      key={r.id}
                      data-testid={`wh-row-${r.id}`}
                      data-anomaly={anomalous ? "true" : "false"}
                      className={`transition-colors hover:bg-wh-sunken ${
                        anomalous ? "bg-wh-warn-bg/40 shadow-[inset_3px_0_0_var(--wh-warn)]" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap border-b border-wh-border px-3.5 py-2.5 font-mono text-[12px] tabular-nums text-wh-ink-3">
                        {timeOf(r.at)}
                      </td>
                      <td className="border-b border-wh-border px-3.5 py-2.5">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-pill px-2.5 py-[2.5px] text-[11.5px] font-semibold ${WH_TONE[style.tone].tint}`}
                        >
                          {t(style.key)}
                        </span>
                      </td>
                      <td className="border-b border-wh-border px-3.5 py-2.5 text-[13px] text-wh-ink-1">
                        <bdi>{r.detail}</bdi>
                        {anomalous ? (
                          <span className="ms-2 inline-block rounded-pill bg-wh-warn-bg px-2 py-px text-[10.5px] font-semibold text-wh-warn">
                            {t("toJustify")}
                          </span>
                        ) : null}
                      </td>
                      <td className="border-b border-wh-border px-3.5 py-2.5 text-[12.5px] text-wh-ink-2">
                        {r.actor?.full_name ?? t("noActor")}
                      </td>
                      <td
                        data-testid="wh-delta"
                        className="whitespace-nowrap border-b border-wh-border px-3.5 py-2.5 text-end font-mono text-[12.5px] tabular-nums"
                      >
                        {r.qty_change === null ? (
                          <span className="text-wh-ink-3">—</span>
                        ) : (
                          <>
                            <span
                              className={`font-bold ${
                                r.qty_change > 0
                                  ? "text-wh-ok"
                                  : r.qty_change < 0
                                    ? "text-wh-bad"
                                    : "text-wh-ink-3"
                              }`}
                            >
                              {r.qty_change > 0 ? "+" : ""}
                              {r.qty_change}
                            </span>
                            <span className="mx-1.5 text-wh-ink-3">→</span>
                            <span className="text-wh-ink-2">{r.balance_after ?? "—"}</span>
                          </>
                        )}
                      </td>
                      <td className="border-b border-wh-border px-2 py-2.5">
                        <button
                          type="button"
                          onClick={() => copyRef(r)}
                          title={t("copy")}
                          aria-label={t("copy")}
                          className="rounded-[6px] p-1 text-wh-ink-3 transition-colors hover:bg-wh-sunken hover:text-wh-ink-1"
                        >
                          <Copy size={14} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>,
                  ];
                })
              )}
            </tbody>
          </table>
        </div>
      </WhCard>

      {copied ? (
        <p
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-pill bg-wh-ink-1 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg"
        >
          {t("copied")}
        </p>
      ) : null}
    </div>
  );
}
