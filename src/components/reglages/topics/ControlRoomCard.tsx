"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { DEFAULT_SHIFT_CONFIG, type ShiftConfig } from "@/types/settings";
import { marketTimezone } from "@/lib/markets";
import type { MarketSettingsForm } from "../useMarketSettingsForm";
import { SettingsCard, ReadOnlyLine } from "../kit/parts";
import { SettingRow } from "../kit/SettingRow";
import { NumberSetting } from "../kit/NumberSetting";
import { HistoryButton } from "../kit/HistoryButton";
import { RgButton } from "../kit/RgButton";

/** Saturday first, as the Libyan and Tunisian week reads. */
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];
const HHMM = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

/** "9:5" / "0905" / "09:05" → "09:05"; anything else stays as typed (and shows red). */
function normaliseTime(s: string): string {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s.trim());
  if (!m) return s;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function TimeInput({ value, onChange, label, disabled }: { value: string; onChange: (v: string) => void; label: string; disabled: boolean }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : value;
  const bad = !HHMM.test(normaliseTime(shown));
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={5}
      aria-label={label}
      disabled={disabled}
      value={shown}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const v = normaliseTime(draft);
        if (HHMM.test(v)) onChange(v);
      }}
      className={`h-[34px] w-[76px] rounded-[8px] border bg-white px-[10px] text-center text-[14px] tabular-nums text-ink-primary outline-none focus:border-brand disabled:bg-surface-sunken disabled:text-ink-secondary ${bad ? "border-status-critical" : "border-[#D1D5DB]"}`}
    />
  );
}

interface AgentRow {
  id: string;
  full_name: string;
  role?: string;
}

/**
 * Réglages › Équipe › Salle de contrôle — the thresholds behind /team and the
 * bell (prototypes/team-v5.html, the settings drawer). The owner asked for them
 * as administrator settings (2026-10-03): a manager reads them, does not edit.
 * The team planning is the existing `shift_config` key.
 */
export function ControlRoomCard({ form, marketId, editable }: { form: MarketSettingsForm; marketId: string; editable: boolean }) {
  const t = useTranslations("reglages.room");
  const shift = (form.value("shift_config") as ShiftConfig | undefined) ?? { ...DEFAULT_SHIFT_CONFIG, timezone: marketTimezone(marketId) };
  const overrides = (form.value("team_shift_overrides") as Record<string, { start: string; end: string }> | undefined) ?? {};
  const { data } = useSWR<{ data: AgentRow[] }>(`/api/agents?market_id=${encodeURIComponent(marketId)}`, { revalidateOnFocus: false });
  const agents = (data?.data ?? []).filter((a) => !a.role || a.role === "agent");
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.full_name ?? id.slice(0, 8);
  const free = agents.filter((a) => !overrides[a.id]);
  const [pick, setPick] = useState("");

  const setShift = (patch: Partial<ShiftConfig>) => form.set("shift_config", { ...shift, ...patch });
  const setOverride = (id: string, patch: Partial<{ start: string; end: string }>) =>
    form.set("team_shift_overrides", { ...overrides, [id]: { ...(overrides[id] ?? { start: shift.start, end: shift.end }), ...patch } });
  const removeOverride = (id: string) => {
    const next = { ...overrides };
    delete next[id];
    form.set("team_shift_overrides", next);
  };
  const shiftBad = shift.start >= shift.end;

  return (
    <div id="salle-de-controle" className="scroll-mt-[16px]">
      <SettingsCard title={t("title")} description={t("desc")} end={editable ? undefined : <ReadOnlyLine text={t("adminOnly")} />}>
        <NumberSetting form={form} marketId={marketId} settingKey="team_call_delay_hours" label={t("call")} unit={t("unitH")} min={1} max={72} editable={editable} help={(n) => t("callHelp", { n })} />
        <NumberSetting form={form} marketId={marketId} settingKey="team_idle_minutes" label={t("idle")} unit={t("unitMin")} min={5} max={240} step={5} editable={editable} help={(n) => t("idleHelp", { n })} />
        <NumberSetting form={form} marketId={marketId} settingKey="team_late_minutes" label={t("late")} unit={t("unitMin")} min={0} max={120} step={5} editable={editable} help={(n) => t("lateHelp", { n })} />

        <SettingRow
          stack
          label={t("shift")}
          help={t("shiftHelp")}
          dirty={form.isDirty("shift_config")}
          history={<HistoryButton marketId={marketId} settingKey="shift_config" label={t("shift")} format={(v) => (v && typeof v === "object" && "start" in (v as object) ? `${(v as ShiftConfig).start}–${(v as ShiftConfig).end}` : String(v))} />}
          control={
            <div className="flex flex-col gap-[10px]">
              <div className="flex flex-wrap items-center gap-[8px] text-[13px] text-ink-secondary">
                <TimeInput value={shift.start} label={t("start")} disabled={!editable} onChange={(v) => setShift({ start: v })} />
                <span aria-hidden="true">→</span>
                <TimeInput value={shift.end} label={t("end")} disabled={!editable} onChange={(v) => setShift({ end: v })} />
                {shiftBad && <span className="text-status-critical">{t("invalidTime")}</span>}
              </div>
              <div className="flex flex-wrap gap-[4px]" role="group" aria-label={t("daysLabel")}>
                {DAY_ORDER.map((d) => {
                  const on = shift.days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      disabled={!editable}
                      onClick={() => setShift({ days: on ? shift.days.filter((x) => x !== d) : [...shift.days, d].sort((a, b) => a - b) })}
                      className={`h-[30px] w-[36px] rounded-[7px] border text-[12px] font-semibold ${on ? "border-ink-primary bg-ink-primary text-white" : "border-line bg-white text-ink-muted"} disabled:cursor-default`}
                    >
                      {t(`days.d${d}` as "days.d0")}
                    </button>
                  );
                })}
              </div>
            </div>
          }
        />

        <SettingRow
          stack
          label={t("over")}
          help={t("overHelp")}
          dirty={form.isDirty("team_shift_overrides")}
          history={<HistoryButton marketId={marketId} settingKey="team_shift_overrides" label={t("over")} format={(v) => (v && typeof v === "object" ? String(Object.keys(v as object).length) : String(v))} />}
          control={
            <div>
              {Object.keys(overrides).length === 0 && <p className="m-0 text-[13px] text-ink-secondary">{t("overNone")}</p>}
              {Object.entries(overrides).map(([id, o]) => (
                <div key={id} className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-[8px] border-t border-line-subtle py-[8px] text-[13px] first:border-t-0">
                  <b className="font-medium text-ink-primary">{nameOf(id)}</b>
                  <TimeInput value={o.start} label={`${nameOf(id)} · ${t("start")}`} disabled={!editable} onChange={(v) => setOverride(id, { start: v })} />
                  <span aria-hidden="true">→</span>
                  <TimeInput value={o.end} label={`${nameOf(id)} · ${t("end")}`} disabled={!editable} onChange={(v) => setOverride(id, { end: v })} />
                  {editable ? (
                    <button type="button" onClick={() => removeOverride(id)} aria-label={t("remove", { name: nameOf(id) })} className="grid h-[28px] w-[28px] place-items-center rounded-[7px] text-ink-muted hover:bg-surface-hover hover:text-status-critical">
                      <Trash2 size={15} strokeWidth={1.8} aria-hidden="true" />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              {editable && free.length > 0 && (
                <div className="mt-[6px] flex items-center gap-[8px]">
                  <select aria-label={t("pick")} value={pick} onChange={(e) => setPick(e.target.value)} className="h-[32px] rounded-[8px] border border-[#D1D5DB] bg-white px-[8px] text-[13px]">
                    <option value="">{t("pick")}</option>
                    {free.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.full_name}
                      </option>
                    ))}
                  </select>
                  <RgButton
                    size="sm"
                    disabled={!pick}
                    onClick={() => {
                      if (!pick) return;
                      setOverride(pick, {});
                      setPick("");
                    }}
                  >
                    {t("add")}
                  </RgButton>
                </div>
              )}
            </div>
          }
        />
      </SettingsCard>
    </div>
  );
}
