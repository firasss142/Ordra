import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { CustomerCard } from "../OrderDetailPanel/CustomerCard";

const DESTINATIONS = [
  { id: 4, city: "طرابلس", area: "جنزور" },
  { id: 5, city: "طرابلس", area: "عين زارة" },
  { id: 6, city: "اجدابيا", area: "اجدابيا" },
];

function renderCard(props: Partial<React.ComponentProps<typeof CustomerCard>> = {}) {
  const onCommitDarbDestination = vi.fn();
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
        darbDestinations={DESTINATIONS}
        darbDestinationId={null}
        loadCities={async () => []}
        onCommitAddress={vi.fn()}
        onCommitCity={vi.fn()}
        onCommitDarbDestination={onCommitDarbDestination}
        onCommitNote={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onCommitDarbDestination };
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

  test("a Libya order bound to a Darb pair reads as city — zone, not the bare city", () => {
    renderCard({ city: "طرابلس", darbDestinationId: 4 });
    expect(screen.getByText("طرابلس — جنزور")).toBeInTheDocument();
  });

  test("Changer opens the Darb picker and a zone click commits the pair id", async () => {
    const user = userEvent.setup();
    const { onCommitDarbDestination } = renderCard({ city: "طرابلس", darbDestinationId: 4 });

    await user.click(screen.getByRole("button", { name: /changer/i }));
    await user.type(screen.getByPlaceholderText(/chercher une ville/i), "عين");
    await user.click(screen.getByRole("option", { name: /عين زارة/ }));

    expect(onCommitDarbDestination).toHaveBeenCalledWith(5);
  });

  test("offers the city control on Tunisia orders too, not only Libya", async () => {
    // Tunisia rendered a bare combobox with no visible affordance, so a
    // dispatcher had no way to tell the field was editable at all.
    renderCard({ isLibyaOrder: false, city: null });
    expect(screen.getByText(/non définie/i)).toBeInTheDocument();
  });
});
