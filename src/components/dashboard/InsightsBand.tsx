"use client";

import { Sparkles, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { Insight, InsightTone } from "@/lib/dashboard/insights";

const TONE_STYLES: Record<InsightTone, { bg: string; fg: string; icon: string }> = {
  positive: { bg: "#E6F4EE", fg: "#0A6A4E", icon: "#008060" },
  negative: { bg: "#FDEDEA", fg: "#A11A06", icon: "#D72C0D" },
  neutral: { bg: "#F1F2F3", fg: "#3D4043", icon: "#6D7175" },
};

const TONE_ICONS: Record<InsightTone, LucideIcon> = {
  positive: TrendingUp,
  negative: TrendingDown,
  neutral: Sparkles,
};

export function InsightsBand({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      {insights.map((insight) => {
        const tone = TONE_STYLES[insight.tone];
        const Icon = TONE_ICONS[insight.tone];
        return (
          <div
            key={insight.key}
            data-tone={insight.tone}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: tone.bg,
              color: tone.fg,
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.2,
            }}
          >
            <Icon size={14} color={tone.icon} strokeWidth={2.25} />
            {insight.text}
          </div>
        );
      })}
    </div>
  );
}
