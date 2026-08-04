import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AdminCorrectionsPanel } from "./AdminCorrectionsPanel";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (key: string) => mockUseSWR(key),
  mutate: vi.fn(),
}));

const INVESTORS = [
  { id: "u-1", legal_name: "Ilyes Capital SARL", full_name: "ilyes", configured: true },
  { id: "u-2", legal_name: null, full_name: "bob", configured: false },
];

function mount() {
  mockUseSWR.mockImplementation(() => ({ data: { data: INVESTORS }, error: undefined }));
  return render(<AdminCorrectionsPanel />);
}

/** Fill the form with a valid correction. */
function fillValid() {
  fireEvent.change(screen.getByLabelText(/Investisseur/i), { target: { value: "u-1" } });
  fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: "-67.26" } });
  fireEvent.change(screen.getByLabelText(/Motif/i), {
    target: { value: "Retours tardifs mars" },
  });
}

beforeEach(() => {
  mockUseSWR.mockReset();
  vi.restoreAllMocks();
});

describe("AdminCorrectionsPanel — guards", () => {
  test("refuses a correction with no explanation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount();

    fireEvent.change(screen.getByLabelText(/Investisseur/i), { target: { value: "u-1" } });
    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: "-50" } });
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("refuses a zero amount", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount();

    fireEvent.change(screen.getByLabelText(/Investisseur/i), { target: { value: "u-1" } });
    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/Motif/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("requires an investor", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount();

    fireEvent.change(screen.getByLabelText(/Montant/i), { target: { value: "-50" } });
    fireEvent.change(screen.getByLabelText(/Motif/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("offers only investors who have a profile", () => {
    mount();
    const select = screen.getByLabelText(/Investisseur/i);
    expect(select).toHaveTextContent("Ilyes Capital SARL");
    expect(select).not.toHaveTextContent("bob");
  });
});

describe("AdminCorrectionsPanel — posting", () => {
  /**
   * The ledger is append-only: a mistyped correction can only be answered with
   * another correction. One deliberate confirmation step is cheap insurance.
   */
  test("does not post until the entry is confirmed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount();

    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));

    expect(await screen.findByText(/irréversible/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("posts the entry once confirmed", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    mount();

    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("/api/admin/investments/corrections");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      investor_id: "u-1",
      entry_type: "correction",
      amount: -67.26,
      note: "Retours tardifs mars",
    });
  });

  test("cancelling the confirmation posts nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mount();

    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    fireEvent.click(screen.getByRole("button", { name: /Annuler/i }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Confirmer/i })).not.toBeInTheDocument()
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("surfaces a server rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Investor not found" }), { status: 404 })
    );
    mount();

    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Investor not found/i);
  });

  test("confirms success and clears the form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 201 })
    );
    mount();

    fillValid();
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => expect(screen.getByLabelText(/Motif/i)).toHaveValue(""));
  });

  test("can post the other repair types", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 201 }));
    mount();

    fillValid();
    fireEvent.change(screen.getByLabelText(/Type/i), { target: { value: "principal_return" } });
    fireEvent.click(screen.getByRole("button", { name: /Poster/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toMatchObject({
      entry_type: "principal_return",
    });
  });
});
