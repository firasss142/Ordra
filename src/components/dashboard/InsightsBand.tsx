"use client";

import type { Insight, InsightTone } from "@/lib/dashboard/insights";

const TONE_STYLES: Record<InsightTone, { bg: string; fg: string; dot: string }> = {
  positive: { bg: "#E6F4EE", fg: "#0A6A4E", dot: "#008060" },
  negative: { bg: "#FDEDEA", fg: "#A11A06", dot: "#D72C0D" },
  neutral: { bg: "#F1F2F3", fg: "#3D4043", dot: "#6D7175" },
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
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: tone.dot,
                flexShrink: 0,
              }}
            />
            {insight.text}
          </div>
        );
      })}
    </div>
  );
}
