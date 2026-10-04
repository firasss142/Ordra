import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { OrderFacts } from "../OrderFacts";

const DESTINATIONS = [
  { id: 4, city: "طرابلس", area: "جنزور" },
  { id: 5, city: "طرابلس", area: "عين زارة" },
  { id: 6, city: "اجدابيا", area: "اجدابيا" },
];

function renderFacts(overrides: Partial<React.ComponentProps<typeof OrderFacts>> = {}) {
  const props = {
    total: 199,
    currencyCode: "LYD",
    itemCount: 1,
    city: "Tripoli",
    address: "Hay Andalus, rue 9",
    note: null,
    agent: { id: "a1", name: "tasnim" },
    carrierName: "Darb Assabil",
    store: { id: "s1", name: "Bloom", platform: "shopify", accent_color: "#7c3aed" },
    canEdit: true,
    isLibyaOrder: true,
    darbDestinations: DESTINATIONS,
    darbDestinationId: null,
    loadCities: async () => [],
    onCommitAddress: vi.fn(),
    onCommitCity: vi.fn(),
    onCommitDarbDestination: vi.fn(),
    onCommitNote: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrderFacts {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

const valueOf = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;

describe("OrderFacts — label / value lines (prototype .facts)", () => {
  it("states each fact under its own label", () => {
    renderFacts();
    expect(valueOf("Ville")).toHaveTextContent("Tripoli");
    expect(valueOf("Adresse")).toHaveTextContent("Hay Andalus, rue 9");
    expect(valueOf("Agent")).toHaveTextContent("tasnim");
    expect(valueOf("Transporteur")).toHaveTextContent("Darb Assabil");
    expect(valueOf("Boutique")).toHaveTextContent("Bloom");
  });

  it("states the total with two decimals and the article count beside it", () => {
    renderFacts({ total: 199, itemCount: 2 });
    expect(valueOf("Total")).toHaveTextContent("199.00 LYD");
    expect(valueOf("Total")).toHaveTextContent("· 2 articles");
  });

  it("names the store's platform after its name", () => {
    renderFacts();
    expect(valueOf("Boutique")).toHaveTextContent("Shopify");
  });

  it("says the order is unassigned rather than leaving the agent blank", () => {
    renderFacts({ agent: null });
    expect(valueOf("Agent")).toHaveTextContent("Non assignée");
  });

  it("says the order has not left yet rather than leaving the carrier blank", () => {
    renderFacts({ carrierName: null });
    expect(valueOf("Transporteur")).toHaveTextContent("pas encore envoyée");
  });

  it("lets the address resolve its own direction", () => {
    renderFacts({ canEdit: false, address: "شارع النصر" });
    expect(screen.getByText("شارع النصر").closest("[dir=auto]")).not.toBeNull();
  });

  it("falls back to a dash when there is no address and nothing can be done", () => {
    renderFacts({ canEdit: false, address: null });
    expect(valueOf("Adresse")).toHaveTextContent("—");
  });
});

describe("OrderFacts — the city", () => {
  it("flags a missing city and offers to define it in the same line", () => {
    renderFacts({ city: null });
    const city = valueOf("Ville");
    expect(city).toHaveTextContent("Non renseignée");
    expect(city.querySelector(".miss")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Définir la ville" })).toBeInTheDocument();
  });

  it("treats a whitespace-only city as missing", () => {
    renderFacts({ city: "   " });
    expect(valueOf("Ville")).toHaveTextContent("Non renseignée");
  });

  it("reports a missing city without the button when nothing can be done", () => {
    renderFacts({ city: null, canEdit: false });
    expect(valueOf("Ville")).toHaveTextContent("Non renseignée");
    expect(screen.queryByRole("button", { name: "Définir la ville" })).toBeNull();
  });

  it("gives the notice something to aim at", () => {
    renderFacts({ city: null });
    const anchor = document.querySelector('[data-field="city"]');
    expect(anchor?.querySelector("button")).not.toBeNull();
  });

  it("reads a Libya order bound to a Darb pair as city — zone", () => {
    renderFacts({ city: "طرابلس", darbDestinationId: 4 });
    expect(screen.getByText("طرابلس — جنزور")).toBeInTheDocument();
  });

  it("opens the Darb picker from « Changer » and commits the pair id", async () => {
    const user = userEvent.setup();
    const { onCommitDarbDestination } = renderFacts({ city: "طرابلس", darbDestinationId: 4 });
    await user.click(screen.getByRole("button", { name: /changer/i }));
    await user.type(screen.getByPlaceholderText(/chercher une ville/i), "عين");
    await user.click(screen.getByRole("option", { name: /عين زارة/ }));
    expect(onCommitDarbDestination).toHaveBeenCalledWith(5);
  });

  it("offers the city control on Tunisia orders too", () => {
    renderFacts({ isLibyaOrder: false, city: null });
    expect(screen.getByText("Définir la ville")).toBeInTheDocument();
  });

  it("drops every edit affordance in read-only mode", () => {
    renderFacts({ canEdit: false });
    expect(screen.queryByRole("button", { name: /changer/i })).toBeNull();
  });
});

describe("OrderFacts — the note", () => {
  it("keeps the customer's note", () => {
    renderFacts({ note: "Appeler après 18h" });
    expect(valueOf("Note")).toHaveTextContent("Appeler après 18h");
  });

  it("invites a note where one can be added", () => {
    renderFacts({ note: null });
    expect(valueOf("Note")).toHaveTextContent("Ajouter une note…");
  });

  it("leaves the line out when there is no note and nothing can be done", () => {
    renderFacts({ note: null, canEdit: false });
    expect(screen.queryByText("Note", { selector: "dt" })).toBeNull();
  });
});
