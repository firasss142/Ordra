import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProductSheetDrawer } from "../ProductSheetDrawer";
import type { ProductSheetPayload } from "@/types/product-sheet";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) => (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(frMessages, ns, key, params),
  };
});

function payload(overrides: Partial<ProductSheetPayload> = {}): ProductSheetPayload {
  return {
    product: {
      id: "p-1",
      name: "Biovera 250ml",
      description: "Huile anti-cellulite naturelle",
      default_price: 49,
      floor_price: null,
      current_stock: 40,
      low_stock_threshold: 10,
      is_active: true,
      agent_brief: "Stock bleu épuisé",
      agent_brief_tone: "warning",
      agent_notes: "Objection prix → pack 2 à 79 TND",
      agent_composition: null,
      agent_contraindications: null,
      agent_usage: null,
      agent_content_updated_at: "2026-08-01T10:00:00Z",
    },
    signals: null,
    cross_sell: null,
    is_cross_sell_view: false,
    raw_product_name: "Biovera 250ml",
    media: [{ id: "m-1", url: "https://cdn/a.png", alt: "Biovera", position: 0 }],
    variants: [
      {
        id: "v-1",
        label: "1 pc",
        quantity: 1,
        display_price: 49,
        is_active: true,
        agent_note: null,
        is_ordered: true,
      },
      {
        id: "v-2",
        label: "Pack 2",
        quantity: 2,
        display_price: 79,
        is_active: true,
        agent_note: "Meilleure marge",
        is_ordered: false,
      },
    ],
    checks: [],
    currency: "TND",
    ...overrides,
  };
}

function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof ProductSheetDrawer>> = {},
) {
  const onClose = vi.fn();
  render(
    <ProductSheetDrawer
      open
      onClose={onClose}
      data={payload()}
      isLoading={false}
      isError={false}
      customerPhone="24850880"
      market="tn"
      locale="fr"
      {...overrides}
    />,
  );
  return { onClose };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ProductSheetDrawer — lifecycle", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ProductSheetDrawer
        open={false}
        onClose={vi.fn()}
        data={payload()}
        isLoading={false}
        isError={false}
        customerPhone="24850880"
        market="tn"
        locale="fr"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("closes on the header button", () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const { onClose } = renderDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows a loading message while fetching", () => {
    renderDrawer({ data: null, isLoading: true });
    expect(screen.getByText("Chargement de la fiche…")).toBeInTheDocument();
  });

  it("shows an error message when the fetch failed", () => {
    renderDrawer({ data: null, isLoading: false, isError: true });
    expect(screen.getByText("Impossible de charger la fiche produit.")).toBeInTheDocument();
  });
});

describe("ProductSheetDrawer — unmapped orders", () => {
  it("explains why there is no product instead of rendering blank", () => {
    renderDrawer({
      data: payload({
        product: null,
        raw_product_name: "Huile mystère",
        media: [],
        variants: [],
        checks: [{ code: "unmapped", severity: "warning" }],
      }),
    });
    expect(screen.getByText("Produit non rattaché au catalogue")).toBeInTheDocument();
    expect(screen.getByText(/Huile mystère/)).toBeInTheDocument();
  });
});

describe("ProductSheetDrawer — content", () => {
  it("separates the customer-facing description from internal notes", () => {
    renderDrawer();
    expect(screen.getByText("Description produit")).toBeInTheDocument();
    expect(screen.getByText("Huile anti-cellulite naturelle")).toBeInTheDocument();
    expect(screen.getByText("Notes internes")).toBeInTheDocument();
    expect(screen.getByText("Objection prix → pack 2 à 79 TND")).toBeInTheDocument();
    // Rendered with a leading "·" separator, hence the partial matcher.
    expect(screen.getByText(/ne pas lire au client/)).toBeInTheDocument();
  });

  it("lists pack tiers with their prices and per-pack notes", () => {
    renderDrawer();
    expect(screen.getByText("Pack 2")).toBeInTheDocument();
    expect(screen.getByText("79")).toBeInTheDocument();
    expect(screen.getByText("Meilleure marge")).toBeInTheDocument();
  });

  it("marks the pack tier this order is actually for", () => {
    renderDrawer();
    expect(screen.getByText("Commandé")).toBeInTheDocument();
  });

  it("renders every verification check, including info level", () => {
    renderDrawer({
      data: payload({
        checks: [
          { code: "out_of_stock", severity: "critical" },
          { code: "low_stock", severity: "info", values: { stock: 2 } },
        ],
      }),
    });
    expect(screen.getByText("Rupture de stock")).toBeInTheDocument();
    expect(screen.getByText("Stock faible — 2 restants")).toBeInTheDocument();
  });

  it("says so plainly when a manager has not filled the sheet in yet", () => {
    renderDrawer({
      data: payload({
        product: { ...payload().product!, description: null, agent_notes: null },
        variants: [],
      }),
    });
    expect(
      screen.getByText("Aucune information n'a encore été ajoutée pour ce produit."),
    ).toBeInTheDocument();
  });

  it("uses the product's own low-stock threshold, not the receipt card's hardcoded 5", () => {
    renderDrawer({
      data: payload({
        product: { ...payload().product!, current_stock: 8, low_stock_threshold: 10 },
      }),
    });
    // orders.detail.stockLeft is "{count} restant" — the receipt card's
    // hardcoded threshold of 5 would have shown "En stock" here instead.
    expect(screen.getByText("8 restant")).toBeInTheDocument();
  });
});

describe("ProductSheetDrawer — computed signals", () => {
  const signals = {
    confirmation: { percent: 80, tone: "success" as const, sample: 105 },
    returns: { percent: 21, tone: "critical" as const, sample: 2057 },
    topRejectionReason: "prix",
    totalOutcomes: 105,
    hasAny: true,
  };

  it("shows both rates and the sample size", () => {
    renderDrawer({ data: payload({ signals }) });
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("21")).toBeInTheDocument();
    expect(screen.getByText("n = 105")).toBeInTheDocument();
  });

  it("translates the top rejection reason via the shared orders namespace", () => {
    renderDrawer({ data: payload({ signals }) });
    expect(screen.getByText("Prix")).toBeInTheDocument();
  });

  it("hides the whole block when every signal was suppressed", () => {
    renderDrawer({
      data: payload({
        signals: {
          confirmation: null,
          returns: null,
          topRejectionReason: null,
          totalOutcomes: 3,
          hasAny: false,
        },
      }),
    });
    expect(screen.queryByText("Signaux")).not.toBeInTheDocument();
  });
});

describe("ProductSheetDrawer — commercial levers", () => {
  it("shows the floor price with its warning", () => {
    renderDrawer({
      data: payload({ product: { ...payload().product!, floor_price: 39 } }),
    });
    expect(screen.getByText("Prix plancher 39 TND")).toBeInTheDocument();
    expect(screen.getByText("Ne pas descendre en dessous sans accord")).toBeInTheDocument();
  });

  it("omits the floor price when none is set", () => {
    renderDrawer();
    expect(screen.queryByText(/Prix plancher/)).not.toBeInTheDocument();
  });
});

describe("ProductSheetDrawer — product facts", () => {
  it("renders composition and usage", () => {
    renderDrawer({
      data: payload({
        product: {
          ...payload().product!,
          agent_composition: "Aloe vera, huile d'argan",
          agent_usage: "Matin et soir sur peau propre",
        },
      }),
    });
    expect(screen.getByText("Aloe vera, huile d'argan")).toBeInTheDocument();
    expect(screen.getByText("Matin et soir sur peau propre")).toBeInTheDocument();
  });

  it("renders contraindications in the critical tone — it is a warning, not prose", () => {
    renderDrawer({
      data: payload({
        product: {
          ...payload().product!,
          agent_contraindications: "Déconseillé aux femmes enceintes",
        },
      }),
    });
    const body = screen.getByText("Déconseillé aux femmes enceintes");
    expect(body.className).toContain("status-critical");
  });

  it("omits a fact section that has not been filled in", () => {
    renderDrawer();
    expect(screen.queryByText("Composition")).not.toBeInTheDocument();
    expect(screen.queryByText("Contre-indications")).not.toBeInTheDocument();
  });
});

describe("ProductSheetDrawer — cross-sell", () => {
  const crossSell = {
    id: "p-alt",
    name: "Biovera Pack Duo",
    image_url: null,
    default_price: 79,
  };

  it("offers the alternative and drills into it", () => {
    const onOpenProduct = vi.fn();
    renderDrawer({ data: payload({ cross_sell: crossSell }), onOpenProduct });
    fireEvent.click(screen.getByRole("button", { name: /Biovera Pack Duo/ }));
    expect(onOpenProduct).toHaveBeenCalledWith("p-alt");
  });

  it("renders nothing when there is no alternative", () => {
    renderDrawer();
    expect(screen.queryByText("Alternative")).not.toBeInTheDocument();
  });

  it("says so when the sheet is showing an alternative, and offers a way back", () => {
    const onOpenProduct = vi.fn();
    renderDrawer({ data: payload({ is_cross_sell_view: true }), onOpenProduct });
    expect(screen.getByText("Vous consultez une alternative")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Revenir au produit commandé/ }));
    expect(onOpenProduct).toHaveBeenCalledWith(null);
  });
});

describe("ProductSheetDrawer — sharing with the customer", () => {
  it("builds a wa.me link with the internationalised customer number", () => {
    renderDrawer();
    const link = screen.getByRole("link", { name: /WhatsApp/i }) as HTMLAnchorElement;
    expect(link.href).toContain("https://wa.me/21624850880");
    expect(link.href).toContain(encodeURIComponent("https://cdn/a.png"));
  });

  it("converts a Libyan local number for the link", () => {
    renderDrawer({ customerPhone: "0912345678", market: "ly" });
    const link = screen.getByRole("link", { name: /WhatsApp/i }) as HTMLAnchorElement;
    expect(link.href).toContain("https://wa.me/218912345678");
  });

  it("hides the WhatsApp button when the number cannot be normalized", () => {
    renderDrawer({ customerPhone: "123" });
    expect(screen.queryByRole("link", { name: /WhatsApp/i })).not.toBeInTheDocument();
  });

  it("copies the image link and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /Copier le lien/i }));
    expect(writeText).toHaveBeenCalledWith("https://cdn/a.png");
    expect(await screen.findByText("Lien copié")).toBeInTheDocument();
  });

  it("does not claim success when the clipboard is denied", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /Copier le lien/i }));
    await Promise.resolve();
    expect(screen.queryByText("Lien copié")).not.toBeInTheDocument();
  });
});
