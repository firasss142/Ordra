import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { DarbAssabilDispatchModal } from "../DarbAssabilDispatchModal";

vi.mock("swr", () => ({ default: vi.fn() }));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

import useSWR from "swr";

// Default: active carrier, no services (services list empty → service_id omitted).
function mockActiveCarrier() {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
    if (typeof key === "string" && key.includes("/api/darb/services")) {
      return { data: { services: [] }, isLoading: false };
    }
    return { data: { carrier: { id: "c-darb", is_active: true } }, isLoading: false };
  });
}

const SERVICES = [
  { service_id: "svc-male", title: "توصيل رجالي", attribute: "male", surcharge: 0, currency: "lyd", is_default: true },
  { service_id: "svc-express", title: "توصيل فوري", attribute: "express", surcharge: 15, currency: "lyd", is_default: false },
];

function mockCarrierAndServices() {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
    if (typeof key === "string" && key.includes("/api/darb/services")) {
      return { data: { services: SERVICES }, isLoading: false };
    }
    return { data: { carrier: { id: "c-darb", is_active: true } }, isLoading: false };
  });
}

const BASE = {
  orderId: "order-1",
  marketId: "m-ly",
  customerAddress: "test",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockActiveCarrier();
});

describe("DarbAssabilDispatchModal — destination resolution", () => {
  it("single-area city (اجدابيا) shows a FIXED destination, not a free picker", () => {
    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);
    // The resolved destination اجدابيا is shown…
    expect(screen.getByText(/اجدابيا/)).toBeInTheDocument();
    // …and there is NO search box (nothing to misclick).
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("multi-area city (الجفرة) shows the picker scoped to its areas only", () => {
    render(<DarbAssabilDispatchModal {...BASE} customerCity="الجفرة" />);
    // Picker present and الجفرة's areas listed…
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText("الجفرة — سوكنة")).toBeInTheDocument();
    // …but a different city's area (طرابلس/عين زارة) is excluded by the scope.
    expect(screen.queryByText(/عين زارة/)).not.toBeInTheDocument();
  });

  it("truly unknown city shows the full picker", () => {
    // A fabricated label that is neither a Darb city, area, nor alias.
    render(<DarbAssabilDispatchModal {...BASE} customerCity="بلدة وهمية" />);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    // Full list → areas from multiple distinct cities available.
    expect(screen.getByText("الجفرة — سوكنة")).toBeInTheDocument();
    expect(screen.getByText("طرابلس — عين زارة")).toBeInTheDocument();
  });

  it("an area-named city (شحات) pre-resolves to a fixed destination (no picker)", () => {
    render(<DarbAssabilDispatchModal {...BASE} customerCity="شحات" />);
    // شحات → البيضاء/شحات exact pair → fixed destination, no search box.
    expect(screen.getByText(/شحات/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("an alias label (ضواحي طرابلس) scopes the picker to طرابلس", () => {
    render(<DarbAssabilDispatchModal {...BASE} customerCity="ضواحي طرابلس" />);
    // Alias → طرابلس (multi-area): picker present, scoped to طرابلس's areas.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText("طرابلس — عين زارة")).toBeInTheDocument();
    // A different city's area is excluded by the scope.
    expect(screen.queryByText("الجفرة — سوكنة")).not.toBeInTheDocument();
  });
});

describe("DarbAssabilDispatchModal — per-order options", () => {
  it("sends the toggled options in the dispatch extra (defaults off, fragile on)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ data: { tracking_number: "SH1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Single-area city → fixed destination, confirm button enabled immediately.
    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);

    fireEvent.click(screen.getByLabelText("Fragile"));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer l'envoi/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra).toMatchObject({
      city: "اجدابيا",
      customer_area: "اجدابيا",
      is_fragile: true,
      allow_inspection: false,
      allow_card_payment: false,
      allow_testing: false,
    });

    vi.unstubAllGlobals();
  });

  it("sends the chosen service_id (defaults to is_default, switches on pick)", async () => {
    mockCarrierAndServices();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ data: { tracking_number: "SH1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);

    // Default service (men's) is preselected; pick express instead.
    fireEvent.click(screen.getByRole("button", { name: /توصيل فوري/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer l'envoi/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra.service_id).toBe("svc-express");

    vi.unstubAllGlobals();
  });
});
