"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  Ban,
  BarChart3,
  CheckCheck,
  Clock,
  Compass,
  Inbox,
  Package,
  PenLine,
  Phone,
  Upload,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAgentDayDetail } from "@/hooks/useAgentDayDetail";
import {
  buildAgentDayView,
  type AgentDayView,
  type OutcomeKind,
  type Takeaway,
  type Tone,
} from "@/lib/team/day-view";
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
    <div className="relative my-2 h-1.5 rounded-pill bg-surface-sunken">
      <div
        className={`absolute inset-y-0 start-0 rounded-pill ${tone === "bad" ? "bg-status-critical" : "bg-status-success"}`}
        style={{ width: pct(value) }}
      />
      <i className="absolute -top-1 h-3.5 w-0.5 rounded-pill bg-ink-muted" style={{ insetInlineStart: pct(target) }} aria-hidden="true" />
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

/* ── the day in six figures ──────────────────────────────────── */

/**
 * The five counts in funnel order: what she held, what she did, what came out.
 * The middle figure is orders carried to a decision (confirmed or rejected),
 * not orders merely dialled — a dial nobody answered is effort, not progress.
 * How many were dialled at all still shows on the funnel bar below.
 */
function figuresOf(view: AgentDayView) {
  const f = view.funnel;
  return [
    { key: "assigned", icon: Inbox, n: f.assigned, tone: null },
    { key: "calls", icon: Phone, n: f.calls, tone: null },
    { key: "treated", icon: CheckCheck, n: view.totals.treated, tone: null },
    { key: "uploaded", icon: Upload, n: view.totals.uploaded, tone: "ok" as Tone },
    { key: "rejected", icon: Ban, n: view.totals.rejected, tone: "bad" as Tone },
  ];
}

/** One fill per outcome, reused by the bar and its legend so they cannot drift. */
const OUTCOME_FILL: Record<OutcomeKind, string> = {
  uploaded: "bg-status-success",
  stuck: "bg-status-warning",
  rejected: "bg-status-critical",
  pending: "bg-hue-neutral-edge-mid",
};

/**
 * Replaces the old four goal cards and the end-of-day queue histogram with one
 * block: the six figures of the day, the yield they produced, and the funnel
 * that ties them together. Both bars account for every order — the pool splits
 * into called/never-called, and the called part splits into its four outcomes —
 * so the widths are readable as proportions, not as decoration.
 */
function Scoreboard({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  const f = view.funnel;
  const rate = view.uploadRate;
  const target = view.targets.min_rate;
  const rateTone: Tone = rate === null ? "warn" : rate >= target ? "ok" : "bad";
  const share = (n: number, total: number) => (total > 0 ? (n / total) * 100 : 0);
  const calledShare = share(f.attempted, f.assigned);

  return (
    // shrink-0 is load-bearing, not tidiness. This is a flex item in the
    // drawer's scrolling column, and `overflow-hidden` (needed so the figures
    // row's fill is clipped by the card radius) drops its automatic minimum
    // size from min-content to 0 — the CSS minimum only applies while overflow
    // is visible. Without shrink-0 the flex algorithm hands this one item the
    // whole overflow and it collapses to a 2px line. jsdom does no layout, so
    // no render test can catch it.
    <section className="shrink-0 overflow-hidden rounded-card border border-line-subtle">
      {/* ── the six figures ── */}
      <div className="grid grid-cols-5 bg-surface-sunken" data-testid="day-figures">
        {figuresOf(view).map((fig, i) => {
          const Icon = fig.icon;
          return (
            <div key={fig.key} className={`px-1 py-3 text-center ${i > 0 ? "border-s border-line-subtle" : ""}`}>
              <div className={`text-[23px] font-bold leading-none tabular-nums ${fig.tone ? TONE_TEXT[fig.tone] : "text-ink-primary"}`}>
                {fmtNum(locale, fig.n)}
              </div>
              <div className="mt-1.5 flex items-center justify-center gap-1 text-[9.5px] font-semibold uppercase leading-tight tracking-[0.04em] text-ink-muted">
                <Icon size={10} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />
                {t(`figure.${fig.key}`)}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── the yield, against the market's quality target ── */}
      <div className="border-t border-line-subtle px-3.5 pb-3 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            <Compass size={12} strokeWidth={2} aria-hidden="true" />
            {t("uploadRate")}
          </div>
          <span className="text-[11px] text-ink-muted">{t("rateTarget", { n: fmtNum(locale, target, 0) })}</span>
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className={`text-[30px] font-bold leading-none tracking-[-0.02em] tabular-nums ${TONE_TEXT[rateTone]}`}>
            {rate === null ? "—" : fmtPct(locale, rate)}
          </span>
          {view.signatureDelta !== null && (
            <span className={`inline-flex rounded-pill px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${view.signatureDelta < 0 ? TONE_BG.bad : TONE_BG.ok}`}>
              {view.signatureDelta > 0 ? "+" : "−"}{fmtNum(locale, Math.abs(view.signatureDelta), 1)} pt
            </span>
          )}
        </div>
        <Meter value={rate ?? 0} target={target} scale={100} tone={rateTone} />
        <p className="text-[11.5px] text-ink-secondary">
          {t("rateLegend", {
            uploaded: fmtNum(locale, view.totals.uploaded),
            treated: fmtNum(locale, view.totals.treated),
          })}
        </p>
      </div>

      {/* ── the funnel ── */}
      <div className="border-t border-line-subtle px-3.5 pb-3.5 pt-3">
        <SecLabel icon={Activity}>{t("journey")}</SecLabel>

        <div className="flex h-2.5 overflow-hidden rounded-pill bg-surface-sunken">
          <i className="bg-ink-muted" style={{ width: `${calledShare}%` }} aria-hidden="true" />
          {f.notAttempted > 0 && (
            <i className="border-s border-hue-amber-edge-soft bg-hue-amber-fill-soft" style={{ width: `${100 - calledShare}%` }} aria-hidden="true" />
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11.5px]">
          <span className="text-ink-secondary">
            {t("reach", {
              attempted: fmtNum(locale, f.attempted),
              assigned: fmtNum(locale, f.assigned),
              pct: f.reachRate === null ? "—" : fmtPct(locale, f.reachRate, 0),
            })}
          </span>
          {f.notAttempted > 0 && (
            <span className="font-semibold text-status-warning">
              {t("neverCalled", { n: fmtNum(locale, f.notAttempted) })}
            </span>
          )}
        </div>

        {/* Outcomes, drawn exactly as wide as the called part of the bar above. */}
        {f.attempted > 0 && (
          <>
            <div className="mt-3" style={{ width: `${calledShare}%` }}>
              <div className="flex h-2.5 overflow-hidden rounded-pill bg-surface-sunken">
                {f.outcome
                  .filter((seg) => seg.n > 0)
                  .map((seg) => (
                    <i
                      key={seg.kind}
                      className={OUTCOME_FILL[seg.kind]}
                      style={{ width: `${share(seg.n, f.attempted)}%`, minWidth: 4 }}
                      title={`${fmtNum(locale, seg.n)} · ${t(`outcome.${seg.kind}`)}`}
                    />
                  ))}
              </div>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1">
              {f.outcome.map((seg) => (
                <li key={seg.kind} className={`inline-flex items-center gap-1.5 text-[11.5px] ${seg.n === 0 ? "opacity-45" : ""}`}>
                  <i className={`h-2 w-2 shrink-0 rounded-full ${OUTCOME_FILL[seg.kind]}`} aria-hidden="true" />
                  <span className="font-semibold tabular-nums text-ink-primary">{fmtNum(locale, seg.n)}</span>
                  <span className="text-ink-secondary">{t(`outcome.${seg.kind}`)}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-2.5 border-t border-line-subtle pt-2 text-[11.5px] text-ink-secondary">
          {t("effort", {
            calls: fmtNum(locale, f.calls),
            per: f.callsPerAttempt === null ? "—" : fmtNum(locale, f.callsPerAttempt, 1),
          })}
        </p>
      </div>
    </section>
  );
}

/* ── the relances drill-down ─────────────────────────────────── */

/**
 * Kept from the old queue block: the per-order follow-up gaps, worst first.
 * The histogram it used to sit under is gone, but this is the only place the
 * 2 h cadence rule can be audited order by order, so it survives on its own.
 */
function CadenceDetail({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  const tStatus = useTranslations("orders.statuses");
  const [open, setOpen] = useState(false);
  const orders = view.cadence.orders;
  if (orders.length === 0) return null;

  const tier = view.cadence.tier;
  const tone: Tone = tier === "abandoned" ? "bad" : tier === "late" ? "warn" : "ok";

  return (
    <section className="rounded-card border border-line-subtle p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            <Clock size={12} strokeWidth={2} aria-hidden="true" />
            {t("relances")}
          </div>
          {tier && (
            <span className={`inline-flex rounded-pill px-2 py-0.5 text-[11px] font-semibold ${TONE_BG[tone]}`}>
              {t(`tier.${tier}`)}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex h-[28px] items-center gap-1.5 rounded-md border border-line bg-surface-card px-2.5 text-[12px] font-semibold text-ink-primary hover:bg-surface-hover"
        >
          {open ? t("hideCadence") : t("showCadence")}
        </button>
      </div>

      <p className="mt-2 text-[12.5px] text-ink-secondary">
        {t("relancesSummary", {
          judged: fmtNum(locale, view.cadence.judged),
          late: fmtNum(locale, view.cadence.late),
          median: view.cadence.median_gap_min === null ? "—" : formatActiveMinutes(view.cadence.median_gap_min),
        })}
      </p>

      {open && (
        <ul className="mt-2 border-t border-line-subtle pt-1">
          {orders.map((o) => {
            const worst = o.worst_gap_min;
            const rowTone: Tone = worst > 1440 ? "bad" : worst > 120 ? "warn" : "ok";
            return (
              <li key={o.order_id} className="flex items-center gap-2.5 border-b border-line-subtle py-2 text-[12.5px] last:border-b-0">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-primary" dir="auto" title={o.product_name}>{o.product_name}</span>
                <span className={`whitespace-nowrap font-semibold tabular-nums ${TONE_TEXT[rowTone]}`}>{formatActiveMinutes(worst)}</span>
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
              <th className="pb-2 text-end font-semibold">{t("thAttempted")}</th>
              <th className="pb-2 text-end font-semibold">{t("thTreated")}</th>
              <th className="pb-2 text-end font-semibold">{t("thUploadRate")}</th>
            </tr>
          </thead>
          <tbody>
            {view.products.map((p) => (
              <tr key={p.key} className="border-t border-line-subtle text-[13px]">
                <td className="py-2 pe-2">
                  <span className="grid grid-cols-[26px_1fr] items-center gap-2">
                    <span className="grid h-[26px] w-[26px] place-items-center overflow-hidden rounded-[6px] border border-line bg-surface-sunken text-ink-muted">
                      {p.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <Package size={13} aria-hidden="true" />
                      )}
                    </span>
                    <span className="max-w-[130px] truncate font-medium text-ink-primary" dir="auto" title={p.name}>{p.name}</span>
                  </span>
                </td>
                <td className="py-2 text-end tabular-nums text-ink-secondary">{fmtNum(locale, p.calls)}</td>
                <td className="py-2 text-end tabular-nums text-ink-secondary">{fmtNum(locale, p.attempted)}</td>
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

/**
 * The reasons behind the day's rejections, biggest first, each with its count
 * and its share of the total. The constats below read those counts; showing
 * only the verdict ("93 % sans motif clair") without the tally it came from
 * left the section unable to answer "how many, and of what?".
 */
function Motifs({ view, locale }: { view: AgentDayView; locale: string }) {
  const tRej = useTranslations("orders.rejectionReasons");
  const motifs = view.motifs;
  if (motifs.length === 0) return null;
  const total = motifs.reduce((s, m) => s + m.n, 0);
  const max = Math.max(1, ...motifs.map((m) => m.n));

  return (
    <ul className="mb-1" data-testid="day-motifs">
      {motifs.map((m) => (
        <li key={m.reason} className="flex items-center gap-2.5 py-1.5 text-[12.5px]">
          <span className="min-w-0 flex-1 truncate text-ink-primary" dir="auto">
            {tRej.has(m.reason) ? tRej(m.reason) : m.reason}
          </span>
          <span className="h-1.5 w-[72px] shrink-0 overflow-hidden rounded-pill bg-surface-sunken">
            <i className="block h-full rounded-pill bg-status-critical" style={{ width: `${(m.n / max) * 100}%` }} />
          </span>
          <span className="w-[26px] shrink-0 text-end font-semibold tabular-nums text-ink-primary">
            {fmtNum(locale, m.n)}
          </span>
          <span className="w-[38px] shrink-0 text-end tabular-nums text-ink-muted">
            {fmtPct(locale, total > 0 ? (m.n / total) * 100 : 0, 0)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Takeaways({ view, locale }: { view: AgentDayView; locale: string }) {
  const t = useTranslations("team.dayDrawer");
  if (view.takeaways.length === 0 && view.motifs.length === 0) return null;
  return (
    <section className="rounded-card border border-line-subtle p-3.5">
      <SecLabel icon={Compass}>{t("takeaways")}</SecLabel>
      <Motifs view={view} locale={locale} />
      {view.takeaways.length > 0 && view.motifs.length > 0 && (
        <div className="mb-1 mt-2 border-t border-line-subtle" />
      )}
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
              <Scoreboard view={view} locale={locale} />
              <CadenceDetail view={view} locale={locale} />
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
