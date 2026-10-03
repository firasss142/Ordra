import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthUser, UserAuditEvent } from "@/types";
import { installFakeApi, renderAccess } from "@/test/helpers/accessHarness";
import { accessUser, BENGHAZI, LY, TN, TRIPOLI } from "@/test/helpers/accessUsers";

// jsdom cannot satisfy focus-trap's "one tabbable node" invariant during the
// first paint (no layout); the same stand-in as the other admin panel tests.
vi.mock("focus-trap-react", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { UsersPageClient } from "../UsersPageClient";

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

const ADMIN: AuthUser = { id: "u-super.admin", email: "admin@oms.tn", full_name: "Super Admin", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const MANAGER: AuthUser = { id: "u-hamidaly", email: "hamidaly@oms.local", full_name: "hamidaly", avatar_url: null, role: "market_manager", market_id: LY, locale: "ar", direction: "rtl" };

const tasnim = accessUser({ full_name: "tasnim", last_seen_at: at(3, 15, 27) });
const roqaya = accessUser({ full_name: "roqaya", last_seen_at: at(3, 14, 15) });
const mouna = accessUser({ full_name: "mouna" });
const agentTn = accessUser({ full_name: "Agent TN 1", email: "agent1.tn@oms.local", market_id: TN, last_seen_at: new Date(2026, 8, 14, 13, 46).toISOString() });
const gone = accessUser({ full_name: "Agent 1 TN", email: "agent1.tn@oms.test", market_id: TN, is_active: false, deactivation_reason: "on-leave" });
const adel = accessUser({ full_name: "adel", role: "warehouse_agent", warehouse_id: BENGHAZI, last_seen_at: at(3, 2, 48) });
const tarek = accessUser({ full_name: "tarek", role: "warehouse_agent", warehouse_id: TRIPOLI });
const hamid = accessUser({ full_name: "hamidaly", role: "market_manager", last_seen_at: at(3, 13, 56) });
const self = accessUser({ full_name: "Super Admin", id: "u-super.admin", email: "admin@oms.tn", role: "super_admin", market_id: null, last_seen_at: at(3, 15, 28) });
const EVERYONE = [mouna, gone, adel, self, roqaya, agentTn, hamid, tarek, tasnim];

const AUDIT: Record<string, UserAuditEvent[]> = {
  "u-tarek": [
    { id: "e2", actor_id: "u-super.admin", target_id: "u-tarek", event_type: "warehouse_assigned", meta: { warehouse_id: TRIPOLI }, created_at: "2026-09-09T17:03:00Z", actor: { full_name: "Super Admin" } },
    { id: "e1", actor_id: "u-super.admin", target_id: "u-tarek", event_type: "user_created", meta: null, created_at: "2026-06-07T13:34:00Z", actor: { full_name: "Super Admin" } },
  ],
};

const bodyRows = () => screen.getAllByRole("row").slice(1);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 15, 30));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Accès — the list", () => {
  it("shows the roles as tiles, agents first, each with its count and who is online", async () => {
    installFakeApi(EVERYONE);
    renderAccess(<UsersPageClient user={ADMIN} />);
    expect(screen.getByRole("heading", { name: "Accès" })).toBeInTheDocument();
    const tiles = within(await screen.findByRole("group", { name: "Filtrer par rôle" })).getAllByRole("button");
    expect(tiles.map((b) => b.textContent)).toEqual([
      expect.stringMatching(/^Tous\s*8.*2 en ligne/),
      expect.stringMatching(/^Agents\s*4.*1 en ligne/),
      expect.stringMatching(/^Entrepôt\s*2.*personne en ligne/),
      expect.stringMatching(/^Managers\s*1/),
      expect.stringMatching(/^Investisseurs\s*0/),
      expect.stringMatching(/^Super admins\s*1.*1 en ligne/),
    ]);
    expect(tiles[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("lists one row per account in role order, with the role, the market and the last activity in words", async () => {
    installFakeApi(EVERYONE);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await screen.findByText("tasnim");
    const rows = bodyRows();
    expect(rows.map((r) => within(r).getAllByRole("button")[0].getAttribute("aria-label"))).toEqual([
      "Ouvrir la fiche de tasnim",
      "Ouvrir la fiche de roqaya",
      "Ouvrir la fiche de Agent TN 1",
      "Ouvrir la fiche de mouna",
      "Ouvrir la fiche de adel",
      "Ouvrir la fiche de tarek",
      "Ouvrir la fiche de hamidaly",
      "Ouvrir la fiche de Super Admin",
    ]);
    expect(rows[0]).toHaveTextContent("Agent de confirmation");
    expect(rows[0]).toHaveTextContent("Libye");
    expect(rows[0]).toHaveTextContent("En ligne");
    expect(rows[1]).toHaveTextContent("il y a 1 h");
    expect(rows[2]).toHaveTextContent("agent1.tn");
    expect(rows[2]).toHaveTextContent("Tunisie");
    expect(rows[2]).toHaveTextContent("14 sept.");
    expect(rows[3]).toHaveTextContent("Aucune activité");
    expect(rows[3]).not.toHaveTextContent("mouna@oms.local");
    expect(rows[7]).toHaveTextContent("vous");
    expect(rows[7]).toHaveTextContent("Tous les marchés");
  });

  it("filters by tile, by name and by market", async () => {
    installFakeApi(EVERYONE);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await screen.findByText("tasnim");
    await userEvent.click(screen.getByRole("button", { name: /^Entrepôt\s*2/ }));
    expect(screen.getByRole("button", { name: /^Entrepôt\s*2/ })).toHaveAttribute("aria-pressed", "true");
    expect(bodyRows()).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: /^Tous\s*8/ }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Rechercher un nom ou un identifiant" }), "ROQ");
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText("1 compte")).toBeInTheDocument();

    await userEvent.clear(screen.getByRole("searchbox"));
    await userEvent.click(within(screen.getByRole("group", { name: "Filtrer par marché" })).getByRole("button", { name: /Tunisie\s*1/ }));
    expect(bodyRows().map((r) => r.textContent)).toEqual([expect.stringContaining("Agent TN 1")]);
  });

  it("narrows to the active accounts with no recorded activity", async () => {
    installFakeApi(EVERYONE);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await screen.findByText("tasnim");
    await userEvent.click(screen.getByRole("button", { name: /Sans activité\s*2/ }));
    expect(screen.getByRole("button", { name: /Sans activité\s*2/ })).toHaveAttribute("aria-pressed", "true");
    expect(bodyRows().map((r) => r.textContent)).toEqual([expect.stringContaining("mouna"), expect.stringContaining("tarek")]);
    expect(screen.getByText("2 comptes sans activité enregistrée")).toBeInTheDocument();
  });

  it("folds the disabled accounts away, with their reason", async () => {
    installFakeApi(EVERYONE);
    renderAccess(<UsersPageClient user={ADMIN} />);
    const fold = await screen.findByRole("button", { name: "1 compte désactivé" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Agent 1 TN")).not.toBeInTheDocument();
    await userEvent.click(fold);
    expect(screen.getByRole("row", { name: /Agent 1 TN/ })).toHaveTextContent("Désactivé · Congé / absence");
  });

  it("raises a banner for a warehouse agent with no building, and Affecter opens their file", async () => {
    installFakeApi([adel, { ...tarek, warehouse_id: null }]);
    renderAccess(<UsersPageClient user={ADMIN} />);
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("1 agent entrepôt n'a pas d'entrepôt");
    await userEvent.click(within(banner).getByRole("button", { name: /tarek.*Affecter/ }));
    expect(screen.getByRole("dialog", { name: "tarek" })).toBeInTheDocument();
  });
});

describe("Accès — the file", () => {
  it("shows the account, what the role allows and the journal, and gives focus back on close", async () => {
    installFakeApi(EVERYONE, AUDIT);
    renderAccess(<UsersPageClient user={ADMIN} />);
    const opener = await screen.findByRole("button", { name: "Ouvrir la fiche de tarek" });
    await userEvent.click(opener);
    const file = screen.getByRole("dialog", { name: "tarek" });
    expect(file).toHaveTextContent("Agent entrepôt");
    expect(file).toHaveTextContent("Actif");
    expect(file).toHaveTextContent("tarek@oms.local");
    expect(file).toHaveTextContent("Aucune activité");
    expect(within(file).getByRole("radio", { name: "Tripoli" })).toBeChecked();
    const allowed = within(file).getByRole("list", { name: "Ce que ce rôle permet" });
    expect(within(allowed).getByText("Accès entrepôt").closest("li")).toHaveAttribute("data-allowed", "true");
    expect(within(allowed).getByText("Voir les finances").closest("li")).toHaveAttribute("data-allowed", "false");
    await waitFor(() => expect(file).toHaveTextContent("Entrepôt affecté · Tripoli"));
    expect(file).toHaveTextContent("par Super Admin");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "tarek" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe("Accès — the row menu", () => {
  it("works from the keyboard and hands focus back on Escape", async () => {
    installFakeApi(EVERYONE);
    renderAccess(<UsersPageClient user={ADMIN} />);
    const kebab = await screen.findByRole("button", { name: "Actions pour roqaya" });
    await userEvent.click(kebab);
    const menu = screen.getByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      "Ouvrir la fiche",
      "Réinitialiser le mot de passe",
      "Désactiver",
      "Journal d'activité",
      "Supprimer l'utilisateur",
    ]);
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(kebab).toHaveFocus();
  });

  it("never offers a super admin the deletion of their own account", async () => {
    installFakeApi(EVERYONE);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Actions pour Super Admin" }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitem", { name: "Supprimer l'utilisateur" })).not.toBeInTheDocument();
  });
});

describe("Accès — a market manager", () => {
  const scoped = [tasnim, roqaya, mouna, adel, tarek];

  it("sees their two roles, no market column, and no deletion or journal", async () => {
    installFakeApi(scoped);
    renderAccess(<UsersPageClient user={{ ...MANAGER, locale: "fr", direction: "ltr" }} />);
    await screen.findByText("tasnim");
    expect(screen.getByText(/^Les comptes de l'équipe Libye\s: agents de confirmation et agents entrepôt\.$/)).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Filtrer par rôle" })).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("group", { name: "Filtrer par marché" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Marché" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Actions pour roqaya" }));
    const items = within(screen.getByRole("menu")).getAllByRole("menuitem").map((i) => i.textContent);
    expect(items).not.toContain("Supprimer l'utilisateur");
    expect(items).not.toContain("Journal d'activité");
  });

  it("reads Arabic, right to left", async () => {
    installFakeApi(scoped);
    const { container } = renderAccess(<UsersPageClient user={MANAGER} />, { locale: "ar" });
    expect(await screen.findByRole("heading", { name: "الوصول" })).toBeInTheDocument();
    expect(container.querySelector("[dir='rtl']")).not.toBeNull();
    expect(screen.getByRole("button", { name: /^الوكلاء\s*3/ })).toBeInTheDocument();
  });
});
