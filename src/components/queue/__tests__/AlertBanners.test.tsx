import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { AlertBanners, panelNotes, type NoteInput } from "../OrderDetailPanel/AlertBanners";

const BASE: NoteInput = {
  status: "pending",
  cityMissing: false,
  outOfStock: false,
  dupShipped: false,
  editBlocked: false,
  callbackScheduledAt: null,
  dispatchScheduledAt: null,
};

describe("panelNotes — one short line per problem (prototype notesOf)", () => {
  test("says nothing when nothing is wrong", () => {
    expect(panelNotes(BASE)).toEqual([]);
  });

  test("warns not to confirm a product that is out of stock, while the call is on", () => {
    expect(panelNotes({ ...BASE, outOfStock: true })).toContain("outOfStock");
    expect(panelNotes({ ...BASE, outOfStock: true, status: "uploaded" })).not.toContain("outOfStock");
  });

  test("asks for the city before the order can be sent", () => {
    expect(panelNotes({ ...BASE, cityMissing: true })).toContain("noCity");
    expect(panelNotes({ ...BASE, cityMissing: true, status: "confirmed" })).toContain("noCity");
    expect(panelNotes({ ...BASE, cityMissing: true, status: "delivered" })).not.toContain("noCity");
  });

  test("flags a copy already with the carrier until this one ships", () => {
    expect(panelNotes({ ...BASE, dupShipped: true })).toContain("dupShipped");
    expect(panelNotes({ ...BASE, dupShipped: true, status: "uploaded" })).not.toContain("dupShipped");
  });

  test("tells a shipped order to be reopened before it can be edited", () => {
    expect(panelNotes({ ...BASE, status: "uploaded", editBlocked: true })).toContain("locked");
  });

  test("keeps the scheduled callback and the scheduled dispatch in view", () => {
    expect(panelNotes({ ...BASE, status: "callback_scheduled", callbackScheduledAt: "2026-10-04T16:00:00Z" })).toContain("callback");
    expect(panelNotes({ ...BASE, status: "dispatch_scheduled", dispatchScheduledAt: "2026-10-05T08:00:00Z" })).toContain("dispatch");
  });

  test("leads with the blockers", () => {
    const notes = panelNotes({ ...BASE, outOfStock: true, cityMissing: true, status: "callback_scheduled", callbackScheduledAt: "2026-10-04T16:00:00Z" });
    expect(notes[0]).toBe("outOfStock");
    expect(notes.at(-1)).toBe("callback");
  });
});

describe("AlertBanners — the notes above the footer", () => {
  function renderNotes(props: Partial<React.ComponentProps<typeof AlertBanners>>) {
    return render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <AlertBanners notes={[]} marketId={null} {...props} />
      </NextIntlClientProvider>,
    );
  }

  test("renders nothing when there is nothing to say", () => {
    const { container } = renderNotes({});
    expect(container.querySelector(".notes")).toBeNull();
  });

  test("writes each problem as a line in its hue, with an icon", () => {
    renderNotes({ notes: ["outOfStock", "noCity", "locked"] });
    expect(screen.getByText("Rupture de stock — ne pas confirmer").closest(".note")).toHaveClass("h-red");
    expect(screen.getByText("Ville non renseignée — à définir avant l'envoi").closest(".note")).toHaveClass("h-amber");
    const locked = screen.getByText("Réouvrez la commande pour modifier ses détails.").closest(".note")!;
    expect(locked).toHaveClass("h-neutral");
    expect(locked.querySelector("svg")).not.toBeNull();
  });

  test("adds the panel's own feedback lines after the problems", () => {
    renderNotes({ notes: ["locked"], extra: [{ key: "x", hue: "red", icon: "alert", text: "Échec de l'envoi", alert: true }] });
    const lines = screen.getAllByText(/./, { selector: ".note > span" }).map((n) => n.textContent);
    expect(lines).toEqual(["Réouvrez la commande pour modifier ses détails.", "Échec de l'envoi"]);
    expect(screen.getByRole("alert")).toHaveTextContent("Échec de l'envoi");
  });
});
