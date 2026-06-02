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

  // Helper: the selected option button (the one with aria-pressed="true").
  function selectedRow(): HTMLButtonElement {
    return screen
      .getAllByRole("button")
      .find((b) => b.getAttribute("aria-pressed") === "true") as HTMLButtonElement;
  }
  function aNonSelectedRow(): HTMLButtonElement {
    return screen
      .getAllByRole("button")
      .find(
        (b) => b.getAttribute("aria-pressed") === "false",
      ) as HTMLButtonElement;
  }

  test("marks the currently selected pair", () => {
    setup({ city: "الجفرة", area: "سوكنة" }, "الجفرة");
    expect(selectedRow()).toHaveTextContent("الجفرة — سوكنة");
    expect(selectedRow()).toHaveAttribute("aria-pressed", "true");
  });

  test("selected row is visually distinct from non-selected rows (accent, not just hover gray)", () => {
    setup({ city: "طرابلس", area: "عين زارة" }, "طرابلس");
    const selectedBtn = selectedRow();
    const otherBtn = aNonSelectedRow();
    expect(otherBtn).toBeDefined();
    // The selected row must NOT share the exact class list of a normal row —
    // it carries a distinct accent treatment so it reads as chosen at rest,
    // independent of hover.
    expect(selectedBtn.className).not.toEqual(otherBtn.className);
    // And it carries the accent token (the green selected affordance).
    expect(selectedBtn.className).toMatch(/accent/);
  });

  test("shows a persistent confirmation of the selected destination", () => {
    setup({ city: "طرابلس", area: "عين زارة" }, "طرابلس");
    // A dedicated status region echoes the choice so the agent sees it even
    // after scrolling the list or moving the mouse.
    const confirmation = screen.getByRole("status");
    expect(confirmation).toHaveTextContent("طرابلس");
    expect(confirmation).toHaveTextContent("عين زارة");
  });

  test("renders a checkmark on the selected row only", () => {
    setup({ city: "طرابلس", area: "عين زارة" }, "طرابلس");
    expect(selectedRow().querySelector("svg")).toBeInTheDocument();
    expect(aNonSelectedRow().querySelector("svg")).toBeNull();
  });

  test("no confirmation region when nothing is selected", () => {
    setup(EMPTY, "طرابلس");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
