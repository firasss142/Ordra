"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";
import { LeadStatusBadge } from "./LeadStatusBadge";
import type { Lead, LeadStatus } from "@/types/lead";

interface Props {
  lead: Lead;
  locale: string;
  density?: "comfortable" | "compact";
}

function attemptsUsed(status: LeadStatus): number {
  if (status === "attempt_1") return 1;
  if (status === "attempt_2") return 2;
  if (status === "attempt_3") return 3;
  return 0;
}

export function LeadCard({ lead, locale, density = "comfortable" }: Props) {
  const tSources = useTranslations("crm.leads.sources");
  const compact = density === "compact";
  const padding = compact ? 10 : 12;
  const status = lead.status as LeadStatus;
  const used = attemptsUsed(status);
  const callbackAt =
    status === "callback_scheduled" && lead.callback_scheduled_at
      ? lead.callback_scheduled_at
      : null;

  return (
    <Link
      href={`/${locale}/leads/${lead.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        background: "white",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding,
      }}
    >
      {/* Line 1: name + source pill */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <strong
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "#1A1A1A",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {lead.customer_name}
        </strong>
        <span
          style={{
            flexShrink: 0,
            fontSize: 11,
            fontWeight: 500,
            color: "#6D7175",
            background: "#F6F6F7",
            border: "1px solid #E1E3E5",
            borderRadius: 4,
            padding: "1px 6px",
            whiteSpace: "nowrap",
          }}
        >
          {tSources(lead.source)}
        </span>
      </div>

      {/* Line 2: phone · city */}
      <div style={{ fontSize: 13, color: "#6D7175" }}>
        {lead.customer_phone}
        {lead.customer_city ? ` · ${lead.customer_city}` : ""}
      </div>

      {/* Line 3: callback datetime (only for callback_scheduled) */}
      {callbackAt && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#1A1A1A",
            marginTop: compact ? 4 : 6,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <circle
              cx="5"
              cy="5"
              r="4"
              fill="none"
              stroke="#1A1A1A"
              strokeWidth="1"
            />
            <path d="M5 2.5 V5 L6.5 6" stroke="#1A1A1A" strokeWidth="1" fill="none" strokeLinecap="round" />
          </svg>
          {formatDateTime(callbackAt, locale)}
        </div>
      )}

      {/* Line 4: status badge + attempt dots */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: compact ? 6 : 8,
        }}
      >
        <LeadStatusBadge status={status} />
        {used > 0 && (
          <div
            aria-label={`attempts ${used}/3`}
            style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
          >
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: n <= used ? "#1A1A1A" : "#E1E3E5",
                  display: "inline-block",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

/**
 * Returns a functional accent for a card:
 *  - "warning" when a callback is overdue
 *  - "critical" on attempt_3 (last chance)
 *  - "neutral" otherwise
 *
 * Exported so both LeadsKanban and future agent-queue Kanban use the same rule.
 */
export function leadCardAccent(lead: Lead): "neutral" | "warning" | "critical" {
  const status = lead.status as LeadStatus;
  if (
    status === "callback_scheduled" &&
    lead.callback_scheduled_at &&
    new Date(lead.callback_scheduled_at).getTime() < Date.now()
  ) {
    return "warning";
  }
  if (status === "attempt_3") return "critical";
  return "neutral";
}
