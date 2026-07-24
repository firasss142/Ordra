import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { PeriodSelector, type Period } from "../PeriodSelector";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    return (key: string) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      return typeof val === "string" ? val : key;
    };
  },
}));

const period: Period = {
  from_date: "2026-04-01",
  to_date: "2026-04-30",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("PeriodSelector", () => {
  it("emits a rolling 7-day period for the last7 preset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const onChange = vi.fn();

    render(<PeriodSelector period={period} onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "7 derniers jours" }));

    expect(onChange).toHaveBeenCalledWith(
      { from_date: "2026-04-28", to_date: "2026-05-04" },
      "last7",
    );
  });

  it("emits a rolling 30-day period for the last30 preset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const onChange = vi.fn();

    render(<PeriodSelector period={period} onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "30 derniers jours" }));

    expect(onChange).toHaveBeenCalledWith(
      { from_date: "2026-04-05", to_date: "2026-05-04" },
      "last30",
    );
  });

  it("emits a single-day yesterday period for the yesterday preset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
    const onChange = vi.fn();

    render(
      <PeriodSelector
        period={period}
        onChange={onChange}
        presets={["yesterday", "last7"]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Hier" }));

    expect(onChange).toHaveBeenCalledWith(
      { from_date: "2026-05-03", to_date: "2026-05-03" },
      "yesterday",
    );
  });

  it("renders the default five tabs without a custom tab", () => {
    render(<PeriodSelector period={period} onChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(screen.queryByRole("tab", { name: "Personnalisé" })).toBeNull();
  });

  it("renders exactly the presets given in order", () => {
    render(
      <PeriodSelector
        period={period}
        onChange={() => {}}
        presets={["today", "last30", "custom"]}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((el) => el.textContent)).toEqual([
      "Aujourd'hui",
      "30 derniers jours",
      "Personnalisé",
    ]);
  });

  it("marks the controlled activePreset as selected", () => {
    render(
      <PeriodSelector
        period={period}
        onChange={() => {}}
        presets={["today", "last7", "last30"]}
        activePreset="last30"
      />,
    );
    expect(
      screen.getByRole("tab", { name: "30 derniers jours" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Aujourd'hui" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("reveals date inputs on custom and emits edited ranges", () => {
    const onChange = vi.fn();
    render(
      <PeriodSelector
        period={period}
        onChange={onChange}
        presets={["today", "custom"]}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Personnalisé" }));
    expect(onChange).toHaveBeenCalledWith(period, "custom");

    const fromInput = screen.getByLabelText(/Du/);
    const toInput = screen.getByLabelText(/Au/);
    expect(fromInput).toBeDefined();
    expect(toInput).toBeDefined();

    fireEvent.change(fromInput, { target: { value: "2026-04-10" } });
    expect(onChange).toHaveBeenCalledWith(
      { from_date: "2026-04-10", to_date: "2026-04-30" },
      "custom",
    );
  });

  it("applies maxDate to the custom to-input", () => {
    render(
      <PeriodSelector
        period={period}
        onChange={() => {}}
        presets={["custom"]}
        activePreset="custom"
        maxDate="2026-05-04"
      />,
    );
    expect(screen.getByLabelText(/Au/)).toHaveAttribute("max", "2026-05-04");
  });
});
