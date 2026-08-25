"use client";

import { useTranslations } from "next-intl";
import useSWR from "swr";
import { FileText } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { dateShort, fmtNum, fmtSigned } from "@/lib/investors/ui-format";
import { LedgerList } from "./LedgerList";

type Stmt = { id: string; sequence_no: number; period_start: string; period_end: string; currency: string; net_profit: string | number; investor_share: string | number; payable: string | number; carried_loss_after: string | number; share_pct_max: string | number; investor_deals: { label: string | null; products: { name: string | null; image_url: string | null } | null } | null };

export function ActivityClient({ locale }: { locale: string }) {
  const t = useTranslations("investor.activity");
  const td = useTranslations("investor.deal");
  const { data } = useSWR<{ data: Stmt[] }>("/api/investor/statements", fetcher, { refreshInterval: 120_000 });
  const stmts = data?.data ?? [];
  const csv = () => {
    const head = ["statement", "product", "period_start", "period_end", "net_profit", "share_pct", "investor_share", "payable", "carried_loss_after", "currency"];
    const rows = stmts.map((s) => [s.sequence_no, s.investor_deals?.products?.name ?? "", s.period_start, s.period_end, s.net_profit, s.share_pct_max, s.investor_share, s.payable, s.carried_loss_after, s.currency]);
    const blob = new Blob([[head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "releves.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
      <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("movements")}</div>
      <section className="rounded-[10px] border border-oms-border bg-oms-surface px-3.5 py-0.5"><LedgerList locale={locale} /></section>
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("statementsArchive")}</span>
        {stmts.length > 0 && <button type="button" onClick={csv} className="text-[12px] font-semibold text-oms-ink-2">{t("csv")}</button>}
      </div>
      <section className="rounded-[10px] border border-oms-border bg-oms-surface px-3.5 py-0.5">
        {data && stmts.length === 0 && <div className="py-6 text-center text-[12.5px] text-oms-ink-3">{t("noStatements")}</div>}
        <ul className="m-0 list-none p-0">
          {stmts.map((s) => {
            const payable = Number(s.payable), carried = Number(s.carried_loss_after);
            return (
              <li key={s.id} className="flex items-start gap-2.5 border-t border-oms-border py-2.5 first:border-t-0">
                {s.investor_deals?.products?.image_url ? <img src={s.investor_deals.products.image_url} alt="" className="h-[30px] w-[30px] flex-none rounded-md object-cover" /> : <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-oms-sunken text-oms-ink-2"><FileText size={15} /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{td("statement", { n: s.sequence_no })} · {s.investor_deals?.products?.name}</span>
                  <span className="block text-[11.5px] leading-snug text-oms-ink-3">{t("period", { start: dateShort(s.period_start, locale), end: dateShort(s.period_end, locale) })} · {t("netTimesShare", { net: fmtSigned(Number(s.net_profit)), pct: fmtNum(Number(s.share_pct_max)) })}{carried > 0 ? <span className="text-oms-warn-ink"> · {td("carriedToRecover").toLowerCase()} {fmtNum(carried)}</span> : null}</span>
                </span>
                <span className="flex-none text-end"><b className={`block text-[13.5px] tabular-nums ${payable > 0 ? "text-oms-ok" : "text-oms-ink-2"}`}>{payable > 0 ? "+" : ""}{fmtNum(payable, 2)}</b><span className="block text-[10.5px] text-oms-ink-3">{payable > 0 ? td("payable") : t("noPayment")}</span></span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
