import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { PresenceHeatmap } from "./PresenceHeatmap";
import { buildPerformanceView } from "@/lib/team/view-models";
import type { TeamPerformance } from "@/lib/team/types";

const messages = {
  team: {
    perf: {
      presence: {
        title: "Présence",
        hint: "heures actives par jour",
        agent: "Agent",
        total: "Total",
        treated: "traitées",
        confirmed: "confirmées",
        absent: "absente",
        days: "{n} j",
        openDay: "{agent} — {day}",
        openAgent: "{agent} — période",
        l0: "0 h", l1: "< 1 h", l2: "1 – 2 h", l3: "2 – 3 h", l4: "3 h +",
      },
    },
  },
};

const PERF: TeamPerformance = {
  from: "2026-08-10",
  to: "2026-08-12",
  tz: "Africa/Tripoli",
  market_id: "m1",
  defaults: { daily_treated: 12, min_rate: 40, conf_per_hour: 3, team_weekly_conf: 150 },
  team: { treated: 30, confirmed: 14, active_minutes: 460, agents_active: 1, agents_total: 1 },
  agents: [
    {
      agent_id: "a1",
      name: "tasnim",
      avatar_url: null,
      last_seen_at: null,
      treated: 30, confirmed: 14, rejected: 16, touches: 90,
      active_minutes: 460, days_active: 3,
      daily: [
        { day: "2026-08-10", active_minutes: 90, treated: 8, confirmed: 3 },
        { day: "2026-08-11", active_minutes: 220, treated: 28, confirmed: 13 },
        { day: "2026-08-12", active_minutes: 150, treated: 12, confirmed: 5 },
      ],
      products: [],
      motifs: [],
      targets: { daily_treated: null, min_rate: null },
    },
  ],
  products: [],
};

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="Africa/Tripoli">
      {ui}
    </NextIntlClientProvider>
  );
}

describe("PresenceHeatmap", () => {
  const onSelectAgent = vi.fn();
  const onSelectDay = vi.fn();
  beforeEach(() => {
    onSelectAgent.mockClear();
    onSelectDay.mockClear();
  });

  function renderGrid() {
    const view = buildPerformanceView(PERF);
    render(
      wrap(
        <PresenceHeatmap
          view={view}
          locale="fr"
          tz="Africa/Tripoli"
          onSelectAgent={onSelectAgent}
          onSelectDay={onSelectDay}
        />,
      ),
    );
    // The row is one agent button followed by one button per day, in order.
    return screen.getAllByRole("button");
  }

  it("reports the day that was actually clicked, not just the agent", () => {
    // The bug this replaces: the handler sat on the <tr>, so every cell in the
    // row reported the same thing and the day was lost.
    const buttons = renderGrid();

    fireEvent.click(buttons[2]);
    expect(onSelectDay).toHaveBeenCalledWith("a1", "2026-08-11");

    fireEvent.click(buttons[3]);
    expect(onSelectDay).toHaveBeenLastCalledWith("a1", "2026-08-12");

    expect(onSelectAgent).not.toHaveBeenCalled();
  });

  it("distinguishes the first day of the period from the last", () => {
    const buttons = renderGrid();
    fireEvent.click(buttons[1]);
    expect(onSelectDay).toHaveBeenCalledWith("a1", "2026-08-10");
  });

  it("keeps the agent name as a separate target for the period overview", () => {
    const buttons = renderGrid();
    fireEvent.click(buttons[0]);
    expect(onSelectAgent).toHaveBeenCalledWith("a1");
    expect(onSelectDay).not.toHaveBeenCalled();
  });

  it("still opens a day with no activity, so absence is inspectable", () => {
    const idle: TeamPerformance = {
      ...PERF,
      agents: [{ ...PERF.agents[0], daily: [{ day: "2026-08-11", active_minutes: 220, treated: 28, confirmed: 13 }] }],
    };
    render(
      wrap(
        <PresenceHeatmap
          view={buildPerformanceView(idle)}
          locale="fr"
          tz="Africa/Tripoli"
          onSelectAgent={onSelectAgent}
          onSelectDay={onSelectDay}
        />,
      ),
    );
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]); // 10 Aug — zero-filled, no activity
    expect(onSelectDay).toHaveBeenCalledWith("a1", "2026-08-10");
  });
});
