"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Search } from "lucide-react";
import { useFeedbackTopics, useMyFeedback } from "@/hooks/useFeedback";
import { FEEDBACK_CATEGORIES, FEEDBACK_MOMENTS, type FeedbackCategory, type FeedbackMoment } from "@/lib/feedback/taxonomy";
import { shiftDay } from "@/lib/feedback/date-range";
import { todayInMarket } from "@/lib/dates/market-day";
import { marketTimezone } from "@/lib/markets";
import { isEditableTarget } from "@/lib/dom";
import { useFeedbackCapture } from "./FeedbackCaptureProvider";
import { CATEGORY_TONE, CategoryTag, ComplaintStatusPill, Kbd, MOMENT_ICON, MomentChip, ProductThumb, useTopicLabel } from "./atoms";

const GRID = "grid grid-cols-[96px_120px_minmax(0,2.2fr)_minmax(0,1.1fr)_170px_110px] items-center gap-3.5 px-4";

/**
 * « Mes retours » — the agent's own sheet (prototype voix-du-client-agent-v2, screen « mine »):
 * filter by category and by moment, search in the customer's words, and the read-only status
 * of the complaints they raised. « Nouveau » (or F) opens the capture window.
 */
export function AgentFeedbackSheet({ marketId }: { marketId: string | null }) {
  const t = useTranslations("feedback.mine");
  const tf = useTranslations("feedback");
  const locale = useLocale();
  const { rows, error } = useMyFeedback();
  const topics = useFeedbackTopics(null);
  const topicLabel = useTopicLabel();
  const { openCapture } = useFeedbackCapture();
  const [cat, setCat] = useState<FeedbackCategory | "all">("all");
  const [moment, setMoment] = useState<FeedbackMoment | "all">("all");
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isEditableTarget(e.target) && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const all = rows ?? [];
  const shown = useMemo(() => {
    const term = q.trim();
    return all.filter((r) => (cat === "all" || r.category === cat) && (moment === "all" || r.moment === moment) && (!term || r.body.includes(term)));
  }, [all, cat, moment, q]);

  const tz = marketTimezone(marketId);
  const today = todayInMarket(marketId);
  const dayLabel = (iso: string) => {
    const d = todayInMarket(marketId, new Date(iso));
    if (d === today) return t("today");
    if (d === shiftDay(today, -1)) return t("yesterday");
    return new Intl.DateTimeFormat(locale.startsWith("ar") ? "ar-LY" : "fr-FR", { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
  };
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));

  const chip = (on: boolean) =>
    `inline-flex h-[34px] items-center gap-[7px] rounded-full border px-3 text-[13px] font-semibold ${on ? "border-[#111827] bg-[#111827] text-white" : "border-[#D1D5DB] bg-white text-[#374151]"}`;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] max-w-[1480px] flex-col px-5 pb-5 pt-4 text-start">
      <div className="flex items-start gap-3.5">
        <div>
          <h2 className="m-0 text-[24px] font-bold">{t("title")}</h2>
          <p className="m-0 mt-[3px] text-[14px] text-[#6B7280]">{t("subtitle")}</p>
        </div>
        <button type="button" onClick={() => openCapture(null)}
          className="ms-auto inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg bg-[#15803D] px-4 text-[14px] font-bold text-white">
          <Plus size={18} aria-hidden />
          <span>{t("new")}</span>
          <Kbd dark>F</Kbd>
        </button>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={cat === "all"} onClick={() => setCat("all")} className={chip(cat === "all")}>
          {t("all")} <b className={`text-[12px] tabular-nums ${cat === "all" ? "text-[#D1D5DB]" : "text-[#6B7280]"}`}>{all.length}</b>
        </button>
        {FEEDBACK_CATEGORIES.map((c) => {
          const on = cat === c;
          const tone = CATEGORY_TONE[c];
          return (
            <button key={c} type="button" aria-pressed={on} onClick={() => setCat(c)}
              className="inline-flex h-[34px] items-center gap-[7px] rounded-full border px-3 text-[13px] font-semibold"
              style={on ? { background: tone.bg, borderColor: tone.dot, borderWidth: 1.5, color: tone.ink } : { background: "#fff", borderColor: "#D1D5DB", color: "#374151" }}>
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: tone.dot }} />
              {tf(`cat.${c}`)} <b className="text-[12px] tabular-nums" style={{ color: on ? tone.ink : "#6B7280" }}>{all.filter((r) => r.category === c).length}</b>
            </button>
          );
        })}
        <span aria-hidden className="mx-1 h-[22px] w-px bg-[#D1D5DB]" />
        {FEEDBACK_MOMENTS.map((m) => {
          const Icon = MOMENT_ICON[m];
          const on = moment === m;
          return (
            <button key={m} type="button" aria-pressed={on} onClick={() => setMoment(on ? "all" : m)} className={chip(on)}>
              <Icon size={14} aria-hidden />
              {tf(`moments.${m}`)} <b className={`text-[12px] tabular-nums ${on ? "text-[#D1D5DB]" : "text-[#6B7280]"}`}>{all.filter((r) => r.moment === m).length}</b>
            </button>
          );
        })}
        <label className="ms-auto flex h-[38px] w-[300px] items-center gap-2 rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-[#6B7280] max-lg:w-full">
          <Search size={18} aria-hidden />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] text-[#111827] outline-none" />
          <Kbd>/</Kbd>
        </label>
      </div>

      <section className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
        <div role="table" className="flex min-h-0 flex-1 flex-col overflow-x-auto">
          <div role="row" className={`${GRID} h-9 min-w-[900px] border-b border-[#E5E7EB] bg-[#F9FAFB] text-[12.5px] font-semibold text-[#6B7280]`}>
            {(["date", "category", "words", "product", "moment", "status"] as const).map((c) => (
              <span key={c} role="columnheader">{t(`cols.${c}`)}</span>
            ))}
          </div>
          <div className="min-h-0 min-w-[900px] flex-1 overflow-y-auto">
            {error && <p className="p-8 text-center text-[#6B7280]">{t("error")}</p>}
            {!error && rows && shown.length === 0 && (
              <p className="p-8 text-center text-[#6B7280]">{all.length === 0 ? t("empty") : t("noMatch")}</p>
            )}
            {shown.map((r) => (
              <div key={r.id} role="row" data-testid="mine-row" className={`${GRID} min-h-[58px] border-b border-[#E5E7EB] text-[13.5px]`}>
                <span role="cell" className="text-[12.5px] text-[#6B7280]">
                  <b className="block text-[13px] text-[#374151]">{dayLabel(r.created_at)}</b>
                  <span dir="ltr" className="tabular-nums">{time(r.created_at)}</span>
                </span>
                <span role="cell"><CategoryTag category={r.category} /></span>
                <span role="cell" className="min-w-0">
                  <span data-testid="mine-words" className="block truncate text-[14.5px] font-medium [unicode-bidi:plaintext]">{r.body}</span>
                  <small className="mt-px block text-[12.5px] text-[#6B7280]">{r.topic_id ? topicLabel(topics, r.topic_id) : "—"}</small>
                </span>
                <span role="cell" className="flex min-w-0 items-center gap-2">
                  {r.product ? (
                    <>
                      <ProductThumb url={r.product.image_url} size={28} />
                      <span className="truncate [unicode-bidi:plaintext]">{r.product.name}</span>
                    </>
                  ) : <span className="text-[#9CA3AF]">—</span>}
                </span>
                <span role="cell"><MomentChip moment={r.moment} /></span>
                <span role="cell">{r.status ? <ComplaintStatusPill status={r.status} /> : <span className="text-[#9CA3AF]">—</span>}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex h-11 items-center gap-3.5 border-t border-[#E5E7EB] px-4 text-[12.5px] text-[#6B7280]">
          <span className="inline-flex items-center gap-1.5"><Kbd>/</Kbd> {t("footSearch")}</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>F</Kbd> {t("footNew")}</span>
          <span className="ms-auto">{t("count", { shown: shown.length, total: all.length })}</span>
        </div>
      </section>
    </div>
  );
}
