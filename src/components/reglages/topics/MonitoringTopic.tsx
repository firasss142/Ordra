"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Activity } from "lucide-react";
import { RULE_CATALOG, RULE_GROUPS, type RuleKey, type ThresholdField } from "@/lib/journal/rule-settings";
import type { TopicProps } from "../TopicBody";
import { useRegisterSaver } from "../form-context";
import { EmptyState, Notice, SettingsCard } from "../kit/parts";
import { SettingRow } from "../kit/SettingRow";
import { NumberField } from "../kit/NumberField";
import { Switch } from "../kit/Switch";
import { TopicSkeleton } from "../kit/TopicSkeleton";

interface RuleRow {
  rule_key: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

interface RuleState {
  enabled: boolean;
  params: Record<string, number | null>;
}

/**
 * Réglages › Surveillance (super_admin, every market at once) — when Journaux
 * opens a problem. Each rule is one row: a sentence that says when it opens
 * (it follows what you type), its thresholds, and a switch. Saved through the
 * page's save bar, one PATCH per changed rule. 20261006120100.
 */
export function MonitoringTopic(_props: TopicProps) {
  const t = useTranslations("reglages");
  const { data, error, mutate } = useSWR<{ data: RuleRow[] }>("/api/admin/journal/rules");
  const [edits, setEdits] = useState<Partial<Record<RuleKey, RuleState>>>({});

  const stored = useMemo(() => {
    const byKey = new Map((data?.data ?? []).map((r) => [r.rule_key, r]));
    const out = {} as Record<RuleKey, RuleState>;
    for (const rule of Object.keys(RULE_CATALOG) as RuleKey[]) {
      const row = byKey.get(rule);
      const fields: ThresholdField[] = RULE_CATALOG[rule];
      out[rule] = {
        enabled: row?.enabled ?? true,
        params: Object.fromEntries(
          fields.map((fd) => {
            const v = row?.params?.[fd.key];
            return [fd.key, typeof v === "number" ? v : fd.default];
          }),
        ),
      };
    }
    return out;
  }, [data]);

  const current = (rule: RuleKey): RuleState => edits[rule] ?? stored[rule];
  const isDirty = (rule: RuleKey) => {
    const e = edits[rule];
    if (!e) return false;
    const s = stored[rule];
    return e.enabled !== s.enabled || Object.keys(s.params).some((k) => e.params[k] !== s.params[k]);
  };
  const dirtyRules = (Object.keys(RULE_CATALOG) as RuleKey[]).filter(isDirty);
  const label = (rule: RuleKey) => t(`monitoring.rules.${rule}.label`);

  useRegisterSaver(
    "monitoring",
    data
      ? {
          count: dirtyRules.length,
          validate: () => {
            for (const rule of dirtyRules) {
              const fields: ThresholdField[] = RULE_CATALOG[rule];
              for (const fd of fields) {
                const v = current(rule).params[fd.key];
                if (v === null || !Number.isInteger(v) || v < fd.min || v > fd.max) {
                  return t("monitoring.outOfRange", { rule: label(rule), min: fd.min, max: fd.max });
                }
              }
            }
            return null;
          },
          save: async () => {
            for (const rule of dirtyRules) {
              const c = current(rule);
              const res = await fetch("/api/admin/journal/rules", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rule_key: rule, enabled: c.enabled, params: c.params }),
              });
              if (!res.ok) throw new Error(t("monitoring.saveFailed", { rule: label(rule) }));
            }
            await mutate();
            setEdits({});
          },
          reset: () => setEdits({}),
        }
      : null,
  );

  if (error && !data) {
    return (
      <SettingsCard>
        <EmptyState icon={<Activity aria-hidden />} title={t("monitoring.notReadyTitle")} text={t("monitoring.notReady")} />
      </SettingsCard>
    );
  }
  if (!data) return <TopicSkeleton cards={2} rows={3} />;

  const set = (rule: RuleKey, next: Partial<RuleState>) =>
    setEdits((prev) => {
      const base = prev[rule] ?? stored[rule];
      return { ...prev, [rule]: { enabled: next.enabled ?? base.enabled, params: { ...base.params, ...(next.params ?? {}) } } };
    });

  const help = (rule: RuleKey) => {
    const c = current(rule);
    if (!c.enabled) return t("monitoring.off");
    const values = Object.fromEntries(Object.entries(c.params).map(([k, v]) => [k, v ?? "…"]));
    return t(`monitoring.rules.${rule}.help`, values);
  };

  return (
    <>
      <Notice>{t("monitoring.intro")}</Notice>
      {RULE_GROUPS.map((group) => (
        <SettingsCard key={group.id} title={t(`monitoring.groups.${group.id}.title`)} description={t(`monitoring.groups.${group.id}.desc`)}>
          {group.rules.map((rule) => {
            const c = current(rule);
            const fields: ThresholdField[] = RULE_CATALOG[rule];
            return (
              <SettingRow
                key={rule}
                label={label(rule)}
                dirty={isDirty(rule)}
                muted={!c.enabled}
                help={help(rule)}
                control={
                  <div className="flex flex-wrap items-center justify-end gap-[8px]">
                    {fields.map((fd) => (
                      <NumberField
                        key={fd.key}
                        label={`${label(rule)} — ${t(`monitoring.units.${fd.unit}`)}`}
                        value={c.params[fd.key] ?? null}
                        onChange={(n) => set(rule, { params: { [fd.key]: n } })}
                        unit={t(`monitoring.units.${fd.unit}`)}
                        min={fd.min}
                        max={fd.max}
                        width={fd.unit === "rows" ? 92 : 64}
                      />
                    ))}
                    <Switch checked={c.enabled} onChange={(on) => set(rule, { enabled: on })} label={label(rule)} />
                  </div>
                }
              />
            );
          })}
        </SettingsCard>
      ))}
    </>
  );
}
