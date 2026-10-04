import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { ReceptionDockFlow } from "../ReceptionDockFlow";

vi.mock("swr", () => ({
  default: () => ({
    data: {
      data: [
        {
          id: "p1",
          name: "مصحف التهجد",
          sku: "th-01",
          image_url: null,
          current_stock: 122,
          variants: [],
        },
      ],
    },
  }),
}));

const onChanged = vi.fn().mockResolvedValue(undefined);
const arrival: Record<string, unknown> = {};

function wrap() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ReceptionDockFlow
        reception={null}
        warehouseId="w-tripoli"
        marketId="m-ly"
        warehouseName="Tripoli"
        onClose={vi.fn()}
        onChanged={onChanged}
      />
    </NextIntlClientProvider>,
  );
}

/** Compter 94 : choisir le produit, taper 9 puis 4, valider. */
async function count94() {
  fireEvent.click(screen.getByRole("button", { name: /ajouter un arrivage/i }));
  fireEvent.click(await screen.findByText("مصحف التهجد"));
  fireEvent.click(screen.getByRole("button", { name: "9" }));
  fireEvent.click(screen.getByRole("button", { name: "4" }));
  fireEvent.click(screen.getByRole("button", { name: /entrer en stock/i }));
  await waitFor(() => expect(screen.getByText("+94")).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockImplementation(() =>
    Promise.resolve({ ok: true, json: async () => arrival }),
  ) as never;
});

/**
 * L'ANCRE, ET POURQUOI ELLE N'APPARAÎT QU'APRÈS.
 *
 * Montrer « attendu 150 » avant le comptage ne fait pas gagner du temps : ça
 * fait ÉCRIRE 150. L'écart n'est utile qu'une fois le compte engagé — il est
 * alors une information sur le FOURNISSEUR, et non sur la mémoire de l'agent.
 */
describe("Le quai est aveugle avant le compte", () => {
  it("n'affiche nulle part une quantité attendue pendant la saisie", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /ajouter un arrivage/i }));
    fireEvent.click(await screen.findByText("مصحف التهجد"));
    expect(screen.queryByText(/attendu/i)).not.toBeInTheDocument();
    expect(screen.queryByText("150")).not.toBeInTheDocument();
  });

  it("ne demande ni fournisseur ni prix à la saisie", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /ajouter un arrivage/i }));
    fireEvent.click(await screen.findByText("مصحف التهجد"));
    // La seule mention de « prix » ou « fournisseur » de tout le quai est la
    // note de l'écran d'accueil, qui dit qu'ils sont ABSENTS.
    expect(screen.queryByText(/fournisseur/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prix/i)).not.toBeInTheDocument();
  });
});

describe("La révélation, après l'engagement", () => {
  it("montre commandé, compté et l'écart", async () => {
    Object.assign(arrival, { product_total: 216, site_total: 94, ordered: 150, counted: 94 });
    wrap();
    await count94();
    expect(screen.getByText(/face à la commande/i)).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("−56")).toBeInTheDocument();
  });

  it("se tait quand rien n'était commandé", async () => {
    // `ordered` NULL : il n'y a pas de plan contre lequel mesurer, et afficher
    // « écart −94 » contre un attendu inexistant serait un reproche inventé.
    Object.assign(arrival, { product_total: 216, site_total: 94, ordered: null, counted: 94 });
    wrap();
    await count94();
    expect(screen.queryByText(/face à la commande/i)).not.toBeInTheDocument();
  });

  it("dit « complet » quand le compte tombe juste", async () => {
    Object.assign(arrival, { product_total: 216, site_total: 94, ordered: 94, counted: 94 });
    wrap();
    await count94();
    expect(screen.getByText(/complet/i)).toBeInTheDocument();
    expect(screen.queryByText("−0")).not.toBeInTheDocument();
  });

  it("montre un surplus signé", async () => {
    Object.assign(arrival, { product_total: 216, site_total: 94, ordered: 80, counted: 94 });
    wrap();
    await count94();
    expect(screen.getByText("+14")).toBeInTheDocument();
  });
});
