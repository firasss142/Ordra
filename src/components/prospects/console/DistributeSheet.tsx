"use client";

/**
 * « Répartir les prospects » — the console's whole reason for existing.
 *
 * The preview table is not decoration. Decision 33 routes a prospect back to
 * the agent who last confirmed that customer, and in Libya that works for 288
 * of 288. In Tunisia it works for 93 of 1 685 — so 96 % of the batch is plain
 * round robin, and a manager in Tunis who was not told would expect a
 * continuity they are not getting. Hence the split, spelled out per agent and
 * in total, before they press the button.
 *
 * Design: prototypes/prospects-manager-v1.html (the dist sheet).
 */
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import type { DistributionRow, DistributionRule } from "@/lib/prospects/distribution";
import { Avatar, DARK, fmt, Field, Hint, INPUT, OUTLINE, Sheet } from "./ui";

export interface DistributePlan {
  rows: DistributionRow[];
  assigned: number;
  left: number;
  byHistory: number;
  byRoundRobin: number;
}

export interface DistributeSheetProps {
  /** How many prospects are in this batch. */
  pool: number;
  /** The campaign this batch came from, when it came from one. */
  scopeLabel?: string | null;
  agents: { id: string; name: string; open_leads: number; calls_today: number }[];
  picked: string[];
  onPick: (ids: string[]) => void;
  rule: DistributionRule;
  onRule: (r: DistributionRule) => void;
  cap: number;
  onCap: (n: number) => void;
  /** The plan the server computed. null while it is still being fetched. */
  plan: DistributePlan | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
  locale: string;
}

const RULES: DistributionRule[] = ["history_then_round_robin", "round_robin", "by_queue"];
const RULE_KEY: Record<DistributionRule, string> = {
  history_then_round_robin: "r1", round_robin: "r2", by_queue: "r3",
};

export function DistributeSheet(props: DistributeSheetProps) {
  const {
    pool, scopeLabel, agents, picked, onPick, rule, onRule, cap, onCap,
    plan, busy, error, onConfirm, onClose, locale,
  } = props;
  const t = useTranslations("prospects.console");

  const toggle = (id: string) =>
    onPick(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  const total = plan?.assigned ?? 0;

  return (
    <Sheet
      wide
      title={t("d.t")}
      sub={scopeLabel ? t("d.subCamp", { campaign: scopeLabel, n: pool }) : t("d.sub", { n: pool })}
      onClose={onClose}
      footer={
        <>
          {plan && plan.left > 0 ? (
            <span className="text-[13px] text-[#6B7280]">{t("d.tomorrow", { n: fmt(plan.left, locale) })}</span>
          ) : null}
          <button type="button" onClick={onClose} className={`ms-auto h-11 px-4 text-[14px] ${OUTLINE}`}>
            {t("cb.back")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || total === 0}
            className={`h-11 min-w-[180px] px-4 text-[14px] ${DARK}`}
          >
            {t("d.go", { n: fmt(total, locale) })}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="m-0 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-[13.5px] text-[#B91C1C]">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-3.5">
          <Field label={t("d.agents")}>
            <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
              {agents.map((a, i) => {
                const on = picked.includes(a.id);
                return (
                  <label
                    key={a.id}
                    data-on={on}
                    className={`grid cursor-pointer grid-cols-[auto_28px_1fr_auto] items-center gap-2.5 px-3 py-2.5 text-[13.5px] ${
                      i > 0 ? "border-t border-[#F3F4F6]" : ""
                    } ${on ? "bg-[#F1FAF4]" : ""}`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(a.id)} className="h-4 w-4 accent-[#15803D]" />
                    <Avatar name={a.name} size="sm" />
                    <span className="min-w-0">
                      <b className="block truncate font-semibold text-[#111827] [unicode-bidi:plaintext]">{a.name}</b>
                      <small className="text-[12px] text-[#6B7280]">
                        {t("a.queue", { n: fmt(a.open_leads, locale) })} · {t("agt.cap", { calls: a.calls_today, cap })}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label={t("d.rule")}>
            <div className="flex flex-col gap-1.5">
              {RULES.map((r) => {
                const k = RULE_KEY[r];
                const on = rule === r;
                return (
                  <label
                    key={r}
                    data-on={on}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${
                      on ? "border-[#15803D] bg-[#F1FAF4]" : "border-[#D1D5DB] bg-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name="dist-rule"
                      checked={on}
                      onChange={() => onRule(r)}
                      className="mt-0.5 accent-[#15803D]"
                    />
                    <span className="min-w-0">
                      <b className="block text-[13.5px] font-semibold text-[#111827]">{t(`d.${k}`)}</b>
                      <span className="text-[12.5px] text-[#374151]">{t(`d.${k}d`)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>

          <Field label={t("d.cap")} hint={t("d.capd")}>
            <input
              type="number"
              min={1}
              max={500}
              value={cap}
              onChange={(e) => onCap(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              className={`${INPUT} w-28`}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2.5">
          <Field label={t("d.prev")}>
            <div className="overflow-hidden rounded-lg border border-[#E5E7EB]">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-[#E5E7EB] px-3 py-2 text-start text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#6B7280]">
                      {t("th.agent")}
                    </th>
                    <th scope="col" className="border-b border-[#E5E7EB] px-3 py-2 text-end text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#6B7280]">
                      {t("d.today")}
                    </th>
                    <th scope="col" className="border-b border-[#E5E7EB] px-3 py-2 text-end text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#6B7280]">
                      {t("d.after")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(plan?.rows ?? []).map((r) => (
                    <tr key={r.agentId} className="border-b border-[#F3F4F6] last:border-b-0">
                      <td className="px-3 py-2 [unicode-bidi:plaintext]">{r.name}</td>
                      <td className="px-3 py-2 text-end font-semibold tabular-nums">
                        {fmt(r.total, locale)}
                        {/* Where each agent's share came from. In Tunisia this
                            column is almost entirely round robin. */}
                        {r.byHistory > 0 ? (
                          <small className="ms-1 font-normal text-[#15803D]">
                            ({fmt(r.byHistory, locale)})
                          </small>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums text-[#6B7280]">{fmt(r.queueAfter, locale)}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#F9FAFB] font-semibold">
                    <td className="px-3 py-2">{t("d.total")}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{fmt(total, locale)}</td>
                    <td className="px-3 py-2" />
                  </tr>
                </tbody>
              </table>
            </div>
          </Field>

          {plan ? (
            <Hint icon={ShieldCheck}>
              {t("d.split", {
                history: fmt(plan.byHistory, locale),
                robin: fmt(plan.byRoundRobin, locale),
              })}
            </Hint>
          ) : null}

          {plan && plan.assigned === 0 && pool > 0 ? (
            <p className="m-0 text-[13px] text-[#B91C1C]">{t("cb.pickAgents")}</p>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
