import { render, screen } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { AgentDayDetail } from "@/lib/team/types";

/**
 * The drawer's own render. The six figures and the funnel only ever appear
 * after a click on a Présence cell, so nothing in the page's server render
 * exercises them — a throw in here is invisible until a human opens a day.
 * This mounts it directly against a real production-shaped payload.
 */

const DETAIL: AgentDayDetail = {
  day: "2026-08-11",
  tz: "Africa/Tripoli",
  market_id: "m1",
  agent: { agent_id: "a1", name: "tasnim", avatar_url: null },
  targets: { daily_treated: 12, min_rate: 40, conf_per_hour: 3, max_attempts: 8 },
  totals: {
    assigned: 43, calls: 62, attempted: 37, touched: 37, treated: 28,
    confirmed: 13, rejected: 15, active_minutes: 220, uploaded: 7,
    stuck_confirmed: 0, lost_after_confirm: 5,
  },
  hourly: [{ hour: 15, active_minutes: 40, treated: 3, confirmed: 1 }],
  late_hours: { "15": 2 },
  products: [
    { key: "p1", name: "دميه ملاكمه", image_url: "https://cdn.test/boxe.jpg", calls: 34, attempted: 21, touched: 21, treated: 18, confirmed: 9, uploaded: 4 },
    { key: "p2", name: "القرآن", image_url: null, calls: 1, attempted: 1, touched: 1, treated: 0, confirmed: 0, uploaded: 0 },
  ],
  motifs: [
    { reason: "autre", n: 13 },
    { reason: "refus_client", n: 2 },
  ],
  cadence: {
    judged: 20, late: 12, median_gap_min: 200,
    tiers: { ok: 8, late: 10, abandoned: 2 },
    orders: [
      { order_id: "o1", external_id: "X1", product_name: "دميه ملاكمه", status_now: "attempt_3", worst_gap_min: 2827, attempts: [{ n: 3, gap_min: 2827, late: true }] },
    ],
  },
  queue_end_of_day: { open: 9, uploaded: 11, rejected: 15, by_attempts_left: [{ attempts_left: 0, n: 1 }, { attempts_left: 5, n: 8 }] },
  series: [
    { day: "2026-08-10", active_minutes: 90, treated: 8, confirmed: 3, uploaded: 3 },
    { day: "2026-08-11", active_minutes: 220, treated: 28, confirmed: 13, uploaded: 7 },
  ],
};

vi.mock("@/hooks/useAgentDayDetail", () => ({
  useAgentDayDetail: () => ({ detail: DETAIL, error: undefined, isLoading: false }),
  buildAgentDayKey: () => "k",
}));

const { AgentDayDrawer } = await import("./AgentDayDrawer");

/** The real French copy, so a key renamed in the component fails here. */
const fr = (await import("@/messages/fr.json")).default as AbstractIntlMessages;

function open() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr} timeZone="Africa/Tripoli">
      <AgentDayDrawer
        agentId="a1"
        day="2026-08-11"
        onClose={() => {}}
        marketId="m1"
        locale="fr"
        tz="Africa/Tripoli"
      />
    </NextIntlClientProvider>,
  );
}

describe("AgentDayDrawer — the six figures", () => {
  it("renders every metric of the day without throwing", () => {
    open();
    // assigned · calls · processed · uploaded · rejected, each under its label
    for (const label of [/assignées/i, /appels/i, /traitées/i, /téléchargées/i, /rejetées/i]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("43")).toBeInTheDocument();
    expect(screen.getByText("62")).toBeInTheDocument();
  });

  it("counts orders carried to a decision, not merely dialled", () => {
    open();
    // 28 treated (confirmed + rejected) is the headline, not the 37 dialled.
    const figures = screen.getByTestId("day-figures");
    expect(figures).toHaveTextContent("28");
    expect(figures).not.toHaveTextContent("37");
  });

  it("shows the yield against the market target, not the confirmation rate", () => {
    open();
    // 7 uploaded / 28 treated = 25,0 %, target 40 % → −15,0 pt
    expect(screen.getByText("25,0 %")).toBeInTheDocument();
    expect(screen.getByText(/−15,0 pt/)).toBeInTheDocument();
  });

  it("names the orders that were never called", () => {
    open();
    // 43 assigned − 37 attempted = 6
    expect(screen.getByText(/6 jamais appelées/)).toBeInTheDocument();
  });

  it("shows each product with its image, falling back to an icon", () => {
    open();
    const img = screen.getByRole("img", { name: "دميه ملاكمه" });
    expect(img).toHaveAttribute("src", "https://cdn.test/boxe.jpg");
    // the imageless product still gets a row, just no <img>
    expect(screen.getByText("القرآن")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("counts the rejections behind each reason", () => {
    open();
    const motifs = screen.getByTestId("day-motifs");
    // 13 "autre" and 2 "refus_client", each with its own count
    expect(motifs).toHaveTextContent(/13/);
    expect(motifs).toHaveTextContent(/2/);
    expect(motifs).toHaveTextContent(/refus client/i);
  });

  it("keeps the relances drill-down that the queue block used to hold", () => {
    open();
    expect(screen.getByRole("button", { name: /détail des relances/i })).toBeInTheDocument();
  });

  it("never lets a clipped section collapse in the scrolling column", () => {
    // The drawer body is a flex column that scrolls. `overflow-hidden` drops a
    // flex item's automatic minimum size from min-content to 0, so such an item
    // absorbs the whole overflow and flattens to its border — which is exactly
    // how the scoreboard disappeared. jsdom does no layout, so assert the
    // invariant that prevents it instead of the height it would produce.
    const { container } = open();
    const clipped = Array.from(container.querySelectorAll("section")).filter((s) =>
      s.className.includes("overflow-hidden"),
    );
    expect(clipped.length).toBeGreaterThan(0);
    for (const section of clipped) {
      expect(section.className).toContain("shrink-0");
    }
  });

  it("no longer renders the four goal cards it replaced", () => {
    open();
    expect(screen.queryByText(/^Série$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/file d'attente à la fin du jour/i)).not.toBeInTheDocument();
  });
});
