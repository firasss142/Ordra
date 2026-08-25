"use client";

import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ArrowDown, ArrowUp, FileText, Layers, RotateCcw } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { dateShort, moneySigned } from "@/lib/investors/ui-format";

type Entry = { id: string; entry_type: "capital_in" | "settlement" | "withdrawal" | "correction" | "principal_return"; amount: string | number; currency: string; note: string | null; created_at: string; investor_deals: { label: string | null; products: { name: string | null } | null } | null; statement_id: string | null };

/** Every ledger movement with its cause. Money-direction colour on the figure only. */
export function LedgerList({ locale, limit, compact = false }: { locale: string; limit?: number; compact?: boolean }) {
  const t = useTranslations("investor.activity");
  const { data } = useSWR<{ data: Entry[] }>("/api/investor/ledger", fetcher, { refreshInterval: 60_000 });
  const rows = (data?.data ?? []).slice(0, limit ?? 500);
  if (!data) return <div className="py-6 text-center text-[12.5px] text-oms-ink-3">…</div>;
  if (!rows.length) return <div className="py-6 text-center text-[12.5px] text-oms-ink-3">{t("noMovements")}</div>;
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((e) => {
        const amt = Number(e.amount);
        const product = e.investor_deals?.products?.name ?? null;
        let title = ""; let dir: "in" | "out" | "neutral" = "neutral"; let Icon = FileText;
        switch (e.entry_type) {
          case "capital_in": title = amt >= 0 ? t("capitalIn") : t("capitalOut"); Icon = Layers; break;
          case "settlement": title = product ? `${t("settlementShort")} · ${product}` : t("settlementShort"); dir = "in"; Icon = ArrowDown; break;
          case "withdrawal": title = t("withdrawal"); dir = "out"; Icon = ArrowUp; break;
          case "correction": title = t("correction"); dir = amt >= 0 ? "in" : "out"; Icon = RotateCcw; break;
          case "principal_return": title = product ? `${t("principalReturn")} · ${product}` : t("principalReturn"); dir = "in"; Icon = Layers; break;
        }
        const sign = e.entry_type === "withdrawal" || e.entry_type === "principal_return" ? -Math.abs(amt) : amt;
        return (
          <li key={e.id} className={`flex items-start gap-2.5 border-t border-oms-border first:border-t-0 ${compact ? "py-2" : "py-2.5"}`}>
            <span className={`grid h-[30px] w-[30px] flex-none place-items-center rounded-full ${dir === "in" ? "bg-oms-ok-bg text-oms-ok" : dir === "out" ? "bg-oms-bad-bg text-oms-age-late" : "bg-oms-sunken text-oms-ink-2"}`}><Icon size={15} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{title}</span>
              <span className="block text-[11.5px] leading-snug text-oms-ink-3">{dateShort(e.created_at.slice(0, 10), locale)}{e.entry_type === "correction" && e.note ? ` · ${e.note}` : ""}</span>
            </span>
            <span className={`flex-none text-[13.5px] font-bold tabular-nums ${dir === "in" ? "text-oms-ok" : dir === "out" ? "text-oms-age-late" : ""}`}>{moneySigned(e.entry_type === "capital_in" ? amt : sign, e.currency, locale, 2)}</span>
          </li>
        );
      })}
    </ul>
  );
}
