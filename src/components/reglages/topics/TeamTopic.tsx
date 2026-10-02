"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { canEditArea } from "@/lib/reglages/topics";
import { todayInMarket } from "@/lib/dates/market-day";
import type { CommissionRateRow, CommissionSettings } from "@/lib/commissions/types";
import type { TopicProps } from "../TopicBody";
import { useRegisterSaver } from "../form-context";
import { useMarketSettingsForm, type MarketSettingsForm } from "../useMarketSettingsForm";
import {
  SettingsCard,
  ReadOnlyLine,
  RgBadge,
  Drawer,
  DrawerSection,
  Field,
  SwitchRow,
  inputClass,
  th,
  td,
  trPlain,
} from "../kit/parts";
import { SettingRow } from "../kit/SettingRow";
import { OptionCards } from "../kit/OptionCards";
import { NumberSetting } from "../kit/NumberSetting";
import { NumberField } from "../kit/NumberField";
import { Switch } from "../kit/Switch";
import { HistoryButton } from "../kit/HistoryButton";
import { RgButton } from "../kit/RgButton";
import { TopicSkeleton } from "../kit/TopicSkeleton";

/** The four methods that do something. « Par produit » and « Par région » stay hidden until built. */
const METHODS = ["manual", "round_robin", "workload", "percentage"] as const;
type Method = (typeof METHODS)[number];

/**
 * Réglages › Équipe — how orders reach agents, the team's goals, and (for the
 * administrator) commissions. Everything goes through the page's save bar;
 * the split by percentage is checked before anything is written.
 */
export function TeamTopic({ user, marketId }: TopicProps) {
  const t = useTranslations("reglages");
  const form = useMarketSettingsForm(marketId);
  const editable = canEditArea(user.role, "team");
  const isSA = user.role === "super_admin";
  if (!form.loaded) return <TopicSkeleton cards={3} />;

  const method = form.value("assignment_algorithm") as Method;
  const methodLabel = t("team.method");
  const goal = (key: string) => ({ label: t(`fields.${key}.label`), unit: t(`fields.${key}.unit`) });

  return (
    <>
      <SettingsCard title={t("team.distTitle")} description={t("team.distDesc")} end={editable ? undefined : <ReadOnlyLine />}>
        <SettingRow
          stack
          label={methodLabel}
          help={t("team.methodHelp")}
          dirty={form.isDirty("assignment_algorithm")}
          history={
            <HistoryButton
              marketId={marketId}
              settingKey="assignment_algorithm"
              label={methodLabel}
              format={(v) => (METHODS.includes(v as Method) ? t(`team.algo.${v}.label`) : String(v))}
            />
          }
          control={
            <>
              <OptionCards
                label={methodLabel}
                value={method}
                disabled={!editable}
                onChange={(v) => form.set("assignment_algorithm", v)}
                options={METHODS.map((m) => ({ value: m, label: t(`team.algo.${m}.label`), description: t(`team.algo.${m}.desc`) }))}
              />
              {method === "percentage" && <SharesEditor marketId={marketId} editable={editable} form={form} />}
            </>
          }
        />
      </SettingsCard>

      <SettingsCard title={t("team.goalsTitle")} description={t("team.goalsDesc")}>
        <NumberSetting form={form} marketId={marketId} settingKey="goal_daily_treated" {...goal("goal_daily_treated")} editable={editable} help={() => t("fields.goal_daily_treated.help")} />
        <NumberSetting form={form} marketId={marketId} settingKey="goal_min_rate" {...goal("goal_min_rate")} max={100} editable={editable} help={(n) => t("fields.goal_min_rate.help", { n })} />
        <NumberSetting form={form} marketId={marketId} settingKey="goal_conf_per_hour" {...goal("goal_conf_per_hour")} step={0.5} editable={editable} help={() => null} />
        <NumberSetting form={form} marketId={marketId} settingKey="goal_team_weekly_conf" {...goal("goal_team_weekly_conf")} editable={editable} help={() => null} />
      </SettingsCard>

      {isSA && <CommissionsCard marketId={marketId} />}
    </>
  );
}

interface ShareRow {
  agent_id: string;
  full_name: string;
  share_pct: number | null;
}

/** The split by percentage: one share per active agent, exactly 100 % in all. */
function SharesEditor({ marketId, editable, form }: { marketId: string; editable: boolean; form: MarketSettingsForm }) {
  const t = useTranslations("reglages");
  const { data, mutate } = useSWR<{ data: ShareRow[] }>(`/api/settings/agent-shares?market_id=${marketId}`);
  const [edits, setEdits] = useState<Record<string, number | null>>({});
  const agents = useMemo(() => data?.data ?? [], [data]);
  const value = (a: ShareRow) => (a.agent_id in edits ? edits[a.agent_id] : a.share_pct);
  const total = Math.round(agents.reduce((sum, a) => sum + (value(a) ?? 0), 0) * 100) / 100;
  const changed = Object.keys(edits).length > 0;

  useRegisterSaver("shares", {
    count: changed ? 1 : 0,
    order: -1,
    // The method may only become « par pourcentages » with a split that adds up.
    validate: () => (form.value("assignment_algorithm") === "percentage" && (changed || form.isDirty("assignment_algorithm")) && total !== 100 ? t("team.sharesInvalid") : null),
    save: async () => {
      const shares = Object.fromEntries(agents.map((a) => [a.agent_id, value(a) ?? 0]));
      const res = await fetch("/api/settings/agent-shares", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, shares }),
      });
      if (!res.ok) throw new Error(res.status === 400 ? t("team.sharesInvalid") : t("save.failed"));
      await mutate();
      setEdits({});
    },
    reset: () => setEdits({}),
  });

  if (!data) return null;
  if (agents.length === 0) return <p className="mt-[14px] text-[13px] text-ink-secondary">{t("team.noAgents")}</p>;

  return (
    <div className="mt-[14px]">
      <div className="overflow-hidden rounded-[8px] border border-line-subtle">
        {agents.map((a) => {
          const v = value(a);
          return (
            <div key={a.agent_id} className="grid grid-cols-[minmax(0,1fr)_120px_220px] items-center gap-[16px] border-b border-line-subtle px-[14px] py-[8px]">
              <div className="flex min-w-0 items-center gap-[10px]">
                <span className="grid h-[28px] w-[28px] flex-none place-items-center rounded-full bg-[#F1F2F3] text-[11.5px] font-bold text-ink-secondary">
                  {a.full_name.slice(0, 1).toUpperCase()}
                </span>
                <b className="truncate font-medium">{a.full_name}</b>
              </div>
              {editable ? (
                <NumberField
                  label={t("team.shareOf", { name: a.full_name })}
                  value={v}
                  onChange={(n) => setEdits((e) => ({ ...e, [a.agent_id]: n }))}
                  unit="%"
                  max={100}
                  step={0.5}
                  width={60}
                  dirty={a.agent_id in edits}
                />
              ) : (
                <span className="tabular-nums">{v ?? 0} %</span>
              )}
              <div className="h-[8px] overflow-hidden rounded-full bg-[#F1F2F3]">
                <i className="block h-full rounded-full bg-[#9CA3AF]" style={{ width: `${Math.min(100, v ?? 0)}%` }} />
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-[minmax(0,1fr)_120px_220px] items-center gap-[16px] bg-surface-sunken px-[14px] py-[8px] font-semibold">
          <span>{t("team.sharesTotal")}</span>
          <span className="pe-[12px] text-end tabular-nums">{total} %</span>
          <span>
            {total === 100 ? (
              <RgBadge tone="ok" dot={false}>
                <Check className="h-[12px] w-[12px]" aria-hidden />
                {t("team.sharesReady")}
              </RgBadge>
            ) : (
              <RgBadge tone="warn">{total < 100 ? t("team.sharesMissing", { n: Math.round((100 - total) * 100) / 100 }) : t("team.sharesOver", { n: Math.round((total - 100) * 100) / 100 })}</RgBadge>
            )}
          </span>
        </div>
      </div>
      <p className="m-0 mt-[8px] text-[13px] text-ink-secondary">{t("team.sharesHelp")}</p>
    </div>
  );
}

/** Commissions (administrator only): the team amount through the save bar, each agent through a panel. */
function CommissionsCard({ marketId }: { marketId: string }) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const { data, mutate } = useSWR<{ data: CommissionSettings }>(`/api/settings/commissions?market_id=${marketId}`);
  const [edits, setEdits] = useState<{ enabled?: boolean; amount?: number | null }>({});
  const [agentOpen, setAgentOpen] = useState<CommissionSettings["agents"][number] | null>(null);
  const settings = data?.data;
  const team = settings?.market ?? null;
  const enabled = edits.enabled ?? team?.enabled ?? false;
  const amount = "amount" in edits ? edits.amount ?? null : team?.amount ?? 0;
  const currency = settings?.currency ?? "";
  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${d}T12:00:00Z`));

  useRegisterSaver("commissions", {
    count: Object.keys(edits).length,
    validate: () => (Object.keys(edits).length && (amount === null || amount < 0) ? t("save.invalid") : null),
    save: async () => {
      const res = await fetch("/api/settings/commissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, agent_id: null, amount, enabled, effective_from: todayInMarket(marketId) }),
      });
      if (!res.ok) throw new Error(t("save.failed"));
      await mutate();
      setEdits({});
    },
    reset: () => setEdits({}),
  });

  if (!settings) return null;
  const set = (patch: { enabled?: boolean; amount?: number | null }) =>
    setEdits((e) => {
      const next = { ...e, ...patch };
      if (next.enabled === (team?.enabled ?? false)) delete next.enabled;
      if ("amount" in next && next.amount === (team?.amount ?? 0)) delete next.amount;
      return next;
    });

  const agents = settings.agents.filter((a) => a.is_active);
  const effective = (o: CommissionRateRow | null) => ({
    enabled: o ? o.enabled : team?.enabled ?? false,
    amount: o ? o.amount : team?.amount ?? 0,
    since: o ? o.effective_from : team?.effective_from ?? null,
  });

  return (
    <SettingsCard title={t("team.commTitle")} description={t("team.commDesc")} end={<ReadOnlyLine text={t("adminOnly")} />}>
      <SettingRow
        label={t("team.commPay")}
        dirty={"enabled" in edits}
        help={enabled ? t("team.commOn") : t("team.commOff")}
        control={<Switch checked={enabled} onChange={(v) => set({ enabled: v })} label={t("team.commPay")} />}
      />
      {enabled && (
        <SettingRow
          label={t("team.commAmount")}
          dirty={"amount" in edits}
          help={team?.effective_from ? t("team.commAmountHelp", { date: fmtDate(team.effective_from) }) : t("team.commAmountHelpNew")}
          control={
            <NumberField label={t("team.commAmount")} value={amount} onChange={(n) => set({ amount: n })} unit={currency} step={0.5} dirty={"amount" in edits} />
          }
        />
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>{t("team.colAgent")}</th>
            <th className={th}>{t("team.colCommission")}</th>
            <th className={`${th} text-end`}>{t("team.colAmount")}</th>
            <th className={th}>{t("team.colSince")}</th>
            <th className={`${th} w-[1%]`} />
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => {
            const e = effective(a.override);
            const own = !!a.override && a.override.enabled && a.override.amount !== (team?.amount ?? 0);
            return (
              <tr key={a.agent_id} className={trPlain}>
                <td className={td}>
                  <div className="flex items-center gap-[10px]">
                    <span className="grid h-[28px] w-[28px] place-items-center rounded-full bg-[#F1F2F3] text-[11.5px] font-bold text-ink-secondary">
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                    <b className="font-medium">{a.name}</b>
                  </div>
                </td>
                <td className={td}>{e.enabled ? <RgBadge tone="ok">{t("team.paid")}</RgBadge> : <RgBadge tone="neutral">{t("team.unpaid")}</RgBadge>}</td>
                <td className={`${td} text-end`}>
                  {e.enabled ? (
                    <span className="inline-flex items-center gap-[6px]">
                      <span className="tabular-nums">
                        {e.amount} {currency}
                      </span>
                      {own && (
                        <RgBadge tone="info" dot={false}>
                          {t("team.ownAmount")}
                        </RgBadge>
                      )}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={td}>{e.since ? fmtDate(e.since) : "—"}</td>
                <td className={`${td} w-[1%] text-end`}>
                  <RgButton size="sm" onClick={() => setAgentOpen(a)}>
                    {t("common.edit")}
                  </RgButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {agentOpen && (
        <AgentRateDrawer
          marketId={marketId}
          agent={agentOpen}
          teamAmount={team?.amount ?? 0}
          currency={currency}
          current={effective(agentOpen.override)}
          onClose={() => setAgentOpen(null)}
          onSaved={async () => {
            await mutate();
            setAgentOpen(null);
          }}
        />
      )}
    </SettingsCard>
  );
}

function AgentRateDrawer({
  marketId,
  agent,
  teamAmount,
  currency,
  current,
  onClose,
  onSaved,
}: {
  marketId: string;
  agent: CommissionSettings["agents"][number];
  teamAmount: number;
  currency: string;
  current: { enabled: boolean; amount: number };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("reglages");
  const [pay, setPay] = useState(current.enabled);
  const [mode, setMode] = useState<"team" | "own">(current.amount === teamAmount ? "team" : "own");
  const [amount, setAmount] = useState<number | null>(current.amount);
  const [from, setFrom] = useState(todayInMarket(marketId));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const value = mode === "team" ? teamAmount : amount;
    if (value === null || value < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      setError(t("team.agent.invalid"));
      return;
    }
    const res = await fetch("/api/settings/commissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market_id: marketId, agent_id: agent.agent_id, amount: value, enabled: pay, effective_from: from }),
    });
    if (!res.ok) {
      setError(t("common.error"));
      return;
    }
    await onSaved();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("team.agent.title", { name: agent.name })}
      subtitle={t("team.agent.sub", { amount: `${teamAmount} ${currency}` })}
      footer={
        <>
          {error && (
            <span role="alert" className="text-[12.5px] text-status-critical">
              {error}
            </span>
          )}
          <span className="flex-1" />
          <RgButton onClick={onClose}>{t("common.cancel")}</RgButton>
          <RgButton variant="primary" onClick={() => void save()}>
            {t("common.save")}
          </RgButton>
        </>
      }
    >
      <DrawerSection>
        <SwitchRow label={t("team.agent.pay")} help={t("team.agent.payHelp")} control={<Switch checked={pay} onChange={setPay} label={t("team.agent.pay")} />} />
        <div className="my-[14px]">
          <OptionCards
            label={t("team.agent.amount")}
            columns={2}
            value={mode}
            onChange={setMode}
            options={[
              { value: "team", label: t("team.agent.team"), description: `${teamAmount} ${currency}` },
              { value: "own", label: t("team.agent.own"), description: t("team.agent.ownDesc") },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-[12px]">
          <Field label={t("team.agent.amount")}>
            {mode === "own" ? (
              <NumberField label={t("team.agent.amount")} value={amount} onChange={setAmount} unit={currency} step={0.5} fill />
            ) : (
              <input className={inputClass} value={`${teamAmount} ${currency}`} readOnly />
            )}
          </Field>
          <Field label={t("team.agent.from")} htmlFor="rg-agent-from">
            <input id="rg-agent-from" type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <p className="m-0 mt-[10px] text-[12.5px] text-ink-secondary">{t("team.agent.help")}</p>
      </DrawerSection>
    </Drawer>
  );
}
