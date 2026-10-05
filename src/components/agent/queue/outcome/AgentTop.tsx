"use client";

/**
 * The agent's pieces of the order's top line (prototype `panelTop`): the pill reads
 * « Tentative n/3 » (the agent's word — managers keep « Appel n/3 »), the SLA chip that
 * stops at the confirmation, and « Voix du client » with its F key or the open-complaint count.
 */

import { useTranslations } from "next-intl";
import { Ic } from "@/components/agent/shared";
import { Pill } from "@/components/orders/commandes/ui";
import { useFeedbackCapture } from "@/components/feedback/FeedbackCaptureProvider";
import { useFeedbackContext } from "@/hooks/useFeedback";
import { ageParts, slaChip, type SlaInput } from "./outcome-model";

export function AttemptPill({ status, attempts, max }: { status: string; attempts: number | null | undefined; max: number | null }) {
  const t = useTranslations("agentOutcome.top");
  const n = attempts && attempts > 0 ? attempts : Number(status.slice(8)) || 1;
  return <Pill hue="amber" icon="phone" text={max ? t("attempt", { n, max }) : t("attemptBare", { n })} />;
}

export function useAgeWords() {
  const t = useTranslations("agentOutcome.age");
  return (minutes: number) => {
    const a = ageParts(minutes);
    return a.kind === "min" ? t("min", { n: a.n }) : a.kind === "hours" ? t("hours", { h: a.h, m: a.m }) : a.kind === "days" ? t("days", { d: a.d }) : t("daysHours", { d: a.d, h: a.h });
  };
}

export function AgentSla(props: SlaInput) {
  const t = useTranslations("agentOutcome.top");
  const age = useAgeWords();
  const chip = slaChip(props);
  if (!chip || props.slaMinutes == null) return null;
  const h = Math.round((props.slaMinutes / 60) * 10) / 10;
  return (
    <span
      className={`sla${chip.cls ? ` ${chip.cls}` : ""}`}
      data-testid="panel-sla"
      data-state={chip.cls || "late"}
      data-tip={chip.tip === "ok" ? t("slaOk") : chip.tip === "late" ? t("slaLate") : undefined}
      title={chip.tip === "ok" ? t("slaOk") : chip.tip === "late" ? t("slaLate") : undefined}
    >
      <Ic n={chip.icon} />
      {t("sla", { took: age(chip.minutes), h })}
    </span>
  );
}

/** `.vdc` — opens the capture on this order (F does the same, from the provider). */
export function VoiceButton({ orderId }: { orderId: string }) {
  const t = useTranslations("agentOutcome.top");
  const { enabled, openCapture } = useFeedbackCapture();
  const { context } = useFeedbackContext(enabled ? orderId : null);
  if (!enabled) return null;
  const open = context?.history.open ?? 0;
  const tip = open ? t("voiceTipOpen", { n: open }) : t("voiceTip");
  return (
    <button type="button" className="vdc" data-tip={tip} title={tip} aria-label={t("voice")} onClick={() => openCapture(orderId)}>
      <Ic n="quote" />
      {open ? <em>{open}</em> : <span className="kbd2">F</span>}
    </button>
  );
}
