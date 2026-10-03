import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";
import type { AuthUser } from "@/types";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: vi.fn() }) }));
const scope = vi.hoisted(() => ({ value: "ly" as "ly" | "tn" | "all", setScope: vi.fn() }));
vi.mock("@/context/market-scope", () => ({
  useMarketScope: () => ({
    scope: scope.value,
    marketId: scope.value === "ly" ? "00000000-0000-0000-0000-000000000002" : scope.value === "tn" ? "00000000-0000-0000-0000-000000000001" : null,
    marketCode: scope.value === "all" ? null : scope.value,
    setScope: scope.setScope,
  }),
}));
// The topic bodies have their own tests; here a stand-in that can leave a change pending.
vi.mock("../TopicBody", async () => {
  const { useRegisterSaver } = await import("../form-context");
  return {
    TopicBody: ({ topic }: { topic: string }) => {
      useRegisterSaver("stub", { count: topic === "orders" ? 1 : 0, save: async () => {}, reset: () => {} });
      return <div data-testid="topic-body">{topic}</div>;
    },
  };
});

import { ReglagesShell } from "../ReglagesShell";

const LY = "00000000-0000-0000-0000-000000000002";
const admin: AuthUser = { id: "a", email: "a@x", full_name: "Admin", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const manager: AuthUser = { ...admin, id: "m", role: "market_manager", market_id: LY };

beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  scope.value = "ly";
  scope.setScope.mockReset();
  push.mockReset();
});

describe("ReglagesShell", () => {
  it("gives the administrator the nine topics, in the order an order travels", () => {
    render(<ReglagesShell user={admin} topic="markets" />);
    const nav = screen.getByRole("navigation", { name: "Réglages" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Marchés", "Boutiques", "Commandes", "Motifs de rejet", "Équipe", "Entrepôts", "Livraison", "WhatsApp", "Publicité",
    ]);
    expect(within(nav).getByRole("link", { name: "Marchés" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a manager their own market, fixed, and neither Marchés nor Publicité", () => {
    render(<ReglagesShell user={manager} topic="shops" />);
    expect(screen.getByText("Votre marché")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tunisie/ })).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Réglages" });
    expect(within(nav).queryByRole("link", { name: "Marchés" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Publicité" })).not.toBeInTheDocument();
  });

  it("names the market in the header of a market topic", () => {
    render(<ReglagesShell user={admin} topic="delivery" />);
    expect(screen.getByText("Libye · LYD")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Livraison" })).toBeInTheDocument();
  });

  it("asks for a market instead of loading forever when the scope is « Tous les marchés »", async () => {
    scope.value = "all";
    render(<ReglagesShell user={admin} topic="orders" />);
    expect(screen.getByText("Quel marché voulez-vous régler ?")).toBeInTheDocument();
    expect(screen.queryByTestId("topic-body")).not.toBeInTheDocument();
    const prompt = screen.getByText("Quel marché voulez-vous régler ?").closest("section") as HTMLElement;
    await userEvent.click(within(prompt).getByRole("button", { name: /Tunisie/ }));
    expect(scope.setScope).toHaveBeenCalledWith("tn");
  });

  it("does not ask for a market on Marchés, which covers them all", () => {
    scope.value = "all";
    render(<ReglagesShell user={admin} topic="markets" />);
    expect(screen.getByTestId("topic-body")).toHaveTextContent("markets");
  });

  it("asks before leaving a topic with unsaved changes, and throws them away only on « Quitter »", async () => {
    render(<ReglagesShell user={admin} topic="orders" />);
    expect(await screen.findByText("1 modification non enregistrée")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Équipe" }));
    expect(push).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rester" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("link", { name: "Équipe" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(push).toHaveBeenCalledWith("/fr/system/settings/team");
  });

  it("asks the same before switching market with unsaved changes", async () => {
    render(<ReglagesShell user={admin} topic="orders" />);
    await screen.findByText("1 modification non enregistrée");
    await userEvent.click(screen.getByRole("button", { name: /Tunisie/ }));
    expect(scope.setScope).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Quitter sans enregistrer" }));
    expect(scope.setScope).toHaveBeenCalledWith("tn");
  });
});
