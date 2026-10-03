import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
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
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: toast }) }));
const swr = vi.hoisted(() => ({ byKey: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? swr.byKey[key] : undefined, isLoading: false, mutate: swr.mutate }) }));

import { ReglagesFormProvider } from "../../form-context";
import { WarehousesTopic } from "../WarehousesTopic";

const LY = "00000000-0000-0000-0000-000000000002";
const admin: AuthUser = { id: "a", email: "a@x", full_name: "A", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const manager: AuthUser = { ...admin, id: "m", role: "market_manager", market_id: LY };

const fetchMock = vi.fn();
beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  // Libya, production 2026-10-02: Benghazi is active, its Darb account is not.
  swr.byKey = {
    [`/api/settings/${LY}`]: { data: [] },
    [`/api/admin/warehouse-sites?market_id=${LY}`]: {
      data: [
        { id: "w1", code: "tripoli", nameFr: "Tripoli", nameAr: "طرابلس", marketId: LY, isDefault: true, isActive: true, assignedAgents: [{ id: "u1", name: "adel" }], stockUnits: 40 },
        { id: "w2", code: "benghazi", nameFr: "Benghazi", nameAr: "بنغازي", marketId: LY, isDefault: false, isActive: true, assignedAgents: [{ id: "u2", name: "tarek" }], stockUnits: 0 },
      ],
    },
    [`/api/carriers?market_id=${LY}`]: {
      data: [
        { id: "c1", name: "Darb Assabil - Tripoli", code: "darb_assabil", is_active: true, warehouse_id: "w1" },
        { id: "c2", name: "Darb Assabil — Benghazi", code: "darb_assabil", is_active: false, warehouse_id: "w2" },
        { id: "c3", name: "Dexpress", code: "dexpress", is_active: false, warehouse_id: "w1" },
      ],
    },
  };
  swr.mutate.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const mount = (user: AuthUser) =>
  render(
    <ReglagesFormProvider>
      <WarehousesTopic user={user} marketId={LY} marketCode="ly" />
    </ReglagesFormProvider>,
  );

describe("Réglages › Entrepôts", () => {
  it("shows each site with its agents and the carriers that ship from it", () => {
    mount(admin);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Tripoli");
    expect(rows[0]).toHaveTextContent("par défaut");
    expect(rows[0]).toHaveTextContent("1 agent");
    expect(rows[0]).toHaveTextContent("Darb Assabil - Tripoli");
    expect(rows[1]).toHaveTextContent("Darb Assabil — Benghazi");
    expect(within(rows[1]).getByText("désactivé")).toBeInTheDocument();
  });

  it("a manager reads the sites and the lead time, and changes neither", () => {
    mount(manager);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.getAllByText("Modifiable par un administrateur").length).toBeGreaterThan(0);
  });

  it("switching off a site that still has agents asks first, then confirms", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "x", code: "needs_confirmation", agents: [{ id: "u2", name: "tarek" }], stockUnits: 0 }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "w2", is_active: false } }), { status: 200 }));
    mount(admin);
    await userEvent.click(screen.getByRole("switch", { name: "Benghazi actif" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("tarek");
    await userEvent.click(within(dialog).getByRole("button", { name: "Désactiver quand même" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ id: "w2", is_active: false, confirmed: true });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Benghazi désactivé" }));
  });
});
