"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Clock,
  Phone,
  Plus,
  ListChecks,
  Activity,
  CheckCircle,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useFollowUpsTimeline } from "@/hooks/useFollowUpsTimeline";
import {
  getDueUrgency,
  type DueUrgency,
  type FollowUpStatus,
  type OrderFollowUpWithOrder,
} from "@/types/follow-up";
import type { FollowUpsListPage } from "@/lib/follow-ups/list";
import type { Locale } from "@/types";

const NewFollowUpModal = dynamic(
  () => import("./NewFollowUpModal").then((m) => m.NewFollowUpModal),
  { ssr: false },
);

interface Props {
  userMarketId: string;
  marketCode: "TN" | "LY";
  locale: Locale;
  agentId: string;
  initialTimelinePage: FollowUpsListPage;
}

// Status tabs — same lifecycle tones as the queue tab.
// Open       → slate   (incoming)
// In Progress → amber  (in flight)
// Resolved   → emerald (success goal)
// Escalated  → red    (problem)
type StatusFilter = "all" | FollowUpStatus;

interface TabDef {
  key: StatusFilter;
  icon: LucideIcon;
  i18nKey: string;
  tone: "neutral" | "warning" | "success" | "danger";
}

const TABS: TabDef[] = [
  { key: "all", icon: ListChecks, i18nKey: "tabAll", tone: "neutral" },
  { key: "open", icon: ListChecks, i18nKey: "statuses.open", tone: "neutral" },
  {
    key: "in_progress",
    icon: Activity,
    i18nKey: "statuses.in_progress",
    tone: "warning",
  },
  {
    key: "resolved",
    icon: CheckCircle,
    i18nKey: "statuses.resolved",
    tone: "success",
  },
  {
    key: "escalated",
    icon: AlertTriangle,
    i18nKey: "statuses.escalated",
    tone: "danger",
  },
];

const TAB_TONE: Record<
  TabDef["tone"],
  {
    activeBg: string;
    activeText: string;
    activeBorder: string;
    chipBg: string;
    iconActive: string;
  }
> = {
  neutral: {
    activeBg: "bg-[#EEF2F7]",
    activeText: "text-[#1E3A5F]",
    activeBorder: "border-[#C7D2E0]",
    chipBg: "bg-[#1E3A5F]",
    iconActive: "text-[#1E3A5F]",
  },
  warning: {
    activeBg: "bg-[#FEF4E2]",
    activeText: "text-[#8A5A00]",
    activeBorder: "border-[#F0C97D]",
    chipBg: "bg-[#B07A00]",
    iconActive: "text-[#8A5A00]",
  },
  success: {
    activeBg: "bg-[#DFF8EC]",
    activeText: "text-[#004D35]",
    activeBorder: "border-[#10B981]",
    chipBg: "bg-[#007A52]",
    iconActive: "text-[#008060]",
  },
  danger: {
    activeBg: "bg-[#FEECEC]",
    activeText: "text-[#8B1F1F]",
    activeBorder: "border-[#F3B5B5]",
    chipBg: "bg-[#8B1F1F]",
    iconActive: "text-[#8B1F1F]",
  },
};

// Per-status pill style for the trailing-edge badge on each follow-up card.
const STATUS_PILL: Record<FollowUpStatus, string> = {
  open: "bg-[#EEF2F7] text-[#1E3A5F] border border-[#C7D2E0]",
  in_progress: "bg-[#FEF4E2] text-[#8A5A00] border border-[#F0C97D]",
  resolved: "bg-[#DFF8EC] text-[#004D35] border border-[#10B981]",
  escalated: "bg-[#FEECEC] text-[#8B1F1F] border border-[#F3B5B5]",
};

// Urgency bucket headers. Maps to the queue palette's lifecycle tones so the
// visual language is consistent across all three agent tabs.
const URGENCY_STYLE: Record<
  DueUrgency,
  { text: string; bar: string; chipBg: string }
> = {
  overdue: {
    text: "text-[#8B1F1F]",
    bar: "bg-[#8B1F1F]",
    chipBg: "bg-[#FEECEC]",
  },
  due_today: {
    text: "text-[#8A5A00]",
    bar: "bg-[#8A5A00]",
    chipBg: "bg-[#FEF4E2]",
  },
  due_future: {
    text: "text-agent-on-surface-variant",
    bar: "bg-agent-outline",
    chipBg: "bg-agent-surface-high",
  },
  no_schedule: {
    text: "text-agent-on-surface-variant/80",
    bar: "bg-agent-outline-variant",
    chipBg: "bg-agent-surface-high",
  },
};

const URGENCY_ORDER: DueUrgency[] = [
  "overdue",
  "due_today",
  "due_future",
  "no_schedule",
];

const URGENCY_I18N: Record<DueUrgency, string> = {
  overdue: "overdueBucket",
  due_today: "dueTodayBucket",
  due_future: "dueFutureBucket",
  no_schedule: "noScheduleBucket",
};

function getCustomerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function AgentFollowUpsView({
  userMarketId,
  marketCode,
  locale,
  agentId,
  initialTimelinePage,
}: Props) {
  const t = useTranslations("crm.followUps");
  const tStatuses = useTranslations("crm.followUps.statuses");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [logTarget, setLogTarget] = useState<OrderFollowUpWithOrder | null>(null);

  const timeline = useFollowUpsTimeline({
    marketId: userMarketId,
    agentId,
    campaignId: null,
    fallbackFirstPage: initialTimelinePage,
  });

  const rows = useMemo<OrderFollowUpWithOrder[]>(() => {
    if (statusFilter === "all") return timeline.rows;
    return timeline.rows.filter((r) => r.status === statusFilter);
  }, [timeline.rows, statusFilter]);

  // Group filtered rows by urgency for the timeline sections.
  const grouped = useMemo(() => {
    const nowMs = Date.now();
    const map: Record<DueUrgency, OrderFollowUpWithOrder[]> = {
      overdue: [],
      due_today: [],
      due_future: [],
      no_schedule: [],
    };
    for (const row of rows) {
      map[getDueUrgency(row.due_at, nowMs)].push(row);
    }
    return URGENCY_ORDER.map((urgency) => ({
      urgency,
      rows: map[urgency],
    })).filter((b) => b.rows.length > 0);
  }, [rows]);

  // Counts per status — used to populate the segmented tab chips.
  const statusCounts = useMemo<Record<StatusFilter, number>>(() => {
    const c: Record<StatusFilter, number> = {
      all: timeline.rows.length,
      open: 0,
      in_progress: 0,
      resolved: 0,
      escalated: 0,
    };
    for (const r of timeline.rows) c[r.status]++;
    return c;
  }, [timeline.rows]);

  return (
    <div
      className="bg-agent-bg flex flex-col gap-5 px-8 pt-6 pb-16 min-h-screen"
      style={{ fontFamily: "var(--font-cairo)" }}
    >
      {/* Title row */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold text-agent-on-surface leading-tight tracking-tight">
            {t("myDueToday")}
          </h1>
          <p className="text-[13px] text-agent-on-surface-variant mt-1">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Segmented status tabs + New Follow-up CTA */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="overflow-x-auto min-w-0 -mx-1 px-1 custom-scrollbar">
          <div
            role="tablist"
            aria-label={t("statusLabel")}
            className="inline-flex items-center gap-1 p-1 bg-agent-surface rounded-2xl border border-agent-outline-variant shadow-[0_1px_2px_rgba(16,24,40,0.02)]"
          >
            {TABS.map((tab) => {
              const isActive = statusFilter === tab.key;
              const Icon = tab.icon;
              const tone = TAB_TONE[tab.tone];
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setStatusFilter(tab.key)}
                  className={[
                    "inline-flex items-center gap-2 py-2 px-4 rounded-xl",
                    "text-[13.5px] font-semibold transition-all duration-fast whitespace-nowrap",
                    isActive
                      ? `${tone.activeBg} ${tone.activeText} shadow-[0_1px_2px_rgba(16,24,40,0.04)] border ${tone.activeBorder}`
                      : "text-agent-on-surface-variant hover:text-agent-on-surface hover:bg-agent-surface-low/60 border border-transparent",
                  ].join(" ")}
                >
                  <Icon
                    size={15}
                    strokeWidth={isActive ? 2.5 : 2}
                    aria-hidden="true"
                    className={
                      isActive ? tone.iconActive : "text-agent-on-surface-variant/70"
                    }
                  />
                  <span>
                    {tab.key === "all" ? t("tabAll") : tStatuses(tab.key)}
                  </span>
                  <span
                    className={[
                      "inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-pill tabular-nums text-[11px] font-bold",
                      isActive
                        ? `${tone.chipBg} text-white`
                        : "bg-agent-surface-high text-agent-on-surface-variant/80",
                    ].join(" ")}
                  >
                    {statusCounts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="ms-auto shrink-0 inline-flex items-center gap-1.5 h-10 px-5 rounded-pill bg-agent-primary text-white text-[13.5px] font-bold hover:bg-agent-on-primary-container transition-colors duration-fast"
        >
          <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
          <span>{t("newFollowUp")}</span>
        </button>
      </div>

      {/* Body */}
      {grouped.length === 0 ? (
        <div className="text-agent-on-surface-variant text-center py-12 px-6 bg-agent-surface border border-agent-outline-variant rounded-xl">
          {t("emptyTimeline")}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(({ urgency, rows: bucketRows }) => {
            const style = URGENCY_STYLE[urgency];
            return (
              <section key={urgency}>
                <div className="flex items-center gap-2 mb-3">
                  <span
                    aria-hidden="true"
                    className={["inline-block w-1 h-5 rounded-full", style.bar].join(" ")}
                  />
                  <h2
                    className={[
                      "text-[13px] font-bold uppercase tracking-[0.06em]",
                      style.text,
                    ].join(" ")}
                  >
                    {t(URGENCY_I18N[urgency])}
                  </h2>
                  <span
                    className={[
                      "inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-pill tabular-nums text-[11px] font-bold",
                      style.chipBg,
                      style.text,
                    ].join(" ")}
                  >
                    {bucketRows.length}
                  </span>
                </div>

                <div className="flex flex-col gap-3">
                  {bucketRows.map((fu) => (
                    <FollowUpRow
                      key={fu.id}
                      fu={fu}
                      marketCode={marketCode}
                      locale={locale}
                      onLogAttempt={() => setLogTarget(fu)}
                      logLabel={t("logAttempt")}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {timeline.hasMore && (
            <div className="text-center">
              <button
                type="button"
                onClick={timeline.loadMore}
                disabled={timeline.loadingMore}
                className="inline-flex items-center gap-1.5 h-10 px-5 rounded-pill bg-agent-surface border border-agent-outline-variant text-agent-on-surface text-[13px] font-semibold hover:bg-agent-surface-low transition-colors duration-fast disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {timeline.loadingMore ? "…" : t("column.loadMore")}
              </button>
            </div>
          )}
        </div>
      )}

      {createOpen && (
        <NewFollowUpModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void timeline.mutate();
          }}
          marketId={userMarketId}
          marketCode={marketCode}
        />
      )}

      {logTarget && (
        <LogAttemptModal
          followUp={logTarget}
          onClose={() => setLogTarget(null)}
          onSubmitted={() => {
            setLogTarget(null);
            void timeline.mutate();
          }}
        />
      )}
    </div>
  );
}

function FollowUpRow({
  fu,
  marketCode,
  locale,
  onLogAttempt,
  logLabel,
}: {
  fu: OrderFollowUpWithOrder;
  marketCode: "TN" | "LY";
  locale: string;
  onLogAttempt: () => void;
  logLabel: string;
}) {
  const tStatuses = useTranslations("crm.followUps.statuses");
  const { order } = fu;
  return (
    <div className="group relative p-4 bg-agent-surface border border-agent-outline-variant rounded-xl agent-card-hover hover:border-agent-primary/30">
      <div className="flex items-center gap-4">
        {/* Customer avatar */}
        <Link
          href={`/${locale}/follow-ups/${fu.id}`}
          className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-agent-surface-high border border-agent-outline-variant text-agent-primary text-[15px] font-bold no-underline"
          aria-label={order.customer_name}
        >
          {getCustomerInitials(order.customer_name)}
        </Link>

        {/* Identity + meta */}
        <Link
          href={`/${locale}/follow-ups/${fu.id}`}
          className="flex flex-col min-w-0 flex-1 no-underline"
        >
          <span className="text-[15px] font-bold text-agent-on-surface truncate">
            {order.customer_name}
          </span>
          <div className="flex items-center gap-2 mt-0.5 text-[12.5px] text-agent-on-surface-variant flex-wrap">
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Phone size={11} strokeWidth={2} aria-hidden="true" />
              {order.customer_phone}
            </span>
            {order.customer_city && (
              <>
                <span aria-hidden="true" className="opacity-60">·</span>
                <span className="truncate">{order.customer_city}</span>
              </>
            )}
          </div>
        </Link>

        {/* Price */}
        <div className="hidden md:flex flex-col items-end shrink-0 px-3">
          <span className="text-[16px] font-bold text-agent-primary tabular-nums leading-tight">
            {formatCurrency(order.total_price, marketCode)}
          </span>
          {fu.due_at && (
            <span className="text-[11.5px] text-agent-on-surface-variant inline-flex items-center gap-1 mt-0.5">
              <Clock size={11} strokeWidth={2} aria-hidden="true" />
              {formatDateTime(fu.due_at, locale)}
            </span>
          )}
        </div>

        {/* Status pill */}
        <span
          className={[
            "shrink-0 inline-flex items-center px-3.5 py-1 rounded-pill text-[11px] font-bold tracking-[0.04em]",
            STATUS_PILL[fu.status],
          ].join(" ")}
        >
          {tStatuses(fu.status)}
        </span>

        {/* Log attempt button */}
        <button
          type="button"
          onClick={onLogAttempt}
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-pill bg-agent-surface border border-agent-outline-variant text-agent-on-surface text-[12px] font-semibold hover:bg-agent-surface-low transition-colors duration-fast"
        >
          {logLabel}
        </button>
      </div>

      {fu.description && (
        <div className="mt-3 ps-16 text-[12.5px] text-agent-on-surface-variant line-clamp-2">
          {fu.description}
        </div>
      )}
    </div>
  );
}

function LogAttemptModal({
  followUp,
  onClose,
  onSubmitted,
}: {
  followUp: OrderFollowUpWithOrder;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const t = useTranslations("crm.followUps");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!note.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(`/api/follow-ups/${followUp.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? t("errors.addNoteFailed"));
      }
      onSubmitted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errors.addNoteFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[420px] max-w-full bg-agent-surface border border-agent-outline-variant rounded-2xl p-6 shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
        style={{ fontFamily: "var(--font-cairo)" }}
      >
        <h3 className="text-[15px] font-bold text-agent-on-surface mb-1">
          {t("logAttempt")}
        </h3>
        <p className="text-[12.5px] text-agent-on-surface-variant mb-4">
          {followUp.order.customer_name} · {followUp.order.customer_phone}
        </p>
        {err && (
          <div className="text-[12.5px] text-agent-error mb-2">{err}</div>
        )}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("addNotePlaceholder")}
          autoFocus
          className="w-full h-20 p-2.5 text-[14px] border border-agent-outline-variant rounded-xl bg-agent-surface text-agent-on-surface resize-y focus:outline-none focus:ring-2 focus:ring-agent-primary/30"
        />
        <div className="flex gap-2 justify-end mt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center h-9 px-4 rounded-pill bg-agent-surface border border-agent-outline-variant text-agent-on-surface text-[13px] font-semibold hover:bg-agent-surface-low transition-colors duration-fast"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || !note.trim()}
            onClick={submit}
            className="inline-flex items-center h-9 px-4 rounded-pill bg-agent-primary text-white text-[13px] font-bold hover:bg-agent-on-primary-container transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? t("adding") : t("addNote")}
          </button>
        </div>
      </div>
    </div>
  );
}
