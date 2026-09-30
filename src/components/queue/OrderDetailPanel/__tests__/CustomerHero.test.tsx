import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomerHero } from "../CustomerHero";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

function renderHero(overrides: Partial<React.ComponentProps<typeof CustomerHero>> = {}) {
  return render(
    <CustomerHero
      name="Nafesa Ton"
      phone="922692547"
      phone2={null}
      terminal={false}
      canEdit
      isLibyaOrder
      reliability={{ total_orders: 12, delivered_count: 11, returned_count: 1 }}
      onCommitName={vi.fn()}
      onCommitPhone={vi.fn()}
      onCommitPhone2={vi.fn()}
      onCopyPhone={vi.fn()}
      phoneCopied={false}
      validatePhone={() => null}
      {...overrides}
    />,
  );
}

describe("CustomerHero — reliability strip", () => {
  it("states the verdict in one word and backs it with the three figures", () => {
    renderHero();

    const strip = screen.getByTestId("customer-reliability");
    expect(strip).toHaveTextContent("Fiable");
    expect(strip).toHaveTextContent("12");
    expect(strip).toHaveTextContent("11");
    expect(strip).toHaveTextContent("1");
  });

  it("spells the whole reading out for screen readers, since the glyphs carry it visually", () => {
    renderHero();

    expect(screen.getByTestId("customer-reliability")).toHaveAccessibleName(
      /12 commandes, 11 livrées, 1 retour/,
    );
  });

  it("calls a poor delivery record risky", () => {
    renderHero({
      reliability: { total_orders: 10, delivered_count: 4, returned_count: 6 },
    });

    expect(screen.getByTestId("customer-reliability")).toHaveTextContent("À risque");
  });

  it("calls a middling record average", () => {
    renderHero({
      reliability: { total_orders: 12, delivered_count: 9, returned_count: 3 },
    });

    expect(screen.getByTestId("customer-reliability")).toHaveTextContent("Moyen");
  });

  it("says new rather than passing judgement on a thin record", () => {
    renderHero({
      reliability: { total_orders: 2, delivered_count: 2, returned_count: 0 },
    });

    expect(screen.getByTestId("customer-reliability")).toHaveTextContent("Nouveau");
  });

  it("shows nothing at all while the history is still loading", () => {
    renderHero({ reliability: null });

    expect(screen.queryByTestId("customer-reliability")).not.toBeInTheDocument();
  });

  it("shows nothing for a customer with no orders on record", () => {
    renderHero({
      reliability: { total_orders: 0, delivered_count: 0, returned_count: 0 },
    });

    expect(screen.queryByTestId("customer-reliability")).not.toBeInTheDocument();
  });
});

describe("CustomerHero — identity", () => {
  it("leads with the customer name and the number to dial", () => {
    renderHero();

    expect(screen.getByText("Nafesa Ton")).toBeInTheDocument();
    expect(screen.getByText("922692547")).toBeInTheDocument();
  });

  it("offers the call action on a live order", () => {
    renderHero();

    expect(screen.getByRole("link", { name: /Appeler/ })).toHaveAttribute(
      "href",
      "tel:922692547",
    );
  });

  it("makes calling the one filled control on the block", () => {
    renderHero();
    // Four controls used to sit at the same 30px weight — call, copy, call the
    // second number, and the name itself. The capture ranks them: one green
    // button, everything else a glyph.
    expect(screen.getByRole("link", { name: /Appeler/ }).className).toContain("bg-brand");
  });

  it("keeps copying the number a glyph, not a button that competes with calling", () => {
    renderHero();
    const copy = screen.getByRole("button", { name: /Copier/ });
    expect(copy.className).not.toContain("border");
  });

  it("drops the call action once the order is terminal", () => {
    renderHero({ terminal: true });

    expect(screen.queryByRole("link", { name: /Appeler/ })).not.toBeInTheDocument();
  });

  // The hero no longer takes a city or an address at all: destination moved to
  // the facts grid, where OrderFacts.test.tsx owns its behaviour. Re-adding it
  // here would mean re-adding the props, which is the regression this absence
  // guards against.
});

describe("CustomerHero — WhatsApp (prototype whatsapp-agent-v1.html, hero)", () => {
  it("connected: a green outline button beside the call CTA, with the unread count on its corner", () => {
    const onWhatsApp = vi.fn();
    renderHero({ onWhatsApp, whatsappState: "active", whatsappUnread: 2 });
    const btn = screen.getByRole("button", { name: /^WhatsApp/ });
    expect(btn).toHaveAttribute("data-state", "active");
    expect(btn).toHaveTextContent("2");
    expect(btn.querySelector('[data-icon="whatsapp"]')).not.toBeNull();
    btn.click();
    expect(onWhatsApp).toHaveBeenCalled();
    // The call CTA is still the primary one, right beside it.
    expect(screen.getByRole("link", { name: /Appeler/ })).toBeInTheDocument();
  });

  it("not connected: still there, muted, and it explains itself (owner decision: show it disabled)", () => {
    const onWhatsApp = vi.fn();
    renderHero({ onWhatsApp, whatsappState: "not_connected" });
    const btn = screen.getByRole("button", { name: /^WhatsApp/ });
    expect(btn).toHaveAttribute("data-state", "not_connected");
    expect(btn).toHaveAttribute("title", "WhatsApp n'est pas connecté pour ce marché");
    btn.click();
    expect(onWhatsApp).toHaveBeenCalled();
  });

  it("opted out: greyed and inert, with the reason as its title", () => {
    const onWhatsApp = vi.fn();
    renderHero({ onWhatsApp, whatsappState: "opted_out" });
    const btn = screen.getByRole("button", { name: /^WhatsApp/ });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAttribute("title", "Ce client a demandé à ne plus recevoir de messages");
    btn.click();
    expect(onWhatsApp).not.toHaveBeenCalled();
  });

  it("hides both actions on a terminal order", () => {
    renderHero({ terminal: true, onWhatsApp: vi.fn(), whatsappState: "active" });
    expect(screen.queryByRole("button", { name: /^WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Appeler/ })).not.toBeInTheDocument();
  });
});
