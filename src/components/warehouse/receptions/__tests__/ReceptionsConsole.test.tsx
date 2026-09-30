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
    status: "submitted",
    expected_at: "2026-09-28",
    note: null,
    photo_url: null,
    submitted_at: "2026-09-28T09:00:00Z",
    submitted_by_name: "Adel",
    posted_at: null,
    posted_by_name: null,
    reverses_reception_id: null,
    created_at: "2026-09-27T08:00:00Z",
    is_late: false,
    days_late: null,
    lines: [],
    totals: { units: 312, damaged: 2, value: 18720, lines: 4 },
    payments: [],
    paid_total: 7488,
    outstanding: 11232,
    payment_state: "partial",
    can: { submit: false, post: true, reverse: false, pay: true },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseReceptions.mockReturnValue({
    receptions: [reception()],
    counts: { all: 1, draft: 0, submitted: 1, posted: 0, late: 0 },
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
          totals: { units: 312, damaged: 2, value: null, lines: 4 },
          payment_state: null,
          outstanding: null,
          paid_total: null,
        }),
      ],
      counts: { all: 1, draft: 0, submitted: 1, posted: 0, late: 0 },
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
      receptions: [reception({ is_late: true, days_late: 4, status: "draft" })],
      counts: { all: 1, draft: 1, submitted: 0, posted: 0, late: 1 },
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
      counts: { all: 0, draft: 0, submitted: 0, posted: 0, late: 0 },
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
      counts: { all: 0, draft: 0, submitted: 0, posted: 0, late: 0 },
      currency: "LYD",
      unassigned: false,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    expect(screen.getByText(/aucune réception/i)).toBeInTheDocument();
  });

  it("propose « nouvelle réception » à qui peut en créer", () => {
    wrap(<ReceptionsConsole locale="fr" role="warehouse_agent" />);
    expect(screen.getByRole("button", { name: /nouvelle réception/i })).toBeInTheDocument();
  });

  /*
   * Le segment et la pastille de statut portent le même mot, « À valider ».
   * Le filtre est donc nommé explicitement : sans cela, deux boutons de même
   * nom accessible coexistent, ce qui est ambigu pour un lecteur d'écran autant
   * que pour ce test.
   */
  it("porte un compteur sur le filtre « à valider » — la file du manager", () => {
    wrap(<ReceptionsConsole locale="fr" role="market_manager" />);
    const group = screen.getByRole("group", { name: /filtre/i });
    const seg = within(group).getByRole("button", { name: /à valider/i });
    expect(seg).toHaveAttribute("aria-pressed", "false");
    expect(seg).toHaveTextContent("1");
  });
});
