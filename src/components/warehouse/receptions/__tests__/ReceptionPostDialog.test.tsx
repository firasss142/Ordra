import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { ProjectedReception, ProjectedLine } from "@/lib/receptions/project";

import { ReceptionPostDialog } from "../ReceptionPostDialog";

function line(over: Partial<ProjectedLine> = {}): ProjectedLine {
  return {
    id: "l1",
    product_id: "p1",
    variant_id: null,
    product_name: "القرآن تدبر وعمل",
    product_sku: "qr-01",
    product_image_url: null,
    product_stock: 943,
    variant_label: null,
    expected_qty: 150,
    received_qty: 150,
    damaged_qty: 0,
    variance: 0,
    note: null,
    unit_cost: 40,
    line_value: 6000,
    cogs_current: 40,
    cogs_next: 40,
    ...over,
  };
}

function reception(lines: ProjectedLine[]): ProjectedReception {
  return {
    id: "r1",
    reference: "REC-LY-2026-0042",
    market_id: "m-ly",
    warehouse_id: "w-tripoli",
    warehouse_name: "Tripoli",
    warehouse_name_ar: "طرابلس",
    supplier_name: null,
    supplier_ref: null,
    status: "submitted",
    expected_at: null,
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
    lines,
    totals: { units: 312, damaged: 2, value: 18720, lines: lines.length, expected: 310, countedLines: lines.length },
    payments: [],
    paid_total: 0,
    outstanding: 18720,
    payment_state: "unpaid",
    can: { submit: false, post: true, reverse: false, pay: true, sendBack: true },
  };
}

function wrap(lines: ProjectedLine[]) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ReceptionPostDialog
        reception={reception(lines)}
        currency="LYD"
        onClose={vi.fn()}
        onPosted={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never;
});

/**
 * SEULS LES COÛTS QUI BOUGENT SONT LISTÉS.
 *
 * Quatre lignes dont deux disaient « 40,000 → 40,000 » faisaient du bruit qui
 * cachait les deux vrais changements. Un coût inchangé est un fait, mais il se
 * COMPTE : il n'a pas besoin d'une ligne pour lui seul.
 */
describe("ReceptionPostDialog — l'arithmétique des coûts", () => {
  const moving = line({ id: "l2", product_name: "كتاب الحفظ الميسر", cogs_current: 75, cogs_next: 74.667 });
  const still = line({ id: "l3", product_name: "مصحف التهجد", cogs_current: 85, cogs_next: 85 });

  it("liste le coût qui change", () => {
    wrap([moving, still]);
    expect(screen.getByText("كتاب الحفظ الميسر")).toBeInTheDocument();
    expect(screen.getByText(/74,667/)).toBeInTheDocument();
  });

  it("ne liste pas celui qui ne change pas — il se compte", () => {
    wrap([moving, still]);
    expect(screen.queryByText("مصحف التهجد")).not.toBeInTheDocument();
    expect(screen.getByText(/1 autres? produits? gardent? exactement/i)).toBeInTheDocument();
  });

  it("ne dit rien du tout quand tous les coûts bougent", () => {
    wrap([moving]);
    expect(screen.queryByText(/gardent exactement/i)).not.toBeInTheDocument();
  });

  /*
   * Si AUCUN coût ne bouge, la case à cocher n'a aucun objet : l'afficher
   * proposerait une décision sans conséquence, et la décocher par prudence
   * n'aurait rien évité.
   */
  it("retire la case à cocher quand aucun coût ne bougerait", () => {
    wrap([still]);
    expect(screen.queryByText(/adopter les nouveaux coûts/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /valider et entrer en stock/i })).toBeInTheDocument();
  });

  it("annonce combien de coûts changeraient", () => {
    const other = line({ id: "l4", product_name: "كتاب الداء والدواء", cogs_current: 27, cogs_next: 27.929 });
    wrap([moving, other, still]);
    expect(screen.getByText(/2 produits changeraient de coût/i)).toBeInTheDocument();
  });

  it("barre l'ancien coût, puisqu'il est réellement remplacé", () => {
    wrap([moving]);
    expect(screen.getByText(/75,000/).className).toMatch(/line-through/);
  });
});
