import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import type { ProjectedReception, ProjectedLine } from "@/lib/receptions/project";
import type { LinePatch } from "../ReceptionLineEditor";

import { ReceptionCountFlow } from "../ReceptionCountFlow";

function line(over: Partial<ProjectedLine> = {}): ProjectedLine {
  return {
    id: "l1",
    product_id: "p1",
    variant_id: null,
    product_name: "مصحف التهجد و قيام الليل",
    product_sku: "th-01",
    product_image_url: null,
    product_stock: 218,
    variant_label: null,
    expected_qty: 100,
    received_qty: null,
    damaged_qty: 0,
    variance: null,
    note: null,
    ...over,
  };
}

function reception(over: Partial<ProjectedReception> = {}): ProjectedReception {
  return {
    id: "r1",
    reference: "REC-LY-2026-0044",
    market_id: "m-ly",
    warehouse_id: "w-tripoli",
    warehouse_name: "Tripoli",
    warehouse_name_ar: "طرابلس",
    supplier_name: "مكتبة الرسالة",
    supplier_ref: "BL-4471",
    status: "draft",
    expected_at: "2026-10-02",
    note: null,
    photo_url: null,
    submitted_at: null,
    submitted_by_name: null,
    posted_at: null,
    posted_by_name: null,
    reverses_reception_id: null,
    created_at: "2026-10-01T08:00:00Z",
    is_late: false,
    days_late: null,
    lines: [line(), line({ id: "l2", product_name: "القرآن تدبر وعمل", expected_qty: 150 })],
    totals: { units: 0, damaged: 0, value: null, lines: 2, expected: 250, countedLines: 0 },
    payments: [],
    paid_total: null,
    outstanding: null,
    payment_state: null,
    can: { submit: true, post: false, reverse: false, pay: false, sendBack: false },
    ...over,
  };
}

const onPatch = vi.fn();
const onClose = vi.fn();

function wrap(
  over: Partial<ProjectedReception> = {},
  edits: Record<string, LinePatch> = {},
  locale: "fr" | "ar" = "fr",
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? ar : fr}>
      <ReceptionCountFlow
        reception={reception(over)}
        locale={locale}
        edits={edits}
        onPatch={onPatch}
        onClose={onClose}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

/**
 * LE COMPTAGE SUR LE QUAI — maquette §6.
 *
 * Même grammaire que la tournée de scan : une ligne à la fois, avec sa
 * progression. On ne demande pas à quelqu'un debout devant une palette de
 * remplir un tableau à six colonnes sur un écran de 390 px.
 */
describe("ReceptionCountFlow — une ligne à la fois", () => {
  it("montre la première ligne et sa progression", () => {
    wrap();
    expect(screen.getByText("مصحف التهجد و قيام الليل")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    // La deuxième ligne n'est pas encore là : c'est tout l'intérêt.
    expect(screen.queryByText("القرآن تدبر وعمل")).not.toBeInTheDocument();
  });

  it("avance à la ligne suivante", () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /suivant/i }));
    expect(screen.getByText("القرآن تدبر وعمل")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("montre l'attendu de la ligne", () => {
    wrap();
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});

/**
 * LES DEUX RACCOURCIS. Les deux cas réels sur un quai sont « tout est arrivé »
 * et « rien n'est arrivé ». Les taper chiffre par chiffre était du travail
 * inutile, et c'est ce que la v2 de la maquette a ajouté.
 */
describe("ReceptionCountFlow — les raccourcis de quantité", () => {
  it("le raccourci « l'attendu » remplit le champ avec l'attendu", () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /l'attendu 100/i }));
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ received_qty: 100 }));
  });

  /*
   * « Zéro » écrit un ZÉRO, pas un champ vide. « Le carton était vide » est une
   * réponse ; « je n'ai pas encore regardé » est son contraire, et les confondre
   * ferait valider une réception que personne n'a comptée.
   */
  it("le raccourci « zéro » écrit 0 et non null", () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /^zéro$/i }));
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ received_qty: 0 }));
  });

  it("n'offre pas le raccourci « l'attendu » quand rien n'était annoncé", () => {
    wrap({ lines: [line({ expected_qty: null })] });
    expect(screen.queryByRole("button", { name: /l'attendu/i })).not.toBeInTheDocument();
    // Mais « zéro » reste utile : le carton peut être vide.
    expect(screen.getByRole("button", { name: /^zéro$/i })).toBeInTheDocument();
  });

  it("incrémente et décrémente d'une unité", () => {
    wrap({}, { l1: { received_qty: 94, damaged_qty: 0, unit_cost: null } });
    fireEvent.click(screen.getByRole("button", { name: /un de plus/i }));
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ received_qty: 95 }));
    fireEvent.click(screen.getByRole("button", { name: /un de moins/i }));
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ received_qty: 93 }));
  });

  it("ne descend jamais sous zéro", () => {
    wrap({}, { l1: { received_qty: 0, damaged_qty: 0, unit_cost: null } });
    fireEvent.click(screen.getByRole("button", { name: /un de moins/i }));
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ received_qty: 0 }));
  });

  /* Un champ vide + « un de plus » part de 1, pas de NaN. */
  it("part de 1 quand rien n'est encore compté", () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /un de plus/i }));
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ received_qty: 1 }));
  });
});

/**
 * « PASSER » LAISSE LA LIGNE INCONNUE. Un agent qui n'a pas ouvert le carton
 * doit pouvoir avancer sans rien affirmer — sinon il écrira n'importe quoi pour
 * se débarrasser de l'écran, ce qui est exactement ce qu'on cherche à éviter.
 */
describe("ReceptionCountFlow — passer sans mentir", () => {
  it("avance sans rien écrire", () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /passer/i }));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
  });

  it("ferme le comptage sur la dernière ligne", () => {
    wrap({ lines: [line()] });
    fireEvent.click(screen.getByRole("button", { name: /terminer la saisie/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * ABÎMÉ EST UN SECOND NOMBRE, PAS UNE SOUSTRACTION. Les fondre obligerait
 * l'agent à faire un calcul mental debout devant une palette.
 */
describe("ReceptionCountFlow — abîmé à l'arrivée", () => {
  it("saisit les abîmées séparément", () => {
    wrap();
    fireEvent.change(screen.getByLabelText(/abîmé à l'arrivée/i), { target: { value: "2" } });
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ damaged_qty: 2 }));
  });

  it("vider le champ abîmé vaut zéro, pas inconnu", () => {
    wrap({}, { l1: { received_qty: 94, damaged_qty: 2, unit_cost: null } });
    fireEvent.change(screen.getByLabelText(/abîmé à l'arrivée/i), { target: { value: "" } });
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ damaged_qty: 0 }));
  });
});

/**
 * AUCUN COÛT, NULLE PART. Le prix est absent de la réponse API pour un agent, et
 * ce composant ne doit pas en rendre même si on lui en donnait un : il sert sur
 * un quai, et un agent qui compte des objets n'a pas affaire à leur prix.
 */
describe("ReceptionCountFlow — aucun prix sur le quai", () => {
  it("ne montre aucun coût même quand la ligne en porte un", () => {
    wrap({ lines: [line({ unit_cost: 85, line_value: 7990 })] });
    expect(screen.queryByText(/85/)).not.toBeInTheDocument();
    expect(screen.queryByText(/7\s*990/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/coût/i)).not.toBeInTheDocument();
  });
});

describe("ReceptionCountFlow — en arabe", () => {
  it("rend la scène en RTL avec les mots arabes", () => {
    const { container } = wrap({}, {}, "ar");
    expect(screen.getByText("الكمية المستلمة")).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});

/**
 * LE STOCK ACTUEL, À CÔTÉ DE L'ATTENDU — maquette §6 (« متوقع 100 » et
 * « في المخزون 218 »). Ce n'est pas une information de coût : c'est le chiffre
 * qui dit à l'agent si ce carton comble un manque ou empile du dormant, et il le
 * voit déjà sur l'onglet Niveaux.
 */
describe("ReceptionCountFlow — le stock actuel", () => {
  it("montre le stock actuel du produit à côté de l'attendu", () => {
    wrap({ lines: [line({ product_stock: 218 })] });
    expect(screen.getByText(/en stock/i)).toBeInTheDocument();
    expect(screen.getByText("218")).toBeInTheDocument();
  });

  it("n'invente pas un stock quand il est inconnu", () => {
    wrap({ lines: [line({ product_stock: null })] });
    expect(screen.queryByText(/en stock/i)).not.toBeInTheDocument();
  });
});
