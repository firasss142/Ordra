import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { ProjectedReception } from "@/lib/receptions/project";
import { ReceptionFeesBlock } from "../ReceptionFeesBlock";

function reception(over: Partial<ProjectedReception> = {}): ProjectedReception {
  return {
    id: "r1",
    reference: "REC-LY-2026-0042",
    market_id: "m-ly",
    warehouse_id: "w-tripoli",
    warehouse_name: "Tripoli",
    warehouse_name_ar: "طرابلس",
    supplier_name: "مكتبة الرسالة",
    supplier_ref: "4471",
    status: "open",
    expected_at: null,
    note: null,
    photo_url: null,
    settled_at: null,
    counted_by_name: null,
    settled_by_name: null,
    reverses_reception_id: null,
    created_at: "2026-09-29T08:00:00Z",
    is_late: false,
    days_late: null,
    arrival_date: "2026-09-29",
    supplier_id: null,
    supplier: null,
    invoice_total: null,
    due_at: null,
    discrepancy_reason: null,
    lines: [],
    totals: { units: 312, damaged: 2, value: 18720, lines: 4, expected: null, countedLines: 4 },
    fee_basis: "value",
    costs: [
      { id: "c1", kind: "freight", label: "Misrata → Tripoli", amount: 900 },
      { id: "c2", kind: "customs", label: null, amount: 420 },
      { id: "c3", kind: "handling", label: "Déchargement", amount: 180 },
    ],
    fees_total: 1500,
    fees_blocked: null,
    landed_value: 20220,
    payments: [],
    paid_total: 0,
    outstanding: 18720,
    payment_state: "unpaid",
    can: { recordArrival: true, settle: true, reverse: false, pay: true },
    ...over,
  };
}

const onChanged = vi.fn().mockResolvedValue(undefined);

function wrap(over: Partial<ProjectedReception> = {}, editable = true) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ReceptionFeesBlock
        reception={reception(over)}
        currency="LYD"
        editable={editable}
        onChanged={onChanged}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
});

/**
 * LE PRIX DU FOURNISSEUR N'EST PAS CE QUE LA MARCHANDISE COÛTE. Sans ces
 * lignes, tout COGS adopté depuis une réception est systématiquement trop bas,
 * ce qui gonfle la marge de chaque produit et les relevés investisseurs.
 */
describe("ReceptionFeesBlock — ce qu'il montre", () => {
  it("liste chaque frais avec son montant", () => {
    wrap();
    expect(screen.getByText("Misrata → Tripoli")).toBeInTheDocument();
    expect(screen.getByText("900,000")).toBeInTheDocument();
    expect(screen.getByText("180,000")).toBeInTheDocument();
  });

  it("nomme un frais sans intitulé par sa nature", () => {
    // La ligne « douane » n'a pas d'intitulé : « Douane » vaut mieux qu'un vide.
    wrap();
    expect(screen.getByText("Douane")).toBeInTheDocument();
  });

  it("dit ce que les frais pèsent par unité", () => {
    // 1 500 / 312 = 4,808 — le chiffre qui dit si les frais comptent.
    wrap();
    expect(screen.getByText(/312 unités/)).toBeInTheDocument();
    expect(screen.getByText(/4,808/)).toBeInTheDocument();
  });

  it("sans frais, dit que le coût de revient est le prix du fournisseur seul", () => {
    wrap({ costs: [], fees_total: 0 });
    expect(screen.getByText(/prix du fournisseur seul/i)).toBeInTheDocument();
  });
});

describe("ReceptionFeesBlock — le critère de répartition", () => {
  it("montre lequel est actif", () => {
    wrap();
    expect(screen.getByRole("button", { name: /par valeur/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: /par unité/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("bascule sur « par unité »", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /par unité/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(url).toContain("/costs");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ fee_basis: "units" });
  });
});

describe("ReceptionFeesBlock — ce qu'on refuse de deviner", () => {
  /*
   * Retomber en douce sur « par unité » quand aucune ligne n'a de prix serait
   * exactement le repli silencieux qui fabrique un COGS faux sans rien dire.
   */
  it("dit pourquoi les frais ne peuvent pas être répartis", () => {
    wrap({ fees_blocked: "no_value" });
    expect(screen.getByText(/ne peuvent pas être répartis par valeur/i)).toBeInTheDocument();
  });

  it("ne crie pas quand il n'y a aucun frais à répartir", () => {
    wrap({ fees_blocked: "no_value", costs: [], fees_total: 0 });
    expect(screen.queryByText(/ne peuvent pas être répartis/i)).not.toBeInTheDocument();
  });
});

describe("ReceptionFeesBlock — une réception validée est figée", () => {
  /*
   * Le coût de revient est écrit dans `landed_unit_cost` et a pu nourrir
   * `unit_cogs` : rouvrir les frais après coup ferait mentir le registre.
   */
  it("n'offre ni ajout, ni suppression, ni bascule de critère", () => {
    wrap({ status: "settled" }, false);
    expect(screen.queryByRole("button", { name: /ajouter un frais/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retirer ce frais/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /par unité/i })).not.toBeInTheDocument();
    // Mais les frais restent LISIBLES : c'est l'histoire de la réception.
    expect(screen.getByText("Misrata → Tripoli")).toBeInTheDocument();
  });
});

describe("ReceptionFeesBlock — saisir et retirer", () => {
  it("retire un frais par son identifiant", async () => {
    wrap();
    fireEvent.click(screen.getAllByRole("button", { name: /retirer ce frais/i })[0]);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(url).toContain("cost_id=c1");
    expect(init.method).toBe("DELETE");
  });

  it("ajoute un frais", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /ajouter un frais/i }));
    fireEvent.change(screen.getByLabelText(/montant/i), { target: { value: "250,500" } });
    fireEvent.click(screen.getByRole("button", { name: /ajouter un frais/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    // La virgule décimale est acceptée : c'est ce qu'on tape en français.
    expect(JSON.parse(init.body as string)).toMatchObject({ amount: 250.5, kind: "freight" });
  });

  it("refuse un montant vide sans appeler le serveur", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /ajouter un frais/i }));
    fireEvent.click(screen.getByRole("button", { name: /ajouter un frais/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
