import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockUseSites = vi.fn();
vi.mock("@/hooks/useWarehouseSites", () => ({
  useWarehouseSites: (...a: unknown[]) => mockUseSites(...a),
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

import { WarehouseAssignment } from "../WarehouseAssignment";

/**
 * Which building a warehouse agent works out of.
 *
 * Libya prepares from two, one per Darb Assabil account, and a parcel booked on
 * the Benghazi account handed to Darb Tripoli does not exist in their system.
 * Until this control existed, `users.warehouse_id` could only be set by hand in
 * the database — so agents sat unassigned, which used to mean they saw BOTH
 * buildings' parcels at once.
 */
const SITES = [
  { id: "site-tripoli", code: "tripoli", name: "Tripoli", isDefault: true },
  { id: "site-benghazi", code: "benghazi", name: "Benghazi", isDefault: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSites.mockReturnValue({ sites: SITES, isLoading: false, error: null });
});

function renderIt(props: Partial<React.ComponentProps<typeof WarehouseAssignment>> = {}) {
  const onChange = vi.fn().mockResolvedValue(undefined);
  render(
    <WarehouseAssignment
      marketId="market-ly"
      warehouseId="site-benghazi"
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe("WarehouseAssignment", () => {
  test("shows the building the agent is assigned to", () => {
    renderIt();
    expect(screen.getByRole("combobox")).toHaveValue("site-benghazi");
  });

  test("offers every building of the market", () => {
    renderIt();
    expect(screen.getByRole("option", { name: "Tripoli" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Benghazi" })).toBeInTheDocument();
  });

  /*
   * The loud empty state. An unassigned agent now sees an empty bench, so the
   * admin screen has to make that visible — otherwise the manager has no way to
   * tell why the agent is reporting they have no work.
   */
  test("warns when nobody has assigned the agent", () => {
    renderIt({ warehouseId: null });
    expect(screen.getByText("Aucun entrepôt")).toBeInTheDocument();
  });

  test("does not warn once assigned", () => {
    renderIt();
    expect(screen.queryByText("Aucun entrepôt")).not.toBeInTheDocument();
  });

  test("saves the chosen building", async () => {
    const { onChange } = renderIt();
    await userEvent.selectOptions(screen.getByRole("combobox"), "site-tripoli");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith("site-tripoli"));
  });

  test("an empty choice un-assigns rather than sending an empty string", async () => {
    const { onChange } = renderIt();
    await userEvent.selectOptions(screen.getByRole("combobox"), "");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  test("surfaces a failure instead of pretending it saved", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("nope"));
    render(
      <WarehouseAssignment marketId="market-ly" warehouseId={null} onChange={onChange} />,
    );
    await userEvent.selectOptions(screen.getByRole("combobox"), "site-tripoli");
    await waitFor(() =>
      expect(screen.getByText("Impossible d'enregistrer l'entrepôt")).toBeInTheDocument(),
    );
  });

  test("a market with a single building still renders the control", () => {
    mockUseSites.mockReturnValue({
      sites: [{ id: "site-tunis", code: "tunis", name: "Tunis", isDefault: true }],
      isLoading: false,
      error: null,
    });
    renderIt({ warehouseId: "site-tunis" });
    expect(screen.getByRole("combobox")).toHaveValue("site-tunis");
  });
});
