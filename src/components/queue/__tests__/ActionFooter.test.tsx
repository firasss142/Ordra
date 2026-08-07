import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/fr.json";
import { ActionFooter } from "../OrderDetailPanel/ActionFooter";
import type { PanelActions } from "../OrderDetailPanel/types";

function renderFooter(actions: PanelActions) {
  const onInvoke = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ActionFooter actions={actions} onInvoke={onInvoke} />
    </NextIntlClientProvider>,
  );
  return { onInvoke };
}

const PRIMARY = { kind: "endCall", labelKey: "actions.endCall" } as const;

describe("ActionFooter — the second action", () => {
  beforeEach(() => vi.clearAllMocks());

  test("names the commonest second action instead of hiding it behind ⋯", async () => {
    const user = userEvent.setup();
    const { onInvoke } = renderFooter({
      primary: PRIMARY,
      overflow: [{ kind: "returnToPool", labelKey: "actions.returnToPool" }],
    });

    const secondary = screen.getByRole("button", { name: /retirer de l.agent/i });
    await user.click(secondary);

    expect(onInvoke).toHaveBeenCalledWith("returnToPool");
  });

  test("never promotes a destructive action next to the primary", () => {
    // resolvePanelActions puts `cancel` first for managers on several statuses.
    // Promoted, it would sit one mis-click from the confirm button.
    renderFooter({
      primary: PRIMARY,
      overflow: [{ kind: "cancel", labelKey: "actions.cancel", destructive: true }],
    });

    expect(screen.queryByRole("button", { name: /^annuler la commande$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /plus d.actions/i })).toBeInTheDocument();
  });

  test("promotes the first non-destructive action, skipping a destructive one", async () => {
    const user = userEvent.setup();
    const { onInvoke } = renderFooter({
      primary: PRIMARY,
      overflow: [
        { kind: "cancel", labelKey: "actions.cancel", destructive: true },
        { kind: "returnToPool", labelKey: "actions.returnToPool" },
      ],
    });

    await user.click(screen.getByRole("button", { name: /retirer de l.agent/i }));
    expect(onInvoke).toHaveBeenCalledWith("returnToPool");
  });

  test("keeps the rest in the menu rather than crowding the bar", () => {
    renderFooter({
      primary: PRIMARY,
      overflow: [
        { kind: "returnToPool", labelKey: "actions.returnToPool" },
        { kind: "changeStatus", labelKey: "actions.changeStatus" },
      ],
    });

    expect(screen.getByRole("button", { name: /retirer de l.agent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /plus d.actions/i })).toBeInTheDocument();
  });

  test("drops the ⋯ entirely when nothing is left in it", () => {
    renderFooter({
      primary: PRIMARY,
      overflow: [{ kind: "returnToPool", labelKey: "actions.returnToPool" }],
    });

    expect(screen.queryByRole("button", { name: /plus d.actions/i })).toBeNull();
  });

  test("still renders a primary when there is no second action at all", () => {
    renderFooter({ primary: { kind: "close", labelKey: "actions.close" }, overflow: [] });
    expect(screen.getByRole("button", { name: /fermer/i })).toBeInTheDocument();
  });
});
