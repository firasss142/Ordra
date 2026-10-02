"use client";

import { useLocale, useTranslations } from "next-intl";
import { Flag, Truck } from "lucide-react";
import { FEEDBACK_CATEGORIES, type FeedbackCategory } from "@/lib/feedback/taxonomy";
import { COURIER_AGENT } from "@/lib/feedback/overview";
import type { FeedbackOverviewResponse, FeedbackTopic } from "@/types/feedback";
import { CATEGORY_TONE, ProductThumb } from "../atoms";

/** Agent avatar colours of the prototype, handed out in roster order. */
const AGENT_PALETTE = ["#0E7490", "#7C3AED", "#B45309", "#BE185D", "#4D7C0F", "#1D4ED8", "#9F1239", "#0F766E"];
const COURIER_COLOR = "#334155";

export function agentColor(agents: { id: string }[], id: string | null): string {
  if (!id || id === COURIER_AGENT) return COURIER_COLOR;
  const i = agents.findIndex((a) => a.id === id);
  return i < 0 ? "#6B7280" : AGENT_PALETTE[i % AGENT_PALETTE.length];
}

export function Avatar({ name, color, courier = false, size = 20 }: { name: string; color: string; courier?: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ background: color, width: size, height: size, fontSize: size >= 28 ? 12 : 11 }}
    >
      {courier ? <Truck size={size >= 28 ? 14 : 12} /> : (name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

type Overview = FeedbackOverviewResponse;

export function ProductPills({ overview, value, onChange }: { overview: Overview; value: string | null; onChange: (id: string | null) => void }) {
  const t = useTranslations("feedback.manager");
  const byId = new Map(overview.families.map((f) => [f.id, f]));
  const base = "inline-flex items-center gap-[8px] whitespace-nowrap rounded-full border py-[5px] text-[13px]";
  const tone = (on: boolean) => (on ? "border-[#1A1A1A] bg-[#1A1A1A] font-medium text-white" : "border-[#E1E3E5] bg-white text-[#1A1A1A] hover:border-[#C9CCCF]");
  return (
    <div role="tablist" aria-label={t("productTabs")} className="mb-[16px] flex gap-[8px] overflow-x-auto pb-[2px]">
      <button type="button" role="tab" aria-selected={value === null} onClick={() => onChange(null)} className={`${base} px-[14px] ${tone(value === null)}`}>
        {t("allProducts")}<span className={`text-[12px] tabular-nums ${value === null ? "text-[#B5BAC2]" : "text-[#8A9096]"}`}>{overview.tabs.all}</span>
      </button>
      {overview.tabs.byFamily.map(({ id, count }) => {
        const f = byId.get(id);
        if (!f) return null;
        const on = value === id;
        return (
          <button key={id} type="button" role="tab" aria-selected={on} onClick={() => onChange(id)} className={`${base} pe-[12px] ps-[6px] ${tone(on)}`}>
            <ProductThumb url={f.imageUrl} size={24} round />
            <span className="max-w-[220px] truncate [unicode-bidi:plaintext]">{f.label}</span>
            <span className={`text-[12px] tabular-nums ${on ? "text-[#B5BAC2]" : "text-[#8A9096]"}`}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function AlertStrip({ late, review, onLate, onReview }: { late: number; review: number; onLate: () => void; onReview: () => void }) {
  const t = useTranslations("feedback.manager");
  if (!late && !review) return null;
  const num = (chunks: React.ReactNode) => <span className="tabular-nums text-[#D72C0D]">{chunks}</span>;
  const numDark = (chunks: React.ReactNode) => <span className="tabular-nums text-[#1A1A1A]">{chunks}</span>;
  return (
    <div className="mb-[12px] flex flex-wrap items-center gap-[14px] rounded-[10px] border border-[#F8D3CB] bg-[#FFF8F6] px-[14px] py-[9px] text-[13px]">
      <Flag size={16} className="text-[#D72C0D]" aria-hidden />
      {late > 0 && (
        <button type="button" onClick={onLate} className="inline-flex items-center gap-[6px] font-semibold text-[#1A1A1A] hover:underline">
          {t.rich("lateAlert", { n: late, b: num })}
        </button>
      )}
      {late > 0 && review > 0 && <span aria-hidden className="h-[16px] w-px bg-[#F0C8BF]" />}
      {review > 0 && (
        <button type="button" onClick={onReview} className="inline-flex items-center gap-[6px] font-medium text-[#1A1A1A] hover:underline">
          {t.rich("reviewAlert", { n: review, b: numDark })}
        </button>
      )}
    </div>
  );
}

function Sparkline({ values, category }: { values: number[]; category: FeedbackCategory }) {
  const tone = CATEGORY_TONE[category];
  if (values.length < 2) return <svg className="mt-[6px] block h-[38px] w-full" aria-hidden />;
  const W = 300, H = 38, mx = Math.max(1, ...values);
  const pts = values.map((y, i) => [(i * W) / (values.length - 1), H - 3 - (y / mx) * (H - 8)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return (
    <svg className="mt-[6px] block h-[38px] w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path d={`${d}L${W},${H}L0,${H}Z`} fill={tone.bg} opacity={0.7} />
      <path d={d} fill="none" stroke={tone.dot} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Up is bad for complaints and objections, good for suggestions (prototype v6). */
function deltaClass(category: FeedbackCategory, d: number): string {
  if (d === 0) return "text-[#8A9096]";
  if (category === "suggestion") return d > 0 ? "text-[#008060]" : "text-[#8A9096]";
  return d > 0 ? "text-[#D72C0D]" : "text-[#008060]";
}

export function KpiCards({ overview, value, onChange }: { overview: Overview; value: FeedbackCategory | null; onChange: (c: FeedbackCategory | null) => void }) {
  const t = useTranslations("feedback.manager");
  const tf = useTranslations("feedback");
  const total = overview.total || 1;
  return (
    <div className="mb-[12px] grid grid-cols-3 gap-[12px] max-md:grid-cols-1">
      {overview.kpis.map((k) => {
        const tone = CATEGORY_TONE[k.category];
        const on = value === k.category;
        const d = k.prev === null ? null : k.count - k.prev;
        const sub = k.category === "reclamation"
          ? overview.complaints.late
            ? t.rich("openLate", { open: overview.complaints.open, late: overview.complaints.late, b: (c) => <b className="font-semibold text-[#D72C0D]">{c}</b> })
            : t("open", { open: overview.complaints.open })
          : t("ofTotal", { p: Math.round((k.count * 100) / total) });
        return (
          <button key={k.category} type="button" aria-pressed={on} onClick={() => onChange(on ? null : k.category)}
            className="relative overflow-hidden rounded-[10px] border bg-white px-[16px] pb-[10px] pt-[14px] text-start hover:border-[#C9CCCF]"
            style={on ? { borderColor: tone.dot, boxShadow: `inset 0 0 0 1px ${tone.dot}` } : { borderColor: "#E1E3E5" }}>
            <div className="flex items-center gap-[7px] text-[13px] font-medium text-[#5C6166]">
              <span aria-hidden className="h-[8px] w-[8px] rounded-full" style={{ background: tone.dot }} />
              {tf(`catPlural.${k.category}`)}
            </div>
            <div className="my-[4px] flex items-baseline gap-[10px] text-[30px] font-[650] tracking-[-0.01em]">
              <span className="tabular-nums">{k.count}</span>
              {d !== null && (
                <span className={`text-[12.5px] font-semibold tracking-normal ${deltaClass(k.category, d)}`} title={`${t("vsPrev")} : ${k.prev}`}>
                  <span dir="ltr" className="tabular-nums">{d > 0 ? "↑" : d < 0 ? "↓" : "="} {Math.abs(d)}</span>{" "}
                  <span className="font-normal text-[#8A9096]">{t("vsPrev")}</span>
                </span>
              )}
            </div>
            <div className="flex justify-between text-[12.5px] text-[#8A9096]"><span>{sub}</span></div>
            <Sparkline values={k.series} category={k.category} />
          </button>
        );
      })}
    </div>
  );
}

export function TopTopics({ overview, category, topicId, onPick }: {
  overview: Overview; category: FeedbackCategory | null; topicId: string | null;
  onPick: (category: FeedbackCategory, topicId: string | null) => void;
}) {
  const t = useTranslations("feedback.manager");
  const tf = useTranslations("feedback");
  const locale = useLocale();
  const label = (topics: FeedbackTopic[], id: string | null) => {
    const x = id ? topics.find((y) => y.id === id) : null;
    return x ? (locale.startsWith("ar") ? x.label_ar : x.label_fr) : tf("noTopic");
  };
  const mixTotal = overview.mix.reduce((s, m) => s + m.count, 0) || 1;
  const max = overview.ranked[0]?.count ?? 1;
  return (
    <div className="rounded-[10px] border border-[#E1E3E5] bg-white px-[16px] py-[14px]">
      <div className="mb-[10px] flex items-baseline justify-between">
        <h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#8A9096]">{t("topics")}</h3>
        <small className="text-[12px] text-[#8A9096]">{t("topicsSub")}</small>
      </div>
      <div className="mb-[6px] flex h-[8px] gap-[2px] overflow-hidden rounded-[4px]">
        {overview.mix.map((m) => <span key={m.category} style={{ flex: m.count, background: CATEGORY_TONE[m.category].dot }} />)}
      </div>
      <div className="mb-[12px] flex flex-wrap gap-[14px] text-[12px] text-[#5C6166]">
        {overview.mix.map((m) => (
          <span key={m.category}>
            <i className="me-[5px] inline-block h-[8px] w-[8px] rounded-[2px]" style={{ background: CATEGORY_TONE[m.category].dot }} />
            {tf(`catPlural.${m.category}`)} <b className="tabular-nums">{Math.round((m.count * 100) / mixTotal)} %</b>
          </span>
        ))}
      </div>
      {overview.ranked.length === 0 && <div className="p-[30px] text-center text-[#8A9096]">{t("none")}</div>}
      {overview.ranked.map((r, i) => {
        const tone = CATEGORY_TONE[r.category];
        const on = category === r.category && topicId === (r.topicId ?? "none");
        const d = r.prev === null ? null : r.count - r.prev;
        const isNew = r.prev === 0 && r.count > 0;
        return (
          <button key={`${r.category}|${r.topicId}`} type="button" data-testid="topic-row" aria-pressed={on}
            onClick={() => onPick(r.category, r.topicId)}
            className="grid w-full grid-cols-[22px_minmax(0,1fr)_120px_40px_52px] items-center gap-[10px] rounded-[8px] px-[8px] py-[7px] text-start text-[13px] hover:bg-[#F7F8F9] max-md:grid-cols-[22px_minmax(0,1fr)_40px_52px]"
            style={on ? { background: `color-mix(in srgb, ${tone.bg} 55%, #fff)`, boxShadow: `inset 0 0 0 1px ${tone.dot}` } : undefined}>
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] text-[11.5px] font-bold tabular-nums" style={{ background: tone.bg, color: tone.ink }}>{i + 1}</span>
            <span className="min-w-0">
              <b className="block truncate font-[550]">{label(overview.topics, r.topicId)}</b>
              <small className="text-[11.5px] text-[#8A9096]">{tf(`cat.${r.category}`)} · <span className="tabular-nums">{r.share} %</span></small>
            </span>
            <span className="h-[6px] overflow-hidden rounded-[3px] bg-[#EDEEF0] max-md:hidden">
              <span className="block h-full rounded-[3px]" style={{ width: `${Math.max(5, (r.count * 100) / max)}%`, background: tone.dot }} />
            </span>
            <span className="text-end font-[650] tabular-nums">{r.count}</span>
            {d === null ? <span /> : isNew
              ? <span className="text-end text-[11.5px] font-semibold text-[#6D28D9]">{t("newTopic")}</span>
              : <span dir="ltr" className={`text-end text-[11.5px] font-semibold tabular-nums ${deltaClass(r.category, d)}`}>{d > 0 ? "↑" : d < 0 ? "↓" : "="}{d ? Math.abs(d) : ""}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function AgentsBox({ overview, value, onPick }: { overview: Overview; value: string | null; onPick: (id: string) => void }) {
  const t = useTranslations("feedback.manager");
  const tf = useTranslations("feedback");
  const max = Math.max(1, overview.byAgent[0]?.count ?? 0);
  return (
    <div className="rounded-[10px] border border-[#E1E3E5] bg-white px-[16px] py-[14px]">
      <div className="mb-[10px] flex items-baseline justify-between">
        <h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#8A9096]">{t("byAgent")}</h3>
        <small className="text-[12px] tabular-nums text-[#8A9096]">{t("mixOf", { n: overview.agentsTotal })}</small>
      </div>
      <div className="mb-[12px] flex flex-wrap gap-[14px] text-[12px] text-[#5C6166]">
        {FEEDBACK_CATEGORIES.map((c) => (
          <span key={c}><i className="me-[5px] inline-block h-[8px] w-[8px] rounded-[2px]" style={{ background: CATEGORY_TONE[c].dot }} />{tf(`catPlural.${c}`)}</span>
        ))}
      </div>
      {overview.byAgent.map((a) => {
        const flag = a.count === 0
          ? <span className="rounded-[4px] px-[5px] text-[11px] font-semibold text-[#D72C0D] [background:#FFF1EE]">{t("noEntry")}</span>
          : a.count < max * 0.1
            ? <span className="rounded-[4px] px-[5px] text-[11px] font-semibold text-[#8A5A00] [background:#FFF8E6]">{t("low")}</span>
            : null;
        const on = value === a.id;
        return (
          <button key={a.id} type="button" data-testid="agent-row" data-agent={a.id} aria-pressed={on} onClick={() => onPick(a.id)}
            className={`grid w-full grid-cols-[28px_minmax(0,1fr)_34px] items-center gap-x-[10px] gap-y-[4px] rounded-[8px] px-[8px] py-[7px] text-start hover:bg-[#F7F8F9] ${on ? "bg-[#F9FAFB] shadow-[inset_0_0_0_1px_#E1E3E5]" : ""}`}>
            <span className="row-span-2"><Avatar name={a.name} color={agentColor(overview.agents, a.id)} size={28} /></span>
            <span className="flex items-center gap-[6px] text-[13px] font-[550]">{a.name} {flag}</span>
            <span className={`row-span-2 text-end text-[15px] font-[650] tabular-nums ${a.count === 0 ? "text-[#D72C0D]" : ""}`}>{a.count}</span>
            <span className="flex h-[6px] gap-px overflow-hidden rounded-[3px] bg-[#EDEEF0]" style={{ width: `${Math.max(a.count ? 4 : 100, (a.count * 100) / max)}%` }}>
              {a.count > 0 && FEEDBACK_CATEGORIES.map((c) => a.byCategory[c]
                ? <span key={c} title={`${tf(`catPlural.${c}`)} : ${a.byCategory[c]}`} style={{ flex: a.byCategory[c], background: CATEGORY_TONE[c].dot }} />
                : null)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
