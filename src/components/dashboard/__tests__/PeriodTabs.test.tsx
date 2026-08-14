import { describe, test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

import { PeriodTabs, presetFor } from "../PeriodTabs";
import { lastNDaysPeriod } from "@/lib/date";

describe("PeriodTabs", () => {
  test("offers the three windows and marks the active one", () => {
    render(<PeriodTabs value={30} onChange={() => {}} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["7j", "30j", "90j"]);
    expect(screen.getByRole("tab", { name: "30j" })).toHaveAttribute("aria-selected", "true");
  });

  test("reports the chosen window in days", async () => {
    const onChange = vi.fn();
    render(<PeriodTabs value={30} onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "90j" }));
    expect(onChange).toHaveBeenCalledWith(90);
  });

  // A custom range must leave every segment dark rather than light a wrong one.
  test("selects nothing when the range came from the calendar", () => {
    render(<PeriodTabs value={null} onChange={() => {}} />);
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-selected", "false");
    }
  });
});

describe("presetFor", () => {
  test("recognises each preset window", () => {
    expect(presetFor(lastNDaysPeriod(7))).toBe(7);
    expect(presetFor(lastNDaysPeriod(30))).toBe(30);
    expect(presetFor(lastNDaysPeriod(90))).toBe(90);
  });

  /**
   * The bug this exists to prevent: the old page shifted to a 30-day window
   * ending in the past while the control still read "30 jours", so every delta
   * compared two historical windows and looked catastrophic. Right length,
   * wrong end date — the segment must stay dark.
   */
  test("refuses a preset-length window that does not end today", () => {
    expect(presetFor({ from_date: "2026-05-01", to_date: "2026-05-30" })).toBeNull();
  });

  test("refuses a length that matches no preset", () => {
    expect(presetFor(lastNDaysPeriod(45))).toBeNull();
  });
});
