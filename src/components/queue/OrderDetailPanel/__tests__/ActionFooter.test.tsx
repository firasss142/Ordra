import { fireEvent, render, screen } from "@testing-library/react";
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
    { kind: "callback", labelKey: "actions.callback" },
    { kind: "reject", labelKey: "actions.reject", destructive: true },
  ],
  overflow: [
    { kind: "endCall", labelKey: "actions.endCall" },
    { kind: "cancel", labelKey: "actions.cancel", destructive: true },
  ],
};

const SINGLE_CTA: PanelActions = {
  primary: { kind: "uploadToCarrier", labelKey: "actions.uploadToCarrier" },
  overflow: [
    { kind: "scheduleDispatch", labelKey: "actions.scheduleDispatch" },
    { kind: "cancel", labelKey: "actions.cancel", destructive: true },
  ],
};

describe("ActionFooter — the three call outcomes", () => {
  it("states all three endings as buttons", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Confirmer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rappeler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refuser" })).toBeInTheDocument();
  });

  it("routes each one to its own handler", () => {
    const onInvoke = vi.fn();
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={onInvoke} />);

    fireEvent.click(screen.getByRole("button", { name: "Rappeler" }));
    expect(onInvoke).toHaveBeenCalledWith("callback");

    fireEvent.click(screen.getByRole("button", { name: "Refuser" }));
    expect(onInvoke).toHaveBeenCalledWith("reject");

    fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    expect(onInvoke).toHaveBeenCalledWith("confirm");
  });

  it("does not promote an overflow item next to three buttons that are already there", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} onInvoke={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Appel terminé" })).not.toBeInTheDocument();
  });

  it("disables every outcome while the confirmation is in flight", () => {
    render(<ActionFooter actions={CALL_OUTCOMES} primaryPending onInvoke={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Confirmer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Refuser" })).toBeDisabled();
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
});
