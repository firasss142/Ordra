import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { ProjectedLine } from "@/lib/receptions/project";
import { ReceptionLineEditor } from "../ReceptionLineEditor";

/**
 * La saisie des quantités — le geste central de l'agent sur le quai.
 *
 * Trois règles de ce projet sont testées ici plutôt que commentées :
 *   · une quantité vide n'est PAS zéro (« pas encore comptée » vs « rien n'est
 *     arrivé » sont des faits opposés) ;
 *   · l'écart n'apparaît que si les deux nombres existent ;
 *   · un agent d'entrepôt ne voit aucun prix.
 */

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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
    ordered_qty: 150,
    received_qty: null,
    damaged_qty: 0,
    variance: null,
    note: null,
    ...over,
  };
}

let onChange: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onChange = vi.fn();
});

describe("ReceptionLineEditor — la saisie", () => {
  it("laisse le champ VIDE quand rien n'a été compté, jamais 0", () => {
    wrap(<ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />);
    const received = screen.getByLabelText(/reçu/i) as HTMLInputElement;
    expect(received.value).toBe("");
  });

  /*
   * L'ANCRE N'EXISTE PLUS, ET CE TEST EST LÀ POUR QU'ELLE NE REVIENNE PAS.
   *
   * Il y avait ici un bouton qui adoptait la quantité commandée d'un seul
   * doigt. Montrer « commandé 150 » avant le comptage ne fait pas gagner du
   * temps : ça fait ÉCRIRE 150 — on avait construit l'ancrage exprès et on
   * l'appelait confort. Les quantités appartiennent désormais au quai, qui ne
   * voit pas le commandé du tout.
   */
  it("n'offre aucun geste pour adopter la quantité commandée", () => {
    wrap(<ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: /150/ })).not.toBeInTheDocument();
  });

  it("permet de déclarer zéro explicitement — « rien n'est arrivé » est une réponse", () => {
    wrap(<ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ received_qty: 0 }));
  });

  it("revient à null quand on vide le champ, et pas à 0", () => {
    wrap(
      <ReceptionLineEditor line={line({ received_qty: 12 })} withCosts={false} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ received_qty: null }));
  });

  it("refuse une quantité négative", () => {
    wrap(<ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "-5" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuse une quantité fractionnaire — on ne reçoit pas 2,5 livres", () => {
    wrap(<ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/reçu/i), { target: { value: "2.5" } });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ReceptionLineEditor — l'écart", () => {
  it("n'affiche aucun écart tant que rien n'est compté", () => {
    wrap(<ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />);
    expect(screen.queryByText(/conforme/i)).not.toBeInTheDocument();
    expect(screen.getByText(/pas encore comptée/i)).toBeInTheDocument();
  });

  it("dit « conforme » à égalité", () => {
    wrap(
      <ReceptionLineEditor
        line={line({ received_qty: 150, variance: 0 })}
        withCosts={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/conforme/i)).toBeInTheDocument();
  });

  it("montre le manque signé", () => {
    wrap(
      <ReceptionLineEditor
        line={line({ ordered_qty: 100, received_qty: 94, variance: -6 })}
        withCosts={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("−6")).toBeInTheDocument();
  });

  it("dit « hors bon » pour ce qui n'était pas annoncé, sans inventer d'écart", () => {
    wrap(
      <ReceptionLineEditor
        line={line({ ordered_qty: null, received_qty: 8, variance: null })}
        withCosts={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/non commandé/i)).toBeInTheDocument();
    expect(screen.queryByText(/conforme/i)).not.toBeInTheDocument();
  });
});

describe("ReceptionLineEditor — les abîmées", () => {
  it("sont un nombre distinct de la quantité reçue", () => {
    wrap(<ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/abîmé/i), { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ damaged_qty: 3 }));
  });

  it("valent 0 par défaut, ce qui est une vraie valeur ici", () => {
    // Contrairement à « reçu », zéro abîmée est l'état normal et non une inconnue.
    wrap(<ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />);
    expect((screen.getByLabelText(/abîmé/i) as HTMLInputElement).value).toBe("0");
  });
});

describe("ReceptionLineEditor — le coût", () => {
  it("n'existe pas pour un agent d'entrepôt", () => {
    const { container } = wrap(
      <ReceptionLineEditor line={line()} withCosts={false} onChange={onChange} />,
    );
    expect(screen.queryByLabelText(/coût/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/40,000/);
  });

  it("est saisissable par qui a le droit de le voir", () => {
    wrap(
      <ReceptionLineEditor
        line={line({ unit_cost: 40 })}
        withCosts
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/coût/i), { target: { value: "42,5" } });
    // La virgule décimale est la norme en français et doit être acceptée.
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ unit_cost: 42.5 }));
  });

  it("accepte un coût vide sans le transformer en 0", () => {
    wrap(
      <ReceptionLineEditor line={line({ unit_cost: 40 })} withCosts onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText(/coût/i), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ unit_cost: null }));
  });
});

describe("ReceptionLineEditor — lecture seule", () => {
  it("ne propose aucun champ quand la réception est validée", () => {
    wrap(
      <ReceptionLineEditor
        line={line({ ordered_qty: 150, received_qty: 148, variance: -2 })}
        withCosts
        readOnly
        onChange={onChange}
      />,
    );
    expect(screen.queryByLabelText(/reçu/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/abîmé/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/coût/i)).not.toBeInTheDocument();
    // Les chiffres restent lisibles, et l'écart avec.
    expect(screen.getByText("148")).toBeInTheDocument();
    expect(screen.getByText("−2")).toBeInTheDocument();
  });
});
