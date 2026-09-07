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

describe("Delivery rows — reading the screen", () => {
  beforeEach(() => vi.clearAllMocks());

  test("splits the destination from what the carrier did, and names both", () => {
    // Five equal rows made the reader work out which values they own and
    // which the carrier writes. Two named groups answer that before the
    // first value is read.
    renderCard();
    expect(screen.getByRole("group", { name: /destination/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /transporteur/i })).toBeInTheDocument();
  });

  test("an empty editable field invites the edit instead of showing a dash", () => {
    // A bare "—" is indistinguishable from "not applicable" (§4.17 G). The
    // address is empty AND fillable, so it must say so.
    renderCard({ address: null });
    const address = screen.getByRole("button", { name: /adresse/i });
    expect(address).toHaveTextContent(/ajouter/i);
    expect(address).not.toHaveTextContent("—");
  });

  test("a value the carrier has not written yet still reads as a dash", () => {
    // Tracking is not editable here: it appears when the upload succeeds.
    // That is genuinely "not yet", and must not pose as a missing input.
    renderCard({ trackingNumber: null });
    const tracking = screen.getByTestId("row-tracking");
    expect(tracking).toHaveTextContent("—");
    expect(tracking.querySelector("button")).toBeNull();
  });

  test("editable values declare themselves at rest with a dotted underline", () => {
    // §4.17 G: a pencil that appears on hover is undiscoverable.
    renderCard({ address: "شارع النصر" });
    const address = screen.getByRole("button", { name: /شارع النصر/ });
    expect(address.className).toMatch(/decoration-dotted/);
  });

  test("read-only mode drops every edit affordance", () => {
    renderCard({ canEdit: false, address: "شارع النصر", note: "fragile" });
    expect(screen.queryByRole("button", { name: /changer/i })).toBeNull();
    const address = screen.getByText("شارع النصر");
    expect(address.className).not.toMatch(/decoration-dotted/);
  });

  test("the missing city keeps its fix next to the problem, not across the panel", () => {
    // "Non définie" amber on the left with "Définir" flush right made the
    // eye cross the whole panel to connect a problem to its remedy.
    renderCard({ city: null });
    const row = document.querySelector('[data-field="city"]')!;
    const warning = screen.getByText(/non définie/i);
    const fix = screen.getByRole("button", { name: /définir/i });
    expect(row.contains(warning)).toBe(true);
    expect(row.contains(fix)).toBe(true);
    // Same flex line: the fix sits beside the warning rather than being
    // pushed to the far edge by an `ms-auto` spacer.
    const line = warning.parentElement!;
    expect(line.contains(fix)).toBe(true);
    expect(line.className).not.toMatch(/ms-auto/);
    expect(fix.closest('[class*="ms-auto"]')).toBeNull();
  });
});
