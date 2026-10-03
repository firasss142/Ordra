import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ReturnVerdict } from "../ReturnVerdict";
import { atDarb } from "./fixtures";

/**
 * The verdict (prototype R.verdict): the parcel in hand, then two tiles of
 * equal size — Intact puts it back in stock in one tap, Abîmé asks why first.
 * The causes are the data's own (`return_reason` enum), and « Autre » needs a
 * note, as the RPC does.
 */
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

function stub(ok = true, body: unknown = { success: true }) {
  const f = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 422, json: async () => body });
  vi.stubGlobal("fetch", f);
  return f;
}
const sent = (f: ReturnType<typeof vi.fn>) => JSON.parse(f.mock.calls[0][1].body);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReturnVerdict", () => {
  it("shows the parcel in hand: product, city · first name, quantity and Darb's reason", () => {
    render(<ReturnVerdict row={atDarb("1", { quantity: 2 })} onRecorded={() => {}} />);
    expect(screen.getByText("مصحف القرآن تدبر وعمل")).toBeInTheDocument();
    expect(screen.getByText("طبرق · سعاد")).toBeInTheDocument();
    expect(screen.getByText("×2")).toBeInTheDocument();
    expect(screen.getByText("Motif Darb")).toBeInTheDocument();
    expect(screen.getByText("Refusé par le client")).toBeInTheDocument();
  });

  it("omits the reason line when Darb gave none, rather than inventing one", () => {
    render(<ReturnVerdict row={atDarb("1", { darb_reason: null })} onRecorded={() => {}} />);
    expect(screen.queryByText("Motif Darb")).toBeNull();
  });

  it("Intact records the return in one tap, back into stock", async () => {
    const f = stub(true, { success: true, stock_after: 943 });
    const onRecorded = vi.fn();
    render(<ReturnVerdict row={atDarb("o-1")} onRecorded={onRecorded} />);
    fireEvent.click(screen.getByRole("button", { name: /Intact/ }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith({ kind: "intact", quantity: 1 }));
    expect(f.mock.calls[0][0]).toBe("/api/warehouse/scan-return");
    expect(sent(f)).toMatchObject({ order_id: "o-1", is_damaged: false, return_reason: null });
  });

  it("Intact says how much enters stock", () => {
    render(<ReturnVerdict row={atDarb("1", { quantity: 3 })} onRecorded={() => {}} />);
    expect(screen.getByRole("button", { name: /Intact/ })).toHaveTextContent("en stock +3");
  });

  it("Abîmé asks for a cause first, and records nothing until one is chosen", () => {
    const f = stub();
    render(<ReturnVerdict row={atDarb("o-1")} onRecorded={() => {}} />);
    expect(screen.queryByText("Quelle cause ?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Abîmé/ }));
    expect(screen.getByText("Quelle cause ?")).toBeInTheDocument();
    const record = screen.getByRole("button", { name: "Enregistrer comme abîmé" });
    expect(record).toBeDisabled();
    fireEvent.click(record);
    expect(f).not.toHaveBeenCalled();
  });

  it("offers the five causes the data accepts", () => {
    render(<ReturnVerdict row={atDarb("o-1")} onRecorded={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Abîmé/ }));
    for (const label of ["Emballage", "Défaut produit", "Dommage client", "Dommage transporteur", "Autre"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("records a damaged return with its cause", async () => {
    const f = stub();
    const onRecorded = vi.fn();
    render(<ReturnVerdict row={atDarb("o-1")} onRecorded={onRecorded} />);
    fireEvent.click(screen.getByRole("button", { name: /Abîmé/ }));
    fireEvent.click(screen.getByRole("button", { name: "Dommage transporteur" }));
    expect(screen.getByRole("button", { name: "Dommage transporteur" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer comme abîmé" }));
    await waitFor(() => expect(onRecorded).toHaveBeenCalledWith({ kind: "damaged", quantity: 1 }));
    expect(sent(f)).toMatchObject({
      order_id: "o-1", is_damaged: true, return_reason: "carrier_damage", return_reason_note: null,
    });
  });

  it("« Autre » needs a note before it can be recorded", async () => {
    const f = stub();
    render(<ReturnVerdict row={atDarb("o-1")} onRecorded={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Abîmé/ }));
    fireEvent.click(screen.getByRole("button", { name: "Autre" }));
    const record = screen.getByRole("button", { name: "Enregistrer comme abîmé" });
    expect(record).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Précisez la cause"), { target: { value: "boîte mouillée" } });
    expect(record).toBeEnabled();
    fireEvent.click(record);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(sent(f)).toMatchObject({ return_reason: "other", return_reason_note: "boîte mouillée" });
  });

  it("says so when the server refuses, and stays on the parcel", async () => {
    stub(false, { error: "Order is not in to_be_returned status (current: returned)" });
    const onRecorded = vi.fn();
    render(<ReturnVerdict row={atDarb("o-1")} onRecorded={onRecorded} />);
    fireEvent.click(screen.getByRole("button", { name: /Intact/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("to_be_returned");
    expect(onRecorded).not.toHaveBeenCalled();
  });
});
