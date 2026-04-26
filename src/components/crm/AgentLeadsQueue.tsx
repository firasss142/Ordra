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
  type LucideIcon,
} from "lucide-react";
import { useAgentLeadQueue, tentativeTotal } from "@/hooks/useAgentLeadQueue";
import { formatDateTime } from "@/lib/format";
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
}

const TABS: TabDef[] = [
  { key: "nouveau", icon: Inbox, labelKey: "nouveau" },
  { key: "a_rappeler", icon: Phone, labelKey: "toCallBack" },
  { key: "qualifie", icon: BadgeCheck, labelKey: "qualifie" },
  { key: "fermees", icon: Archive, labelKey: "fermees" },
];

const CARD_BG = "#FFFFFF";
const SOFT_BG = "#FFFFFF";
const BORDER = "#E1E3E5";
const SUBTLE_BG = "#F6F6F7";
const TEXT = "#1A1A1A";
const MUTED = "#6D7175";

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

export function AgentLeadsQueue({ user }: Props) {
  const t = useTranslations("crm.queue");
  const tBuckets = useTranslations("crm.queue.buckets");
  const tSub = useTranslations("crm.queue.buckets.subfilter");
  const tLeads = useTranslations("crm.leads");
  const tViews = useTranslations("crm.leads.views");
  const tSources = useTranslations("crm.leads.sources");

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
      className="px-4 pt-16 pb-16 md:px-8 md:pt-8"
      style={{
        background: SUBTLE_BG,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: TEXT, margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: MUTED, margin: "4px 0 0" }}>
          {t("subtitle")}
        </p>
      </div>

      {/* Filter card — mirrors manager LeadsFilterBar */}
      <div
        style={{
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* Top row: bucket tabs (left) + view toggle + new lead (right) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              minWidth: 0,
              flex: "1 1 auto",
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
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

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <ViewToggle
              view={view}
              onViewChange={switchView}
              kanbanLabel={tViews("kanban")}
              listLabel={tLeads("view.list")}
            />
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 34,
                padding: "0 14px",
                fontSize: 13,
                fontWeight: 500,
                border: `1px solid ${TEXT}`,
                borderRadius: 8,
                background: TEXT,
                color: "#FFFFFF",
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              <Plus size={14} strokeWidth={2} />
              {tLeads("newLead")}
            </button>
          </div>
        </div>

        {/* Sub-filter chips — only on À rappeler */}
        {bucket === "a_rappeler" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {subDefs.map(({ key, label, count }) => {
              const active = sub === key;
              return (
                <button
                  key={String(key)}
                  type="button"
                  aria-pressed={active}
                  aria-label={label}
                  onClick={() => setSub(key)}
                  style={{
                    appearance: "none",
                    height: 28,
                    padding: "0 10px",
                    borderRadius: 6,
                    border: `1px solid ${active ? TEXT : BORDER}`,
                    background: active ? TEXT : SOFT_BG,
                    color: active ? "#FFFFFF" : TEXT,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "inherit",
                    transition:
                      "background-color 120ms ease, color 120ms ease, border-color 120ms ease",
                  }}
                >
                  <span>{label}</span>
                  <span
                    style={{
                      fontVariantNumeric: "tabular-nums",
                      opacity: 0.85,
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Body */}
      {view === "kanban" ? (
        <LeadsKanban
          marketId={user.market_id}
          locale={user.locale}
          agentId={user.id}
        />
      ) : isLoading && display.length === 0 ? (
        <div
          style={{
            color: MUTED,
            padding: 24,
            textAlign: "center",
          }}
        >
          …
        </div>
      ) : display.length === 0 ? (
        <div
          style={{
            color: MUTED,
            padding: 48,
            textAlign: "center",
            background: CARD_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
          }}
        >
          {t("emptyQueue")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {display.map((l) => {
            const isAttemptOrCallback =
              l.status.startsWith("attempt_") ||
              l.status === "callback_scheduled";
            return (
              <Link
                key={l.id}
                href={`/${user.locale}/leads/${l.id}`}
                style={{
                  display: "block",
                  padding: 16,
                  background: CARD_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  textDecoration: "none",
                  color: TEXT,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {l.customer_name}
                    </div>
                    {l.repeat_kind && l.repeat_kind !== "none" && (
                      <RepeatBuyerBadge
                        source="lead"
                        sourceId={l.id}
                        repeatKind={l.repeat_kind}
                        priorOrderCount={l.prior_order_count ?? 0}
                        priorLeadCount={l.prior_lead_count ?? 0}
                        priorRejectedCount={l.prior_rejected_count ?? 0}
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
                  <LeadStatusBadge status={l.status as LeadStatus} />
                </div>
                <div style={{ fontSize: 13, color: MUTED }}>
                  {l.customer_phone}
                  {l.customer_city && ` · ${l.customer_city}`}
                  {" · "}
                  {tSources(l.source)}
                </div>
                {l.product_interest_note && (
                  <div
                    style={{
                      fontSize: 13,
                      color: TEXT,
                      marginTop: 4,
                    }}
                  >
                    {l.product_interest_note}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 12,
                    color: MUTED,
                    marginTop: 4,
                  }}
                >
                  {formatDateTime(l.created_at, user.locale)}
                  {l.callback_scheduled_at &&
                    ` · ${formatDateTime(l.callback_scheduled_at, user.locale)}`}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {view !== "kanban" && footerCount > 0 && (
        <div style={{ fontSize: 13, color: MUTED, textAlign: "end" }}>
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
      style={{
        display: "inline-flex",
        background: SUBTLE_BG,
        borderRadius: 8,
        padding: 2,
        gap: 2,
        border: `1px solid ${BORDER}`,
      }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const Icon = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              border: "none",
              borderRadius: 6,
              background: isActive ? "#FFFFFF" : "transparent",
              color: isActive ? TEXT : MUTED,
              fontSize: 13,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              fontFamily: "inherit",
              transition: "color 120ms ease, background-color 120ms ease",
            }}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{labelFor(tab.labelKey)}</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                color: "inherit",
                opacity: isActive ? 1 : 0.7,
                fontVariantNumeric: "tabular-nums",
              }}
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
      icon: <Rows3 size={13} strokeWidth={1.75} />,
    },
    {
      key: "kanban",
      label: kanbanLabel,
      icon: <LayoutGrid size={13} strokeWidth={1.75} />,
    },
  ];
  return (
    <div
      style={{
        display: "inline-flex",
        background: SUBTLE_BG,
        borderRadius: 8,
        padding: 2,
        gap: 2,
        border: `1px solid ${BORDER}`,
      }}
    >
      {items.map((it) => {
        const isActive = view === it.key;
        return (
          <button
            key={it.key}
            type="button"
            aria-selected={isActive}
            onClick={() => onViewChange(it.key)}
            title={it.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 10px",
              border: "none",
              borderRadius: 6,
              background: isActive ? "#FFFFFF" : "transparent",
              color: TEXT,
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
              fontFamily: "inherit",
            }}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
