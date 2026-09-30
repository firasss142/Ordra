"use client";

/**
 * A business-number campaign between « Soumettre » and « Lancer »: where its
 * template stands at Meta, and — once approved — what launching now would do.
 *
 *   pending  → since when, what happens next, « Vérifier le statut »
 *   approved → since when, the plan in one sentence, and the four-cell summary
 *              (Audience · Cadence · Plage · Fin estimée)
 *   rejected → Meta's reason and the version the correction will become
 *   draft    → the submission never reached Meta
 *
 * « Fin estimée » is estimateCampaignEnd(): the same pacing as SQL
 * whatsapp_campaign_slot(), applied to the last prospect, launched now.
 *
 * Design: prototypes/whatsapp-manager-v1.html?screen=campagne&tstatus=… (.tstat, .summary).
 */
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCheck, Clock, RefreshCw } from "lucide-react";
import type { CampaignWhatsApp } from "@/lib/prospects/console";
import { estimateCampaignEnd, localDayDiff, localTime, parseSendWindow } from "@/lib/whatsapp/campaign-template";
import { fmt, OUTLINE } from "./ui";

export type TemplatePhase = "pending" | "approved" | "rejected" | "draft" | "launched";

/** The sheet's reading of a campaign's launch status. */
export function templatePhase(wa: CampaignWhatsApp): TemplatePhase {
  switch (wa.launch_status) {
    case "pending_template": return "pending";
    case "ready": return "approved";
    case "rejected": return "rejected";
    case "draft": return "draft";
    default: return "launched";
  }
}

/** The version a resubmission creates: `_v2` after the first, `_v3` after `_v2`… (resubmit route). */
export function nextTemplateVersion(templateName: string | null): string {
  if (!templateName) return "v1";
  const m = /_v(\d+)$/.exec(templateName);
  return `v${m ? Number(m[1]) + 1 : 2}`;
}

const TONES: Record<Exclude<TemplatePhase, "launched">, string> = {
  pending: "border-[#F5E1A4] bg-[#FFF8E6] text-[#7A5B00]",
  approved: "border-[#BFE3D2] bg-[#F1F8F5] text-[#065F46]",
  rejected: "border-[#F5C6BC] bg-[#FFF4F4] text-[#9A2A14]",
  draft: "border-[#F5C6BC] bg-[#FFF4F4] text-[#9A2A14]",
};

interface Plan {
  audience: number; rate: number; window: string | null; tz: string; now: number;
  /** The audience is still being counted: say so rather than show a zero. */
  counting?: boolean;
}

export function TemplateBanner({
  wa, now, plan, locale, busy = false, onCheckStatus,
}: {
  wa: CampaignWhatsApp;
  now: number;
  plan: Plan;
  locale: string;
  busy?: boolean;
  onCheckStatus?: () => void;
}) {
  const t = useTranslations("prospects.console");
  const phase = templatePhase(wa);
  if (phase === "launched") return null;

  const ago = (() => {
    if (!wa.status_at) return "";
    const minutes = Math.max(0, Math.round((now - Date.parse(wa.status_at)) / 60_000));
    if (minutes < 1) return t("cb.ago.now");
    if (minutes < 60) return t("cb.ago.min", { n: minutes });
    if (minutes < 48 * 60) return t("cb.ago.h", { n: Math.floor(minutes / 60) });
    return t("cb.ago.d", { n: Math.floor(minutes / 1440) });
  })();

  let title: string;
  let body: string;
  if (phase === "pending") {
    title = t("cb.tstPending");
    body = t("cb.tstPendingD", { name: wa.template_name ?? "—", ago });
  } else if (phase === "approved") {
    title = t("cb.tstApproved", { ago }).trim();
    body = approvedSentence(t, plan, locale);
  } else if (phase === "rejected") {
    title = t("cb.tstRejected");
    body = t("cb.tstRejectedD", {
      reason: wa.template_rejected_reason?.trim() || t("cb.tstNoReason"),
      version: nextTemplateVersion(wa.template_name),
    });
  } else {
    title = t("cb.tstDraft");
    body = t("cb.tstDraftD");
  }

  const Icon = phase === "approved" ? CheckCheck : phase === "pending" ? Clock : AlertTriangle;

  return (
    <div data-testid="wa-template-banner" role={phase === "pending" ? "status" : undefined}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13.5px] leading-[1.45] ${TONES[phase]}`}>
      <Icon size={18} aria-hidden className="mt-px shrink-0" />
      <div className="min-w-0">
        <b className="block font-semibold">{title}</b>
        <span className="[unicode-bidi:plaintext]">{body}</span>
        {phase === "pending" && onCheckStatus ? (
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={onCheckStatus} className={`h-8 px-2.5 text-[12.5px] ${OUTLINE}`}>
              <RefreshCw size={13} aria-hidden className={busy ? "animate-spin" : ""} />
              {t("cb.checkStatus")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function etaParts(plan: Plan): { time: string; days: number } | null {
  const end = estimateCampaignEnd({ audience: plan.audience, window: plan.window, rate: plan.rate, tz: plan.tz, from: new Date(plan.now) });
  if (!end) return null;
  return { time: localTime(end, plan.tz), days: localDayDiff(new Date(plan.now), end, plan.tz) };
}

type T = (key: string, values?: Record<string, string | number>) => string;

function approvedSentence(t: T, plan: Plan, locale: string): string {
  const eta = plan.counting ? null : etaParts(plan);
  if (!eta) return t("cb.tstApprovedShort");
  const etaText = eta.days === 0 ? t("cb.eta.today", { time: eta.time })
    : eta.days === 1 ? t("cb.eta.tomorrow", { time: eta.time })
      : t("cb.eta.later", { time: eta.time, n: eta.days });
  const win = parseSendWindow(plan.window);
  const args = { n: fmt(plan.audience, locale), rate: plan.rate, eta: etaText };
  return win ? t("cb.tstApprovedD", { ...args, start: win.start, end: win.end }) : t("cb.tstApprovedDAny", args);
}

/** Audience · Cadence · Plage · Fin estimée — what launching now would do. */
export function CampaignSummary({ plan, locale }: { plan: Plan; locale: string }) {
  const t = useTranslations("prospects.console");
  const eta = plan.counting ? null : etaParts(plan);
  const win = parseSendWindow(plan.window);
  const cells: [string, React.ReactNode][] = [
    [t("cb.sum.aud"), plan.counting ? "…" : fmt(plan.audience, locale)],
    [t("cb.sum.rate"), t("cb.sum.rateV", { n: plan.rate })],
    [t("cb.sum.win"), win ? t("cb.sum.winV", win) : t("cb.sum.always")],
    [t("cb.sum.eta"), eta ? (
      <>
        {eta.time}
        <small className="ms-1 text-[11.5px] font-normal text-[#6B7280]">
          {eta.days === 0 ? t("cb.etaDay.today") : eta.days === 1 ? t("cb.etaDay.tomorrow") : t("cb.etaDay.later", { n: eta.days })}
        </small>
      </>
    ) : plan.counting ? "…" : "—"],
  ];
  return (
    <div data-testid="wa-campaign-summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#E5E7EB] sm:grid-cols-4">
      {cells.map(([label, value]) => (
        <div key={label} className="min-w-0 bg-white px-3 py-2.5">
          <div className="text-[11.5px] text-[#6B7280]">{label}</div>
          <div className="mt-0.5 text-[16px] font-semibold tabular-nums text-[#111827]">{value}</div>
        </div>
      ))}
    </div>
  );
}
