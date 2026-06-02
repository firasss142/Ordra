import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-intl", () => ({
  // Echo the key's last segment so the search input renders a textbox and
  // labels are present; the test asserts on the Arabic destination data, not labels.
  useTranslations: () => (key: string) => key,
  useLocale: () => "fr",
}));

import {
  DarbAssabilLocationPicker,
  type DarbAssabilSelection,
} from "../DarbAssabilLocationPicker";

function setup(value: DarbAssabilSelection, onChange = vi.fn()) {
  render(<DarbAssabilLocationPicker value={value} onChange={onChange} />);
  return { onChange };
}

const EMPTY: DarbAssabilSelection = { city: null, area: null };

describe("DarbAssabilLocationPicker", () => {
  test("renders the bundled destinations including Tripoli's sub-areas", () => {
    setup(EMPTY);
    // بنغازي (single-area city) and a Tripoli sub-area both appear.
    expect(screen.getByText(/بنغازي/)).toBeInTheDocument();
    expect(screen.getByText(/الرياضية/)).toBeInTheDocument();
  });

  test("selecting a single-area city emits city + area", () => {
    const { onChange } = setup(EMPTY);
    fireEvent.click(screen.getByText(/مصراتة/));
    expect(onChange).toHaveBeenCalledWith({ city: "مصراتة", area: "مصراتة" });
  });

  test("selecting a Tripoli sub-area emits city=طرابلس with that area", () => {
    const { onChange } = setup(EMPTY);
    fireEvent.click(screen.getByText(/زناتة/));
    expect(onChange).toHaveBeenCalledWith({ city: "طرابلس", area: "زناتة" });
  });

  test("filters the list by the search query", () => {
    setup(EMPTY);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "بنغازي" } });
    expect(screen.getByText(/بنغازي/)).toBeInTheDocument();
    expect(screen.queryByText(/مصراتة/)).not.toBeInTheDocument();
  });

  test("marks the currently selected pair", () => {
    setup({ city: "طرابلس", area: "زناتة" });
    const selected = screen.getByText(/زناتة/).closest("button");
    expect(selected).toHaveAttribute("aria-pressed", "true");
  });
});
