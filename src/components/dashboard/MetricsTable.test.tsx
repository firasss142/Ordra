import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PeriodSelector, type Period } from "./MetricsTable";

const period: Period = {
  from_date: "2026-04-01",
  to_date: "2026-04-30",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("PeriodSelector", () => {
  it("emits a rolling 7-day period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const onChange = vi.fn();

    render(<PeriodSelector period={period} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "7 derniers jours" }));

    expect(onChange).toHaveBeenCalledWith({
      from_date: "2026-04-28",
      to_date: "2026-05-04",
    });
  });

  it("emits a rolling 30-day period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const onChange = vi.fn();

    render(<PeriodSelector period={period} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "30 derniers jours" }));

    expect(onChange).toHaveBeenCalledWith({
      from_date: "2026-04-05",
      to_date: "2026-05-04",
    });
  });
});
