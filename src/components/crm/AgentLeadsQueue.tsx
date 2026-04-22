"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Inbox,
  Phone,
  BadgeCheck,
  Archive,
  List,
  Columns,
  type LucideIcon,
} from "lucide-react";
import { useAgentLeadQueue, tentativeTotal } from "@/hooks/useAgentLeadQueue";
import { formatDateTime } from "@/lib/format";
import { LeadStatusBadge } from "./LeadStatusBadge";
import { LeadsKanban } from "./LeadsKanban";
import { NewLeadModal } from "./NewLeadModal";
import { AttemptEtiquette } from "@/components/queue/AttemptEtiquette";
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

  return (
    <div style={{ padding: 24, minHeight: "calc(100vh - 64px)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--text-primary)",
              margin: "0 0 4px 0",
            }}
          >
            {t("title")}
          </h1>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {t("subtitle")}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            role="tablist"
            aria-label={tLeads("view.list")}
            style={{
              display: "inline-flex",
              border: "1px solid var(--border)",
              borderRadius: 6,
              overflow: "hidden",
              height: 36,
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              onClick={() => switchView("list")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "0 12px",
                fontSize: 12,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                background:
                  view === "list" ? "var(--text-primary)" : "var(--bg-card)",
                color: view === "list" ? "#FFFFFF" : "var(--text-primary)",
                transition: "background-color 120ms ease, color 120ms ease",
              }}
            >
              <List size={14} strokeWidth={1.5} aria-hidden="true" />
              <span>{tLeads("view.list")}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "kanban"}
              onClick={() => switchView("kanban")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "0 12px",
                fontSize: 12,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                background:
                  view === "kanban" ? "var(--text-primary)" : "var(--bg-card)",
                color: view === "kanban" ? "#FFFFFF" : "var(--text-primary)",
                transition: "background-color 120ms ease, color 120ms ease",
              }}
            >
              <Columns size={14} strokeWidth={1.5} aria-hidden="true" />
              <span>{tLeads("view.kanban")}</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            style={{
              height: 36,
              padding: "0 14px",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid var(--text-primary)",
              borderRadius: 6,
              background: "var(--text-primary)",
              color: "white",
              cursor: "pointer",
            }}
          >
            + {tLeads("newLead")}
          </button>
        </div>
      </div>

      {view === "kanban" ? (
        <LeadsKanban
          marketId={user.market_id}
          locale={user.locale}
          agentId={user.id}
        />
      ) : (
      <>
      {/* Bucket tabs */}
      <div
        role="tablist"
        aria-label={t("title")}
        style={{
          display: "flex",
          flexWrap: "wrap",
          borderBottom: "1px solid var(--border)",
          marginBottom: 12,
        }}
      >
        {TABS.map((tab) => {
          const active = bucket === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                setBucket(tab.key);
                if (tab.key !== "a_rappeler") setSub("all");
              }}
              style={{
                appearance: "none",
                background: "transparent",
                border: "none",
                padding: "10px 4px",
                marginInlineEnd: 20,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                cursor: "pointer",
                borderBlockEnd: active
                  ? "2px solid var(--text-primary)"
                  : "2px solid transparent",
                transition: "color 120ms ease, border-color 120ms ease",
              }}
            >
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>{tBuckets(tab.labelKey)}</span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {bucketCount[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Sub-filter chips — visible only in À rappeler */}
      {bucket === "a_rappeler" && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          {subDefs.map(({ key, label, count }) => {
            const active = sub === key;
            return (
              <button
                key={String(key)}
                type="button"
                aria-pressed={active}
                aria-current={active ? "true" : undefined}
                aria-label={label}
                onClick={() => setSub(key)}
                style={{
                  appearance: "none",
                  padding: "4px 10px",
                  borderRadius: 9999,
                  border: `1px solid ${
                    active ? "var(--text-primary)" : "var(--border)"
                  }`,
                  background: active ? "var(--text-primary)" : "transparent",
                  color: active ? "#FFFFFF" : "var(--text-primary)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  transition:
                    "background-color 120ms ease, color 120ms ease, border-color 120ms ease",
                }}
              >
                <span>{label}</span>
                <span
                  style={{ fontVariantNumeric: "tabular-nums", opacity: 0.85 }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* List */}
      {isLoading && display.length === 0 ? (
        <div
          style={{
            color: "var(--text-secondary)",
            padding: 24,
            textAlign: "center",
          }}
        >
          …
        </div>
      ) : display.length === 0 ? (
        <div
          style={{
            color: "var(--text-secondary)",
            padding: 48,
            textAlign: "center",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
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
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "var(--text-primary)",
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
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {l.customer_phone}
                  {l.customer_city && ` · ${l.customer_city}`}
                  {" · "}
                  {tSources(l.source)}
                </div>
                {l.product_interest_note && (
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-primary)",
                      marginTop: 4,
                    }}
                  >
                    {l.product_interest_note}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
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
      </>
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
