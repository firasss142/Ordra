"use client";

import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { canEditArea } from "@/lib/reglages/topics";
import { slaDuration } from "@/lib/reglages/helpers";
import type { TopicProps } from "../TopicBody";
import { useMarketSettingsForm, type MarketSettingsForm } from "../useMarketSettingsForm";
import { SettingsCard, ReadOnlyValue } from "../kit/parts";
import { NumberSetting } from "../kit/NumberSetting";
import { SettingRow } from "../kit/SettingRow";
import { HistoryButton } from "../kit/HistoryButton";
import { RgButton } from "../kit/RgButton";
import { TopicSkeleton } from "../kit/TopicSkeleton";

/**
 * Réglages › Commandes — calls, duplicates, card payment and archiving. What is left of the
 * old « Opérations » once the 13 settings no code reads are hidden
 * (plans/reglages-redesign.md). A market manager edits all of it.
 */
export function OrdersTopic({ user, marketId }: TopicProps) {
  const t = useTranslations("reglages");
  const form = useMarketSettingsForm(marketId);
  const editable = canEditArea(user.role, "orders");
  if (!form.loaded) return <TopicSkeleton cards={4} />;

  const field = (key: string) => ({ label: t(`fields.${key}.label`), unit: t(`fields.${key}.unit`) });

  return (
    <>
      <SettingsCard title={t("orders.callsTitle")} description={t("orders.callsDesc")}>
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="max_call_attempts"
          {...field("max_call_attempts")}
          min={1}
          max={10}
          editable={editable}
          help={(n) => t("fields.max_call_attempts.help", { n })}
        />
        <RetrySlots form={form} marketId={marketId} editable={editable} />
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="sla_minutes"
          {...field("sla_minutes")}
          min={1}
          max={10080}
          editable={editable}
          help={(m) => {
            const d = slaDuration(m);
            return t(d.unit === "h" ? "fields.sla_minutes.helpHours" : "fields.sla_minutes.helpMinutes", { n: d.n });
          }}
        />
      </SettingsCard>

      <SettingsCard title={t("orders.dupTitle")} description={t("orders.dupDesc")}>
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="duplicate_window_hours"
          {...field("duplicate_window_hours")}
          max={168}
          editable={editable}
          help={(n) => t("fields.duplicate_window_hours.help", { n })}
        />
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="duplicate_autoselect_window_hours"
          {...field("duplicate_autoselect_window_hours")}
          max={168}
          editable={editable}
          help={(n) => (n === 0 ? t("fields.duplicate_autoselect_window_hours.helpZero") : t("fields.duplicate_autoselect_window_hours.help", { n }))}
        />
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="merge_window_hours"
          {...field("merge_window_hours")}
          max={168}
          editable={editable}
          help={(n) => (n === 0 ? t("fields.merge_window_hours.helpZero") : t("fields.merge_window_hours.help", { n }))}
        />
      </SettingsCard>

      <SettingsCard title={t("orders.cardTitle")} description={t("orders.cardDesc")}>
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="card_surcharge_pct"
          {...field("card_surcharge_pct")}
          min={0}
          max={50}
          step={0.5}
          editable={canEditArea(user.role, "money")}
          help={(n) => t("fields.card_surcharge_pct.help", { n })}
        />
      </SettingsCard>

      <SettingsCard title={t("orders.archiveTitle")} description={t("orders.archiveDesc")}>
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="auto_archive_after_days"
          {...field("auto_archive_after_days")}
          min={1}
          max={365}
          editable={editable}
          help={(n) => t("fields.auto_archive_after_days.help", { n })}
        />
      </SettingsCard>
    </>
  );
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The retry hours: up to three « HH:MM » slots, in the order of the day. */
function RetrySlots({ form, marketId, editable }: { form: MarketSettingsForm; marketId: string; editable: boolean }) {
  const t = useTranslations("reglages");
  const slots = (form.value("attempt_retry_times") ?? []) as string[];
  const label = t("fields.attempt_retry_times.label");
  const setSlots = (next: string[]) => form.set("attempt_retry_times", next);

  const nextSlot = () => {
    const last = slots[slots.length - 1];
    if (!last || !HHMM.test(last)) return "11:00";
    const h = Math.min(23, Number(last.slice(0, 2)) + 2);
    return `${String(h).padStart(2, "0")}:00`;
  };

  return (
    <SettingRow
      label={label}
      dirty={form.isDirty("attempt_retry_times")}
      help={
        slots.length
          ? t("fields.attempt_retry_times.help", { times: slots.join(", ") })
          : t("fields.attempt_retry_times.helpEmpty")
      }
      control={
        editable ? (
          <div className="flex flex-wrap items-center justify-end gap-[6px]">
            {slots.map((slot, i) => (
              <span
                key={i}
                className={`inline-flex h-[36px] items-center gap-[2px] rounded-[6px] border bg-white pe-[4px] ps-[8px] ${HHMM.test(slot) ? "border-[#D2D5D9]" : "border-status-critical"}`}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  dir="ltr"
                  value={slot}
                  aria-label={t("fields.attempt_retry_times.slot", { n: i + 1 })}
                  onChange={(e) => setSlots(slots.map((s, j) => (j === i ? e.target.value : s)))}
                  className="w-[52px] border-0 bg-transparent text-center text-[14px] tabular-nums outline-none"
                />
                <button
                  type="button"
                  aria-label={t("fields.attempt_retry_times.remove")}
                  onClick={() => setSlots(slots.filter((_, j) => j !== i))}
                  className="grid h-[24px] w-[24px] place-items-center rounded-[4px] text-ink-secondary hover:bg-surface-selected"
                >
                  <X className="h-[14px] w-[14px]" aria-hidden />
                </button>
              </span>
            ))}
            {slots.length < 3 && (
              <RgButton size="sm" onClick={() => setSlots([...slots, nextSlot()])}>
                <Plus aria-hidden />
                {t("fields.attempt_retry_times.add")}
              </RgButton>
            )}
          </div>
        ) : (
          <ReadOnlyValue value={slots.join(" · ") || "—"} />
        )
      }
      history={<HistoryButton marketId={marketId} settingKey="attempt_retry_times" label={label} />}
    />
  );
}
