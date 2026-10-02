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
const onDeclare = vi.fn();

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
        onDeclare={onDeclare}
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

  /*
   * Ce test affirmait que la dernière ligne FERMAIT le comptage. C'était
   * justement le défaut : l'agent comptait son dernier carton et se retrouvait
   * sur la feuille sans avoir rien déclaré. Elle mène maintenant au
   * récapitulatif, et c'est de là qu'on déclare.
   */
  it("mène au récapitulatif sur la dernière ligne, sans fermer", () => {
    wrap({ lines: [line()] });
    fireEvent.click(screen.getByRole("button", { name: /terminer la saisie/i }));
    expect(screen.getByText(/le comptage est terminé/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * ABÎMÉ EST UN SECOND NOMBRE, PAS UNE SOUSTRACTION. Les fondre obligerait
 * l'agent à faire un calcul mental debout devant une palette.
 */
describe("ReceptionCountFlow — abîmé à l'arrivée", () => {
  it("saisit les abîmées séparément", () => {
    wrap();
    // Le champ est derrière un geste depuis la v3 — l'avarie est l'exception.
    fireEvent.click(screen.getByRole("button", { name: /signaler un article abîmé/i }));
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

/**
 * L'AVARIE EST UN GESTE, PAS UN CHAMP PERMANENT.
 *
 * Un encadré ambre présent sur chaque ligne réclame une avarie qui n'arrive
 * presque jamais, et finit par ne plus rien signaler. Il reste à un geste.
 */
describe("ReceptionCountFlow — l'avarie est un geste", () => {
  it("n'affiche pas le champ abîmé tant qu'il n'y a rien à signaler", () => {
    wrap();
    expect(screen.queryByLabelText(/abîmé à l'arrivée/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /signaler un article abîmé/i })).toBeInTheDocument();
  });

  it("l'ouvre au geste, et la saisie fonctionne", () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /signaler un article abîmé/i }));
    const field = screen.getByLabelText(/abîmé à l'arrivée/i);
    fireEvent.change(field, { target: { value: "2" } });
    expect(onPatch).toHaveBeenCalledWith("l1", expect.objectContaining({ damaged_qty: 2 }));
  });

  /* Une ligne qui PORTE déjà une avarie montre son champ sans qu'on le demande. */
  it("l'affiche d'emblée quand la ligne porte déjà une avarie", () => {
    wrap({}, { l1: { received_qty: 94, damaged_qty: 2, unit_cost: null } });
    expect(screen.getByLabelText(/abîmé à l'arrivée/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /signaler un article abîmé/i })).not.toBeInTheDocument();
  });
});

/**
 * LE RÉCAPITULATIF — la fin que le parcours n'avait pas.
 *
 * On faisait compter la dernière ligne à l'agent et on s'arrêtait : il n'existait
 * aucun moment pour déclarer. L'écran montre ce qu'il va affirmer, y compris LA
 * LIGNE QU'IL A SAUTÉE — une réception déclarée avec une ligne non comptée est un
 * fait et non une erreur, mais il doit le savoir avant de signer.
 */
describe("ReceptionCountFlow — le récapitulatif", () => {
  function toEnd() {
    // deux lignes dans le gabarit : une avance suffit pour atteindre la dernière
    fireEvent.click(screen.getByRole("button", { name: /^suivant$/i }));
    fireEvent.click(screen.getByRole("button", { name: /terminer la saisie/i }));
  }

  it("s'ouvre à la fin au lieu de fermer", () => {
    wrap({}, { l1: { received_qty: 150, damaged_qty: 0, unit_cost: null } });
    toEnd();
    expect(screen.getByText(/le comptage est terminé/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("totalise ce qui a été compté", () => {
    wrap(
      {},
      {
        l1: { received_qty: 94, damaged_qty: 2, unit_cost: null },
        l2: { received_qty: 150, damaged_qty: 0, unit_cost: null },
      },
    );
    toEnd();
    expect(screen.getByText("244")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("montre la ligne sautée au lieu de la taire", () => {
    wrap({}, { l1: { received_qty: 94, damaged_qty: 0, unit_cost: null } });
    toEnd();
    expect(screen.getByText(/non comptées/i)).toBeInTheDocument();
    // La ligne non comptée porte un tiret, jamais un zéro.
    const rows = screen.getAllByTestId("count-summary-row");
    expect(rows[1]).toHaveTextContent("—");
  });

  it("propose de déclarer, et revient en arrière sans rien perdre", () => {
    wrap({}, { l1: { received_qty: 150, damaged_qty: 0, unit_cost: null } });
    toEnd();
    expect(screen.getByRole("button", { name: /déclarer la réception/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^retour$/i }));
    expect(screen.getByLabelText(/quantité reçue/i)).toBeInTheDocument();
  });

  it("remonte la demande de déclaration à la feuille", () => {
    wrap({}, { l1: { received_qty: 150, damaged_qty: 0, unit_cost: null } });
    toEnd();
    fireEvent.click(screen.getByRole("button", { name: /déclarer la réception/i }));
    expect(onDeclare).toHaveBeenCalled();
  });
});

/**
 * ON NE PROPOSE PAS DE DÉCLARER CE QUI EST DÉJÀ DÉCLARÉ.
 *
 * Le comptage s'ouvre aussi sur une réception DÉJÀ déclarée — un manager qui
 * recompte avant de valider. Mais `POST …/submit` n'accepte qu'un brouillon :
 * proposer « Déclarer » là aurait mené à un 409 sur le dernier écran du parcours,
 * c'est-à-dire à un cul-de-sac au moment précis où l'agent croit avoir fini. Le
 * bouton devient donc « Enregistrer les quantités », qui est le geste réel.
 */
describe("ReceptionCountFlow — le récapitulatif selon le statut", () => {
  function toEnd() {
    fireEvent.click(screen.getByRole("button", { name: /^suivant$/i }));
    fireEvent.click(screen.getByRole("button", { name: /terminer la saisie/i }));
  }

  it("propose de déclarer un brouillon", () => {
    wrap({ status: "draft", can: { submit: true, post: false, reverse: false, pay: false, sendBack: false } });
    toEnd();
    expect(screen.getByRole("button", { name: /déclarer la réception/i })).toBeInTheDocument();
  });

  it("propose seulement d'enregistrer une réception déjà déclarée", () => {
    wrap({
      status: "submitted",
      can: { submit: false, post: true, reverse: false, pay: true, sendBack: true },
    });
    toEnd();
    expect(screen.queryByRole("button", { name: /déclarer la réception/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enregistrer les quantités/i })).toBeInTheDocument();
  });
});
