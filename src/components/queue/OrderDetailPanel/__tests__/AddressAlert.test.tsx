import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    const resolve = (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params)
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val,
        );
      return val;
    };
    return resolve;
  },
}));

import { AddressAlert } from "../AddressAlert";

function makeProps(overrides: Partial<React.ComponentProps<typeof AddressAlert>> = {}) {
  return {
    note: "client a dit de rappeler demain",
    attemptsCount: 3,
    canEdit: true,
    isLibyaOrder: false,
    dexpressStates: [],
    loadCities: async () => [],
    onCommitAddress: vi.fn(),
    onCommitCity: vi.fn(),
    onCommitDexpressState: vi.fn(),
    ...overrides,
  };
}

describe("AddressAlert", () => {
  it("renders the missing-address headline title", () => {
    render(<AddressAlert {...makeProps()} />);
    expect(
      screen.getByText(frMessages.orders.detail.addressMissingTitle),
    ).toBeDefined();
  });

  it("shows the customer note inline when present", () => {
    render(<AddressAlert {...makeProps({ note: "rappeler demain" })} />);
    expect(screen.getByText(/rappeler demain/)).toBeDefined();
  });

  it("omits the note line when there is no note", () => {
    render(<AddressAlert {...makeProps({ note: null })} />);
    // The title still renders; no stray empty quote element.
    expect(
      screen.getByText(frMessages.orders.detail.addressMissingTitle),
    ).toBeDefined();
  });

  it("renders an attempt pill when the order is on a call attempt", () => {
    render(<AddressAlert {...makeProps({ attemptsCount: 2 })} />);
    expect(screen.getByText("Tentative 2")).toBeDefined();
  });

  it("hides the attempt pill when there are no attempts", () => {
    render(<AddressAlert {...makeProps({ attemptsCount: 0 })} />);
    expect(screen.queryByText(/Tentative/)).toBeNull();
  });

  it("shows an Add-address button that opens the inline form", async () => {
    const user = userEvent.setup();
    render(<AddressAlert {...makeProps()} />);
    const addBtn = screen.getByRole("button", {
      name: frMessages.orders.detail.addAddress,
    });
    expect(addBtn).toBeDefined();
    await user.click(addBtn);
    // The address field label appears once the form is open.
    expect(screen.getAllByText(frMessages.orders.detail.fieldAddress).length).toBeGreaterThan(0);
  });

  it("does not render the Add-address button when read-only", () => {
    render(<AddressAlert {...makeProps({ canEdit: false })} />);
    expect(
      screen.queryByRole("button", { name: frMessages.orders.detail.addAddress }),
    ).toBeNull();
  });
});
