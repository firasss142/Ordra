import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthUser } from "@/types";
import { installFakeApi, renderAccess } from "@/test/helpers/accessHarness";
import { accessUser, BENGHAZI, LY, TRIPOLI } from "@/test/helpers/accessUsers";

// jsdom cannot satisfy focus-trap's "one tabbable node" invariant during the
// first paint (no layout); the same stand-in as the other admin panel tests.
vi.mock("focus-trap-react", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// jsdom has no createImageBitmap: the downscale is PhotoPicker's own test.
vi.mock("@/lib/client/image", async (orig) => ({
  ...(await orig<typeof import("@/lib/client/image")>()),
  decodeImageFile: async () => ({ ok: true, dataUrl: "data:image/png;base64,AAA" }),
}));

import { UsersPageClient } from "../UsersPageClient";

const ADMIN: AuthUser = { id: "u-super.admin", email: "admin@oms.tn", full_name: "Super Admin", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const MANAGER: AuthUser = { id: "u-hamidaly", email: "hamidaly@oms.local", full_name: "hamidaly", avatar_url: null, role: "market_manager", market_id: LY, locale: "fr", direction: "ltr" };

const roqaya = accessUser({ full_name: "roqaya" });
const adel = accessUser({ full_name: "adel", role: "warehouse_agent", warehouse_id: BENGHAZI });
const tarek = accessUser({ full_name: "tarek", role: "warehouse_agent", warehouse_id: TRIPOLI });
const gone = accessUser({ full_name: "Agent 1 TN", email: "agent1.tn@oms.test", is_active: false });
const USERS = [roqaya, adel, tarek, gone];

const menuItem = async (who: string, item: string) => {
  await userEvent.click(await screen.findByRole("button", { name: `Actions pour ${who}` }));
  await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: item }));
};
const toastSays = (text: string) => waitFor(() => expect(screen.getByText(text, { exact: false })).toBeInTheDocument());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 15, 30));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// The create flow types several fields; under the full suite's parallel load
// that can pass the 5 s default, which says nothing about the page.
describe("Accès — creating an account", { timeout: 15_000 }, () => {
  it("previews the login, offers the building for a warehouse agent and sends exactly what was chosen", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Créer un utilisateur" }));
    const panel = screen.getByRole("dialog", { name: "Créer un utilisateur" });
    const submit = within(panel).getByRole("button", { name: "Créer le compte" });

    await userEvent.type(within(panel).getByLabelText("Nom d'utilisateur"), "Ahmed Ben Ali");
    expect(panel).toHaveTextContent("Identifiant de connexion");
    expect(panel).toHaveTextContent("ahmed.ben.ali");
    expect(within(panel).queryByRole("radio", { name: "Tripoli" })).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("radio", { name: /Agent entrepôt/ }));
    await userEvent.click(within(panel).getByRole("radio", { name: "Libye" }));
    expect(panel).toHaveTextContent("Sans entrepôt, l'agent ne verra aucun colis");
    await userEvent.click(within(panel).getByRole("radio", { name: "Benghazi" }));
    expect(submit).toBeDisabled();
    await userEvent.type(within(panel).getByLabelText("Mot de passe"), "s3cret");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    await waitFor(() => expect(api.calls).toContainEqual({ method: "POST", url: "/api/users", body: { username: "Ahmed Ben Ali", password: "s3cret", role: "warehouse_agent", market_id: LY, warehouse_id: BENGHAZI } }));
    await toastSays("Ahmed Ben Ali créé · identifiant ahmed.ben.ali");
    expect(await screen.findByRole("button", { name: "Ouvrir la fiche de Ahmed Ben Ali" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Créer un utilisateur" })).not.toBeInTheDocument();
  });

  it("forgets the building when the role changes away from warehouse agent", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Créer un utilisateur" }));
    const panel = screen.getByRole("dialog", { name: "Créer un utilisateur" });
    await userEvent.type(within(panel).getByLabelText("Nom d'utilisateur"), "nour");
    await userEvent.type(within(panel).getByLabelText("Mot de passe"), "x");
    await userEvent.click(within(panel).getByRole("radio", { name: /Agent entrepôt/ }));
    await userEvent.click(within(panel).getByRole("radio", { name: "Libye" }));
    await userEvent.click(within(panel).getByRole("radio", { name: "Tripoli" }));
    await userEvent.click(within(panel).getByRole("radio", { name: /Agent de confirmation/ }));
    expect(within(panel).queryByRole("radio", { name: "Tripoli" })).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Créer le compte" }));
    await waitFor(() => expect(api.calls[0]?.body).toEqual({ username: "nour", password: "x", role: "agent", market_id: LY }));
  });

  it("refuses an identifier that is already taken", async () => {
    installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Créer un utilisateur" }));
    const panel = screen.getByRole("dialog", { name: "Créer un utilisateur" });
    await userEvent.type(within(panel).getByLabelText("Nom d'utilisateur"), "Roqaya");
    await userEvent.type(within(panel).getByLabelText("Mot de passe"), "x");
    await userEvent.click(within(panel).getByRole("radio", { name: /Agent de confirmation/ }));
    await userEvent.click(within(panel).getByRole("radio", { name: "Libye" }));
    expect(panel).toHaveTextContent("Cet identifiant est déjà utilisé.");
    expect(within(panel).getByRole("button", { name: "Créer le compte" })).toBeDisabled();
  });

  it("gives a manager two roles and their own market, and never sends a market", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={MANAGER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Créer un utilisateur" }));
    const panel = screen.getByRole("dialog", { name: "Créer un utilisateur" });
    expect(within(panel).getAllByRole("radio")).toHaveLength(2);
    expect(panel).toHaveTextContent(/Marché\s: Libye/);
    await userEvent.type(within(panel).getByLabelText("Nom d'utilisateur"), "salma");
    await userEvent.type(within(panel).getByLabelText("Mot de passe"), "x");
    await userEvent.click(within(panel).getByRole("radio", { name: /Agent de confirmation/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Créer le compte" }));
    await waitFor(() => expect(api.calls[0]?.body).toEqual({ username: "salma", password: "x", role: "agent" }));
  });
});

describe("Accès — deactivating and reactivating", () => {
  it("asks for a reason in one step, then folds the account away", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await menuItem("roqaya", "Désactiver");
    const dialog = screen.getByRole("dialog", { name: /Désactiver roqaya/ });
    expect(dialog).toHaveTextContent("roqaya ne pourra plus se connecter.");
    const confirm = within(dialog).getByRole("button", { name: "Désactiver" });
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Congé / absence" }));
    await userEvent.click(confirm);
    await waitFor(() => expect(api.calls).toContainEqual({ method: "PATCH", url: "/api/agents/u-roqaya", body: { action: "deactivate", reason: "on-leave" } }));
    await toastSays("roqaya désactivé. 3 commandes retournées à la file.");
    expect(await screen.findByRole("button", { name: "2 comptes désactivés" })).toBeInTheDocument();
  });

  it("reactivates a folded account from its menu", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "1 compte désactivé" }));
    await menuItem("Agent 1 TN", "Réactiver");
    await waitFor(() => expect(api.calls).toContainEqual({ method: "PATCH", url: "/api/agents/u-agent.1.tn", body: { action: "reactivate" } }));
    await toastSays("Agent 1 TN réactivé.");
  });
});

describe("Accès — deleting", () => {
  it("deletes after confirmation and says how many orders went back", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await menuItem("roqaya", "Supprimer l'utilisateur");
    const dialog = screen.getByRole("dialog", { name: /Supprimer définitivement roqaya/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(api.calls).toContainEqual({ method: "DELETE", url: "/api/agents/u-roqaya", body: null }));
    await toastSays("roqaya supprimé. 2 commandes retournées à la file.");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Ouvrir la fiche de roqaya" })).not.toBeInTheDocument());
  });

  it("keeps the dialog open and shows the error when the deletion fails", async () => {
    const api = installFakeApi(USERS);
    api.failNext("/api/agents/u-roqaya", 409, "Impossible : commandes en cours");
    renderAccess(<UsersPageClient user={ADMIN} />);
    await menuItem("roqaya", "Supprimer l'utilisateur");
    const dialog = screen.getByRole("dialog", { name: /Supprimer définitivement roqaya/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Impossible : commandes en cours");
  });
});

describe("Accès — resetting a password", () => {
  it("refuses two different passwords and saves matching ones", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await menuItem("roqaya", "Réinitialiser le mot de passe");
    const dialog = screen.getByRole("dialog", { name: "Réinitialiser le mot de passe" });
    const save = within(dialog).getByRole("button", { name: "Enregistrer" });
    await userEvent.type(within(dialog).getByLabelText("Nouveau mot de passe"), "abc");
    await userEvent.type(within(dialog).getByLabelText("Confirmer le mot de passe"), "abd");
    expect(dialog).toHaveTextContent("Les mots de passe ne correspondent pas.");
    expect(save).toBeDisabled();
    await userEvent.clear(within(dialog).getByLabelText("Confirmer le mot de passe"));
    await userEvent.type(within(dialog).getByLabelText("Confirmer le mot de passe"), "abc");
    await userEvent.click(save);
    await waitFor(() => expect(api.calls).toContainEqual({ method: "PATCH", url: "/api/agents/u-roqaya", body: { action: "reset_password", new_password: "abc" } }));
    await toastSays("Mot de passe réinitialisé.");
  });
});

describe("Accès — a warehouse agent's building", () => {
  it("is changed from the row, and an empty choice un-assigns rather than sending an empty string", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    const pick = await screen.findByRole("combobox", { name: "Entrepôt de adel" });
    await waitFor(() => expect(within(pick).getByRole("option", { name: "Benghazi" })).toBeInTheDocument());
    expect(pick).toHaveValue(BENGHAZI);
    await userEvent.selectOptions(pick, TRIPOLI);
    await waitFor(() => expect(api.calls).toContainEqual({ method: "PATCH", url: "/api/agents/u-adel", body: { action: "set_warehouse", warehouse_id: TRIPOLI } }));
    await toastSays("Entrepôt enregistré.");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Entrepôt de adel" }), "");
    await waitFor(() => expect(api.calls).toContainEqual({ method: "PATCH", url: "/api/agents/u-adel", body: { action: "set_warehouse", warehouse_id: null } }));
  });

  it("surfaces a failure instead of pretending it saved", async () => {
    const api = installFakeApi(USERS);
    api.failNext("/api/agents/u-adel");
    renderAccess(<UsersPageClient user={ADMIN} />);
    const pick = await screen.findByRole("combobox", { name: "Entrepôt de adel" });
    await waitFor(() => expect(within(pick).getByRole("option", { name: "Tripoli" })).toBeInTheDocument());
    await userEvent.selectOptions(pick, TRIPOLI);
    expect(await screen.findByText("Impossible d'enregistrer l'entrepôt")).toBeInTheDocument();
  });

  it("is chosen as a card in the file", async () => {
    const api = installFakeApi(USERS);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ouvrir la fiche de tarek" }));
    const file = screen.getByRole("dialog", { name: "tarek" });
    await userEvent.click(await within(file).findByRole("radio", { name: "Benghazi" }));
    await waitFor(() => expect(api.calls).toContainEqual({ method: "PATCH", url: "/api/agents/u-tarek", body: { action: "set_warehouse", warehouse_id: BENGHAZI } }));
  });
});

describe("Accès — the person's photo", () => {
  it("is set from the file, and shows at once", async () => {
    const api = installFakeApi(USERS);
    const { container } = renderAccess(<UsersPageClient user={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ouvrir la fiche de roqaya" }));
    const file = screen.getByRole("dialog", { name: "roqaya" });
    await userEvent.upload(within(file).getByTestId("photo-input"), new File(["x"], "r.png", { type: "image/png" }));
    await waitFor(() => expect(api.calls).toContainEqual({ method: "PATCH", url: "/api/agents/u-roqaya", body: { action: "update_avatar", avatar: "data:image/png;base64,AAA" } }));
    await waitFor(() => expect(container.ownerDocument.querySelector('img[src="https://cdn/avatars/u-roqaya.png?v=1"]')).not.toBeNull());
    expect(await within(file).findByRole("button", { name: "Retirer" })).toBeInTheDocument();
  });

  it("is removed with « Retirer », which sends null", async () => {
    const api = installFakeApi([accessUser({ full_name: "roqaya", avatar_url: "https://cdn/x.png" }), adel]);
    renderAccess(<UsersPageClient user={MANAGER} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ouvrir la fiche de roqaya" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "roqaya" })).getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(api.calls).toContainEqual({ method: "PATCH", url: "/api/agents/u-roqaya", body: { action: "update_avatar", avatar: null } }));
  });
});
