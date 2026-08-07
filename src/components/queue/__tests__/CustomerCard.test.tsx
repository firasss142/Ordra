import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { CustomerCard } from "../OrderDetailPanel/CustomerCard";

function renderCard(props: Partial<React.ComponentProps<typeof CustomerCard>> = {}) {
  const onCommitDexpressState = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CustomerCard
        address="شهداء عبدالجليل جنزور"
        city="جنزور"
        note={null}
        carrierName="Darb Assabil"
        trackingNumber={null}
        canEdit
        isLibyaOrder
        dexpressStates={[{ id: 1, name: "جنزور" }]}
        loadCities={async () => []}
        onCommitAddress={vi.fn()}
        onCommitCity={vi.fn()}
        onCommitDexpressState={onCommitDexpressState}
        onCommitNote={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onCommitDexpressState };
}

describe("Delivery rows", () => {
  beforeEach(() => vi.clearAllMocks());

  test("names the carrier, which the panel knew but never said", () => {
    renderCard();
    expect(screen.getByText("Darb Assabil")).toBeInTheDocument();
  });

  test("carries the tracking number where the delivery is described", () => {
    renderCard({ trackingNumber: "DA-99120" });
    expect(screen.getByText("DA-99120")).toBeInTheDocument();
  });

  test("an unmatched city reads as a problem, not as an empty dash", () => {
    // A bare "—" is indistinguishable from "not applicable". This city is
    // missing, and that is what blocks the carrier upload.
    renderCard({ city: null });
    expect(screen.getByText(/non définie/i)).toBeInTheDocument();
  });

  test("offers to set a missing city rather than only to change a present one", async () => {
    const user = userEvent.setup();
    renderCard({ city: null });

    await user.click(screen.getByRole("button", { name: /définir/i }));

    expect(screen.getByPlaceholderText(/chercher une ville/i)).toBeInTheDocument();
  });

  test("the blocker's Résoudre has something to aim at", () => {
    // AlertBanners scrolls to [data-field="city"] and clicks the button inside.
    const { container } = render(<div />);
    void container;
    renderCard({ city: null });
    const anchor = document.querySelector('[data-field="city"]');
    expect(anchor).not.toBeNull();
    expect(anchor!.querySelector("button")).not.toBeNull();
  });

  test("offers the city control on Tunisia orders too, not only Libya", async () => {
    // Tunisia rendered a bare combobox with no visible affordance, so a
    // dispatcher had no way to tell the field was editable at all.
    renderCard({ isLibyaOrder: false, city: null });
    expect(screen.getByText(/non définie/i)).toBeInTheDocument();
  });
});
