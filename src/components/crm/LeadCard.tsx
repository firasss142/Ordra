"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Phone,
  CalendarClock,
  RefreshCw,
  XCircle,
  Flame,
  AlertCircle,
} from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { LeadStatusBadge } from "./LeadStatusBadge";
import type { Lead, LeadStatus } from "@/types/lead";

interface Props {
  lead: Lead;
  locale: string;
  density?: "comfortable" | "compact";
  onCallback: () => void;
  onMarkLost: () => void;
  onReassign: () => void;
}

function attemptsUsed(status: LeadStatus): number {
  if (status === "attempt_1") return 1;
  if (status === "attempt_2") return 2;
  if (status === "attempt_3") return 3;
  return 0;
}

export function LeadCard({ lead, locale, density = "comfortable", onCallback, onMarkLost, onReassign }: Props) {
  const router = useRouter();
  const tSources = useTranslations("crm.leads.sources");
  const tActions = useTranslations("crm.leads.actions");
  const tHot = useTranslations("crm.leads.hotLeads");
  const tDup = useTranslations("crm.leads.duplicates");
  const tLeads = useTranslations("crm.leads");
  const compact = density === "compact";
  const padding = compact ? 10 : 12;
  const status = lead.status as LeadStatus;
  const used = attemptsUsed(status);
  const callbackAt =
    status === "callback_scheduled" && lead.callback_scheduled_at
      ? lead.callback_scheduled_at
      : null;
  const detailHref = `/${locale}/leads/${lead.id}`;
  const openDetail = () => router.push(detailHref);

  return (
    <div style={{ position: "relative" }}>
      <div
        role="link"
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openDetail();
          }
        }}
        style={{
          display: "block",
          textDecoration: "none",
          color: "inherit",
          background: "white",
          border: "1px solid #E1E3E5",
          borderRadius: 10,
          padding,
          cursor: "pointer",
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
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {lead.is_hot && (
              <span
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "1px 6px",
                  borderRadius: 999,
                  color: "#D72C0D",
                  background: "#FFF4F4",
                  border: "1px solid #F0B6B4",
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                <Flame size={10} strokeWidth={2} />
                {tHot("badge")}
              </span>
            )}
            {lead.has_duplicate && (
              <span
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  padding: "1px 6px",
                  borderRadius: 999,
                  color: "#B98900",
                  background: "#FFF8E6",
                  border: "1px solid #F0C060",
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                <AlertCircle size={10} strokeWidth={2} />
                {tDup("badge")}
              </span>
            )}
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
          </div>
          <span
            style={{
              flexShrink: 0,
              fontSize: 11,
              fontWeight: 500,
              color: "#6D7175",
              background: "#F6F6F7",
              border: "1px solid #E1E3E5",
              borderRadius: 999,
              padding: "1px 8px",
              whiteSpace: "nowrap",
            }}
          >
            {tSources(lead.source)}
          </span>
        </div>

        {/* Line 2: phone · city */}
        <div
          style={{
            fontSize: 13,
            color: "#6D7175",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <Phone size={11} strokeWidth={1.75} style={{ opacity: 0.7 }} />
          {lead.customer_phone}
          {lead.customer_city ? ` · ${lead.customer_city}` : ""}
        </div>

        {/* Line 3: callback datetime */}
        {callbackAt && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: "#1A1A1A",
              marginTop: compact ? 4 : 6,
              fontVariantNumeric: "tabular-nums",
              background: "#FFF8E6",
              border: "1px solid #F0C060",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            <CalendarClock size={11} strokeWidth={1.75} />
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
              aria-label={tLeads("attemptsAria", { used, max: 3 })}
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

        {/* Action strip */}
        <div
          style={{
            display: "flex",
            gap: 2,
            alignItems: "center",
            marginTop: compact ? 6 : 8,
            borderTop: "1px solid #F2F2F2",
            paddingTop: compact ? 6 : 8,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <a
            href={`tel:${lead.customer_phone}`}
            draggable={false}
            style={actionLinkStyle}
            title={tActions("callNow")}
            aria-label={tActions("callNow")}
            onClick={(e) => e.stopPropagation()}
          >
            <Phone size={11} strokeWidth={1.75} />
            {tActions("callNow")}
          </a>
          <button
            type="button"
            style={actionBtnStyle}
            title={tActions("scheduleCallback")}
            aria-label={tActions("scheduleCallback")}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCallback(); }}
          >
            <CalendarClock size={11} strokeWidth={1.75} />
            {tActions("scheduleCallback")}
          </button>
          <button
            type="button"
            style={{ ...actionBtnStyle, color: "#D72C0D" }}
            title={tActions("markLostAction")}
            aria-label={tActions("markLostAction")}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkLost(); }}
          >
            <XCircle size={11} strokeWidth={1.75} />
            {tActions("markLostAction")}
          </button>
          <button
            type="button"
            style={actionBtnStyle}
            title={tActions("reassignLead")}
            aria-label={tActions("reassignLead")}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReassign(); }}
          >
            <RefreshCw size={11} strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

const actionBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 500,
  color: "#1A1A1A",
  padding: "4px 6px",
  borderRadius: 6,
  fontFamily: "inherit",
};

const actionLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 11,
  fontWeight: 500,
  color: "#2C6ECB",
  textDecoration: "none",
  padding: "4px 6px",
  borderRadius: 6,
};

/**
 * Returns a functional accent for a card:
 *  - "warning" when a callback is overdue
 *  - "critical" on attempt_3 (last chance)
 *  - "neutral" otherwise
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
