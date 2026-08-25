import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { OutcomeChart } from "../charts/OutcomeChart";
import { CONFIRMED_COLOR } from "../charts/chartTheme";
import fr from "@/messages/fr.json";
import type { DailyPoint } from "@/lib/dashboard/health";

// recharts measures its container with ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const DATA: DailyPoint[] = [
  {
    day: "2026-08-13",
    delivered: 5,
    returned: 15,
    rejected: 32,
    open: 9,
    intake: 61,
    confirmed: 19,
    revenue: 765,
  },
];

/** "#2C6ECB" → "rgb(44, 110, 203)", the form jsdom reports inline styles in. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function renderChart() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <OutcomeChart data={DATA} locale="fr" currency="LYD" />
    </NextIntlClientProvider>,
  );
}

describe("OutcomeChart legend", () => {
  // The legend keys what is DRAWN. Confirmations are drawn now — as a line over
  // the columns — so the key has to name them, otherwise the reader meets a
  // blue stroke on the plot with nothing telling them what it is.
  test("names confirmations alongside the stacked outcomes", () => {
    renderChart();
    expect(screen.getByText(fr.dashboard.chart.delivered)).toBeInTheDocument();
    expect(screen.getByText(fr.dashboard.chart.confirmedEvents)).toBeInTheDocument();
  });

  // The line's colour and its legend key must be the same value, or the two
  // readings of "confirmed" stop referring to each other. jsdom serialises an
  // inline hex to rgb(), so the expectation is written in that form.
  test("keys confirmations with the same colour the line is drawn in", () => {
    const { container } = renderChart();
    const rgb = hexToRgb(CONFIRMED_COLOR);
    const styles = Array.from(container.querySelectorAll("i[style]")).map(
      (s) => s.getAttribute("style") ?? "",
    );
    expect(styles.some((s) => s.includes(rgb))).toBe(true);
  });
});
