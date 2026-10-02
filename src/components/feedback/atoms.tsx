"use client";

import { useLocale, useTranslations } from "next-intl";
import { DoorOpen, PackageCheck, Phone, Truck, type LucideIcon } from "lucide-react";
import { FEEDBACK_CATEGORIES, type FeedbackCategory, type FeedbackMoment } from "@/lib/feedback/taxonomy";
import type { FeedbackTopic } from "@/types/feedback";

/**
 * The visual vocabulary of « Voix du client », shared by the agent's capture window, the
 * reject and delivery offers, « Mes retours » and the manager page. Values are the
 * prototypes' (voix-du-client-agent-v2 / manager-v6): each category has a background, an ink
 * and a dot — the only colour on these screens besides status.
 */
export const CATEGORY_TONE: Record<FeedbackCategory, { bg: string; ink: string; dot: string }> = {
  reclamation: { bg: "#FEE2E2", ink: "#991B1B", dot: "#EF4444" },
  objection: { bg: "#FEF3C7", ink: "#92400E", dot: "#F59E0B" },
  suggestion: { bg: "#DCFCE7", ink: "#166534", dot: "#22C55E" },
};

export const MOMENT_ICON: Record<FeedbackMoment, LucideIcon> = {
  call: Phone,
  transit: Truck,
  door: DoorOpen,
  after: PackageCheck,
};

export function useTopicLabel() {
  const locale = useLocale();
  const t = useTranslations("feedback");
  return (topics: FeedbackTopic[], id: string | null) => {
    const topic = id ? topics.find((x) => x.id === id) : null;
    if (!topic) return t("noTopic");
    return locale.startsWith("ar") ? topic.label_ar : topic.label_fr;
  };
}

/** « ● Objection » — the pill on a row and in a toast. */
export function CategoryTag({ category, size = "md" }: { category: FeedbackCategory; size?: "sm" | "md" | "plain" }) {
  const t = useTranslations("feedback");
  const tone = CATEGORY_TONE[category];
  // The manager's sheet and drawer use the flat .tag of prototype manager-v6: no dot, square-ish.
  if (size === "plain") {
    return (
      <span
        data-category={category}
        className="inline-flex items-center whitespace-nowrap rounded-[5px] px-[7px] py-[1px] text-[12px] font-[550]"
        style={{ background: tone.bg, color: tone.ink }}
      >
        {t(`cat.${category}`)}
      </span>
    );
  }
  return (
    <span
      data-category={category}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ${size === "sm" ? "h-[22px] ps-2 pe-2 text-[12px]" : "h-6 ps-2 pe-[9px] text-[12.5px]"}`}
      style={{ background: tone.bg, color: tone.ink }}
    >
      <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: tone.dot }} />
      {t(`cat.${category}`)}
    </span>
  );
}

/** « 🚚 En attente · en route » */
export function MomentChip({ moment, small = false }: { moment: FeedbackMoment; small?: boolean }) {
  const t = useTranslations("feedback");
  const Icon = MOMENT_ICON[moment];
  return (
    <span
      data-moment={moment}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#F1F5F9] font-semibold text-[#334155] ${small ? "h-[22px] px-2 text-[11.5px]" : "h-[26px] px-2.5 text-[12.5px]"}`}
    >
      <Icon size={14} strokeWidth={1.8} className="text-[#475569]" aria-hidden />
      {t(`moments.${moment}`)}
    </span>
  );
}

export function ProductThumb({ url, size = 44, round = false }: { url: string | null | undefined; size?: number; round?: boolean }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 border border-[#EDEEF0] bg-[#F3F4F6] object-cover ${round ? "rounded-full" : size >= 40 ? "rounded-lg" : "rounded-[5px]"}`}
      style={{ width: size, height: size }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
    />
  ) : (
    <span aria-hidden className={`shrink-0 bg-[#F3F4F6] ${round ? "rounded-full" : "rounded-lg"}`} style={{ width: size, height: size }} />
  );
}

/**
 * The three category cards — name, the plain-language descriptor under it, the key that picks
 * it (1–3) and, when the words already point somewhere, a « suggéré » tag.
 */
export function CategoryCards({
  value, onChange, suggested = null, showKeys = false, compact = false, stack = false,
}: {
  value: FeedbackCategory | null;
  onChange: (c: FeedbackCategory | null) => void;
  suggested?: FeedbackCategory | null;
  showKeys?: boolean;
  compact?: boolean;
  /** Phones: one card per line, name and descriptor side by side. */
  stack?: boolean;
}) {
  const t = useTranslations("feedback");
  return (
    <div role="group" className={`grid gap-2.5 ${stack ? "grid-cols-1 gap-1.5" : "grid-cols-3"}`}>
      {FEEDBACK_CATEGORIES.map((c, i) => {
        const tone = CATEGORY_TONE[c];
        const on = value === c;
        return (
          <button
            key={c}
            type="button"
            data-category-card={c}
            aria-pressed={on}
            onClick={() => onChange(on ? null : c)}
            className={[
              "relative flex rounded-[14px] border-[1.5px] text-start transition-opacity",
              stack ? "flex-row items-center gap-2.5 px-3 py-2.5" : `flex-col items-start gap-1 px-3.5 ${compact ? "min-h-[64px] py-2.5" : "min-h-[78px] py-3"}`,
              value && !on ? "opacity-55" : "",
            ].join(" ")}
            style={{ background: on ? tone.bg : "#fff", borderColor: on ? tone.dot : "#E5E7EB" }}
          >
            <span className="flex items-center gap-2 text-[15.5px] font-bold" style={{ color: on ? tone.ink : "#111827" }}>
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: tone.dot }} />
              {t(`cat.${c}`)}
            </span>
            <span className="text-[12.5px] leading-[1.35]" style={{ color: on ? tone.ink : "#6B7280", opacity: on ? 0.85 : 1 }}>
              {t(`catDesc.${c}`)}
            </span>
            {suggested === c && (
              <span className="mt-0.5 inline-flex items-center rounded-full bg-[#EDE9FE] px-[7px] py-px text-[10.5px] font-bold text-[#6D28D9]">
                {t("offer.suggested")}
              </span>
            )}
            {showKeys && !stack && (
              <kbd
                className="absolute end-2.5 top-2.5 inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-b-2 bg-white px-[5px] text-[11px] font-bold"
                style={{ borderColor: on ? tone.dot : "#D1D5DB", color: on ? tone.ink : "#6B7280" }}
              >
                {i + 1}
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TopicChips({
  category, topics, value, onChange,
}: {
  category: FeedbackCategory;
  topics: FeedbackTopic[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const locale = useLocale();
  const tone = CATEGORY_TONE[category];
  const list = topics.filter((x) => x.category === category);
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((topic) => {
        const on = value === topic.id;
        return (
          <button
            key={topic.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : topic.id)}
            className={`h-8 whitespace-nowrap rounded-full border px-3 text-[13px] ${on ? "font-semibold" : "text-[#374151]"}`}
            style={on ? { background: tone.bg, color: tone.ink, borderColor: tone.dot } : { background: "#F9FAFB", borderColor: "#E5E7EB" }}
          >
            {locale.startsWith("ar") ? topic.label_ar : topic.label_fr}
          </button>
        );
      })}
    </div>
  );
}

/** « Moment 🚚 En attente · en route  [auto]  déduit du statut « En livraison » » */
export function MomentRow({ moment, status }: { moment: FeedbackMoment | null; status: string | null }) {
  const t = useTranslations("feedback.capture");
  const ts = useTranslations("orders.statuses");
  if (!moment) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-[#6B7280]">
        {t("moment")} · <span>{t("noMoment")}</span>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-[#6B7280]" data-testid="moment-row">
      {t("moment")} <MomentChip moment={moment} />
      <span className="inline-flex items-center rounded-full bg-[#F1F5F9] px-2 py-px text-[11.5px] font-bold text-[#475569]">{t("auto")}</span>
      {status && <span>{t("fromStatus", { status: safeStatus(ts, status) })}</span>}
    </div>
  );
}

function safeStatus(ts: (k: never) => string, status: string): string {
  const label = ts(status as never);
  return label && !label.includes("statuses") ? label : status;
}

/** « Ouverte » / « En cours » / « Résolue » — the agent's read-only complaint status. */
export function ComplaintStatusPill({ status }: { status: "open" | "in_progress" | "resolved" }) {
  const t = useTranslations("feedback.status");
  const tone = status === "open" ? "bg-[#FFF4F4] text-[#D72C0D]" : status === "in_progress" ? "bg-[#FFF8E6] text-[#8A5A00]" : "bg-[#F1F8F5] text-[#008060]";
  return <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-[9px] text-[12.5px] font-semibold ${tone}`}>{t(status)}</span>;
}

export function Kbd({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <kbd
      className={`inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-b-2 px-[5px] text-[11px] font-bold leading-none ${dark ? "border-white/35 bg-white/15 text-white" : "border-[#D1D5DB] bg-white text-[#6B7280]"}`}
    >
      {children}
    </kbd>
  );
}
