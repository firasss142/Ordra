import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AdminInvestorsPanel } from "./AdminInvestorsPanel";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => mockUseSWR(key),
  mutate: vi.fn(),
}));

const MARKETS = [
  { id: "m-ly", code: "ly", name: "Libya" },
  { id: "m-tn", code: "tn", name: "Tunisia" },
];

const investor = (over: Record<string, unknown> = {}) => ({
  id: "u-1",
  email: "ilyes@oms.local",
  full_name: "ilyes",
  market_id: "m-tn",
  is_active: true,
  configured: true,
  legal_name: "Ilyes Capital SARL",
  payout_method: "bank_transfer",
  payout_details: null,
  reserve_pct: 10,
  notes: null,
  ...over,
});

function mount(rows: ReturnType<typeof investor>[], state: { error?: unknown } = {}) {
  const mutateList = vi.fn();
  mockUseSWR.mockImplementation(() => ({
    data: state.error ? undefined : { data: rows },
    error: state.error,
    isLoading: false,
    mutate: mutateList,
  }));
  return { ...render(<AdminInvestorsPanel markets={MARKETS} locale="fr" />), mutateList };
}

beforeEach(() => {
  mockUseSWR.mockReset();
  vi.restoreAllMocks();
});

describe("AdminInvestorsPanel — listing", () => {
  test("shows a configured investor's terms", () => {
    mount([investor()]);
    expect(screen.getByText("Ilyes Capital SARL")).toBeInTheDocument();
    expect(screen.getByText(/ilyes@oms.local/)).toBeInTheDocument();
    expect(screen.getByText(/10\s*%/)).toBeInTheDocument();
  });

  /**
   * A user with role=investor but no `investors` row logs in to "Votre profil
   * investisseur n'est pas encore configuré" and cannot get out of it. This
   * panel is the way out, so the state has to be visible here.
   */
  test("flags a user whose profile was never created", () => {
    mount([investor({ configured: false, legal_name: null, reserve_pct: null })]);
    expect(screen.getByText(/Profil incomplet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Configurer/i })).toBeInTheDocument();
  });

  test("shows the investor's market", () => {
    mount([investor()]);
    expect(screen.getByText("Ilyes Capital SARL").closest("li")).toHaveTextContent("Tunisia");
  });

  test("does not claim there are no investors when the fetch failed", () => {
    mount([], { error: new Error("boom") });
    expect(screen.queryByText(/Aucun investisseur/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Réessayer/i })).toBeInTheDocument();
  });
});

describe("AdminInvestorsPanel — configuring a profile", () => {
  test("posts the new profile for an unconfigured user", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    mount([investor({ configured: false, legal_name: null, reserve_pct: null })]);

    fireEvent.click(screen.getByRole("button", { name: /Configurer/i }));
    fireEvent.change(screen.getByLabelText(/Raison sociale/i), {
      target: { value: "Ilyes Capital SARL" },
    });
    fireEvent.change(screen.getByLabelText(/Réserve/i), { target: { value: "12.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/admin/investments/investors");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      user_id: "u-1",
      legal_name: "Ilyes Capital SARL",
      reserve_pct: 12.5,
    });
  });

  test("blocks an empty legal name before it reaches the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount([investor({ configured: false, legal_name: null })]);

    fireEvent.click(screen.getByRole("button", { name: /Configurer/i }));
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("AdminInvestorsPanel — editing terms", () => {
  test("patches only the edited investor", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    mount([investor()]);

    fireEvent.click(screen.getByRole("button", { name: /Modifier/i }));
    fireEvent.change(screen.getByLabelText(/Réserve/i), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/admin/investments/investors/u-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toMatchObject({ reserve_pct: 20 });
  });

  /**
   * computeSettlement snapshots reserve_pct, so editing it cannot move a period
   * that has already been paid. An admin who assumes otherwise will expect a
   * historical payout to change.
   */
  test("warns that the reserve only affects future settlements", () => {
    mount([investor()]);
    fireEvent.click(screen.getByRole("button", { name: /Modifier/i }));
    expect(screen.getByText(/futures/i)).toBeInTheDocument();
  });

  test("rejects a reserve outside 0–100 without calling the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount([investor()]);

    fireEvent.click(screen.getByRole("button", { name: /Modifier/i }));
    fireEvent.change(screen.getByLabelText(/Réserve/i), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("surfaces a server rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Investor not found" }), { status: 404 })
    );
    mount([investor()]);

    fireEvent.click(screen.getByRole("button", { name: /Modifier/i }));
    fireEvent.change(screen.getByLabelText(/Raison sociale/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Investor not found/i);
  });

  test("only one row opens its editor at a time", () => {
    mount([investor(), investor({ id: "u-2", legal_name: "Second SARL", email: "b@x" })]);
    const first = screen.getByText("Ilyes Capital SARL").closest("li")!;
    fireEvent.click(within(first).getByRole("button", { name: /Modifier/i }));
    expect(screen.getAllByLabelText(/Raison sociale/i)).toHaveLength(1);
  });
});
