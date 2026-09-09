import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// jsdom cannot satisfy focus-trap's "one tabbable node" invariant during the
// first paint; the same stand-in as DeleteUserFlow.test.tsx.
vi.mock("focus-trap-react", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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

import { CreateUserPanel } from "../CreateUserPanel";

/**
 * Creating a warehouse agent already assigned to their building.
 *
 * Libya prepares from two, one per Darb Assabil account. Assigning at creation
 * is what keeps an agent from ever existing unassigned — a state that now means
 * an empty bench, because showing them both buildings is how a Benghazi parcel
 * gets handed to Darb Tripoli, where it does not exist.
 */
const MARKETS = [
  { id: "market-ly", name: "Libye", code: "ly" },
  { id: "market-tn", name: "Tunisie", code: "tn" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSites.mockReturnValue({
    sites: [
      { id: "site-tripoli", code: "tripoli", name: "Tripoli", isDefault: true },
      { id: "site-benghazi", code: "benghazi", name: "Benghazi", isDefault: false },
    ],
    isLoading: false,
    error: null,
  });
});

function renderPanel(props: Partial<React.ComponentProps<typeof CreateUserPanel>> = {}) {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <CreateUserPanel
      open
      actorRole="super_admin"
      actorMarketId={null}
      markets={MARKETS}
      onClose={onClose}
      onCreate={onCreate}
      {...props}
    />,
  );
  return { onCreate, onClose };
}

async function fillBasics(role: string) {
  await userEvent.type(screen.getByPlaceholderText("ex: ahmed ben ali"), "ahmed");
  const pw = document.querySelector('input[type="password"]') as HTMLInputElement;
  await userEvent.type(pw, "testpass123");
  const selects = screen.getAllByRole("combobox");
  await userEvent.selectOptions(selects[0], role);
}

describe("CreateUserPanel — the building", () => {
  test("offers no building for a phone agent", async () => {
    renderPanel();
    await fillBasics("agent");
    expect(screen.queryByLabelText("Entrepôt")).not.toBeInTheDocument();
  });

  test("offers the building once the role is warehouse agent", async () => {
    renderPanel();
    await fillBasics("warehouse_agent");
    expect(screen.getByLabelText("Entrepôt")).toBeInTheDocument();
  });

  test("sends the chosen building with the new user", async () => {
    const { onCreate } = renderPanel();
    await fillBasics("warehouse_agent");
    await userEvent.selectOptions(screen.getByLabelText("Marché"), "market-ly");
    await userEvent.selectOptions(screen.getByLabelText("Entrepôt"), "site-benghazi");
    await userEvent.click(screen.getByRole("button", { name: /créer/i }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ role: "warehouse_agent", warehouse_id: "site-benghazi" }),
      ),
    );
  });

  /*
   * Switching away from the warehouse role must drop the building, or a phone
   * agent is created carrying a site nothing in the system honours.
   */
  test("forgets the building when the role changes away", async () => {
    const { onCreate } = renderPanel();
    await fillBasics("warehouse_agent");
    await userEvent.selectOptions(screen.getByLabelText("Marché"), "market-ly");
    await userEvent.selectOptions(screen.getByLabelText("Entrepôt"), "site-benghazi");
    const selects = screen.getAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "agent");
    await userEvent.click(screen.getByRole("button", { name: /créer/i }));
    await waitFor(() => expect(onCreate).toHaveBeenCalled());
    expect(onCreate.mock.calls[0][0].warehouse_id).toBeUndefined();
  });
});
