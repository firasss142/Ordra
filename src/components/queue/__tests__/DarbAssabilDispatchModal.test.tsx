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

const SERVICES = [
  { service_id: "svc-male", title: "توصيل رجالي", attribute: "male", surcharge: 0, currency: "lyd", is_default: true },
  { service_id: "svc-express", title: "توصيل فوري", attribute: "express", surcharge: 15, currency: "lyd", is_default: false },
];

// The carrier account is now passed in via the `carrierId` prop, so the modal's
// only data fetch is the Darb service catalogue.
function mockServices(services: typeof SERVICES) {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
    if (typeof key === "string" && key.includes("/api/darb/services")) {
      return { data: { services }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  });
}

const BASE = {
  orderId: "order-1",
  carrierId: "c-darb",
  customerAddress: "test",
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockServices([]);
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
    // Dispatch targets the carrier account the agent picked (passed via prop).
    expect(body.carrier_id).toBe("c-darb");
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
    mockServices(SERVICES);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ data: { tracking_number: "SH1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);

    // Default service (men's) is preselected; pick express instead.
    fireEvent.click(screen.getByRole("radio", { name: /توصيل فوري/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmer l'envoi/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra.service_id).toBe("svc-express");
    // Express has a surcharge → fees billed to the customer on top.
    expect(body.extra.service_fee_on_top).toBe(true);

    vi.unstubAllGlobals();
  });

  it("sends service_fee_on_top=false for the free default service (men's)", async () => {
    mockServices(SERVICES);
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ data: { tracking_number: "SH1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);

    // Leave the preselected default (men's, surcharge 0) and confirm.
    fireEvent.click(screen.getByRole("button", { name: /Confirmer l'envoi/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.extra.service_id).toBe("svc-male");
    expect(body.extra.service_fee_on_top).toBe(false);

    vi.unstubAllGlobals();
  });
});

describe("DarbAssabilDispatchModal — account selection", () => {
  it("dispatches against the carrierId prop (a second Darb account routes to its own id)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ data: { tracking_number: "SH2" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // The agent picked the *second* Darb account; the modal must ship to it,
    // not re-resolve "the" darb_assabil carrier by code.
    render(
      <DarbAssabilDispatchModal {...BASE} carrierId="c-darb-2" customerCity="اجدابيا" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Confirmer l'envoi/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.carrier_id).toBe("c-darb-2");

    vi.unstubAllGlobals();
  });
});

// The fulfilment selector is rendered by this shared modal, so it appears
// identically whether the agent arrives from the post-call sheet (pending →
// confirm → upload) or from the order detail panel.
describe("DarbAssabilDispatchModal — fulfilment source", () => {
  function mockAvailability(availability: unknown, opts: { loading?: boolean } = {}) {
    (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
      if (typeof key === "string" && key.includes("/api/darb/services")) {
        return { data: { services: SERVICES }, isLoading: false };
      }
      if (typeof key === "string" && key.includes("warehouse-availability")) {
        return { data: availability, isLoading: !!opts.loading };
      }
      return { data: undefined, isLoading: false };
    });
  }

  it("offers both fulfilment tiles, defaulting to our own warehouse", () => {
    mockAvailability({ available: true, reason: null, lines: [] });
    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);

    const ours = screen.getByRole("radio", { name: /Notre entrepôt/ });
    const theirs = screen.getByRole("radio", { name: /Entrepôt Darb Assabil/ });
    expect(ours).toHaveAttribute("aria-checked", "true");
    expect(theirs).toHaveAttribute("aria-checked", "false");
    expect(theirs).toBeEnabled();
  });

  it("shows live carrier stock once their warehouse is selected", () => {
    mockAvailability({
      available: true,
      reason: null,
      lines: [{ product_name: "Quran", sku: "القران", requested: 1, available: 29, sufficient: true }],
    });
    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);
    fireEvent.click(screen.getByRole("radio", { name: /Entrepôt Darb Assabil/ }));

    expect(screen.getByText(/1 demandé\(s\) · 29 disponible\(s\)/)).toBeInTheDocument();
  });

  it("disables their warehouse and states the reason when unavailable", () => {
    mockAvailability({
      available: false,
      reason: "Stock insuffisant chez le transporteur : القران (0/1)",
      lines: [],
    });
    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);

    expect(screen.getByRole("radio", { name: /Entrepôt Darb Assabil/ })).toBeDisabled();
    expect(screen.getByText(/Stock insuffisant chez le transporteur/)).toBeInTheDocument();
  });

  // The SWR fetcher throws on a non-2xx, so `data` stays undefined. Without an
  // explicit branch the tile went dead with no explanation while its hint still
  // read "prépare et expédie depuis son entrepôt" — silently unusable.
  it("explains itself when the availability check fails outright", () => {
    mockAvailability(undefined);
    render(<DarbAssabilDispatchModal {...BASE} customerCity="اجدابيا" />);

    expect(screen.getByRole("radio", { name: /Entrepôt Darb Assabil/ })).toBeDisabled();
    expect(screen.getByText(/Indisponible pour cette commande/)).toBeInTheDocument();
  });
});
