"use client";

import { useTranslations } from "next-intl";
import { canEditArea } from "@/lib/reglages/topics";
import { slaDuration } from "@/lib/reglages/helpers";
import type { TopicProps } from "../TopicBody";
import { useMarketSettingsForm } from "../useMarketSettingsForm";
import { SettingsCard } from "../kit/parts";
import { NumberSetting } from "../kit/NumberSetting";
import { TopicSkeleton } from "../kit/TopicSkeleton";

/**
 * Réglages › Prospects — two rules the code already used and nobody could
 * change (2026-10-06): how many calls before a prospect is dropped, and how
 * long a new prospect stays « chaud » at the top of the worklist.
 */
export function ProspectsTopic({ user, marketId }: TopicProps) {
  const t = useTranslations("reglages");
  const form = useMarketSettingsForm(marketId);
  const editable = canEditArea(user.role, "prospects");
  if (!form.loaded) return <TopicSkeleton cards={1} rows={2} />;

  const field = (key: string) => ({ label: t(`fields.${key}.label`), unit: t(`fields.${key}.unit`) });

  return (
    <SettingsCard title={t("prospects.title")} description={t("prospects.desc")}>
      <NumberSetting
        form={form}
        marketId={marketId}
        settingKey="max_lead_attempts"
        {...field("max_lead_attempts")}
        min={1}
        max={10}
        editable={editable}
        help={(n) => t("fields.max_lead_attempts.help", { n })}
      />
      <NumberSetting
        form={form}
        marketId={marketId}
        settingKey="lead_hot_window_minutes"
        {...field("lead_hot_window_minutes")}
        min={5}
        max={10080}
        editable={editable}
        help={(m) => {
          const d = slaDuration(m);
          return t(d.unit === "h" ? "fields.lead_hot_window_minutes.helpHours" : "fields.lead_hot_window_minutes.helpMinutes", { n: d.n });
        }}
      />
    </SettingsCard>
  );
}
