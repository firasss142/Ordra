import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FilterBar, type Period } from "./FilterBar";

const labels = {
  today: "Aujourd'hui",
  week: "7 jours",
  month: "30 jours",
  custom: "Personnalisé",
};

const period: Period = {
  from_date: "2026-04-01",
  to_date: "2026-04-30",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("FilterBar", () => {
  it("emits a rolling 7-day period for the week preset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const onPeriodChange = vi.fn();

    render(
      <FilterBar
        period={period}
        activePreset="custom"
        onPeriodChange={onPeriodChange}
        labels={labels}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "7 jours" }));

    expect(onPeriodChange).toHaveBeenCalledWith(
      { from_date: "2026-04-28", to_date: "2026-05-04" },
      "week",
    );
  });

  it("emits a rolling 30-day period for the month preset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const onPeriodChange = vi.fn();

    render(
      <FilterBar
        period={period}
        activePreset="custom"
        onPeriodChange={onPeriodChange}
        labels={labels}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "30 jours" }));

    expect(onPeriodChange).toHaveBeenCalledWith(
      { from_date: "2026-04-05", to_date: "2026-05-04" },
      "month",
    );
  });
});
