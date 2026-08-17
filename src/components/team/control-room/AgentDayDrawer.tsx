"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Activity, BarChart3, Clock, Compass, Flame, Package, PenLine, Phone, Upload } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAgentDayDetail } from "@/hooks/useAgentDayDetail";
import { buildAgentDayView, type AgentDayView, type Takeaway, type Tone } from "@/lib/team/day-view";
import { MIN_TREATED_FOR_RATE, formatActiveMinutes } from "@/lib/team/goals";
import { HOUR_THRESHOLDS, heatColor } from "@/lib/team/heat";
import { fmtNum, fmtPct } from "@/lib/team/format";
import { AgentAvatar } from "./AgentAvatar";

interface Props {
  agentId: string | null;
  day: string | null;
  onClose: () => void;
  marketId: string;
  locale: string;
  tz: string;
}

/* ── shared bits ─────────────────────────────────────────────── */

function SecLabel({ icon: Icon, children }: { icon: typeof Clock; children: string }) {
  return (
    <div className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {children}
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-status-success",
  warn: "text-status-warning",
  bad: "text-status-critical",
};
const TONE_BG: Record<Tone, string> = {
  ok: "bg-status-successBg text-status-success",
  warn: "bg-status-warningBg text-status-warning",
  bad: "bg-status-criticalBg text-status-critical",
};

/** Goal meter: a filled track with the target notched on it. */
function Meter({ value, target, scale, tone }: { value: number; target: number; scale: number; tone: Tone }) {
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / scale) * 100))}%`;
  return (
    <div className="relative my-2 h-1 rounded-pill bg-surface-sunken">
      <div
        className={`absolute inset-y-0 start-0 rounded-pill ${tone === "bad" ? "bg-status-critical" : "bg-status-success"}`}
        style={{ width: pct(value) }}
      />
      <i className="absolute -top-1 h-3 w-0.5 rounded-pill bg-ink-muted" style={{ insetInlineStart: pct(target) }} aria-hidden="true" />
    </div>
  );
}

/* ── the sparkline over the 14-day window ────────────────────── */

function Rhythm({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  const pts = view.series;
  const path = useMemo(() => {
    if (pts.length < 2) return null;
    const max = Math.max(1, ...pts.map((p) => p.uploaded));
    const w = 132, h = 34;
    const xy = pts.map((p, i) => [
      (i / (pts.length - 1)) * w,
      h - (p.uploaded / max) * (h - 4) - 2,
    ] as const);
    return {
      d: xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" "),
      last: xy[xy.length - 1],
      w, h,
    };
  }, [pts]);

  const target = view.targets.conf_per_hour;
  const rate = view.uploadsPerHour;
  const onTarget = rate !== null && rate >= target;

  return (
    <section className="rounded-card border border-line-subtle p-3.5">
      <SecLabel icon={Activity}>{t("rhythm")}</SecLabel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-0.5">
            <span className="text-[34px] font-bold leading-none tracking-[-0.02em] tabular-nums text-ink-primary">
              {rate === null ? "—" : fmtNum(locale, rate, 1)}
            </span>
            <span className="text-[14px] font-medium text-ink-secondary">{t("perHour")}</span>
          </div>
          <span className={`inline-flex h-[26px] items-center gap-1.5 rounded-pill px-2.5 text-[12px] font-semibold ${onTarget ? TONE_BG.ok : TONE_BG.warn}`}>
            <Compass size={12} strokeWidth={2.2} aria-hidden="true" />
            {t("rhythmTarget", { n: fmtNum(locale, target, 0) })}
          </span>
        </div>
        {path && (
          <div className="text-end">
            <svg width={path.w} height={path.h} viewBox={`0 0 ${path.w} ${path.h}`} aria-hidden="true" className="overflow-visible">
              <path d={path.d} fill="none" stroke="var(--chart-line)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={path.last[0]} cy={path.last[1]} r="3.5" fill="var(--brand)" />
            </svg>
            <div className="mt-0.5 text-[11px] text-ink-muted">{t("rhythmWindow")}</div>
          </div>
        )}
      </div>
      <p className="mt-2.5 text-[12.5px] text-ink-secondary">
        {t("callsLine", {
          calls: fmtNum(locale, view.totals.calls),
          touched: fmtNum(locale, view.totals.touched),
          ratio: view.callsPerUpload === null ? "—" : fmtNum(locale, view.callsPerUpload, 1),
        })}
      </p>
    </section>
  );
}

/* ── the four goal cards ─────────────────────────────────────── */

function GoalCards({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  const { totals, targets } = view;
  const volumeOk = totals.treated >= targets.daily_treated;
  const sigTone: Tone = view.uploadRate === null ? "warn" : view.uploadRate >= targets.min_rate ? "ok" : "bad";
  const cadTier = view.cadence.tier;
  const cadTone: Tone = cadTier === "abandoned" ? "bad" : cadTier === "late" ? "warn" : "ok";

  return (
    <section className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
      {/* Volume */}
      <div className="rounded-card border border-line-subtle p-3">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-secondary">
          <Phone size={12} strokeWidth={2} aria-hidden="true" />{t("volume")}
        </div>
        <div className="mt-1.5 text-[22px] font-bold leading-none tabular-nums text-ink-primary">{fmtNum(locale, totals.treated)}</div>
        <Meter value={totals.treated} target={targets.daily_treated} scale={Math.max(totals.treated, targets.daily_treated) * 1.3} tone={volumeOk ? "ok" : "bad"} />
        <div className="text-[11px] text-ink-muted">{t("volumeTarget", { n: fmtNum(locale, targets.daily_treated) })}</div>
      </div>

      {/* Signature — confirmation vs what actually shipped */}
      <div className="rounded-card border border-line-subtle p-3">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-secondary">
          <PenLine size={12} strokeWidth={2} aria-hidden="true" />{t("signature")}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="rounded-md bg-surface-sunken px-1.5 py-1 text-[12.5px] font-semibold tabular-nums text-ink-secondary">
            {view.confirmRate === null ? "—" : fmtPct(locale, view.confirmRate, 0)}
          </span>
          <span className="text-ink-muted" aria-hidden="true">→</span>
          <span className={`rounded-md bg-surface-sunken px-1.5 py-1 text-[12.5px] font-bold tabular-nums ${TONE_TEXT[sigTone]}`}>
            {view.uploadRate === null ? "—" : fmtPct(locale, view.uploadRate)}
          </span>
        </div>
        {view.signatureDelta !== null && (
          <div className={`mt-1.5 inline-flex rounded-pill px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${view.signatureDelta < 0 ? TONE_BG.bad : TONE_BG.ok}`}>
            {view.signatureDelta > 0 ? "+" : "−"}{fmtNum(locale, Math.abs(view.signatureDelta), 1)} pt
          </div>
        )}
        <div className="mt-1 text-[11px] text-ink-muted">
          {t("sigLegend", { confirmed: fmtNum(locale, totals.confirmed), uploaded: fmtNum(locale, totals.uploaded) })}
        </div>
      </div>

      {/* Callback cadence */}
      <div className="rounded-card border border-line-subtle p-3">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-secondary">
          <Clock size={12} strokeWidth={2} aria-hidden="true" />{t("cadence")}
        </div>
        {cadTier ? (
          <>
            <div className={`mt-1.5 inline-flex rounded-pill px-2 py-0.5 text-[11px] font-semibold ${TONE_BG[cadTone]}`}>{t(`tier.${cadTier}`)}</div>
            <div className="mt-1 text-[20px] font-bold leading-none tabular-nums text-ink-primary">
              {formatActiveMinutes(view.cadence.median_gap_min ?? 0)}
            </div>
            <div className="mt-1 text-[11px] text-ink-muted">{t("cadenceMedian")}</div>
          </>
        ) : (
          <div className="mt-2 text-[12px] text-ink-muted">{t("cadenceNone")}</div>
        )}
      </div>

      {/* Streak */}
      <div className="rounded-card border border-line-subtle p-3">
        <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-ink-secondary">
          <Flame size={12} strokeWidth={2} aria-hidden="true" />{t("streak")}
        </div>
        <div className="mt-1.5 text-[22px] font-bold leading-none tabular-nums text-ink-primary">{fmtNum(locale, view.streak.current)}</div>
        <div className="mt-2 text-[11px] text-ink-muted">{t("streakDays")}</div>
        <div className="text-[11px] text-ink-muted">{t("streakBest", { n: fmtNum(locale, view.streak.best) })}</div>
      </div>
    </section>
  );
}

/* ── end-of-day queue ────────────────────────────────────────── */

function QueueSection({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  const tStatus = useTranslations("orders.statuses");
  const [open, setOpen] = useState(false);
  const q = view.queue;
  const max = Math.max(1, ...q.buckets.map((b) => b.n));

  const bandColor = { exhausted: "bg-status-critical", lastChance: "bg-status-warning", healthy: "bg-brand" } as const;
  const bandText = { exhausted: "text-status-critical", lastChance: "text-status-warning", healthy: "text-brand" } as const;

  const cadOrders = view.cadence.orders;

  return (
    <section className="rounded-card border border-line-subtle p-3.5">
      <SecLabel icon={Phone}>{t("queue")}</SecLabel>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[26px] font-bold leading-none tabular-nums text-ink-primary">{fmtNum(locale, q.open)}</span>
          <span className="text-[13px] text-ink-secondary">{t("queueOpen")}</span>
        </div>
        <span className="text-[12px] text-ink-secondary">
          {t("queueRoll", {
            touched: fmtNum(locale, view.totals.touched),
            uploaded: fmtNum(locale, q.uploaded),
            rejected: fmtNum(locale, q.rejected),
          })}
        </span>
      </div>

      {/* attempts-left histogram */}
      <div className="mt-3.5 flex items-end gap-1.5" style={{ height: 74 }}>
        {q.buckets.map((b) => (
          <div key={b.attemptsLeft} className="flex flex-1 flex-col items-center justify-end gap-1">
            {b.n > 0 && <span className="text-[11px] font-semibold tabular-nums text-ink-primary">{fmtNum(locale, b.n)}</span>}
            <div
              className={`w-full rounded-t-[3px] ${b.n > 0 ? bandColor[b.band] : "bg-surface-sunken"}`}
              style={{ height: b.n > 0 ? Math.max(4, (b.n / max) * 46) : 2 }}
              title={t("bucketTitle", { left: b.attemptsLeft, n: b.n })}
            />
            <span className="text-[10px] tabular-nums text-ink-muted">{b.attemptsLeft}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.04em]">
        <span className={`flex-1 border-t pt-1 text-center ${bandText.exhausted} border-line-strong`}>{t("band.exhausted")}</span>
        <span className={`flex-[2] border-t pt-1 text-center ${bandText.lastChance} border-line-strong`}>{t("band.lastChance")}</span>
        <span className={`flex-[6] border-t pt-1 text-center ${bandText.healthy} border-line-strong`}>{t("band.healthy")}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {q.exhausted > 0 && (
          <span className={`inline-flex h-[26px] items-center rounded-pill px-2.5 text-[11.5px] font-semibold ${TONE_BG.bad}`}>
            {t("chipExhausted", { n: fmtNum(locale, q.exhausted) })}
          </span>
        )}
        {q.healthy > 0 && (
          <span className={`inline-flex h-[26px] items-center rounded-pill px-2.5 text-[11.5px] font-semibold ${TONE_BG.ok}`}>
            {t("chipHealthy", { n: fmtNum(locale, q.healthy) })}
          </span>
        )}
        {cadOrders.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="ms-auto inline-flex h-[30px] items-center gap-1.5 rounded-md border border-line bg-surface-card px-3 text-[12px] font-semibold text-ink-primary hover:bg-surface-hover"
          >
            {open ? t("hideCadence") : t("showCadence")}
          </button>
        )}
      </div>

      {/* Confirmed and never shipped — pure loss, so it gets its own band. */}
      {view.totals.stuck_confirmed > 0 && (
        <div className="mt-3 flex items-center gap-2.5 rounded-card border border-hue-amber-edge bg-status-warningBg px-3 py-2.5">
          <Upload size={16} strokeWidth={2} className="shrink-0 text-status-warning" aria-hidden="true" />
          <span className="flex-1 text-[12.5px] font-semibold text-status-warning">
            {t("stuckConfirmed", { n: fmtNum(locale, view.totals.stuck_confirmed) })}
          </span>
        </div>
      )}

      {open && (
        <ul className="mt-3 border-t border-line-subtle pt-1">
          {cadOrders.map((o) => {
            const worst = o.worst_gap_min;
            const tone: Tone = worst > 1440 ? "bad" : worst > 120 ? "warn" : "ok";
            return (
              <li key={o.order_id} className="flex items-center gap-2.5 border-b border-line-subtle py-2 text-[12.5px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-primary" dir="auto" title={o.product_name}>{o.product_name}</span>
                <span className={`whitespace-nowrap font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{formatActiveMinutes(worst)}</span>
                <span className="w-[92px] shrink-0 text-end text-[11.5px] text-ink-secondary">
                  {tStatus.has(o.status_now) ? tStatus(o.status_now) : o.status_now}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ── per product ─────────────────────────────────────────────── */

function ProductsSection({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  if (view.products.length === 0) {
    return (
      <section className="rounded-card border border-line-subtle p-3.5">
        <SecLabel icon={Package}>{t("byProduct")}</SecLabel>
        <p className="py-2 text-[12.5px] text-ink-muted">{t("noProducts")}</p>
      </section>
    );
  }
  return (
    <section className="rounded-card border border-line-subtle p-3.5">
      <SecLabel icon={Package}>{t("byProduct")}</SecLabel>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.04em] text-ink-muted">
              <th className="pb-2 text-start font-semibold">{t("thProduct")}</th>
              <th className="pb-2 text-end font-semibold">{t("thCalls")}</th>
              <th className="pb-2 text-end font-semibold">{t("thTouched")}</th>
              <th className="pb-2 text-end font-semibold">{t("thTreated")}</th>
              <th className="pb-2 text-end font-semibold">{t("thUploadRate")}</th>
            </tr>
          </thead>
          <tbody>
            {view.products.map((p) => (
              <tr key={p.key} className="border-t border-line-subtle text-[13px]">
                <td className="max-w-[150px] truncate py-2 pe-2 font-medium text-ink-primary" dir="auto" title={p.name}>{p.name}</td>
                <td className="py-2 text-end tabular-nums text-ink-secondary">{fmtNum(locale, p.calls)}</td>
                <td className="py-2 text-end tabular-nums text-ink-secondary">{fmtNum(locale, p.touched)}</td>
                <td className="py-2 text-end tabular-nums text-ink-primary">{fmtNum(locale, p.treated)}</td>
                <td className="py-2 ps-2 text-end">
                  {p.uploadRate === null ? (
                    <span className="inline-flex items-center gap-1.5 tabular-nums text-ink-muted">
                      {p.uploaded}/{p.treated}
                      <i
                        className="grid h-[15px] w-[15px] place-items-center rounded-[4px] bg-surface-sunken text-[9px] font-bold not-italic text-ink-muted"
                        title={t("notSignificant", { n: MIN_TREATED_FOR_RATE })}
                      >n</i>
                    </span>
                  ) : (
                    <span className="inline-flex flex-col items-end gap-1">
                      <span className={`font-semibold tabular-nums ${p.uploadRate >= view.targets.min_rate ? "text-status-success" : "text-status-warning"}`}>
                        {fmtPct(locale, p.uploadRate)}
                      </span>
                      <span className="block h-1 w-14 overflow-hidden rounded-pill bg-surface-sunken">
                        <i className={`block h-full ${p.uploadRate >= view.targets.min_rate ? "bg-status-success" : "bg-status-warning"}`} style={{ width: `${Math.min(100, p.uploadRate)}%` }} />
                      </span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── hour strip ──────────────────────────────────────────────── */

function HourlySection({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  return (
    <section className="rounded-card border border-line-subtle p-3.5">
      <SecLabel icon={BarChart3}>{t("hourly")}</SecLabel>
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          <div className="flex gap-[2px]">
            {view.hours.map((h) => (
              <span key={h.hour} className="flex h-2 flex-1 justify-center">
                {h.lateCallbacks > 0 && <i className="h-[5px] w-[5px] rounded-full bg-status-warning" aria-hidden="true" />}
              </span>
            ))}
          </div>
          <div className="mt-0.5 flex gap-[2px]">
            {view.hours.map((h) => (
              <i
                key={h.hour}
                className="h-[26px] flex-1 rounded-[4px]"
                style={{ background: heatColor(h.active_minutes, HOUR_THRESHOLDS) }}
                title={t("hourTitle", {
                  hour: String(h.hour).padStart(2, "0"),
                  minutes: formatActiveMinutes(h.active_minutes),
                  treated: fmtNum(locale, h.treated),
                  confirmed: fmtNum(locale, h.confirmed),
                })}
              />
            ))}
          </div>
          <div className="mt-1 flex gap-[2px]">
            {view.hours.map((h) => (
              <span key={h.hour} className="flex-1 text-center text-[9px] tabular-nums text-ink-muted">
                {h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-secondary">
        <span>{t("hourLow")}</span>
        <span className="flex gap-px">
          {[0, 10, 25, 40, 60].map((m) => (
            <i key={m} className="h-2 w-2.5 rounded-[2px]" style={{ background: heatColor(m, HOUR_THRESHOLDS) }} />
          ))}
        </span>
        <span>{t("hourHigh")}</span>
        <span className="ms-auto inline-flex items-center gap-1.5">
          <i className="h-[5px] w-[5px] rounded-full bg-status-warning" aria-hidden="true" />
          {t("lateDot")}
        </span>
      </div>
    </section>
  );
}

/* ── takeaways ───────────────────────────────────────────────── */

function takeawayLabel(tk: Takeaway, t: ReturnType<typeof useTranslations>, locale: string): string {
  switch (tk.kind) {
    case "cadence":
      return t(`takeaway.cadence.${tk.variant}`);
    case "vague_reason":
      return tk.tone === "bad"
        ? t("takeaway.vagueBad", { pct: fmtPct(locale, tk.pct ?? 0, 0) })
        : t("takeaway.vagueOk");
    case "stuck":
      return t("takeaway.stuck", { n: fmtNum(locale, tk.count ?? 0) });
    case "open_queue":
      return t("takeaway.openQueue", { n: fmtNum(locale, tk.count ?? 0) });
  }
}

const TAKEAWAY_ICON: Record<Takeaway["kind"], typeof Clock> = {
  cadence: Clock,
  vague_reason: PenLine,
  stuck: Upload,
  open_queue: Phone,
};

function Takeaways({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  if (view.takeaways.length === 0) return null;
  return (
    <section className="rounded-card border border-line-subtle p-3.5">
      <SecLabel icon={Compass}>{t("takeaways")}</SecLabel>
      {view.takeaways.map((tk) => {
        const Icon = TAKEAWAY_ICON[tk.kind];
        return (
          <div key={tk.kind} className="flex items-center gap-2.5 border-b border-line-subtle py-2.5 last:border-b-0">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${TONE_BG[tk.tone]}`}>
              <Icon size={15} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="flex-1 text-[12.5px] font-medium text-ink-primary">{takeawayLabel(tk, t, locale)}</span>
          </div>
        );
      })}
    </section>
  );
}

/* ── the drawer ──────────────────────────────────────────────── */

export function AgentDayDrawer({ agentId, day, onClose, marketId, locale, tz }: Props) {
  const t = useTranslations("team.dayDrawer");
  const open = agentId !== null && day !== null;
  const { detail, error, isLoading } = useAgentDayDetail(marketId, agentId, day);
  const view = useMemo(() => (detail?.agent ? buildAgentDayView(detail) : null), [detail]);

  const dayLabel = day
    ? new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(
        new Date(`${day}T12:00:00Z`),
      )
    : "";
  const name = view?.agentName ?? "";
  const idle = view !== null && view.totals.calls === 0 && view.totals.touched === 0;

  return (
    <Sheet open={open} onClose={onClose} ariaLabel={`${name} — ${dayLabel}`} width="w-full sm:w-[600px]">
      <div className="flex h-full flex-col">
        <div className="flex h-[56px] shrink-0 items-center justify-between gap-2.5 border-b border-line-subtle px-4">
          <div className="flex items-center gap-2.5">
            {view && <AgentAvatar name={name} avatarUrl={view.avatarUrl} />}
            <div>
              <div className="text-[15px] font-semibold text-ink-primary">{name || t("loading")}</div>
              <div className="text-[11.5px] text-ink-secondary">{dayLabel}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md px-2 py-1 text-[18px] text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex flex-col gap-3" role="status">
              <Skeleton className="h-[120px] w-full" />
              <Skeleton className="h-[96px] w-full" />
              <Skeleton className="h-[180px] w-full" />
            </div>
          )}
          {error && !detail && <p className="py-6 text-center text-[13px] text-status-critical">{t("loadError")}</p>}
          {view && idle && <p className="py-10 text-center text-[13px] text-ink-muted">{t("noActivity")}</p>}
          {view && !idle && (
            <>
              <Rhythm view={view} locale={locale} />
              <GoalCards view={view} locale={locale} />
              <QueueSection view={view} locale={locale} />
              <ProductsSection view={view} locale={locale} />
              <HourlySection view={view} locale={locale} />
              <Takeaways view={view} locale={locale} />
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
