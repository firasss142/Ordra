import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionFooter } from "../ActionFooter";
import type { PanelActions } from "../types";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

const CALL_OUTCOMES: PanelActions = {
  primary: { kind: "confirm", labelKey: "actions.confirm" },
  outcomes: [
    { kind: "endCall", labelKey: "actions.endCall" },
    { kind: "callback", labelKey: "actions.callback" },
    { kind: "reject", labelKey: "actions.reject", destructive: true },
  ],
  overflow: [],
};

const WITH_MENU: PanelActions = {
  ...CALL_OUTCOMES,
  overflow: [{ kind: "cancel", labelKey: "actions.cancel", destructive: true }],
};

const SINGLE_CTA: PanelActions = {
  primary: { kind: "uploadToCarrier", labelKey: "actions.uploadToCarrier" },
  overflow: [
    { kind: "scheduleDispatch", labelKey: "actions.scheduleDispatch" },
    { kind: "cancel", labelKey: "actions.cancel", destructive: true },
  ],
};

const bar = () => screen.getByTestId("panel-actions");
// The ⋯ trigger sits in the same grid but carries no kind — it is not one of
// the endings, which is the whole point of it.
const kinds = () =>
  within(bar())
    .getAllByRole("button")
    .map((b) => b.getAttribute("data-kind"))
    .filter(Boolean);

describe("ActionFooter — the four call outcomes", () => {
  it("states all four endings as buttons", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Confirmer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rappeler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refuser" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pas de réponse" })).toBeInTheDocument();
  });

  it("puts them in one fixed order, whatever order the resolver returned", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);
    // The resolver hands over [confirm, endCall, callback, reject].
    expect(kinds()).toEqual(["endCall", "confirm", "reject", "callback"]);
  });

  it("routes each one to its own handler", () => {
    const onInvoke = vi.fn();
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={onInvoke} />);

    fireEvent.click(screen.getByRole("button", { name: "Rappeler" }));
    expect(onInvoke).toHaveBeenCalledWith("callback");

    fireEvent.click(screen.getByRole("button", { name: "Refuser" }));
    expect(onInvoke).toHaveBeenCalledWith("reject");

    fireEvent.click(screen.getByRole("button", { name: "Pas de réponse" }));
    expect(onInvoke).toHaveBeenCalledWith("endCall");

    fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    expect(onInvoke).toHaveBeenCalledWith("confirm");
  });

  it("gives every button the same height, so none of them ranks by size", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);
    for (const button of within(bar()).getAllByRole("button")) {
      expect(button.className).toContain("h-[46px]");
    }
  });

  it("ranks them by tone instead: one filled button, three outlines", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);
    const tone = (name: string) =>
      screen.getByRole("button", { name }).className;

    expect(tone("Confirmer")).toContain("bg-brand");
    expect(tone("Refuser")).toContain("text-oms-bad");
    expect(tone("Rappeler")).toContain("bg-oms-warn-bg");
    expect(tone("Pas de réponse")).not.toContain("bg-brand");
  });

  it("stacks two by two below lg, where four labels do not fit side by side", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);
    expect(bar().className).toContain("grid-cols-2");
    expect(bar().className).toContain("lg:[grid-template-columns:repeat(4,auto)]");
  });

  it("drops the ⋯ when the four endings are the whole story", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /plus d.actions/i })).toBeNull();
  });

  it("keeps a manager's cancel in the menu, never on the bar", () => {
    render(<ActionFooter actions={WITH_MENU} onInvoke={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^annuler la commande$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /plus d.actions/i })).toBeInTheDocument();
  });

  it("disables every outcome while the confirmation is in flight", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} primaryPending onInvoke={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Confirmer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refuser" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pas de réponse" })).toBeDisabled();
  });
});

describe("ActionFooter — the queue's keyboard hint", () => {
  it("stays out of the panel wherever the keys do nothing", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);
    expect(screen.queryByText(/pour appeler/)).toBeNull();
  });

  it("states both shortcuts in the queue", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} showNavHint onInvoke={vi.fn()} />);
    expect(screen.getByText(/passer d'une commande à l'autre/)).toBeInTheDocument();
    expect(screen.getByText("Entrée")).toBeInTheDocument();
  });
});

describe("ActionFooter — everywhere else", () => {
  it("keeps the single CTA and promotes the safe overflow item beside it", () => {
    render(<ActionFooter actions={SINGLE_CTA} onInvoke={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Envoyer au transporteur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planifier la livraison" })).toBeInTheDocument();
  });

  it("never promotes a destructive action next to the primary", () => {
    render(<ActionFooter actions={SINGLE_CTA} onInvoke={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Annuler la commande" })).not.toBeInTheDocument();
  });

  it("leads with the primary, since a promoted item is not one of the four", () => {
    render(<ActionFooter actions={SINGLE_CTA} onInvoke={vi.fn()} />);
    expect(kinds()).toEqual(["uploadToCarrier", "scheduleDispatch"]);
  });
});

describe("ActionFooter — « F voix du client » in the key hint", () => {
  it("adds F to the hint line when capture is available", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} showNavHint feedbackHint />);
    expect(screen.getByText("voix du client")).toBeInTheDocument();
    expect(screen.getByText("F")).toBeInTheDocument();
  });
  it("stays out otherwise", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} showNavHint />);
    expect(screen.queryByText("voix du client")).toBeNull();
  });
});
