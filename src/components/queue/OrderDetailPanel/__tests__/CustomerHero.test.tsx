import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { CustomerHero } from "../CustomerHero";

function renderHero(overrides: Partial<React.ComponentProps<typeof CustomerHero>> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <CustomerHero
        name="Nafesa Ton"
        phone="922692547"
        phone2={null}
        terminal={false}
        canEdit
        reliability={{ kind: "ok", delivered: 4 }}
        onCommitName={vi.fn()}
        onCommitPhone={vi.fn()}
        onCommitPhone2={vi.fn()}
        onCopyPhone={vi.fn()}
        phoneCopied={false}
        validatePhone={() => null}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("CustomerHero — the client block (prototype .pc)", () => {
  it("leads with the customer's name as the panel's title, and the number to dial", () => {
    renderHero();
    expect(screen.getByRole("heading", { name: "Nafesa Ton" })).toBeInTheDocument();
    expect(screen.getByText("922692547")).toBeInTheDocument();
  });

  it("calls with the filled button and opens WhatsApp with the outline one beside it", () => {
    const onWhatsApp = vi.fn();
    renderHero({ onWhatsApp, whatsappState: "active" });
    const call = screen.getByRole("link", { name: /Appeler/ });
    expect(call).toHaveAttribute("href", "tel:922692547");
    expect(call).toHaveClass("btn");
    const wa = screen.getByRole("button", { name: /^WhatsApp/ });
    expect(wa).toHaveClass("btn2");
    expect(wa.parentElement).toBe(call.parentElement);
  });

  it("copies the number with a small glyph button", () => {
    const onCopyPhone = vi.fn();
    renderHero({ onCopyPhone });
    const copy = screen.getByRole("button", { name: /Copier le numéro/ });
    expect(copy).toHaveClass("mini");
    fireEvent.click(copy);
    expect(onCopyPhone).toHaveBeenCalled();
  });

  it("drops the call and WhatsApp buttons once the order is terminal", () => {
    renderHero({ terminal: true, onWhatsApp: vi.fn(), whatsappState: "active" });
    expect(screen.queryByRole("link", { name: /Appeler/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^WhatsApp/ })).toBeNull();
  });

  it("offers a second phone as a link while there is none", () => {
    renderHero();
    expect(screen.getByText("Ajouter un 2ᵉ téléphone").closest(".lnk")).not.toBeNull();
  });

  it("shows the second phone with its own call link once there is one", () => {
    renderHero({ phone2: "0911111111" });
    expect(screen.getByText("0911111111")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Appeler 0911111111/ })).toHaveAttribute("href", "tel:0911111111");
  });
});

describe("CustomerHero — reliability chip", () => {
  it("calls a customer with failed deliveries risky, with the count behind it", () => {
    renderHero({ reliability: { kind: "risk", lost: 2, of: 5 } });
    const chip = screen.getByTestId("customer-reliability");
    expect(chip).toHaveTextContent("À risque · 2 sur 5 non livrées");
    expect(chip).toHaveClass("h-red");
  });

  it("calls a customer with deliveries and nothing lost reliable", () => {
    renderHero({ reliability: { kind: "ok", delivered: 1 } });
    const chip = screen.getByTestId("customer-reliability");
    expect(chip).toHaveTextContent("Fiable · 1 livrée");
    expect(chip).toHaveClass("h-green");
  });

  it("says new client when there is no record", () => {
    renderHero({ reliability: { kind: "new" } });
    expect(screen.getByTestId("customer-reliability")).toHaveTextContent("Nouveau client");
  });

  it("shows nothing while the history is still loading", () => {
    renderHero({ reliability: null });
    expect(screen.queryByTestId("customer-reliability")).toBeNull();
  });
});

describe("CustomerHero — WhatsApp states", () => {
  it("connected: the unread count sits on the button", () => {
    renderHero({ onWhatsApp: vi.fn(), whatsappState: "active", whatsappUnread: 2 });
    const btn = screen.getByRole("button", { name: /^WhatsApp/ });
    expect(btn).toHaveAttribute("data-state", "active");
    expect(btn).toHaveTextContent("2");
  });

  it("not connected: still there, muted, and it explains itself", () => {
    const onWhatsApp = vi.fn();
    renderHero({ onWhatsApp, whatsappState: "not_connected" });
    const btn = screen.getByRole("button", { name: /^WhatsApp/ });
    expect(btn).toHaveAttribute("title", "WhatsApp n'est pas connecté pour ce marché");
    fireEvent.click(btn);
    expect(onWhatsApp).toHaveBeenCalled();
  });

  it("opted out: inert, with the reason as its title", () => {
    const onWhatsApp = vi.fn();
    renderHero({ onWhatsApp, whatsappState: "opted_out" });
    const btn = screen.getByRole("button", { name: /^WhatsApp/ });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(btn);
    expect(onWhatsApp).not.toHaveBeenCalled();
  });
});
