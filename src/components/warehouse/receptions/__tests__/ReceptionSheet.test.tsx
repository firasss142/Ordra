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
vi.mock("@/components/warehouse/receptions/ReceptionSettleDialog", () => ({
  ReceptionSettleDialog: () => <div data-testid="settle-dialog" />,
}));
vi.mock("@/components/warehouse/receptions/ReceptionCountFlow", () => ({
  ReceptionCountFlow: () => <div data-testid="count-flow" />,
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
    status: "open",
    expected_at: "2026-09-28",
    note: null,
    photo_url: null,
    settled_at: null,
    counted_by_name: null,
    settled_by_name: null,
    reverses_reception_id: null,
    created_at: "2026-09-27T08:00:00Z",
    is_late: false,
    days_late: null,
    arrival_date: "2026-09-29",
    supplier_id: null,
    supplier: null,
    invoice_total: null,
    due_at: null,
    discrepancy_reason: null,
    lines: [
      {
        id: "l1",
        product_id: "p1",
        variant_id: null,
        product_name: "القرآن تدبر وعمل",
        product_sku: "qr-01",
        product_image_url: null,
    product_stock: 943,
        variant_label: null,
        ordered_qty: 150,
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
    totals: { units: 0, damaged: 0, value: null, lines: 1, expected: 150, countedLines: 0 },
    fee_basis: "value",
    costs: [],
    fees_total: null,
    fees_blocked: null,
    landed_value: null,
    payments: [],
    paid_total: 0,
    outstanding: null,
    claim: null,
    payment_state: "not_applicable",
    can: { recordArrival: true, settle: true, reverse: false, pay: true },
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
        status: "settled",
        can: { recordArrival: false, settle: false, reverse: true, pay: true },
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
  it("remplace les actions par « enregistrer » dès qu'un prix change", () => {
    wrap();
    expect(screen.getByRole("button", { name: /solder et chiffrer/i })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "150" } });

    expect(screen.queryByRole("button", { name: /solder et chiffrer/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enregistrer les prix/i })).toBeInTheDocument();
    expect(screen.getByText(/non enregistrées/i)).toBeInTheDocument();
  });

  it("permet d'abandonner la saisie et retrouve les actions", () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /abandonner/i }));
    expect(screen.getByRole("button", { name: /solder et chiffrer/i })).toBeInTheDocument();
  });

  it("envoie les lignes modifiées au PATCH", async () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "148" } });
    fireEvent.click(screen.getByRole("button", { name: /enregistrer les prix/i }));

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
        claim: null,
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

/**
 * « RENVOYER À L'AGENT » — la troisième issue.
 *
 * Sans elle, un manager qui voit une erreur dans une déclaration n'a que deux
 * choix : valider ce qui est faux, ou ne rien faire. La maquette §4 place donc
 * ce bouton juste à côté de la validation, parce que c'est le moment exact où on
 * s'en sert. Rien n'a bougé en stock à ce stade, donc il n'y a rien à annuler :
 * la réception redevient simplement un brouillon.
 */
/*
 * « RENVOYER À L'AGENT » A DISPARU AVEC L'ÉTAT QUI LE PORTAIT.
 *
 * Il existait parce qu'une déclaration attendait une validation : un manager qui
 * voyait une erreur devait pouvoir la rendre. Sous le modèle de l'arrivage il
 * n'y a plus de déclaration — le stock est entré au quai — donc plus rien à
 * rendre. Une erreur de comptage se corrige par `correct_arrival`, qui écrit le
 * delta au registre.
 */
describe("ReceptionSheet — ce qui a disparu avec la bascule", () => {
  it("n'offre plus « renvoyer à l'agent »", () => {
    wrap("market_manager");
    expect(screen.queryByRole("button", { name: /renvoyer/i })).not.toBeInTheDocument();
  });

  it("n'offre plus « déclarer la réception »", () => {
    wrap("warehouse_agent");
    expect(screen.queryByRole("button", { name: /déclarer/i })).not.toBeInTheDocument();
  });
});

/**
 * « CONTRE-PASSER ». La RPC et la route existaient depuis le premier jour ;
 * aucun bouton ne les appelait, donc une réception validée par erreur n'avait
 * aucune issue dans l'interface. Le registre est en écriture seule : on ajoute
 * l'inverse, on n'efface pas.
 */
describe("ReceptionSheet — contre-passer", () => {
  function posted(role: string, reverse: boolean) {
    mockUseReception.mockReturnValue({
      reception: reception({
        status: "settled",
        settled_by_name: "Salma",
        totals: { units: 150, damaged: 0, value: 6000, lines: 1, expected: 150, countedLines: 1 },
        can: { recordArrival: false, settle: false, reverse, pay: true },
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    return wrap(role);
  }

  it("propose « Contre-passer » à un super_admin sur une réception validée", () => {
    posted("super_admin", true);
    expect(screen.getByRole("button", { name: /contre-passer/i })).toBeInTheDocument();
  });

  it("ne la propose pas à un market_manager", () => {
    posted("market_manager", false);
    expect(screen.queryByRole("button", { name: /contre-passer/i })).not.toBeInTheDocument();
  });

  it("ne la propose pas sur un brouillon — il n'y a rien à contre-passer", () => {
    wrap("super_admin");
    expect(screen.queryByRole("button", { name: /contre-passer/i })).not.toBeInTheDocument();
  });
});

/**
 * « +8 HORS BON » — un fait, et pas un écart.
 *
 * Quand le produit n'était pas sur le bon de livraison, il n'y a pas d'attendu
 * dont faire la différence : ce n'est donc pas un écart, c'est autre chose, et
 * ça a ses propres mots. L'écran n'affichait rien du tout, ce qui laissait une
 * ligne hors bon se confondre avec une ligne conforme.
 */
describe("ReceptionSheet — hors bon de livraison", () => {
  it("dit « hors bon » quand rien n'était annoncé mais que des unités arrivent", () => {
    mockUseReception.mockReturnValue({
      reception: reception({
        status: "open",
        lines: [
          {
            ...reception().lines[0],
            ordered_qty: null,
            received_qty: 8,
            variance: null,
          },
        ],
        can: { recordArrival: false, settle: true, reverse: false, pay: true },
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    wrap();
    expect(screen.getByText(/\+8 hors bon/i)).toBeInTheDocument();
  });

  it("ne dit rien quand rien n'est annoncé ET rien n'est compté", () => {
    mockUseReception.mockReturnValue({
      reception: reception({
        lines: [{ ...reception().lines[0], ordered_qty: null, received_qty: null }],
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    wrap();
    expect(screen.queryByText(/hors bon/i)).not.toBeInTheDocument();
    // Deux mentions : le champ attendu et l'indice sous le champ reçu.
    expect(screen.getAllByText(/pas encore comptée/i).length).toBeGreaterThan(0);
  });
});

/**
 * LE VERSEMENT PORTE SA DATE ET SON MOTIF — maquette §4 : « 24 sept · Virement
 * bancaire · 7 488,000 · acompte à la commande ». Un acompte versé la semaine
 * dernière et saisi aujourd'hui n'a pas la date d'aujourd'hui, et « acompte à la
 * commande » est ce qui permet de relire la liste dans six mois.
 */
describe("ReceptionSheet — enregistrer un paiement", () => {
  function withValue() {
    mockUseReception.mockReturnValue({
      reception: reception({
        status: "settled",
        totals: { units: 150, damaged: 0, value: 6000, lines: 1, expected: 150, countedLines: 1 },
        claim: null,
    payment_state: "unpaid",
        paid_total: 0,
        outstanding: 6000,
        can: { recordArrival: false, settle: false, reverse: false, pay: true },
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    return wrap();
  }

  /** Le bloc est replié : on l'ouvre pour agir. */
  function openPayments() {
    fireEvent.click(screen.getByRole("button", { name: /^paiement/i }));
  }

  it("envoie la date et le motif saisis", async () => {
    withValue();
    openPayments();
    fireEvent.click(screen.getByRole("button", { name: /enregistrer un paiement/i }));
    fireEvent.change(screen.getByLabelText(/montant/i), { target: { value: "2400" } });
    fireEvent.change(screen.getByLabelText(/^date$/i), { target: { value: "2026-09-24" } });
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "acompte à la commande" } });
    fireEvent.click(screen.getByRole("button", { name: /^enregistrer$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/warehouse/receptions/r1/payments");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      amount: 2400,
      paid_at: "2026-09-24",
      note: "acompte à la commande",
    });
  });

  /* Un montant non chiffré n'envoie rien : le serveur refuserait, mais autant
     ne pas lui faire écrire une ligne pour rien. */
  it("n'envoie rien sans montant valide", async () => {
    withValue();
    openPayments();
    fireEvent.click(screen.getByRole("button", { name: /enregistrer un paiement/i }));
    fireEvent.change(screen.getByLabelText(/montant/i), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: /^enregistrer$/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

/**
 * UNE SEULE ACTION PRIMAIRE À L'ÉCRAN. Un manager sur un brouillon pouvait voir
 * « Déclarer la réception » ET « Valider et entrer en stock », tous deux en vert :
 * deux appels à l'action de même poids dont l'un contient l'autre, posés devant
 * quelqu'un qui voulait simplement entrer sa marchandise.
 */
describe("ReceptionSheet — une seule action primaire", () => {
  it("n'offre pas « déclarer » à qui peut valider", () => {
    wrap("market_manager");
    expect(screen.getByRole("button", { name: /solder et chiffrer/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /déclarer la réception/i })).not.toBeInTheDocument();
  });

  /*
   * L'AGENT N'A PLUS D'ACTION PRIMAIRE SUR LA FEUILLE. Il compte au QUAI, où
   * son geste entre le stock ; chiffrer est un geste de bureau, et lui offrir un
   * bouton qu'il ne peut pas presser serait une promesse vide.
   */
  it("ne propose pas de solder à l'agent du quai", () => {
    mockUseReception.mockReturnValue({
      reception: reception({
        can: { recordArrival: true, settle: false, reverse: false, pay: false },
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    wrap("warehouse_agent");
    expect(screen.queryByRole("button", { name: /solder et chiffrer/i })).not.toBeInTheDocument();
  });
});

/**
 * LA FEUILLE DE LA v3 — un seul bandeau d'en-tête, et l'avarie silencieuse.
 */
describe("ReceptionSheet — la densité de la v3", () => {
  it("met les faits d'en-tête sur une ligne, sans libellés empilés", () => {
    mockUseReception.mockReturnValue({
      reception: reception({ status: "open", counted_by_name: "Adel Ben Salah" }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    wrap();
    // Les cinq faits sont la LÉGENDE du document : ils restent lisibles…
    expect(screen.getByText("Tripoli")).toBeInTheDocument();
    expect(screen.getByText(/comptée par Adel Ben Salah/)).toBeInTheDocument();
    // …mais « Bâtiment » n'est plus un libellé en capitales au-dessus d'une valeur.
    expect(screen.queryByText(/^Bâtiment$/)).not.toBeInTheDocument();
  });

  /*
   * La progression était un bandeau vert pleine largeur, troisième bande
   * horizontale avant la première quantité. Elle reste lisible en mots, mais
   * c'est un filet de 3 px qui la dessine.
   */
  it("garde la progression en mots mais sans bandeau", () => {
    wrap();
    expect(screen.getByText(/saisie 0 \/ 1/i)).toBeInTheDocument();
    expect(screen.getByTestId("reception-progress-rail")).toBeInTheDocument();
  });

  /*
   * ABÎMÉ EST SILENCIEUX TANT QU'IL N'EXISTE PAS. Un encadré ambre sur chaque
   * ligne réclame une avarie qui n'arrive presque jamais, et finit par ne plus
   * rien signaler. Zéro reste saisissable — mais discret.
   */
  it("n'habille pas en ambre une ligne sans avarie", () => {
    wrap();
    const field = screen.getByLabelText(/abîmé/i);
    expect(field.className).not.toMatch(/bg-wh-warn-bg/);
  });

  it("passe en ambre dès qu'une avarie existe", () => {
    mockUseReception.mockReturnValue({
      reception: reception({
        lines: [{ ...reception().lines[0], received_qty: 94, damaged_qty: 2 }],
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    wrap();
    expect(screen.getByLabelText(/abîmé/i).className).toMatch(/bg-wh-warn-bg/);
  });

  /* « Valeur reçue » est le chiffre qu'un manager cherche : il domine le pied. */
  it("donne le premier rang à la valeur reçue", () => {
    mockUseReception.mockReturnValue({
      reception: reception({
        status: "open",
        totals: { units: 312, damaged: 2, value: 18720, lines: 1, expected: 150, countedLines: 1 },
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    wrap();
    const lead = screen.getByTestId("reception-total-value");
    expect(lead).toHaveTextContent(/18\s*720/);
    expect(lead.className).toMatch(/text-\[25px\]/);
  });
});

/**
 * LE BLOC PAIEMENT EST REPLIÉ. Son titre porte déjà le fait entier — « acompte
 * 40 % · reste 11 232,000 » — donc on l'ouvre pour AGIR, pas pour lire.
 */
describe("ReceptionSheet — le paiement replié", () => {
  function paid() {
    mockUseReception.mockReturnValue({
      reception: reception({
        status: "settled",
        totals: { units: 150, damaged: 0, value: 18720, lines: 1, expected: 150, countedLines: 1 },
        payments: [
          { id: "pay1", paid_at: "2026-09-24", amount: 7488, method: "bank_transfer", note: null },
        ],
        paid_total: 7488,
        outstanding: 11232,
        claim: null,
    payment_state: "partial",
        can: { recordArrival: false, settle: false, reverse: false, pay: true },
      }),
      isLoading: false,
      error: undefined,
      mutate: mockMutate,
    });
    return wrap();
  }

  it("résume l'état sans être ouvert", () => {
    paid();
    expect(screen.getByText(/acompte 40 %/)).toBeInTheDocument();
    // Le versement lui-même n'est pas rendu tant qu'on n'a pas ouvert.
    expect(screen.queryByText(/virement bancaire/i)).not.toBeInTheDocument();
  });

  it("s'ouvre au clic et montre les versements", () => {
    paid();
    fireEvent.click(screen.getByRole("button", { name: /paiement/i }));
    expect(screen.getByText(/virement bancaire/i)).toBeInTheDocument();
  });
});
