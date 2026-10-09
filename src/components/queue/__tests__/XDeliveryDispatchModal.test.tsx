import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import { XDeliveryDispatchModal } from "../XDeliveryDispatchModal";

/**
 * « Envoyer à X-Delivery » — prototypes/xdelivery-v1.html, screen 3. The governorate is
 * what must be right; the delegation is optional and defaults to the main town
 * (owner decision 1), which the adapter sends when `extra` carries none.
 */

const onClose = vi.fn();
const onSuccess = vi.fn();

function renderModal(over: Partial<React.ComponentProps<typeof XDeliveryDispatchModal>> = {}) {
  return render(
    <NextIntlClientProvider locale="fr" messages={frMessages} timeZone="Africa/Tunis">
      <XDeliveryDispatchModal
        orderId="o-1"
        carrierId="xd-1"
        customerName="Client T."
        customerCity="Sousse"
        totalPrice={89.9}
        onClose={onClose}
        onSuccess={onSuccess}
        {...over}
      />
    </NextIntlClientProvider>,
  );
}

function respond(...answers: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const a of answers) {
    fetchMock.mockResolvedValueOnce({ ok: a.status < 400, status: a.status, json: async () => a.body });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sentExtra = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("XDeliveryDispatchModal", () => {
  it("names the carrier and the order", () => {
    renderModal();
    expect(screen.getByRole("heading", { name: "Envoyer à X-Delivery" })).toBeInTheDocument();
    expect(screen.getByText(/Commande de Client T\. · .*89,900.* · Sousse/)).toBeInTheDocument();
  });

  it("starts on the order's governorate, labelled as such", () => {
    renderModal();
    const select = screen.getByLabelText("Gouvernorat") as HTMLSelectElement;
    expect(select.value).toBe("Sousse");
    expect(within(select).getByRole("option", { name: "Sousse (de la commande)" })).toBeInTheDocument();
  });

  it("an Ordra spelling resolves to X-Delivery's (Manouba → Mannouba)", () => {
    renderModal({ customerCity: "Manouba" });
    expect((screen.getByLabelText("Gouvernorat") as HTMLSelectElement).value).toBe("Mannouba");
  });

  it("the main town is first, selected and marked PAR DÉFAUT, and the note says what goes", () => {
    renderModal();
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Sousse Ville");
    expect(options[0]).toHaveTextContent("PAR DÉFAUT");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Sans choix, on envoie/)).toHaveTextContent("Sans choix, on envoie Sousse Ville");
  });

  it("send without a pick: the governorate only — the adapter applies the default", async () => {
    const fetchMock = respond({ status: 200, body: { data: { tracking_number: "611791217700001" } } });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("611791217700001"));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/orders/o-1/dispatch");
    expect(sentExtra(fetchMock)).toEqual({ carrier_id: "xd-1", extra: { xdelivery_governorate: "Sousse" } });
  });

  it("a picked delegation is sent", async () => {
    const fetchMock = respond({ status: 200, body: { data: { tracking_number: "1" } } });
    renderModal();
    fireEvent.click(screen.getByRole("option", { name: "Msaken" }));
    expect(screen.getByRole("option", { name: "Msaken" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentExtra(fetchMock).extra).toEqual({ xdelivery_governorate: "Sousse", xdelivery_delegation: "Msaken" });
  });

  it("changing the governorate drops the pick and offers that governorate's list", async () => {
    const fetchMock = respond({ status: 200, body: { data: { tracking_number: "1" } } });
    renderModal();
    fireEvent.click(screen.getByRole("option", { name: "Msaken" }));
    fireEvent.change(screen.getByLabelText("Gouvernorat"), { target: { value: "Monastir" } });
    const first = within(screen.getByRole("listbox")).getAllByRole("option")[0];
    expect(first).toHaveTextContent("Monastir");
    expect(first).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentExtra(fetchMock).extra).toEqual({ xdelivery_governorate: "Monastir" });
  });

  it("finds a quartier and sends the delegation it belongs to", async () => {
    const fetchMock = respond({ status: 200, body: { data: { tracking_number: "1" } } });
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("Chercher une délégation ou une localité…"), {
      target: { value: "sahloul" },
    });
    const hit = await screen.findByRole("option", { name: /^Sahloul/ });
    expect(hit).toHaveTextContent("Sousse Jaouhara");
    fireEvent.click(hit);
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sentExtra(fetchMock).extra).toEqual({ xdelivery_governorate: "Sousse", xdelivery_delegation: "Sousse Jaouhara" });
  });

  it("a search with no match says so", async () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("Chercher une délégation ou une localité…"), {
      target: { value: "zzzz" },
    });
    expect(await screen.findByText("Aucune délégation ni localité ne correspond.")).toBeInTheDocument();
  });

  it("a city X-Delivery does not know: no guess, the agent must choose", () => {
    renderModal({ customerCity: "Tripoli" });
    expect((screen.getByLabelText("Gouvernorat") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText(/« Tripoli » n'est pas un gouvernorat connu/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeDisabled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("X-Delivery's refusal is shown and the sheet stays open", async () => {
    respond({ status: 422, body: { error: "Téléphone invalide : 8 chiffres attendus" } });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Téléphone invalide");
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a possible duplicate asks first, then resends with the confirmation", async () => {
    const fetchMock = respond(
      { status: 409, body: { needsConfirmation: true, duplicate: { external_id: "#1042" } } },
      { status: 200, body: { data: { tracking_number: "2" } } },
    );
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    const dialog = await screen.findByRole("dialog", { name: /doublon|similaire|déjà/i });
    fireEvent.click(within(dialog).getAllByRole("button").at(-1)!);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("2"));
    expect(sentExtra(fetchMock, 1)).toMatchObject({ confirm_duplicate: true });
  });

  it("Annuler closes without sending", () => {
    const fetchMock = respond();
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
