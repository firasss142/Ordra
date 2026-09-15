"use client";

/**
 * « Campagnes » — every campaign, and the rule that governs what happens to
 * the prospects they produce.
 *
 * Design: prototypes/prospects-manager-v1.html (campaignsBody).
 */
import { useTranslations } from "next-intl";
import { Clock, ShieldCheck } from "lucide-react";
import type { CampaignResult, LossByReason } from "@/lib/prospects/console";
import { CARD, Empty, fmt, Hint, LossRow } from "./ui";
import { CampaignCard } from "./CampaignCard";

export interface CampaignsTabProps {
  campaigns: CampaignResult[];
  loss: LossByReason;
  marketCode: "ly" | "tn";
  locale: string;
  onDistribute: (campaign: CampaignResult) => void;
  onSee: (campaign: CampaignResult) => void;
}

export function CampaignsTab({ campaigns, loss, marketCode, locale, onDistribute, onSee }: CampaignsTabProps) {
  const t = useTranslations("prospects.console");
  const tLost = useTranslations("prospects.lost");

  const lossRows = Object.entries(loss)
    .map(([reason, n]) => ({ reason, n }))
    .sort((a, b) => b.n - a.n);
  const lossMax = lossRows[0]?.n ?? 0;
  const lossTotal = lossRows.reduce((s, r) => s + r.n, 0);

  return (
    <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1.4fr_1fr]">
      <section className={CARD}>
        <h3 className="m-0 flex items-baseline gap-2 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
          {t("camps.t")}
          <span className="ms-auto text-[13px] font-medium text-[#6B7280]">
            {fmt(campaigns.length, locale)}
          </span>
        </h3>
        {campaigns.length === 0 ? (
          <Empty>{t("camps.none")}</Empty>
        ) : (
          campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              marketCode={marketCode}
              locale={locale}
              onDistribute={onDistribute}
              onSee={onSee}
            />
          ))
        )}
      </section>

      <div className="flex flex-col gap-3.5">
        <section className={CARD}>
          <h3 className="m-0 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
            {t("camps.rule")}
          </h3>
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <Hint icon={ShieldCheck}>{t("camps.ruleDesc")}</Hint>
            <Hint icon={Clock}>{t("camps.capDesc")}</Hint>
          </div>
        </section>

        <section className={CARD}>
          <h3 className="m-0 flex items-baseline gap-2 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
            {t("loss.t")}
            <span className="ms-auto text-[13px] font-medium text-[#6B7280]">
              {fmt(lossTotal, locale)} {t("loss.total")}
            </span>
          </h3>
          {lossRows.length === 0 ? (
            <Empty>{t("empty.pipeline")}</Empty>
          ) : (
            <div className="flex flex-col gap-2 px-4 py-3.5">
              {lossRows.map((r) => (
                <LossRow key={r.reason} label={tLost(r.reason)} value={r.n} max={lossMax} locale={locale} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
