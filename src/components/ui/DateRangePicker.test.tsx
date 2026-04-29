import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { DateRangePicker } from "./DateRangePicker";

const messages = {
  datePicker: {
    placeholder: "Select range",
    presets: {
      today: "Today",
      yesterday: "Yesterday",
      last7days: "Last 7 days",
      last30days: "Last 30 days",
      thisWeek: "This week",
      thisMonth: "This month",
      thisQuarter: "This quarter",
      custom: "Custom",
    },
    apply: "Apply",
    clear: "Clear",
    prevMonth: "Previous month",
    nextMonth: "Next month",
  },
};

function wrap(ui: React.ReactNode, locale: "fr" | "ar" = "fr") {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("DateRangePicker", () => {
  const baseRange = { from: "2026-04-01", to: "2026-04-20" };

  it("renders trigger with formatted range", () => {
    render(
      wrap(
        <DateRangePicker
          value={baseRange}
          activePreset="custom"
          onChange={vi.fn()}
        />,
      ),
    );
    const trigger = screen.getByRole("button");
    expect(trigger.textContent).toMatch(/2026|avr|apr/i);
  });

  it("opens popover with preset rail and calendar on click", () => {
    render(
      wrap(
        <DateRangePicker
          value={baseRange}
          activePreset="custom"
          onChange={vi.fn()}
          presets={["today", "last7days", "last30days", "custom"]}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button", { name: "Today" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Last 7 days" })).toBeDefined();
    expect(screen.getAllByRole("grid").length).toBeGreaterThan(0);
  });

  it("emits today preset range on Today click", () => {
    const onChange = vi.fn();
    render(
      wrap(
        <DateRangePicker
          value={baseRange}
          activePreset="custom"
          onChange={onChange}
          presets={["today", "custom"]}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [range, preset] = onChange.mock.calls[0];
    expect(preset).toBe("today");
    expect(range.from).toBe(range.to);
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("emits last7days range with from = 6 days ago", () => {
    const onChange = vi.fn();
    render(
      wrap(
        <DateRangePicker
          value={baseRange}
          activePreset="custom"
          onChange={onChange}
          presets={["last7days", "custom"]}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [range, preset] = onChange.mock.calls[0];
    expect(preset).toBe("last7days");
    const from = new Date(range.from + "T00:00:00Z");
    const to = new Date(range.to + "T00:00:00Z");
    const diffDays = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(diffDays).toBe(6);
  });

  it("highlights the active preset", () => {
    render(
      wrap(
        <DateRangePicker
          value={baseRange}
          activePreset="last7days"
          onChange={vi.fn()}
          presets={["today", "last7days", "custom"]}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button"));
    const activePreset = screen.getByRole("button", { name: "Last 7 days" });
    expect(activePreset.getAttribute("aria-pressed")).toBe("true");
  });
});
