"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { LeadStatus } from "@/types/lead";
import {
  StatusGlyph,
  type StatusGlyphShape,
} from "@/components/shared/StatusGlyph";

const STATUS_SHAPES: Record<LeadStatus, StatusGlyphShape> = {
  new: "ring",
  assigned: "half",
  attempt_1: "solid",
  attempt_2: "solid",
  attempt_3: "solid",
  callback_scheduled: "ring",
  qualified: "solid",
  won: "check",
  lost: "cross",
  archived: "square",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const t = useTranslations("crm.leads.statuses");
  const isMuted = status === "archived";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color: isMuted ? "#6D7175" : "#1A1A1A",
      }}
    >
      <StatusGlyph
        shape={STATUS_SHAPES[status]}
        tone={isMuted ? "muted" : "default"}
      />
      {t(status)}
    </span>
  );
}
