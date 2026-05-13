import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { CallbackPicker } from "../CallbackPicker";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CallbackPicker", () => {
  it("renders date and time inputs", () => {
    render(<CallbackPicker onSelect={vi.fn()} />);
    const dateInput = document.querySelector('input[type="date"]');
    const timeInput = document.querySelector('input[type="time"]');
    expect(dateInput).not.toBeNull();
    expect(timeInput).not.toBeNull();
  });

  it("renders the localized title and Date/Heure labels", () => {
    render(<CallbackPicker onSelect={vi.fn()} />);
    expect(screen.getByText("Programmer un rappel")).toBeDefined();
    expect(screen.getByText("Date")).toBeDefined();
    expect(screen.getByText("Heure")).toBeDefined();
  });

  it("pre-fills inputs when defaultValue is provided", () => {
    const defaultDate = new Date("2026-04-20T14:30:00.000Z");
    render(<CallbackPicker onSelect={vi.fn()} defaultValue={defaultDate} />);

    const dateInputs = document.querySelectorAll('input[type="date"]');
    const timeInputs = document.querySelectorAll('input[type="time"]');

    expect(dateInputs.length).toBeGreaterThan(0);
    expect(timeInputs.length).toBeGreaterThan(0);

    // date input should have some value
    expect((dateInputs[0] as HTMLInputElement).value).not.toBe("");
  });

  it("does not call onSelect when only date is filled", () => {
    const onSelect = vi.fn();
    render(<CallbackPicker onSelect={onSelect} />);
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-04-20" } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("calls onSelect with a Date when both date and time are filled", () => {
    const onSelect = vi.fn();
    render(<CallbackPicker onSelect={onSelect} />);

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;

    // Use a date 30 days in the future so it passes the must-be-future validation.
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const futureDate = future.toISOString().slice(0, 10);

    fireEvent.change(dateInput, { target: { value: futureDate } });
    fireEvent.change(timeInput, { target: { value: "14:30" } });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it("date input has min attribute set to today", () => {
    render(<CallbackPicker onSelect={vi.fn()} />);
    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    const today = new Date().toISOString().slice(0, 10);
    expect(dateInput.min).toBe(today);
  });
});
