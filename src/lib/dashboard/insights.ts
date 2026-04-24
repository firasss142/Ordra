import type { DashboardSummary } from "./summary";

export type InsightTone = "positive" | "negative" | "neutral";

export interface Insight {
  key: string;
  text: string;
  tone: InsightTone;
}

export interface InsightLabels {
  confAboveAvg: string;
  confBelowAvg: string;
  topProduct: string;
  leadingAgent: string;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export function computeInsights(summary: DashboardSummary, labels: InsightLabels): Insight[] {
  const insights: Insight[] = [];

  const last7 = summary.trend.slice(-7);
  if (last7.length >= 7) {
    const avg = last7.reduce((s, p) => s + p.confRate, 0) / 7;
    const diff = summary.kpis.confirmationRate.current - avg;
    if (Math.abs(diff) >= 1) {
      const absDiff = Math.abs(diff).toFixed(1);
      const tone: InsightTone = diff > 0 ? "positive" : "negative";
      const template = diff > 0 ? labels.confAboveAvg : labels.confBelowAvg;
      insights.push({
        key: "conf_vs_avg",
        text: interpolate(template, { diff: absDiff }),
        tone,
      });
    }
  }

  const topProduct = summary.topProducts[0];
  if (topProduct) {
    insights.push({
      key: "top_product",
      text: interpolate(labels.topProduct, {
        name: topProduct.product_name,
        count: topProduct.delivered_count,
      }),
      tone: "neutral",
    });
  }

  // Insight 3: leading agent (min 5 actioned today to filter noise)
  const eligibleAgents = summary.presence
    .filter((a) => a.actioned_today >= 5)
    .sort((a, b) => {
      if (b.confirmation_rate !== a.confirmation_rate) return b.confirmation_rate - a.confirmation_rate;
      return b.confirmed_today - a.confirmed_today;
    });
  const leader = eligibleAgents[0];
  if (leader) {
    insights.push({
      key: "leading_agent",
      text: interpolate(labels.leadingAgent, {
        name: leader.full_name,
        rate: leader.confirmation_rate.toFixed(1),
      }),
      tone: "positive",
    });
  }

  return insights.slice(0, 3);
}
