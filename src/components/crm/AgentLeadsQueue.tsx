"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Inbox,
  Phone,
  BadgeCheck,
  Archive,
  LayoutGrid,
  Rows3,
  Plus,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { useAgentLeadQueue, tentativeTotal } from "@/hooks/useAgentLeadQueue";
import { formatDateTime } from "@/lib/format";
import { formatDisplayCurrencyCode } from "@/lib/markets";
import { LeadStatusBadge } from "./LeadStatusBadge";
import { LeadsKanban } from "./LeadsKanban";
import { NewLeadModal } from "./NewLeadModal";
import { AttemptEtiquette } from "@/components/queue/AttemptEtiquette";
import { RepeatBuyerBadge } from "@/components/shared/RepeatBuyerBadge";
import type { LeadStatus } from "@/types/lead";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
}

const VIEW_STORAGE_KEY = "agent.leads.view";
type ViewMode = "list" | "kanban";

type BucketKey = "nouveau" | "a_rappeler" | "qualifie" | "fermees";
type SubKey = "all" | 1 | 2 | 3 | "scheduled";

interface TabDef {
  key: BucketKey;
  icon: LucideIcon;
  labelKey: "nouveau" | "toCallBack" | "qualifie" | "fermees";
  /** Lifecycle phase for the active-state tone — matches queue tab pattern. */
  tone: "neutral" | "warning" | "success" | "archive";
}

// Lifecycle parallel to the queue's bucket tabs:
//   Nouveau    → slate (incoming, untouched)
//   À rappeler → amber (in-flight, needs work)
//   Qualifié   → emerald (success — the conversion goal)
//   Fermées    → gray (archive)
const TABS: TabDef[] = [
  { key: "nouveau", icon: Inbox, labelKey: "nouveau", tone: "neutral" },
  { key: "a_rappeler", icon: Phone, labelKey: "toCallBack", tone: "warning" },
  { key: "qualifie", icon: BadgeCheck, labelKey: "qualifie", tone: "success" },
  { key: "fermees", icon: Archive, labelKey: "fermees", tone: "archive" },
];

const TAB_TONE: Record<
  TabDef["tone"],
  {
    activeBg: string;
    activeText: string;
    activeBorder: string;
    chipBg: string;
    chipText: string;
    iconActive: string;
  }
> = {
  neutral: {
    activeBg: "bg-[#EEF2F7]",
    activeText: "text-[#1E3A5F]",
    activeBorder: "border-[#C7D2E0]",
    chipBg: "bg-[#1E3A5F]",
    chipText: "text-white",
    iconActive: "text-[#1E3A5F]",
  },
  warning: {
    activeBg: "bg-[#FEF4E2]",
    activeText: "text-[#8A5A00]",
    activeBorder: "border-[#F0C97D]",
    chipBg: "bg-[#B07A00]",
    chipText: "text-white",
    iconActive: "text-[#8A5A00]",
  },
  success: {
    activeBg: "bg-[#DFF8EC]",
    activeText: "text-[#004D35]",
    activeBorder: "border-[#10B981]",
    chipBg: "bg-[#007A52]",
    chipText: "text-white",
    iconActive: "text-[#008060]",
  },
  archive: {
    activeBg: "bg-agent-surface-high",
    activeText: "text-agent-on-surface",
    activeBorder: "border-agent-outline",
    chipBg: "bg-agent-on-surface-variant",
    chipText: "text-white",
    iconActive: "text-agent-on-surface",
  },
};

function bucketForLeadStatus(status: string): BucketKey | null {
  if (status === "assigned" || status === "new") return "nouveau";
  if (status.startsWith("attempt_") || status === "callback_scheduled") {
    return "a_rappeler";
  }
  if (status === "qualified") return "qualifie";
  if (status === "won" || status === "lost" || status === "archived") {
    return "fermees";
  }
  return null;
}

function matchesSub(
  status: string,
  callbackAt: string | null,
  sub: SubKey,
): boolean {
  if (sub === "all") return true;
  const now = new Date();
  if (sub === "scheduled") {
    return (
      status === "callback_scheduled" &&
      !!callbackAt &&
      new Date(callbackAt) > now
    );
  }
  return status === `attempt_${sub}`;
}

function getCustomerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export function AgentLeadsQueue({ user }: Props) {
  const displayCurrency = formatDisplayCurrencyCode(null, user.market_id);
  const t = useTranslations("crm.queue");
  const tBuckets = useTranslations("crm.queue.buckets");
  const tSub = useTranslations("crm.queue.buckets.subfilter");
  const tLeads = useTranslations("crm.leads");
  const tViews = useTranslations("crm.leads.views");
  const tSources = useTranslations("crm.leads.sources");
  const tShell = useTranslations("queue.agentShell");

  const { allLeads, closedLeads, buckets, isLoading, mutate } =
    useAgentLeadQueue();
  const [bucket, setBucket] = useState<BucketKey>("a_rappeler");
  const [sub, setSub] = useState<SubKey>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<ViewMode>("list");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "list" || stored === "kanban") setView(stored);
  }, []);

  const switchView = (v: ViewMode) => {
    setView(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    }
  };

  const display = useMemo(() => {
    const source = bucket === "fermees" ? closedLeads : allLeads;
    let filtered = source.filter(
      (l) => bucketForLeadStatus(l.status) === bucket,
    );
    if (bucket === "a_rappeler" && sub !== "all") {
      filtered = filtered.filter((l) =>
        matchesSub(l.status, l.callback_scheduled_at ?? null, sub),
      );
    }
    return filtered;
  }, [bucket, sub, allLeads, closedLeads]);

  const bucketCount: Record<BucketKey, number> = {
    nouveau: buckets?.nouveau ?? 0,
    a_rappeler: buckets
      ? tentativeTotal(buckets) + (buckets.rappel_prevu ?? 0)
      : 0,
    qualifie: buckets?.qualifie ?? 0,
    fermees: buckets?.fermees ?? 0,
  };

  const subDefs: Array<{ key: SubKey; label: string; count: number }> = [
    { key: "all", label: tSub("all"), count: bucketCount.a_rappeler },
    { key: 1, label: tSub("t1"), count: buckets?.tentative_1 ?? 0 },
    { key: 2, label: tSub("t2"), count: buckets?.tentative_2 ?? 0 },
    { key: 3, label: tSub("t3"), count: buckets?.tentative_3 ?? 0 },
    { key: "scheduled", label: tSub("scheduled"), count: buckets?.rappel_prevu ?? 0 },
  ];

  const footerCount = display.length;

  return (
    <div
      className="bg-agent-bg flex flex-col gap-5 px-8 pt-6 pb-16 min-h-screen"
      style={{ fontFamily: "var(--font-cairo)" }}
    >
      {/* Title row — mirrors the queue tab's live-feed header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold text-agent-on-surface leading-tight tracking-tight">
            {t("title")}
          </h1>
          <p className="text-[13px] text-agent-on-surface-variant mt-1">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {/* Segmented status tabs + view toggle + New Lead CTA on the row's trailing edge */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="overflow-x-auto min-w-0 -mx-1 px-1 custom-scrollbar">
          <BucketSegmented
            tabs={TABS}
            active={bucket}
            counts={bucketCount}
            onSelect={(k) => {
              setBucket(k);
              if (k !== "a_rappeler") setSub("all");
            }}
            labelFor={(key) => tBuckets(key)}
          />
        </div>

        <div className="ms-auto inline-flex items-center gap-2 shrink-0">
          <ViewToggle
            view={view}
            onViewChange={switchView}
            kanbanLabel={tViews("kanban")}
            listLabel={tLeads("view.list")}
          />
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 h-10 px-5 rounded-pill bg-agent-primary text-white text-[13.5px] font-bold hover:bg-agent-on-primary-container transition-colors duration-fast"
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
            <span>{tLeads("newLead")}</span>
          </button>
        </div>
      </div>

      {/* Sub-filter chips — only on À rappeler. Visually subordinate to the segmented control. */}
      {bucket === "a_rappeler" && (
        <div className="flex items-center gap-1.5 flex-wrap -mt-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-agent-on-surface-variant me-1">
            {tShell("filterLabel")}
          </span>
          {subDefs.map(({ key, label, count }) => {
            const active = sub === key;
            return (
              <button
                key={String(key)}
                type="button"
                aria-pressed={active}
                aria-label={label}
                onClick={() => setSub(key)}
                className={[
                  "inline-flex items-center gap-1.5 py-1 px-2.5 rounded-pill",
                  "text-[11.5px] font-semibold transition-colors duration-fast",
                  active
                    ? "bg-agent-on-surface/90 text-white"
                    : "bg-transparent text-agent-on-surface-variant hover:bg-agent-surface-high/60 hover:text-agent-on-surface",
                ].join(" ")}
              >
                <span>{label}</span>
                <span className="tabular-nums opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      {view === "kanban" ? (
        <LeadsKanban
          marketId={user.market_id}
          locale={user.locale}
          agentId={user.id}
        />
      ) : isLoading && display.length === 0 ? (
        <div className="text-agent-on-surface-variant text-center py-6">…</div>
      ) : display.length === 0 ? (
        <div className="text-agent-on-surface-variant text-center py-12 px-6 bg-agent-surface border border-agent-outline-variant rounded-xl">
          {t("emptyQueue")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {display.map((l) => {
            const isAttemptOrCallback =
              l.status.startsWith("attempt_") ||
              l.status === "callback_scheduled";
            return (
              <Link
                key={l.id}
                href={`/${user.locale}/leads/${l.id}`}
                className="group block p-4 bg-agent-surface border border-agent-outline-variant rounded-xl no-underline agent-card-hover hover:border-agent-primary/30"
              >
                <div className="flex items-center gap-4">
                  {/* Customer avatar — emerald initials on muted surface */}
                  <div
                    aria-hidden="true"
                    className="shrink-0 flex items-center justify-center w-12 h-12 rounded-full bg-agent-surface-high border border-agent-outline-variant text-agent-primary text-[15px] font-bold"
                  >
                    {getCustomerInitials(l.customer_name)}
                  </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    {/* Name + repeat badge + (attempt etiquette) */}
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[15px] font-bold text-agent-on-surface truncate">
                        {l.customer_name}
                      </span>
                      {l.repeat_kind && l.repeat_kind !== "none" && (
                        <RepeatBuyerBadge
                          source="lead"
                          sourceId={l.id}
                          repeatKind={l.repeat_kind}
                          priorOrderCount={l.prior_order_count ?? 0}
                          priorLeadCount={l.prior_lead_count ?? 0}
                          priorRejectedCount={l.prior_rejected_count ?? 0}
                          currencyCode={displayCurrency}
                          customerPhone={l.customer_phone}
                        />
                      )}
                      {isAttemptOrCallback && (
                        <AttemptEtiquette
                          status={l.status}
                          attemptsCount={0}
                          callbackAt={l.callback_scheduled_at ?? null}
                        />
                      )}
                    </div>
                    {/* Phone · city · source */}
                    <div className="flex items-center gap-2 mt-0.5 text-[12.5px] text-agent-on-surface-variant flex-wrap">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Phone size={11} strokeWidth={2} aria-hidden="true" />
                        {l.customer_phone}
                      </span>
                      {l.customer_city && (
                        <>
                          <span aria-hidden="true" className="opacity-60">·</span>
                          <span className="truncate">{l.customer_city}</span>
                        </>
                      )}
                      <span aria-hidden="true" className="opacity-60">·</span>
                      <span className="truncate">{tSources(l.source)}</span>
                    </div>
                  </div>

                  {/* Trailing: status badge + elapsed time */}
                  <div className="flex flex-col items-end shrink-0 ps-2 gap-1.5">
                    <LeadStatusBadge status={l.status as LeadStatus} />
                    <span className="text-[11.5px] text-agent-on-surface-variant inline-flex items-center gap-1">
                      <Clock size={11} strokeWidth={2} aria-hidden="true" />
                      {formatDateTime(l.created_at, user.locale)}
                    </span>
                  </div>
                </div>

                {/* Optional supporting row — product interest + callback time */}
                {(l.product_interest_note || l.callback_scheduled_at) && (
                  <div className="mt-3 ps-16 flex flex-col gap-1">
                    {l.product_interest_note && (
                      <span className="text-[12.5px] text-agent-on-surface">
                        {l.product_interest_note}
                      </span>
                    )}
                    {l.callback_scheduled_at && (
                      <span className="text-[11.5px] text-agent-on-surface-variant inline-flex items-center gap-1">
                        <Phone size={10} strokeWidth={2} aria-hidden="true" />
                        {formatDateTime(l.callback_scheduled_at, user.locale)}
                      </span>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {view !== "kanban" && footerCount > 0 && (
        <div className="text-[13px] text-agent-on-surface-variant text-end">
          {tLeads("footerCount", { count: footerCount })}
        </div>
      )}

      <NewLeadModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => mutate()}
        defaultMarketId={user.market_id}
        isSuperAdmin={false}
        locale={user.locale}
      />
    </div>
  );
}

function BucketSegmented({
  tabs,
  active,
  counts,
  onSelect,
  labelFor,
}: {
  tabs: TabDef[];
  active: BucketKey;
  counts: Record<BucketKey, number>;
  onSelect: (k: BucketKey) => void;
  labelFor: (
    key: "nouveau" | "toCallBack" | "qualifie" | "fermees",
  ) => string;
}) {
  return (
    <div
      role="tablist"
      aria-label="lead-bucket"
      className="inline-flex items-center gap-1 p-1 bg-agent-surface rounded-2xl border border-agent-outline-variant shadow-[0_1px_2px_rgba(16,24,40,0.02)]"
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const Icon = tab.icon;
        const tone = TAB_TONE[tab.tone];
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            className={[
              "group relative inline-flex items-center gap-2 py-2 px-4 rounded-xl",
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
              className={isActive ? tone.iconActive : "text-agent-on-surface-variant/70"}
            />
            <span>{labelFor(tab.labelKey)}</span>
            <span
              className={[
                "inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-pill tabular-nums text-[11px] font-bold",
                isActive ? `${tone.chipBg} ${tone.chipText}` : "bg-agent-surface-high text-agent-on-surface-variant/80",
              ].join(" ")}
            >
              {counts[tab.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ViewToggle({
  view,
  onViewChange,
  kanbanLabel,
  listLabel,
}: {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  kanbanLabel: string;
  listLabel: string;
}) {
  const items: {
    key: ViewMode;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      key: "list",
      label: listLabel,
      icon: <Rows3 size={13} strokeWidth={2} />,
    },
    {
      key: "kanban",
      label: kanbanLabel,
      icon: <LayoutGrid size={13} strokeWidth={2} />,
    },
  ];
  return (
    <div
      role="tablist"
      aria-label="view-toggle"
      className="inline-flex items-center gap-0.5 p-1 bg-agent-surface rounded-xl border border-agent-outline-variant"
    >
      {items.map((it) => {
        const isActive = view === it.key;
        return (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onViewChange(it.key)}
            title={it.label}
            className={[
              "inline-flex items-center gap-1.5 py-1.5 px-3 rounded-lg",
              "text-[12px] font-semibold transition-colors duration-fast whitespace-nowrap",
              isActive
                ? "bg-agent-surface-high text-agent-on-surface"
                : "bg-transparent text-agent-on-surface-variant hover:text-agent-on-surface",
            ].join(" ")}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
