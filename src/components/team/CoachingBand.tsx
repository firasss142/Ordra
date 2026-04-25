"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CoachingPrompt } from "@/lib/team/coaching";

interface CoachingItem {
  agentId: string;
  agentName: string;
  prompt: CoachingPrompt;
}

interface CoachingBandProps {
  items: CoachingItem[];
}

const PROMPT_COLOR: Record<NonNullable<CoachingPrompt>, { bg: string; border: string; dot: string }> = {
  schedule_1on1: { bg: "rgba(217,119,6,0.08)", border: "rgba(217,119,6,0.3)", dot: "#D97706" },
  review_rejections: { bg: "rgba(215,44,13,0.06)", border: "rgba(215,44,13,0.25)", dot: "#D72C0D" },
};

export function CoachingBand({ items }: CoachingBandProps) {
  const t = useTranslations("teamPerf.coaching");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = items.filter(
    (item) => item.prompt !== null && !dismissed.has(item.agentId)
  );

  if (visible.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "12px 0",
      }}
    >
      {visible.map((item) => {
        const promptKey = item.prompt as NonNullable<CoachingPrompt>;
        const colors = PROMPT_COLOR[promptKey];
        const label =
          promptKey === "schedule_1on1"
            ? t("schedule1on1", { name: item.agentName })
            : t("reviewRejections", { name: item.agentName });

        return (
          <div
            key={item.agentId}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              fontSize: 13,
              color: "#1A1A1A",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                backgroundColor: colors.dot,
                flexShrink: 0,
              }}
            />
            {label}
            <button
              type="button"
              onClick={() => setDismissed((prev) => new Set([...prev, item.agentId]))}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#6D7175",
                fontSize: 16,
                lineHeight: 1,
                padding: "0 2px",
                marginInlineStart: 2,
              }}
              aria-label={t("dismiss")}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
