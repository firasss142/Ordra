import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductFunnelChevrons } from "../ProductFunnelChevrons";

/* ─────────────────────────────────────────────────────────────────────────────
   Les clés products.sheet.* n'existent pas encore dans src/messages/*.json —
   un agent dédié fusionne les fichiers de messages en fin de chantier. Le
   fixture ci-dessous EST la table remontée dans i18nKeys : le test échoue donc
   si une clé est renommée sans être remontée.
   ────────────────────────────────────────────────────────────────────────── */
const SHEET = vi.hoisted(() => ({
  funnel: {
    title: "Entonnoir",
    leads: "Commandes",
    leadsSub: "reçues de la boutique",
    treated: "Traitées",
    treatedSub: "un agent a posé une action",
    confirmed: "Confirmées",
    confirmedSub: "{value} des commandes",
    uploaded: "Uploadées",
    uploadedSub: "{count} encore en cours",
    delivered: "Livrées",
    deliveredSub: "{rate} des {count} uploadées",
    shareOfOrders: "{value} des commandes",
    unavailable: "donnée indisponible",
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

type Props = React.ComponentProps<typeof ProductFunnelChevrons>;

function renderFunnel(overrides: Partial<Props> = {}) {
  const defaults: Props = {
    leads: 866,
    treated: 770,
    confirmed: 453,
    uploaded: 431,
    delivered: 108,
    inFlight: 229,
    confirmationRate: 52.3,
    deliveryRate: 25.1,
  };
  return render(<ProductFunnelChevrons {...defaults} {...overrides} />);
}

describe("ProductFunnelChevrons", () => {
  it("rend les cinq étapes de l'entonnoir", () => {
    renderFunnel();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    for (const label of ["Commandes", "Traitées", "Confirmées", "Uploadées", "Livrées"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("porte le nombre encore en vol sous l'étape Uploadées", () => {
    renderFunnel({ inFlight: 229 });
    const uploaded = screen.getAllByRole("listitem")[3];
    expect(uploaded.textContent).toMatch(/229 encore en cours/);
  });

  it("lit le taux de livraison du serveur au lieu de le recalculer", () => {
    // 108 / 431 vaudrait 25,1 % ; le serveur impose 40 %. Le composant doit
    // afficher la valeur serveur — c'est lui qui connaît dispatchedCount.
    renderFunnel({ deliveryRate: 40, delivered: 108, uploaded: 431 });
    const delivered = screen.getAllByRole("listitem")[4];
    expect(delivered.textContent).toMatch(/40\s*%\s*des 431 uploadées/);
    expect(delivered.textContent).not.toMatch(/25,1/);
  });

  it("affiche un tiret, et jamais zéro, pour une étape absente du serveur", () => {
    renderFunnel({ treated: null });
    const treated = screen.getAllByRole("listitem")[1];
    expect(treated.textContent).toContain("—");
    expect(treated.textContent).not.toMatch(/\b0\b/);
  });

  it("porte la conversion cumulée sur chaque étape", () => {
    renderFunnel();
    const items = screen.getAllByRole("listitem");
    // 866/866, 453/866 = 52,3 %, 108/866 = 12,5 %
    expect(items[0].textContent).toMatch(/100\s*%\s*des commandes/);
    expect(items[2].textContent).toMatch(/52,3\s*%\s*des commandes/);
    expect(items[4].textContent).toMatch(/12,5\s*%\s*des commandes/);
  });

  it("ne divise pas par zéro quand aucune commande n'est reçue", () => {
    renderFunnel({
      leads: 0,
      treated: 0,
      confirmed: 0,
      uploaded: 0,
      delivered: 0,
      inFlight: 0,
      confirmationRate: 0,
      deliveryRate: 0,
    });
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.textContent ?? "").join(" ")).not.toMatch(/NaN|Infinity/);
  });
});
