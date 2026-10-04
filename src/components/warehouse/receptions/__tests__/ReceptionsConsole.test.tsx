import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { ProjectedReception } from "@/lib/receptions/project";

const mockUseReceptions = vi.fn();

vi.mock("@/hooks/useReceptions", () => ({
  useReceptions: (...a: unknown[]) => mockUseReceptions(...a),
  buildReceptionsKey: () => "/api/warehouse/receptions",
}));

vi.mock("@/components/warehouse/receptions/ReceptionSheet", () => ({
  ReceptionSheet: () => <div data-testid="sheet" />,
}));
vi.mock("@/components/warehouse/receptions/ReceptionCreateDialog", () => ({
  ReceptionCreateDialog: () => <div data-testid="create" />,
}));

import { ReceptionsConsole } from "../ReceptionsConsole";

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      {ui}
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
    settled_at: "2026-09-28T09:00:00Z",
    counted_by_name: "Adel",
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
    lines: [],
    totals: { units: 312, damaged: 2, value: 18720, lines: 4, expected: 310, countedLines: 4 },
    fee_basis: "value",
    costs: [],
    fees_total: null,
    fees_blocked: null,
    landed_value: null,
    payments: [],
    paid_total: 7488,
    outstanding: 11232,
    claim: null,
    payment_state: "partial",
    can: { recordArrival: false, settle: true, reverse: false, pay: true },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseReceptions.mockReturnValue({
    receptions: [reception()],
    counts: { all: 1, open: 1, settled: 0, unpaid: 1, late: 0 },
    currency: "LYD",
    unassigned: false,
    isLoading: false,
    error: undefined,
    mutate: vi.fn(),
  });
});

describe("ReceptionsConsole", () => {
  it("affiche la référence et le bâtiment", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByText("REC-LY-2026-0042")).toBeInTheDocument();
    expect(screen.getByText("Tripoli")).toBeInTheDocument();
  });

  it("montre la valeur reçue à un manager", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByText(/18\s*720/)).toBeInTheDocument();
  });

  /*
   * L'agent ne reçoit tout simplement pas le champ : la projection le supprime
   * côté serveur. L'écran doit donc gérer `null` sans afficher « 0 ».
   */
  it("n'affiche aucune valeur quand l'API n'en fournit pas", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [
        reception({
          totals: { units: 312, damaged: 2, value: null, lines: 4, expected: 310, countedLines: 4 },
          claim: null,
    payment_state: null,
          outstanding: null,
          paid_total: null,
        }),
      ],
      counts: { all: 1, open: 1, settled: 0, unpaid: 1, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="warehouse_agent" />);
    expect(screen.queryByText(/18\s*720/)).not.toBeInTheDocument();
    expect(screen.queryByText("LYD")).not.toBeInTheDocument();

    // La cellule « valeur reçue » de la ligne porte un tiret, pas un zéro.
    // (« 0 » existe ailleurs à l'écran : les compteurs de segments.)
    const row = screen.getByRole("button", { name: /REC-LY-2026-0042/ });
    expect(row).toHaveTextContent("—");
  });

  it("dit « en retard de 4 j » plutôt que de le taire", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [reception({ is_late: true, days_late: 4, status: "open" })],
      counts: { all: 1, open: 1, settled: 0, unpaid: 0, late: 1 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByText(/en retard de 4/)).toBeInTheDocument();
  });

  /*
   * Une liste vide et « aucun bâtiment ne vous est assigné » sont deux faits
   * OPPOSÉS. Les confondre envoie l'agent chercher des colis qu'il ne verra
   * jamais, au lieu de l'envoyer chez son responsable.
   */
  it("distingue « pas de bâtiment » d'un entrepôt calme", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [],
      counts: { all: 0, open: 0, settled: 0, unpaid: 0, late: 0 },
      currency: "LYD",
      unassigned: true,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="warehouse_agent" />);
    expect(screen.getByText(/aucun bâtiment ne vous est assigné/i)).toBeInTheDocument();
    expect(screen.queryByText(/aucune réception/i)).not.toBeInTheDocument();
  });

  it("affiche l'état vide quand il n'y a simplement rien", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [],
      counts: { all: 0, open: 0, settled: 0, unpaid: 0, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByText(/aucune réception/i)).toBeInTheDocument();
  });

  /*
   * PLUS DE « NOUVELLE RÉCEPTION » SUR LE BUREAU. Le document naît au QUAI, au
   * premier arrivage : un formulaire qui réclamait bâtiment, fournisseur, numéro
   * de bon et date avant d'accepter une seule unité demandait la paperasse avant
   * la marchandise — et c'est exactement là que la seule réception jamais créée
   * en production s'est arrêtée, à zéro ligne.
   */
  it("n'offre plus de créer une réception depuis le bureau", () => {
    wrap(<ReceptionsConsole locale="fr" role="warehouse_agent" />);
    expect(screen.queryByRole("button", { name: /nouvelle réception/i })).not.toBeInTheDocument();
  });

  /*
   * Le segment et la pastille de statut portent le même mot, « À valider ».
   * Le filtre est donc nommé explicitement : sans cela, deux boutons de même
   * nom accessible coexistent, ce qui est ambigu pour un lecteur d'écran autant
   * que pour ce test.
   */
  it("porte un compteur sur le filtre « à solder » — la file du bureau", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const group = screen.getByRole("group", { name: /filtre/i });
    const seg = within(group).getByRole("button", { name: /à solder/i });
    expect(seg).toHaveAttribute("aria-pressed", "false");
    expect(seg).toHaveTextContent("1");
  });
});

/**
 * LES CINQ SEGMENTS DE LA MAQUETTE §3, et le fait qu'ils ne mentent pas.
 *
 * Les compteurs étaient calculés sur la liste DÉJÀ FILTRÉE : choisir
 * « Attendues » mettait « À valider » et « Validées » à zéro, c'est-à-dire que
 * le seul écran censé dire au manager ce qui l'attend l'oubliait dès qu'on s'en
 * servait. Le filtrage se fait donc côté client, sur une liste complète.
 */
describe("ReceptionsConsole — les segments", () => {
  function threeReceptions() {
    return [
      reception({
        id: "r-draft",
        reference: "REC-LY-2026-0043",
        status: "open",
        totals: { units: 0, damaged: 0, value: null, lines: 2, expected: 480, countedLines: 0 },
        claim: null,
    payment_state: "not_applicable",
        outstanding: null,
        paid_total: 0,
      }),
      reception({ id: "r-sub", reference: "REC-LY-2026-0042", status: "open" }),
      reception({
        id: "r-posted",
        reference: "REC-LY-2026-0039",
        status: "settled",
        totals: { units: 602, damaged: 3, value: 45150, lines: 14, expected: 600, countedLines: 14 },
        claim: null,
    payment_state: "paid",
        outstanding: 0,
        paid_total: 45150,
      }),
    ];
  }

  beforeEach(() => {
    mockUseReceptions.mockReturnValue({
      receptions: threeReceptions(),
      counts: { all: 3, open: 2, settled: 1, unpaid: 2, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
  });

  it("porte les quatre filtres : toutes, à solder, soldées, impayées", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const group = screen.getByRole("group", { name: /filtre/i });
    for (const label of [/toutes/i, /à solder/i, /soldées/i, /impayées/i]) {
      expect(within(group).getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("garde tous les compteurs justes après avoir filtré", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const group = screen.getByRole("group", { name: /filtre/i });

    await user.click(within(group).getByRole("button", { name: /à solder/i }));

    // La liste s'est réduite…
    expect(screen.getByText("REC-LY-2026-0043")).toBeInTheDocument();
    expect(screen.queryByText("REC-LY-2026-0039")).not.toBeInTheDocument();
    // …mais les compteurs parlent toujours de l'ensemble.
    expect(within(group).getByRole("button", { name: /à solder/i })).toHaveTextContent("2");
    expect(within(group).getByRole("button", { name: /soldées/i })).toHaveTextContent("1");
    expect(within(group).getByRole("button", { name: /impayées/i })).toHaveTextContent("2");
  });

  it("ne redemande pas le serveur en changeant de segment", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    // La clé SWR ne porte pas de statut : le segment est une vue, pas une requête.
    expect(mockUseReceptions.mock.calls[0][0]?.status ?? null).toBeNull();
  });

  it("filtre les impayées sur l'état déduit, pas sur un statut en base", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const group = screen.getByRole("group", { name: /filtre/i });

    await user.click(within(group).getByRole("button", { name: /impayées/i }));
    // La validée est soldée : elle sort. Les deux autres restent.
    expect(screen.queryByText("REC-LY-2026-0039")).not.toBeInTheDocument();
    expect(screen.getByText("REC-LY-2026-0042")).toBeInTheDocument();
  });
});

/**
 * LE NOMBRE NE RESTE JAMAIS NU. « 300 » ne dit pas si trois cents unités sont
 * arrivées ou seulement promises ; la maquette écrit donc toujours le mot.
 */
describe("ReceptionsConsole — le chiffre et son mot", () => {
  it("annonce « attendues » sur une réception que personne n'a comptée", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [
        reception({
          status: "open",
          totals: { units: 0, damaged: 0, value: null, lines: 3, expected: 300, countedLines: 0 },
        }),
      ],
      counts: { all: 1, open: 1, settled: 0, unpaid: 0, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const row = screen.getByRole("button", { name: /REC-LY-2026-0042/ });
    // Le 0 de `totals.units` se lirait « rien n'est arrivé » : c'est l'attendu
    // qu'on montre, et il est nommé.
    expect(row).toHaveTextContent(/300\s*attendues/);
    expect(row).not.toHaveTextContent(/\b0\s*attendues/);
  });

  it("dit « comptées » sur une déclaration", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByRole("button", { name: /REC-LY-2026-0042/ })).toHaveTextContent(
      /312\s*comptées/,
    );
  });

  it("dit « annulées » sur une contre-passation", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [
        reception({
          status: "reversed",
          totals: { units: 80, damaged: 0, value: 3200, lines: 1, expected: 80, countedLines: 1 },
        }),
      ],
      counts: { all: 1, open: 0, settled: 0, unpaid: 0, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByRole("button", { name: /REC-LY-2026-0042/ })).toHaveTextContent(
      /80\s*annulées/,
    );
  });
});

/**
 * UN SEUL MOT POUR UN SEUL ÉTAT. Le filtre s'appelle « À solder » et la pastille
 * doit dire la même chose sur les lignes qu'il retourne : deux noms pour le même
 * fait, dans le même écran, à quinze centimètres l'un de l'autre, et personne ne
 * peut deviner qu'ils sont égaux.
 */
describe("ReceptionsConsole — le vocabulaire", () => {
  it("appelle un groupe ouvert « À solder », comme son filtre", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [
        reception({
          status: "open",
          totals: { units: 0, damaged: 0, value: null, lines: 1, expected: 300, countedLines: 0 },
        }),
      ],
      counts: { all: 1, open: 1, settled: 0, unpaid: 0, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const row = screen.getByRole("button", { name: /REC-LY-2026-0042/ });
    expect(row).toHaveTextContent(/À solder/);
    // Le vocabulaire d'avant la bascule ne doit plus apparaître nulle part.
    expect(row).not.toHaveTextContent(/Brouillon|Attendue|À valider/);
  });

  it("dit « acompte 40 % » sur une réception partiellement payée", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByRole("button", { name: /REC-LY-2026-0042/ })).toHaveTextContent(
      /acompte\s*40\s*%/,
    );
  });
});

/**
 * « RIEN ICI » N'EST PAS « RIEN DU TOUT ». Dire « une livraison fournisseur
 * commence ici » à quelqu'un qui vient de filtrer sur « Impayées » l'envoie créer
 * une réception alors qu'il voulait savoir qu'il n'en a aucune d'impayée.
 */
describe("ReceptionsConsole — les deux vides", () => {
  it("distingue un filtre vide d'un entrepôt vide", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    mockUseReceptions.mockReturnValue({
      receptions: [
        reception({
          status: "settled",
          claim: null,
    payment_state: "paid",
          totals: { units: 10, damaged: 0, value: 100, lines: 1, expected: 10, countedLines: 1 },
        }),
      ],
      counts: { all: 1, open: 0, settled: 1, unpaid: 0, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const group = screen.getByRole("group", { name: /filtre/i });
    await user.click(within(group).getByRole("button", { name: /impayées/i }));

    expect(screen.getByText(/aucune réception dans ce filtre/i)).toBeInTheDocument();
    expect(screen.queryByText(/une livraison fournisseur commence ici/i)).not.toBeInTheDocument();
  });

  it("dit « aucune réception » quand il n'y en a vraiment aucune", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [],
      counts: { all: 0, open: 0, settled: 0, unpaid: 0, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByText(/une livraison fournisseur commence ici/i)).toBeInTheDocument();
  });
});

/**
 * LA LISTE DE LA v3 — cinq colonnes, et UN SEUL signal de couleur par ligne.
 */
describe("ReceptionsConsole — la densité de la v3", () => {
  it("n'a plus de colonne « Bâtiment » : le site rejoint la référence", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    // L'en-tête ne porte plus le libellé…
    expect(screen.queryByText(/^Bâtiment$/)).not.toBeInTheDocument();
    // …mais le bâtiment reste lisible sur la ligne.
    expect(screen.getByRole("button", { name: /REC-LY-2026-0042/ })).toHaveTextContent("Tripoli");
  });

  /*
   * Une ligne en retard portait un fond rouge ET un liseré rouge ET une puce
   * ambre ET une étiquette rouge. Le liseré suffit : il se lit en balayant la
   * colonne sans lire un mot. Un fond teinté en plus ne dit rien de neuf et
   * entre en concurrence avec les puces, qui portent la vraie nuance.
   */
  it("ne teinte plus le fond de la ligne — le liseré porte le signal seul", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [reception({ is_late: true, days_late: 4, status: "open" })],
      counts: { all: 1, open: 1, settled: 0, unpaid: 0, late: 1 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const row = screen.getByRole("button", { name: /REC-LY-2026-0042/ });
    expect(row.className).toMatch(/border-s-wh-bad/);
    expect(row.className).not.toMatch(/bg-wh-bad-bg/);
  });

  /*
   * « sans objet » est un libellé dont le seul contenu est « cette colonne ne me
   * concerne pas ». Même règle que `null` plutôt que `0` : on ne remplit pas une
   * case pour qu'elle ne soit pas vide.
   */
  it("ne met aucune puce de paiement là où le paiement n'a pas de sens", () => {
    mockUseReceptions.mockReturnValue({
      receptions: [
        reception({
          status: "open",
          claim: null,
    payment_state: "not_applicable",
          outstanding: null,
          paid_total: 0,
          totals: { units: 0, damaged: 0, value: null, lines: 2, expected: 300, countedLines: 0 },
        }),
      ],
      counts: { all: 1, open: 1, settled: 0, unpaid: 0, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.queryByText(/sans objet/i)).not.toBeInTheDocument();
  });

  it("garde la puce quand elle dit quelque chose", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByText(/acompte 40 %/)).toBeInTheDocument();
  });
});
