"use client";

import { useTranslations } from "next-intl";
import type { Waterfall } from "@/lib/investors/accrual";
import { fmtNum, fmtSigned } from "@/lib/investors/ui-format";

export function Card({ children, className = "", pad = true }: { children: React.ReactNode; className?: string; pad?: boolean }) {
  return <section className={`rounded-[10px] border border-oms-border bg-oms-surface ${pad ? "p-3.5" : "overflow-x-auto"} ${className}`}>{children}</section>;
}
export function Label({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3 ${className}`}>{children}</div>;
}
export function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "bad" | "ok" | "info" }) {
  const cls = { neutral: "bg-oms-sunken text-oms-ink-2", warn: "bg-oms-warn-bg text-oms-warn-ink", bad: "bg-oms-bad-bg text-oms-age-late", ok: "bg-oms-ok-bg text-oms-ok", info: "bg-oms-info-bg text-oms-info-ink" }[tone];
  return <span className={`inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[10.5px] font-semibold ${cls}`}>{children}</span>;
}
export function Money({ v, dp = 0, dir = true, className = "" }: { v: number; dp?: number; dir?: boolean; className?: string }) {
  const c = dir ? (v > 0 ? "text-oms-ok" : v < 0 ? "text-oms-age-late" : "") : "";
  return <span className={`tabular-nums ${c} ${className}`}>{fmtSigned(v, dp)}</span>;
}
export function Btn({ children, onClick, variant = "secondary", disabled, size = "sm", type = "button", className = "" }: { children: React.ReactNode; onClick?: () => void; variant?: "primary" | "secondary" | "destructive" | "ghost"; disabled?: boolean; size?: "sm" | "md"; type?: "button" | "submit"; className?: string }) {
  const v = { primary: "bg-oms-ink-1 text-white", secondary: "bg-oms-surface text-oms-ink-1 border border-oms-border-strong", destructive: "bg-oms-age-late text-white", ghost: "bg-transparent text-oms-ink-2" }[variant];
  const s = size === "sm" ? "h-8 px-3 text-[12.5px]" : "h-9 px-4 text-[13px]";
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold disabled:opacity-40 ${v} ${s} ${className}`}>{children}</button>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="text-[11px] font-semibold text-oms-ink-2">{label}</span>{children}{hint && <span className="text-[11px] leading-snug text-oms-ink-3">{hint}</span>}</label>;
}
export const inputCls = "h-9 w-full rounded-lg border border-oms-border-strong bg-oms-surface px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-brand";
export function Callout({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "bad" }) {
  const cls = { info: "bg-oms-info-bg border-[#BFE3DC] text-oms-info-ink", warn: "bg-oms-warn-bg border-[#F0D9A8] text-oms-warn-ink", bad: "bg-oms-bad-bg border-[#F0C4BF] text-oms-age-late" }[tone];
  return <div className={`rounded-lg border px-2.5 py-2 text-[12px] leading-snug ${cls}`}>{children}</div>;
}
export function Eq({ rows }: { rows: { k: string; v: React.ReactNode; tot?: boolean }[] }) {
  return <div className="overflow-hidden rounded-lg border border-oms-border">{rows.map((r, i) => <div key={i} className={`flex justify-between px-3 py-2 text-[12.5px] tabular-nums ${i ? "border-t border-oms-border" : ""} ${r.tot ? "bg-oms-sunken font-bold" : ""}`}><span className={r.tot ? "" : "text-oms-ink-2"}>{r.k}</span><span>{r.v}</span></div>)}</div>;
}
export const th = "px-2.5 py-2 text-end text-[10px] font-semibold uppercase tracking-[.05em] text-oms-ink-3 whitespace-nowrap border-b border-oms-border";
export const thL = th + " text-start";
export const td = "px-2.5 py-2.5 text-end tabular-nums border-b border-oms-border align-middle whitespace-nowrap";
export const tdL = td + " text-start whitespace-normal";

/** Three-column waterfall: product 100 % · investor · house — same figures the portal shows, plus what the house keeps. */
export function Waterfall3({ w, sharePct, counts, perUnit, carried }: { w: Waterfall; sharePct: number; counts?: { dc?: number; rc?: number }; perUnit?: Record<string, number | null>; carried?: number }) {
  const t = useTranslations("investorAdmin.common");
  const y = (v: number) => (v * sharePct) / 100, h = (v: number) => v - y(v);
  const Row = ({ k, u, v, sub, tot }: { k: string; u?: string; v: number; sub?: boolean; tot?: boolean }) => (
    <tr className={tot ? "border-t-2 border-oms-ink-1 text-[14px] font-bold" : sub ? "bg-oms-sunken font-semibold" : ""}>
      <td className="border-t border-oms-border px-2 py-1.5 text-start">{k}{u && <span className="block text-[10.5px] font-normal text-oms-ink-3">{u}</span>}</td>
      <td className="border-t border-oms-border px-2 py-1.5 text-end tabular-nums">{tot ? <Money v={v} /> : fmtSigned(v)}</td>
      <td className="border-t border-oms-border px-2 py-1.5 text-end tabular-nums">{tot ? <Money v={y(v)} /> : fmtSigned(y(v))}</td>
      <td className="border-t border-oms-border px-2 py-1.5 text-end tabular-nums text-oms-ink-2">{tot ? <Money v={h(v)} /> : fmtSigned(h(v))}</td>
    </tr>
  );
  return (
    <table className="w-full border-collapse text-[12.5px]">
      <thead><tr className="text-[10px] font-semibold uppercase tracking-[.05em] text-oms-ink-3"><th className="px-2 pb-1.5 text-start" /><th className="px-2 pb-1.5 text-end">{t("product")}</th><th className="px-2 pb-1.5 text-end">{t("investor", { pct: fmtNum(sharePct) })}</th><th className="px-2 pb-1.5 text-end">{t("house", { pct: fmtNum(100 - sharePct) })}</th></tr></thead>
      <tbody>
        <Row k={t("revenue")} u={counts?.dc && perUnit?.priceAvg ? t("perParcel", { n: counts.dc, amount: fmtNum(perUnit.priceAvg) }) : undefined} v={w.revenue} />
        <Row k={t("cogs")} u={perUnit?.unitCogs != null ? t("perUnit", { amount: fmtNum(perUnit.unitCogs, perUnit.unitCogs % 1 ? 3 : 0) }) : undefined} v={-w.cogs} />
        <Row k={t("delivery")} u={perUnit?.deliveryAvg != null ? t("avgPerParcel", { amount: fmtNum(perUnit.deliveryAvg, 2), n: counts?.dc ?? 0 }) : undefined} v={-w.deliveryCost} />
        <Row k={t("returns")} u={perUnit?.returnAvg != null ? t("avgPerParcel", { amount: fmtNum(perUnit.returnAvg, 2), n: counts?.rc ?? 0 }) : undefined} v={-w.returnCost} />
        <Row k={t("gross")} v={w.grossProfit} sub />
        <Row k={t("packing")} v={-(w.packingCost + w.processingCost)} />
        <Row k={t("ads")} v={-w.adSpend} />
        <Row k={t("net")} v={w.netProfit} tot />
        {carried && carried > 0 ? <tr><td className="border-t border-oms-border px-2 py-1.5 text-start">{t("carried")}<span className="block text-[10.5px] text-oms-ink-3">{t("carriedSub")}</span></td><td className="border-t border-oms-border" /><td className="border-t border-oms-border px-2 py-1.5 text-end tabular-nums text-oms-age-late">{fmtSigned(-carried)}</td><td className="border-t border-oms-border px-2 py-1.5 text-end text-oms-ink-3">—</td></tr> : null}
      </tbody>
    </table>
  );
}
