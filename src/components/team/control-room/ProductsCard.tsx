"use client";

import { useTranslations } from "next-intl";
import { Package } from "lucide-react";
import type { PerformanceView } from "@/lib/team/view-models";
import { fmtNum, fmtPct } from "@/lib/team/format";
import { TeamCard, TeamCardHead } from "./Card";

export function ProductsCard({ view, locale }: { view: PerformanceView; locale: string }) {
  const t = useTranslations("team.perf.products");
  const th = "px-3.5 py-2.5 text-start text-[11px] font-medium uppercase tracking-[0.05em] text-ink-secondary";
  return (
    <TeamCard>
      <TeamCardHead title={t("title")} hint={t("hint")} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={th}>{t("product")}</th>
              <th className={`${th} !text-end`}>{t("treated")}</th>
              <th className={`${th} pb-0`}>
                {t("teamRate")}
                <div className="flex justify-between px-0.5 text-[10.5px] normal-case tracking-normal text-ink-muted">
                  <span>{t("min")}</span><span>{t("team")}</span><span>{t("max")}</span>
                </div>
              </th>
              <th className={th}>{t("spread")}</th>
            </tr>
          </thead>
          <tbody>
            {view.products.map((p) => {
              const s = p.spread;
              const lo = s?.min.rate ?? 0, hi = s?.max.rate ?? 100;
              const pos = s && hi > lo ? Math.min(100, Math.max(0, ((p.rate ?? 0) - lo) / (hi - lo) * 100)) : 50;
              return (
                <tr key={p.key} className="border-b border-line-subtle last:border-b-0 hover:bg-surface-hover">
                  <td className="px-3.5 py-3">
                    <span className="grid grid-cols-[36px_1fr] items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-[7px] border border-line bg-surface-sunken text-ink-muted">
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <Package size={16} aria-hidden="true" />
                        )}
                      </span>
                      <b className="text-[14px] font-semibold text-ink-primary" dir="auto">{p.name}</b>
                    </span>
                  </td>
                  <td className="px-3.5 py-3 text-end tabular-nums">{fmtNum(locale, p.treated)}</td>
                  <td className="px-3.5 py-3">
                    <span className="flex min-w-[230px] items-center gap-2">
                      <span className="w-[46px] text-end text-[12px] tabular-nums text-ink-secondary">{s ? fmtPct(locale, s.min.rate) : "—"}</span>
                      <span className="relative h-[2px] min-w-[90px] flex-1 bg-line-strong">
                        <i className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#B0B4B8] bg-surface-card" style={{ insetInlineStart: 0 }} />
                        <i className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-status-success" style={{ insetInlineStart: `${pos}%` }} />
                        <span className="absolute top-2.5 -translate-x-1/2 whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-status-success" style={{ insetInlineStart: `${pos}%` }}>{fmtPct(locale, p.rate)}</span>
                        <i className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#B0B4B8] bg-surface-card" style={{ insetInlineStart: "100%" }} />
                      </span>
                      <span className="w-[46px] text-[12px] tabular-nums text-ink-secondary">{s ? fmtPct(locale, s.max.rate) : "—"}</span>
                    </span>
                  </td>
                  <td className="px-3.5 py-3 text-[12px] leading-[1.4] text-ink-secondary">
                    {s ? (
                      <>
                        <b className="font-medium text-ink-primary">{s.max.name} {fmtPct(locale, s.max.rate)}</b> ↔ <b className="font-medium text-ink-primary">{s.min.name} {fmtPct(locale, s.min.rate)}</b>
                        <br /><span className="font-semibold text-status-success tabular-nums">{t("pts", { n: fmtNum(locale, s.spread, 1) })}</span>
                      </>
                    ) : (
                      <span className="text-ink-muted">{t("noSpread")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {view.otherProducts.count > 0 && (
              <tr className="border-b border-line-subtle last:border-b-0">
                <td className="px-3.5 py-3">
                  <span className="grid grid-cols-[36px_1fr] items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-[7px] border border-line bg-surface-sunken text-ink-muted"><Package size={16} aria-hidden="true" /></span>
                    <span className="text-ink-secondary">{t("others", { n: view.otherProducts.count })}</span>
                  </span>
                </td>
                <td className="px-3.5 py-3 text-end tabular-nums text-ink-muted">{fmtNum(locale, view.otherProducts.treated)}</td>
                <td className="px-3.5 py-3 text-[12.5px] text-ink-muted">— {t("insufficient")} —</td>
                <td className="px-3.5 py-3 text-ink-muted">—</td>
              </tr>
            )}
            {view.products.length === 0 && view.otherProducts.count === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-[13.5px] text-ink-secondary">{t("empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </TeamCard>
  );
}
