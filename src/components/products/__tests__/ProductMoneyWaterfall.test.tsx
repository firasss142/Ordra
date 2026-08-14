import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductMoneyWaterfall } from "../ProductMoneyWaterfall";

const SHEET = vi.hoisted(() => ({
  money: {
    waterfall: {
      revenue: "Chiffre d'affaires",
      cogs: "COGS",
      delivery: "Livraison",
      returns: "Retours",
      packing: "Emballage",
      processing: "Traitement",
      ads: "Publicité",
      netProfit: "Profit net",
      note: "Le CA ne compte que les {count} commandes livrées. Les barres se soustraient exactement au profit net, sans arrondi intermédiaire.",
      zeroNote:
        "{posts} valent {value} sur ce produit — les postes à zéro ne sont pas tracés, mais ils sont bien dans le calcul.",
      chartLabel: "Cascade du chiffre d'affaires au profit net",
    },
  },
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const fr = (await import("@/messages/fr.json")).default as Record<string, unknown>;
  const messages = {
    ...fr,
    products: { ...(fr.products as Record<string, unknown>), sheet: SHEET },
  };
  return {
    useTranslations:
      (ns: string) => (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

type Props = React.ComponentProps<typeof ProductMoneyWaterfall>;

/** Formateurs injectés — le composant ne formate jamais l'argent lui-même. */
const money = (n: number) => `${n} DT`;
const signedMoney = (n: number) =>
  `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} DT`;

function renderWaterfall(overrides: Partial<Props> = {}) {
  const defaults: Props = {
    revenue: 5142,
    costs: [
      { key: "cogs", value: 1000 },
      { key: "delivery", value: 500 },
      { key: "returns", value: 142 },
      { key: "packing", value: 0 },
      { key: "processing", value: 0 },
      { key: "ads", value: 0 },
    ],
    netProfit: 3500,
    deliveredCount: 108,
    formatMoney: money,
    formatSignedMoney: signedMoney,
  };
  return render(<ProductMoneyWaterfall {...defaults} {...overrides} />);
}

describe("ProductMoneyWaterfall", () => {
  it("trace une colonne par poste non nul, encadrée par le CA et le profit net", () => {
    renderWaterfall();
    const axis = screen.getByRole("list", { name: /Cascade/ });
    const labels = Array.from(axis.querySelectorAll("li")).map((n) =>
      (n.textContent ?? "").trim(),
    );
    expect(labels[0]).toContain("Chiffre d'affaires");
    expect(labels).toHaveLength(5);
    expect(labels[labels.length - 1]).toContain("Profit net");
  });

  it("ne trace pas les postes à zéro mais les nomme sous le graphique", () => {
    renderWaterfall();
    const axis = screen.getByRole("list", { name: /Cascade/ });
    const axisText = axis.textContent ?? "";
    expect(axisText).not.toContain("Emballage");
    expect(axisText).not.toContain("Traitement");
    expect(axisText).not.toContain("Publicité");

    const note = screen.getByText(/postes à zéro ne sont pas tracés/);
    expect(note.textContent).toContain("Emballage");
    expect(note.textContent).toContain("Traitement");
    expect(note.textContent).toContain("Publicité");
    expect(note.textContent).toContain("0 DT");
  });

  it("omet la mention des postes à zéro quand tous les postes sont mouvementés", () => {
    renderWaterfall({
      costs: [
        { key: "cogs", value: 1000 },
        { key: "delivery", value: 500 },
        { key: "returns", value: 142 },
        { key: "packing", value: 10 },
        { key: "processing", value: 5 },
        { key: "ads", value: 20 },
      ],
    });
    expect(screen.queryByText(/postes à zéro ne sont pas tracés/)).toBeNull();
  });

  it("referme la cascade sur le profit net du serveur, sans le recalculer", () => {
    // revenue − coûts = 3500, mais le serveur renvoie 3200 (il connaît des
    // postes que la cascade ne trace pas). C'est 3200 qui doit s'afficher.
    renderWaterfall({ netProfit: 3200 });
    expect(screen.getByText("+3200 DT")).toBeInTheDocument();
    expect(screen.queryByText("+3500 DT")).toBeNull();
  });

  it("affiche une perte avec le signe moins typographique", () => {
    renderWaterfall({ netProfit: -420 });
    expect(screen.getByText("−420 DT")).toBeInTheDocument();
  });

  it("rappelle le nombre de commandes livrées sous le graphique", () => {
    renderWaterfall({ deliveredCount: 108 });
    expect(screen.getByText(/108 commandes livrées/)).toBeInTheDocument();
  });

  it("ne produit ni NaN ni Infinity quand tout vaut zéro", () => {
    const { container } = renderWaterfall({
      revenue: 0,
      netProfit: 0,
      deliveredCount: 0,
      costs: [
        { key: "cogs", value: 0 },
        { key: "delivery", value: 0 },
        { key: "returns", value: 0 },
        { key: "packing", value: 0 },
        { key: "processing", value: 0 },
        { key: "ads", value: 0 },
      ],
    });
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
