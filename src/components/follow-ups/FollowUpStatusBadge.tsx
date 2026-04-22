"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FollowUpStatus } from "@/types/follow-up";
import {
  StatusGlyph,
  type StatusGlyphShape,
} from "@/components/shared/StatusGlyph";

const STATUS_SHAPES: Record<FollowUpStatus, StatusGlyphShape> = {
  open: "ring",
  in_progress: "solid",
  resolved: "check",
  escalated: "cross",
};

export function FollowUpStatusBadge({ status }: { status: FollowUpStatus }) {
  const t = useTranslations("crm.followUps.statuses");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 13,
        color: "#1A1A1A",
      }}
    >
      <StatusGlyph shape={STATUS_SHAPES[status]} />
      {t(status)}
    </span>
  );
}
