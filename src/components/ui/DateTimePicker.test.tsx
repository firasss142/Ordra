import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { DateTimePicker } from "./DateTimePicker";

const messages = {
  datePicker: {
    placeholder: "Pick a date",
    pickTime: "Pick a time",
    clear: "Clear",
    prevMonth: "Previous month",
    nextMonth: "Next month",
    presets: {
      today: "Today",
      custom: "Custom",
    },
  },
};

function wrap(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("DateTimePicker", () => {
  it("renders date trigger and time input", () => {
    render(wrap(<DateTimePicker value={null} onChange={vi.fn()} />));
    // date trigger
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    // native time input
    const time = document.querySelector('input[type="time"]');
    expect(time).not.toBeNull();
  });

  it("emits ISO datetime on time change when date is set", () => {
    const onChange = vi.fn();
    render(
      wrap(
        <DateTimePicker
          value="2026-04-20T10:00:00.000Z"
          onChange={onChange}
        />,
      ),
    );
    const time = document.querySelector('input[type="time"]') as HTMLInputElement;
    fireEvent.change(time, { target: { value: "14:30" } });
    expect(onChange).toHaveBeenCalled();
    const arg = onChange.mock.calls[0][0] as string;
    const parsed = new Date(arg);
    expect(parsed.getHours()).toBe(14);
    expect(parsed.getMinutes()).toBe(30);
    expect(parsed.getDate()).toBe(20);
    expect(parsed.getMonth()).toBe(3);
    expect(parsed.getFullYear()).toBe(2026);
  });

  it("renders preset chips and applies offset", () => {
    const onChange = vi.fn();
    render(
      wrap(
        <DateTimePicker
          value={null}
          onChange={onChange}
          presets={[{ label: "+2h", offsetHours: 2 }]}
        />,
      ),
    );
    const presetBtn = screen.getByRole("button", { name: "+2h" });
    fireEvent.click(presetBtn);
    expect(onChange).toHaveBeenCalledTimes(1);
    const iso = onChange.mock.calls[0][0] as string;
    const t = new Date(iso).getTime();
    const expected = Date.now() + 2 * 3600 * 1000;
    expect(Math.abs(t - expected)).toBeLessThan(5_000);
  });
});
