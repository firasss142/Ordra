"use client";

import { Sparkles, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { Insight, InsightTone } from "@/lib/dashboard/insights";

// White pills — tone survives in the icon only (functional glyph, same
// vocabulary as delta text). Tinted backgrounds are forbidden decoration.
const TONE_ICON_COLOR: Record<InsightTone, string> = {
  positive: "#008060",
  negative: "#D72C0D",
  neutral: "#6D7175",
};

const TONE_ICONS: Record<InsightTone, LucideIcon> = {
  positive: TrendingUp,
  negative: TrendingDown,
  neutral: Sparkles,
};

export function InsightsBand({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {insights.map((insight) => {
        const Icon = TONE_ICONS[insight.tone];
        return (
          <div
            key={insight.key}
            data-tone={insight.tone}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-surface-card border border-line-subtle rounded-pill text-[13px] font-medium text-ink-primary leading-tight"
          >
            <Icon size={14} color={TONE_ICON_COLOR[insight.tone]} strokeWidth={2.25} aria-hidden />
            {insight.text}
          </div>
        );
      })}
    </div>
  );
}
