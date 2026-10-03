"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useFeedbackDays } from "@/hooks/useFeedback";
import { PRESETS, QUICK_PRESETS, activePreset, daysBetween, presetRange, type PresetKey } from "@/lib/feedback/date-range";

const addMonth = (ym: string, n: number) => {
  const d = new Date(`${ym}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/**
 * The period of prototype v6: three quick buttons (Aujourd'hui · 7 j · 30 j) and a date button
 * opening a popover — presets on the side, two months, dots on the days that have feedback,
 * future days and days before the first feedback unavailable, Annuler / Appliquer.
 */
export function DateRangeControl({ from, to, today, first, family, market, onChange }: {
  from: string; to: string; today: string; first: string | null; family: string | null; market: string | null;
  onChange: (from: string, to: string) => void;
}) {
  const t = useTranslations("feedback.manager");
  const locale = useLocale();
  const intl = locale.startsWith("ar") ? "ar-LY" : "fr-FR";
  const [open, setOpen] = useState(false);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [rightMonth, setRightMonth] = useState(to.slice(0, 7));
  const box = useRef<HTMLDivElement>(null);
  const preset = activePreset(from, to, today, first);
  const leftMonth = addMonth(rightMonth, -1);
  const days = useFeedbackDays(open ? `${leftMonth}-01` : null, open ? lastDay(rightMonth) : null, family, market);

  const fdate = (iso: string, year = false) =>
    new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
  });

  function close() { setOpen(false); setA(null); setB(null); }
  function applyPreset(k: PresetKey) {
    const [f, tt] = presetRange(k, today, first);
    close();
    onChange(f, tt);
  }

  // What the calendar shows as chosen: the draft while picking, else the applied range.
  const sa = a ?? from;
  const sb = a ? b : to;
  const lo = sb && sa > sb ? sb : sa;
  const hi = sb ? (sa > sb ? sa : sb) : null;

  // As the prototype: a quick preset always shows its dates (« 30 sept. – 30 sept. » for today);
  // a named preset shows its name; a custom range shows its dates, one day as one date.
  const custom = !preset || !QUICK_PRESETS.includes(preset);
  const label = !custom
    ? `${fdate(from)} – ${fdate(to)}`
    : preset ? t(`presets.${preset}`) : from === to ? fdate(from) : `${fdate(from)} – ${fdate(to)}`;
  const weekdays = t("weekdays").split(",");

  function month(ym: string) {
    const first1 = new Date(`${ym}-01T12:00:00Z`);
    const offset = (first1.getUTCDay() + 6) % 7;
    const n = new Date(Date.UTC(first1.getUTCFullYear(), first1.getUTCMonth() + 1, 0)).getUTCDate();
    const cells: React.ReactNode[] = weekdays.map((w, i) => (
      <span key={`w${i}`} className="pb-[4px] text-center text-[11px] text-[#8A9096]">{w}</span>
    ));
    for (let i = 0; i < offset; i++) cells.push(<span key={`e${i}`} />);
    for (let i = 1; i <= n; i++) {
      const iso = `${ym}-${String(i).padStart(2, "0")}`;
      const off = iso > today || (first !== null && iso < first);
      const isStart = iso === lo;
      const isEnd = hi ? iso === hi : iso === lo;
      const inside = hi !== null && iso > lo && iso < hi;
      cells.push(
        <button
          key={iso}
          type="button"
          disabled={off}
          aria-label={new Intl.DateTimeFormat(intl, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`))}
          onClick={() => { if (!a || b) { setA(iso); setB(null); } else setB(iso); }}
          className={[
            "group relative h-[32px] text-center text-[12.5px] disabled:pointer-events-none disabled:text-[#E1E3E5]",
            inside || ((isStart || isEnd) && hi && lo !== hi) ? "bg-[#EAF6EE]" : "",
            isStart && hi && lo !== hi ? "rounded-s-[16px]" : "",
            isEnd && hi && lo !== hi ? "rounded-e-[16px]" : "",
          ].join(" ")}
        >
          <span
            className={[
              "inline-flex h-[30px] w-[30px] items-center justify-center rounded-full tabular-nums",
              isStart || isEnd ? "bg-[#15803D] font-semibold text-white" : "group-hover:bg-[#EDEEF0]",
              iso === today && !(isStart || isEnd) ? "shadow-[inset_0_0_0_1px_#8A9096]" : "",
            ].join(" ")}
          >
            {i}
          </span>
          {days.has(iso) && <span aria-hidden className="absolute bottom-[3px] left-1/2 h-[3px] w-[3px] -translate-x-1/2 rounded-full bg-[#8A9096]" />}
        </button>,
      );
    }
    const name = new Intl.DateTimeFormat(intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(first1);
    return { name, grid: <div className="grid grid-cols-[repeat(7,34px)] gap-y-[2px]">{cells}</div> };
  }

  const L = month(leftMonth);
  const R = month(rightMonth);
  const canNext = rightMonth < today.slice(0, 7);
  const draftReady = Boolean(a && b);

  return (
    <>
      <div className="inline-flex rounded-[8px] border border-[#E1E3E5] bg-white p-[2px]">
        {QUICK_PRESETS.map((k) => (
          <button key={k} type="button" aria-pressed={preset === k} onClick={() => applyPreset(k)}
            className={`rounded-[6px] px-[11px] py-[5px] text-[13px] ${preset === k ? "bg-[#1A1A1A] text-white" : "text-[#5C6166]"}`}>
            {t(`quick.${k}`)}
          </button>
        ))}
      </div>
      <div className="relative" ref={box}>
        <button type="button" aria-expanded={open} onClick={() => { if (open) close(); else { setOpen(true); setRightMonth(to.slice(0, 7)); } }}
          className={`inline-flex h-[32px] items-center gap-[7px] rounded-[8px] border bg-white px-[10px] text-[13px] ${custom ? "border-[#1A1A1A]" : "border-[#E1E3E5]"}`}>
          <CalendarDays size={16} aria-hidden />
          <span>{label}</span>
          <ChevronDown size={16} aria-hidden />
        </button>
        {open && (
          <div className="absolute end-0 top-[38px] z-30 flex overflow-hidden rounded-[12px] border border-[#E1E3E5] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)] max-md:flex-col">
            <div className="flex min-w-[168px] flex-col border-e border-[#EDEEF0] p-[8px]">
              {PRESETS.map((k) => (
                <button key={k} type="button" onClick={() => applyPreset(k)}
                  className={`rounded-[6px] px-[10px] py-[7px] text-start text-[13px] ${!a && preset === k ? "bg-[#EAF6EE] font-semibold text-[#15803D]" : "text-[#5C6166] hover:bg-[#F7F8F9] hover:text-[#1A1A1A]"}`}>
                  {t(`presets.${k}`)}
                </button>
              ))}
            </div>
            <div className="px-[16px] py-[14px]">
              <div className="flex gap-[24px] max-md:flex-col">
                <div>
                  <div className="mb-[8px] flex min-h-[24px] items-center justify-between text-[13px] font-semibold">
                    <button type="button" aria-label={t("prevMonth")} onClick={() => setRightMonth(addMonth(rightMonth, -1))}
                      className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-[#8A9096] hover:bg-[#F7F8F9]">
                      <ChevronLeft size={16} className="rtl:rotate-180" aria-hidden />
                    </button>
                    <span>{L.name}</span><span className="w-[24px]" />
                  </div>
                  {L.grid}
                </div>
                <div>
                  <div className="mb-[8px] flex min-h-[24px] items-center justify-between text-[13px] font-semibold">
                    <span className="w-[24px]" /><span>{R.name}</span>
                    <button type="button" aria-label={t("nextMonth")} onClick={() => setRightMonth(addMonth(rightMonth, 1))}
                      className={`grid h-[24px] w-[24px] place-items-center rounded-[6px] text-[#8A9096] hover:bg-[#F7F8F9] ${canNext ? "" : "invisible"}`}>
                      <ChevronRight size={16} className="rtl:rotate-180" aria-hidden />
                    </button>
                  </div>
                  {R.grid}
                </div>
              </div>
              <div className="mt-[10px] flex items-center gap-[10px] border-t border-[#EDEEF0] pt-[10px] text-[12.5px] text-[#5C6166]">
                <span>
                  {hi
                    ? <><b className="tabular-nums">{fdate(lo, true)} – {fdate(hi, true)}</b> · {t("days", { n: daysBetween(lo, hi) + 1 })}</>
                    : t("pickEnd")}
                </span>
                <span className="flex-1" />
                <button type="button" onClick={close} className="inline-flex h-[32px] items-center rounded-[8px] border border-[#E1E3E5] bg-white px-[12px] text-[13px]">{t("cancel")}</button>
                <button type="button" disabled={!draftReady && !hi}
                  onClick={() => { const f = lo, e = hi ?? lo; close(); onChange(f, e); }}
                  className="inline-flex h-[32px] items-center rounded-[8px] border border-[#15803D] bg-[#15803D] px-[12px] text-[13px] text-white disabled:opacity-50">
                  {t("apply")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function lastDay(ym: string): string {
  const d = new Date(`${ym}-01T12:00:00Z`);
  const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return `${ym}-${String(n).padStart(2, "0")}`;
}
