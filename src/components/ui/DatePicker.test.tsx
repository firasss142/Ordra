import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { DatePicker } from "./DatePicker";

const messages = {
  datePicker: {
    placeholder: "Pick a date",
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

describe("DatePicker", () => {
  it("shows placeholder when value is null", () => {
    render(wrap(<DatePicker value={null} onChange={vi.fn()} />));
    expect(screen.getByText("Pick a date")).toBeDefined();
  });

  it("shows formatted date when value is set", () => {
    render(wrap(<DatePicker value="2026-04-20" onChange={vi.fn()} />));
    // April 20, 2026 — locale-formatted (fr → "20 avril 2026")
    expect(screen.getByRole("button")).toHaveTextContent(/20/);
    expect(screen.getByRole("button")).toHaveTextContent(/2026/);
  });

  it("opens calendar popover on trigger click", () => {
    render(wrap(<DatePicker value="2026-04-20" onChange={vi.fn()} />));
    fireEvent.click(screen.getByRole("button"));
    // react-day-picker exposes a grid role for the calendar
    expect(screen.getByRole("grid")).toBeDefined();
  });

  it("emits ISO YYYY-MM-DD on day selection", () => {
    const onChange = vi.fn();
    render(wrap(<DatePicker value="2026-04-20" onChange={onChange} />));
    fireEvent.click(screen.getByRole("button"));
    // click day 22 — react-day-picker labels day buttons with their full date label
    const day22 = screen.getByRole("button", { name: /22/ });
    fireEvent.click(day22);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatch(/^2026-04-22$/);
  });

  it("renders RTL when locale is ar", () => {
    const { container } = render(
      wrap(<DatePicker value="2026-04-20" onChange={vi.fn()} />, "ar"),
    );
    fireEvent.click(screen.getByRole("button"));
    // popover panel sets dir on the calendar container
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
