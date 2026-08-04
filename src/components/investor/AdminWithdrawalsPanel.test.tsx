import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { AdminWithdrawalsPanel } from "./AdminWithdrawalsPanel";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => mockUseSWR(key),
  mutate: vi.fn(),
}));

const MARKETS = [
  { id: "m-ly", code: "ly", name: "Libya" },
  { id: "m-tn", code: "tn", name: "Tunisia" },
];

const row = (over: Record<string, unknown> = {}) => ({
  id: "w-1",
  investor_id: "inv-1",
  market_id: "m-tn",
  amount: 300,
  status: "requested",
  requested_at: "2026-08-02T10:00:00.000Z",
  decided_at: null,
  paid_at: null,
  payout_reference: null,
  note: null,
  investors: { legal_name: "Ilyes Capital SARL" },
  ...over,
});

function mount(
  rows: ReturnType<typeof row>[],
  state: { error?: unknown; isLoading?: boolean } = {}
) {
  const mutateList = vi.fn();
  mockUseSWR.mockImplementation(() => ({
    data: state.error ? undefined : { data: rows },
    error: state.error,
    isLoading: state.isLoading ?? false,
    mutate: mutateList,
  }));
  return { ...render(<AdminWithdrawalsPanel markets={MARKETS} locale="fr" />), mutateList };
}

beforeEach(() => {
  mockUseSWR.mockReset();
  vi.restoreAllMocks();
});

describe("AdminWithdrawalsPanel — the queue", () => {
  test("shows a pending request with who is owed and how much", () => {
    mount([row()]);
    expect(screen.getByText("Ilyes Capital SARL")).toBeInTheDocument();
    expect(screen.getByText(/300,000/)).toBeInTheDocument();
  });

  test("denominates each row by its own market", () => {
    mount([
      row({ id: "w-tn", market_id: "m-tn", amount: 300 }),
      row({ id: "w-ly", market_id: "m-ly", amount: 400, investors: { legal_name: "Other" } }),
    ]);
    const tn = screen.getByText("Ilyes Capital SARL").closest("li")!;
    const ly = screen.getByText("Other").closest("li")!;
    expect(tn).toHaveTextContent("DT");
    expect(ly).toHaveTextContent("د.ل");
  });

  test("says the queue is empty only when it really is", () => {
    mount([]);
    expect(screen.getByText(/Aucune demande/i)).toBeInTheDocument();
  });

  test("never claims an empty queue when the request failed", () => {
    mount([], { error: new Error("boom") });
    expect(screen.queryByText(/Aucune demande/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Réessayer/i })).toBeInTheDocument();
  });
});

describe("AdminWithdrawalsPanel — decisions", () => {
  test("approves a requested withdrawal", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    mount([row()]);

    fireEvent.click(screen.getByRole("button", { name: /Approuver/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/admin/investments/withdrawals/w-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toMatchObject({ action: "approve" });
  });

  test("offers mark-paid only once approved", () => {
    const { unmount } = mount([row({ status: "requested" })]);
    expect(screen.queryByRole("button", { name: /Marquer payé/i })).not.toBeInTheDocument();
    unmount();

    mount([row({ status: "approved" })]);
    expect(screen.getByRole("button", { name: /Marquer payé/i })).toBeInTheDocument();
  });

  test("sends the payout reference when marking paid", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    mount([row({ status: "approved" })]);

    fireEvent.click(screen.getByRole("button", { name: /Marquer payé/i }));
    fireEvent.change(screen.getByLabelText(/Référence/i), { target: { value: "VIR-2026-77" } });
    fireEvent.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
      action: "mark_paid",
      payout_reference: "VIR-2026-77",
    });
  });

  test("a settled row offers no actions and shows its reference", () => {
    mount([row({ status: "paid", payout_reference: "VIR-2026-77" })]);
    const li = screen.getByText("Ilyes Capital SARL").closest("li")!;
    expect(within(li).queryByRole("button", { name: /Approuver|Refuser|Marquer payé/i })).toBeNull();
    expect(li).toHaveTextContent("VIR-2026-77");
  });

  test("surfaces a rejected transition instead of failing silently", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Cannot approve a withdrawal that is approved" }), {
        status: 409,
      })
    );
    mount([row()]);

    fireEvent.click(screen.getByRole("button", { name: /Approuver/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Cannot approve/i);
  });

  test("refreshes the list after a successful decision", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const { mutateList } = mount([row()]);

    fireEvent.click(screen.getByRole("button", { name: /Approuver/i }));

    await waitFor(() => expect(mutateList).toHaveBeenCalled());
  });
});
