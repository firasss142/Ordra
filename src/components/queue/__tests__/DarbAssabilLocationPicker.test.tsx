import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "fr",
}));

import {
  DarbAssabilLocationPicker,
  type DarbAssabilSelection,
} from "../DarbAssabilLocationPicker";

function setup(
  value: DarbAssabilSelection,
  restrictToCity?: string,
  onChange = vi.fn(),
) {
  render(
    <DarbAssabilLocationPicker
      value={value}
      onChange={onChange}
      restrictToCity={restrictToCity}
    />,
  );
  return { onChange };
}

const EMPTY: DarbAssabilSelection = { city: null, area: null };

describe("DarbAssabilLocationPicker", () => {
  test("scoped to a city, shows that city's areas and emits a valid pair", () => {
    const { onChange } = setup(EMPTY, "الجفرة");
    // الجفرة has area سوكنة; clicking it emits the city + that area.
    fireEvent.click(screen.getByText("الجفرة — سوكنة"));
    expect(onChange).toHaveBeenCalledWith({ city: "الجفرة", area: "سوكنة" });
  });

  test("scoped picker excludes areas from other cities", () => {
    setup(EMPTY, "الجفرة");
    // عين زارة is a طرابلس area — must not appear when scoped to الجفرة.
    expect(screen.queryByText(/عين زارة/)).not.toBeInTheDocument();
  });

  test("scoped to طرابلس, lets the agent pick a real Tripoli sub-area", () => {
    const { onChange } = setup(EMPTY, "طرابلس");
    fireEvent.click(screen.getByText("طرابلس — عين زارة"));
    expect(onChange).toHaveBeenCalledWith({ city: "طرابلس", area: "عين زارة" });
  });

  test("unscoped, filters the full list by query", () => {
    setup(EMPTY);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "سوكنة" } });
    expect(screen.getByText("الجفرة — سوكنة")).toBeInTheDocument();
    // An unrelated area is filtered out.
    expect(screen.queryByText(/عين زارة/)).not.toBeInTheDocument();
  });

  test("marks the currently selected pair", () => {
    setup({ city: "الجفرة", area: "سوكنة" }, "الجفرة");
    const selected = screen.getByText("الجفرة — سوكنة").closest("button");
    expect(selected).toHaveAttribute("aria-pressed", "true");
  });
});
