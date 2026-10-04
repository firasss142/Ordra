import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import type { ProjectedClaim } from "@/lib/receptions/project";
import { ReceptionClaimBlock } from "../ReceptionClaimBlock";

function claim(over: Partial<ProjectedClaim> = {}): ProjectedClaim {
  return {
    id: "cl-1",
    kind: "damaged",
    amount: 170,
    units: 2,
    status: "open",
    opened_at: "2026-09-29T10:00:00Z",
    resolved_at: null,
    resolution_note: null,
    credit_ref: null,
    withheld: 170,
    disputed: 170,
    ...over,
  };
}

const onChanged = vi.fn().mockResolvedValue(undefined);

function wrap(over: Partial<ProjectedClaim> = {}, editable = true) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ReceptionClaimBlock
        claim={claim(over)}
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
 * L'AVARIE DEVIENT ENFIN UNE ACTION.
 *
 * `damaged_qty` était saisi sur le quai et lu par personne. Ici il porte un
 * montant, un interlocuteur et deux issues.
 */
describe("ReceptionClaimBlock — ce qu'il dit", () => {
  it("nomme la cause et le montant", () => {
    wrap();
    expect(screen.getByText(/2 unités arrivées cassées/i)).toBeInTheDocument();
    expect(screen.getByText("170,000")).toBeInTheDocument();
  });

  it("dit « surfacturation inexpliquée » quand la base ne sait pas", () => {
    // On ne devine pas une cause. « On ne sait pas pourquoi » est une réponse.
    wrap({ kind: "overbilled", units: null });
    expect(screen.getByText(/surfacturation inexpliquée/i)).toBeInTheDocument();
  });

  it("montre l'avoir reçu et sa référence", () => {
    wrap({ status: "credited", credit_ref: "AV-4471", resolved_at: "2026-10-02T09:00:00Z" });
    expect(screen.getByText(/avoir reçu/i)).toBeInTheDocument();
    expect(screen.getByText(/AV-4471/)).toBeInTheDocument();
  });

  it("n'offre plus d'issue sur un litige résolu", () => {
    wrap({ status: "conceded", resolved_at: "2026-10-02T09:00:00Z" });
    expect(screen.queryByRole("button", { name: /renoncer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /avoir reçu/i })).not.toBeInTheDocument();
  });

  it("n'offre aucune issue à qui ne gère pas les fournisseurs", () => {
    wrap({}, false);
    expect(screen.queryByRole("button", { name: /renoncer/i })).not.toBeInTheDocument();
  });
});

describe("ReceptionClaimBlock — résoudre", () => {
  it("exige la référence de l'avoir avant d'appeler le serveur", async () => {
    // Un avoir se prouve : effacer une créance sur une parole est exactement
    // l'écriture qu'un audit demandera à voir.
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /avoir reçu/i }));
    fireEvent.click(screen.getByRole("button", { name: /^enregistrer/i }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("envoie l'avoir avec sa référence", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /avoir reçu/i }));
    fireEvent.change(screen.getByLabelText(/référence de l'avoir/i), {
      target: { value: "AV-4471" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^enregistrer/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(url).toBe("/api/purchases/claims/cl-1/resolve");
    expect(JSON.parse(init.body as string)).toMatchObject({
      outcome: "credited",
      credit_ref: "AV-4471",
    });
  });

  it("laisse renoncer sans référence — on ne prouve pas un abandon", async () => {
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /renoncer/i }));
    fireEvent.click(screen.getByRole("button", { name: /^enregistrer/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as unknown as { mock: { calls: [string, RequestInit][] } })
      .mock.calls[0];
    expect(JSON.parse(init.body as string).outcome).toBe("conceded");
  });

  it("montre le refus du serveur au lieu de se fermer en silence", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "Ce litige est déjà credited" }),
    }) as never;
    wrap();
    fireEvent.click(screen.getByRole("button", { name: /renoncer/i }));
    fireEvent.click(screen.getByRole("button", { name: /^enregistrer/i }));
    expect(await screen.findByText(/déjà credited/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
