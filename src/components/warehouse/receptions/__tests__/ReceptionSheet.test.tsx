import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { ProjectedReception } from "@/lib/receptions/project";

const mockUseReception = vi.fn();
const mockMutate = vi.fn();

vi.mock("@/hooks/useReceptions", () => ({
  useReception: (...a: unknown[]) => mockUseReception(...a),
}));
vi.mock("@/components/warehouse/receptions/ReceptionPostDialog", () => ({
  ReceptionPostDialog: () => <div data-testid="post-dialog" />,
}));

import { ReceptionSheet } from "../ReceptionSheet";

function wrap(role = "market_manager") {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ReceptionSheet
        id="r1"
        locale="fr"
        role={role as never}
        currency="LYD"
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

function reception(over: Partial<ProjectedReception> = {}): ProjectedReception {
  return {
    id: "r1",
    reference: "REC-LY-2026-0042",
    market_id: "m-ly",
    warehouse_id: "w-tripoli",
    warehouse_name: "Tripoli",
    warehouse_name_ar: "طرابلس",
    supplier_name: "مكتبة الرسالة",
    supplier_ref: "BL-4471",
    status: "draft",
    expected_at: "2026-09-28",
    note: null,
    photo_url: null,
    submitted_at: null,
    submitted_by_name: null,
    posted_at: null,
    posted_by_name: null,
    reverses_reception_id: null,
    created_at: "2026-09-27T08:00:00Z",
    is_late: false,
    days_late: null,
    lines: [
      {
        id: "l1",
        product_id: "p1",
        variant_id: null,
        product_name: "القرآن تدبر وعمل",
        product_sku: "qr-01",
        variant_label: null,
        expected_qty: 150,
        received_qty: null,
        damaged_qty: 0,
        variance: null,
        note: null,
        unit_cost: 40,
        line_value: null,
        cogs_current: 40,
        cogs_next: 40,
      },
    ],
    totals: { units: 0, damaged: 0, value: null, lines: 1 },
    payments: [],
    paid_total: 0,
    outstanding: null,
    payment_state: "not_applicable",
    can: { submit: true, post: true, reverse: false, pay: true },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseReception.mockReturnValue({
    reception: reception(),
    isLoading: false,
    error: undefined,
    mutate: mockMutate,
  });
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
});

describe("ReceptionSheet — la saisie est modifiable sur un brouillon", () => {
  it("expose un champ « reçu » plutôt qu'un chiffre figé", () => {
    wrap();
    expect(screen.getByLabelText(/reçu/i)).toBeInTheDocument();
  });

  it("verrouille tout une fois la réception validée", () => {
    mockUseReception.mockReturnValue({
      reception: reception({
        status: "posted",
        can: { submit: false, post: false, reverse: true, pay: true },
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    wrap();
    expect(screen.queryByLabelText(/reçu/i)).not.toBeInTheDocument();
  });
});

/*
 * LA GARDE LA PLUS IMPORTANTE DE CET ÉCRAN. Tant qu'une saisie n'est pas
 * enregistrée, déclarer ou valider porterait sur les chiffres du SERVEUR et non
 * sur ceux que la personne a sous les yeux — la façon la plus sûre d'entrer en
 * stock une quantité que personne n'a voulue.
 */
describe("ReceptionSheet — enregistrer d'abord, agir ensuite", () => {
  it("remplace les actions par « enregistrer » dès qu'une quantité change", () => {
    wrap();
    expect(screen.getByRole("button", { name: /valider et entrer en stock/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "150" } });

    expect(screen.queryByRole("button", { name: /valider et entrer en stock/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enregistrer les quantités/i })).toBeInTheDocument();
    expect(screen.getByText(/non enregistrées/i)).toBeInTheDocument();
  });

  it("permet d'abandonner la saisie et retrouve les actions", () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /abandonner/i }));
    expect(screen.getByRole("button", { name: /valider et entrer en stock/i })).toBeInTheDocument();
  });

  it("envoie TOUTES les lignes au PATCH, pas seulement les modifiées", async () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "148" } });
    fireEvent.click(screen.getByRole("button", { name: /enregistrer les quantités/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/warehouse/receptions/r1");
    expect((init as RequestInit).method).toBe("PATCH");
    const body = JSON.parse((init as RequestInit).body as string);
    // La route remplace en bloc : omettre une ligne la supprimerait.
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ product_id: "p1", received_qty: 148 });
  });
});

describe("ReceptionSheet — les totaux suivent la saisie", () => {
  it("met à jour les unités reçues avant enregistrement", () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "150" } });
    // Un pied qui contredit les champs juste au-dessus est un écran qu'on cesse
    // de croire, et celui-ci porte un geste qui bouge du stock.
    const foot = screen.getByText(/unités reçues/i).parentElement;
    expect(foot).toHaveTextContent("150");
  });

  it("met à jour la progression de saisie", () => {
    wrap();
    expect(screen.getByText(/saisie 0 \/ 1/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "150" } });
    expect(screen.getByText(/saisie 1 \/ 1/i)).toBeInTheDocument();
  });

  it("compte zéro comme une ligne comptée — « rien n'est arrivé » est une réponse", () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "0" } });
    expect(screen.getByText(/saisie 1 \/ 1/i)).toBeInTheDocument();
  });
});

describe("ReceptionSheet — le coût reste invisible pour l'entrepôt", () => {
  it("ne rend aucun champ de coût à un warehouse_agent", () => {
    mockUseReception.mockReturnValue({
      reception: reception({
        lines: [
          {
            ...reception().lines[0],
            unit_cost: undefined,
            line_value: undefined,
            cogs_current: undefined,
            cogs_next: undefined,
          },
        ],
        payment_state: null,
        paid_total: null,
        outstanding: null,
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    wrap("warehouse_agent");
    expect(screen.queryByLabelText(/coût/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/valeur reçue/i)).not.toBeInTheDocument();
  });
});
