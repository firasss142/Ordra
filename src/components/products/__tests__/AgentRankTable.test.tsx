import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AgentRankTable,
  computeAgentRates,
  teamMedians,
  type AgentRankRow,
} from "../AgentRankTable";

const SHEET = vi.hoisted(() => ({
  agents: {
    table: {
      title: "Classement des agents",
      subtitle: "trié par CA généré · en-têtes triables",
      caption: "Comparaison des agents ayant travaillé ce produit",
      empty: "Aucun agent n'a travaillé ce produit sur la période.",
    },
    columns: {
      rank: "Rang",
      agent: "Agent",
      calls: "Appels",
      confirmation: "Confirmation",
      delivery: "Livraison",
      revenue: "CA généré",
    },
    tips: {
      rank: "Classement par CA généré sur ce produit.",
      agent: "Rôle actuel de la personne.",
      calls: "Tentatives d'appel enregistrées et commandes distinctes appelées.",
      confirmation: "Confirmées ÷ traitées.",
      delivery: "Livrées ÷ confirmées.",
      revenue: "Somme des prix des commandes livrées.",
    },
    tipLabel: "À propos de {column}",
    callsDen: "sur {count} commandes",
    noCalls: "aucun appel passé",
    confirmationDen: "{confirmed} sur {treated} traitées",
    deliveryDen: "{delivered} livrées",
    deliveryDenWithReturns: "{delivered} livrées · {returned} retours",
    noConfirmation: "aucune confirmation",
    inFlightPill: "+{count} en cours",
    inFlightNone: "0 en cours",
    inFlightTitle: "Commandes confirmées par cet agent, encore chez le transporteur",
    teamMedian: "Médiane de l'équipe",
    supervisorsGroup: "Managers et administrateurs — hors classement",
    openAgent: "Ouvrir la fiche de {name}",
    openAgentColumn: "Ouvrir la fiche agent",
    unknownAgent: "Compte système / hors marché",
    roles: {
      agent: "Agent",
      market_manager: "Manager marché",
      super_admin: "Super admin",
      warehouse_agent: "Entrepôt",
    },
    readingNote:
      "Tout ce qui suit la confirmation est attribué au dernier agent qui a confirmé.",
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

function agent(over: Partial<AgentRankRow>): AgentRankRow {
  return {
    actor_id: "x",
    full_name: "x",
    role: "agent",
    calls: 0,
    orders_called: 0,
    orders_treated: 0,
    confirmed: 0,
    delivered: 0,
    returned: 0,
    in_flight: 0,
    other: 0,
    revenue: 0,
    ...over,
  };
}

const ROWS: AgentRankRow[] = [
  agent({ actor_id: "a1", full_name: "roqaya", calls: 314, orders_called: 119, orders_treated: 265, confirmed: 105, delivered: 37, returned: 14, in_flight: 30, other: 24, revenue: 5142 }),
  agent({ actor_id: "a2", full_name: "mouna", calls: 520, orders_called: 180, orders_treated: 300, confirmed: 197, delivered: 22, returned: 6, in_flight: 147, other: 22, revenue: 2888 }),
  agent({ actor_id: "a3", full_name: "tasnim", calls: 231, orders_called: 64, orders_treated: 117, confirmed: 44, delivered: 13, returned: 3, in_flight: 11, other: 17, revenue: 1935 }),
  agent({ actor_id: "a4", full_name: "salima", calls: 30, orders_called: 13, orders_treated: 28, confirmed: 12, delivered: 1, returned: 0, in_flight: 10, other: 1, revenue: 129 }),
  agent({ actor_id: "m1", full_name: "hamidaly", role: "market_manager", calls: 93, orders_called: 56, orders_treated: 56, confirmed: 1, delivered: 1, returned: 0, in_flight: 0, other: 0, revenue: 129 }),
  agent({ actor_id: null, full_name: null, role: "super_admin", calls: 112, orders_called: 75, orders_treated: 75, confirmed: 2, delivered: 0, returned: 0, in_flight: 1, other: 1, revenue: 0 }),
];

const money = (n: number) => `${n} DT`;

function renderTable(rows: AgentRankRow[] = ROWS) {
  return render(<AgentRankTable rows={rows} formatMoney={money} />);
}

/** Ordre d'apparition des noms dans le corps du tableau. */
function nameOrder(names: string[]): number[] {
  const text = screen.getAllByRole("row").map((r) => r.textContent ?? "");
  return names.map((n) => text.findIndex((t) => t.includes(n)));
}

describe("AgentRankTable — classement", () => {
  it("classe les agents par CA décroissant et pose les rangs 1 à 4", () => {
    renderTable();
    const [r1, r2, r3, r4] = nameOrder(["roqaya", "mouna", "tasnim", "salima"]);
    expect(r1).toBeLessThan(r2);
    expect(r2).toBeLessThan(r3);
    expect(r3).toBeLessThan(r4);

    const roqaya = screen.getByRole("row", { name: /roqaya/ });
    expect(within(roqaya).getByText("1")).toBeInTheDocument();
    const salima = screen.getByRole("row", { name: /salima/ });
    expect(within(salima).getByText("4")).toBeInTheDocument();
  });

  it("sort managers et administrateurs du classement, dans un groupe repliable", () => {
    renderTable();
    const toggle = screen.getByRole("button", { name: /hors classement/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // hamidaly a plus de CA que personne parmi les agents ? non — mais il ne
    // porte AUCUN rang : il n'est pas classé.
    const hamidaly = screen.getByRole("row", { name: /hamidaly/ });
    expect(within(hamidaly).queryByText("1")).toBeNull();
    expect(within(hamidaly).queryByText("5")).toBeNull();
  });

  it("replie le groupe hors classement au clic", async () => {
    const user = userEvent.setup();
    renderTable();
    const toggle = screen.getByRole("button", { name: /hors classement/ });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("hamidaly")).toBeNull();
    // les agents classés restent visibles
    expect(screen.getByText("roqaya")).toBeInTheDocument();
  });

  it("nomme le compte invisible au manager plutôt que de le masquer", () => {
    renderTable();
    expect(screen.getByText("Compte système / hors marché")).toBeInTheDocument();
  });
});

describe("AgentRankTable — tri", () => {
  it("n'annote aria-sort que sur la colonne active", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Appels" }));
    const headers = screen.getAllByRole("columnheader");
    const sorted = headers.filter((h) => h.hasAttribute("aria-sort"));
    expect(sorted).toHaveLength(1);
    expect(sorted[0].textContent).toContain("Appels");
    expect(sorted[0].getAttribute("aria-sort")).toBe("descending");
  });

  it("inverse la direction au second clic sur le même en-tête", async () => {
    const user = userEvent.setup();
    renderTable();
    const callsHeader = screen.getByRole("button", { name: "Appels" });
    await user.click(callsHeader);
    await user.click(callsHeader);
    const sorted = screen
      .getAllByRole("columnheader")
      .filter((h) => h.hasAttribute("aria-sort"));
    expect(sorted[0].getAttribute("aria-sort")).toBe("ascending");
    // salima (30 appels) passe devant mouna (520 appels)
    const [salima, mouna] = nameOrder(["salima", "mouna"]);
    expect(salima).toBeLessThan(mouna);
  });

  it("ne trie jamais les managers dans le classement", async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole("button", { name: "Appels" }));
    const [mouna, hamidaly] = nameOrder(["mouna", "hamidaly"]);
    // hamidaly (93 appels) resterait entre tasnim et salima s'il était classé ;
    // il doit rester après le séparateur, donc après tous les agents.
    expect(mouna).toBeLessThan(hamidaly);
    const [salima] = nameOrder(["salima"]);
    expect(salima).toBeLessThan(hamidaly);
  });
});

describe("AgentRankTable — cellules de mesure", () => {
  it("affiche confirmées ÷ traitées et livrées ÷ confirmées", () => {
    renderTable();
    const roqaya = screen.getByRole("row", { name: /roqaya/ });
    // 105 / 265 = 39,6 %   ·   37 / 105 = 35,2 %
    expect(roqaya.textContent).toMatch(/39,6/);
    expect(roqaya.textContent).toMatch(/105 sur 265 traitées/);
    expect(roqaya.textContent).toMatch(/35,2/);
    expect(roqaya.textContent).toMatch(/37 livrées · 14 retours/);
  });

  it("affiche un tiret, jamais 0 % ni NaN, quand le dénominateur est nul", () => {
    renderTable([
      agent({ actor_id: "z", full_name: "zora", orders_treated: 0, confirmed: 0 }),
    ]);
    const zora = screen.getByRole("row", { name: /zora/ });
    expect(zora.textContent).toContain("—");
    expect(zora.textContent).not.toMatch(/NaN|0,0\s*%/);
    expect(zora.textContent).toContain("aucun appel passé");
  });

  it("porte la pastille « en cours » par agent", () => {
    renderTable();
    const mouna = screen.getByRole("row", { name: /mouna/ });
    expect(mouna.textContent).toMatch(/\+147 en cours/);
  });

  it("pose un repère médiane sur chaque jauge", () => {
    const { container } = renderTable();
    const markers = container.querySelectorAll('[title="Médiane de l\'équipe"]');
    // 3 colonnes mesurées × 4 agents classés + les 2 lignes hors classement
    expect(markers.length).toBeGreaterThanOrEqual(12);
  });
});

describe("AgentRankTable — accessibilité des en-têtes", () => {
  it("expose une infobulle focalisable par en-tête, reliée par aria-describedby", () => {
    renderTable();
    const info = screen.getByRole("button", { name: "À propos de Appels" });
    const id = info.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    const bubble = document.getElementById(id as string);
    expect(bubble).not.toBeNull();
    expect(bubble).toHaveAttribute("role", "tooltip");
    expect(bubble?.textContent).toContain("Tentatives d'appel");
  });

  it("légende le tableau", () => {
    renderTable();
    expect(
      screen.getByRole("table", { name: /Comparaison des agents/ }),
    ).toBeInTheDocument();
  });
});

describe("AgentRankTable — état vide", () => {
  it("rend un message plutôt qu'un tableau vide", () => {
    renderTable([]);
    expect(
      screen.getByText("Aucun agent n'a travaillé ce produit sur la période."),
    ).toBeInTheDocument();
  });
});

describe("computeAgentRates", () => {
  it("transpose le taux de livraison à l'agent : livrées ÷ confirmées", () => {
    const r = computeAgentRates(
      agent({ orders_treated: 265, confirmed: 105, delivered: 37 }),
    );
    expect(r.confirmationRate).toBeCloseTo(39.6226, 3);
    expect(r.deliveryRate).toBeCloseTo(35.2381, 3);
  });

  it("renvoie null, pas zéro, sur un dénominateur nul", () => {
    const r = computeAgentRates(agent({ orders_treated: 0, confirmed: 0 }));
    expect(r.confirmationRate).toBeNull();
    expect(r.deliveryRate).toBeNull();
  });
});

describe("teamMedians", () => {
  it("ne prend que les agents — managers et admins fausseraient la comparaison", () => {
    const med = teamMedians(ROWS);
    // appels des seuls agents : 30, 231, 314, 520 → médiane (231+314)/2 = 272,5
    expect(med.calls).toBeCloseTo(272.5, 3);
  });

  it("ignore les taux nuls dans la médiane", () => {
    const med = teamMedians([
      agent({ orders_treated: 10, confirmed: 5, delivered: 1 }), // 50 % / 20 %
      agent({ orders_treated: 10, confirmed: 1, delivered: 1 }), // 10 % / 100 %
      agent({ orders_treated: 0, confirmed: 0, delivered: 0 }), // null / null
    ]);
    expect(med.confirmationRate).toBeCloseTo(30, 3);
    expect(med.deliveryRate).toBeCloseTo(60, 3);
  });

  it("renvoie zéro sur un jeu vide plutôt que NaN", () => {
    const med = teamMedians([]);
    expect(med.calls).toBe(0);
    expect(med.confirmationRate).toBe(0);
    expect(med.deliveryRate).toBe(0);
  });
});
