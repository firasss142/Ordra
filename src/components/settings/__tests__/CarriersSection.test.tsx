import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CarriersSection } from "../CarriersSection";

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock("swr", () => ({
  default: vi.fn(),
}));

import useSWR from "swr";

const MARKET_ID = "m-tn";

const CARRIERS = [
  {
    id: "c-1",
    market_id: MARKET_ID,
    name: "Navex TN",
    code: "navex",
    api_endpoint: "https://app.navex.tn/api",
    api_credentials: "••••••••",
    delivery_fee: 6,
    return_fee: 4,
    is_active: true,
  },
  {
    id: "c-2",
    market_id: MARKET_ID,
    name: "Custom Courier",
    code: "mystery",
    api_endpoint: "https://custom.example.com",
    api_credentials: "••••••••",
    delivery_fee: 5,
    return_fee: 3,
    is_active: false,
  },
];

const ADAPTERS = [
  {
    code: "navex",
    label: "Navex",
    description: "Navex description",
    defaultEndpoint: "https://app.navex.tn/api",
    credentialFields: [{ key: "token", label: "Token", secret: true }],
  },
  {
    code: "dexpress",
    label: "DExpress",
    description: "DExpress description",
    credentialFields: [{ key: "api_key", label: "API key", secret: true }],
  },
];

const PERF = [
  {
    carrier_id: "c-1",
    delivered: 90,
    returned: 10,
    delivery_rate_30d: 0.9,
    median_transit_hours: 36,
    sample_size: 100,
  },
];

function setupSWR(overrides?: {
  carriers?: unknown;
  perf?: unknown;
  adapters?: unknown;
}) {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string | null) => {
    if (!key) return { data: undefined, mutate: vi.fn() };
    if (key.includes("/api/carriers/performance")) {
      return { data: overrides?.perf ?? { data: PERF }, mutate: vi.fn() };
    }
    if (key.includes("/api/carriers/adapters")) {
      return { data: overrides?.adapters ?? { data: ADAPTERS }, mutate: vi.fn() };
    }
    if (key.startsWith("/api/carriers")) {
      return { data: overrides?.carriers ?? { data: CARRIERS }, mutate: vi.fn() };
    }
    return { data: undefined, mutate: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  setupSWR();
});

describe("CarriersSection — card rendering", () => {
  test("super_admin sees carrier cards with name, adapter badge, endpoint", () => {
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    expect(screen.getByText("Navex TN")).toBeInTheDocument();
    expect(screen.getByText("Custom Courier")).toBeInTheDocument();
    expect(screen.getByText("Navex")).toBeInTheDocument();
    expect(screen.getByText("Personnalisé")).toBeInTheDocument();
    expect(screen.getByText("https://app.navex.tn/api")).toBeInTheDocument();
  });

  test("non-admin roles render nothing", () => {
    const { container } = render(
      <CarriersSection role="agent" marketId={MARKET_ID} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("shows perf stats for carriers with samples", () => {
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("100 cmd")).toBeInTheDocument();
    expect(screen.getByText("36 h")).toBeInTheDocument();
  });

  test("empty state renders onboarding CTA when no carriers", () => {
    setupSWR({ carriers: { data: [] } });
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    expect(
      screen.getByText("Aucun transporteur configuré pour ce marché.")
    ).toBeInTheDocument();
  });

  test("shows active health badge for healthy carrier", () => {
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    expect(screen.getByText("Connecté")).toBeInTheDocument();
  });

  test("inactive carrier shows disabled badge", () => {
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    expect(screen.getByText("Désactivé")).toBeInTheDocument();
  });
});

describe("CarriersSection — test dispatch flow", () => {
  test("Ping button calls reachability endpoint and shows result", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reachable: true, status: 200, adapter: { code: "navex", known: true } }),
    });
    const user = userEvent.setup();
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    const pingButtons = screen.getAllByRole("button", { name: "Ping" });
    await user.click(pingButtons[0]);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/carriers/c-1/test?mode=reachability",
        { method: "POST" }
      );
    });
    expect(await screen.findByText(/Joignable/)).toBeInTheDocument();
  });

  test("Test dispatch button only shown for known adapters", () => {
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    const dispatchButtons = screen.getAllByRole("button", { name: "Test dispatch" });
    // Only the navex carrier (known adapter) should have it
    expect(dispatchButtons).toHaveLength(1);
  });

  test("Test dispatch calls dry_run endpoint and shows preview count", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        reachable: true,
        adapter: {
          code: "navex",
          known: true,
          dryRun: { payloadPreview: { a: "1", b: "2", c: "3" } },
        },
      }),
    });
    const user = userEvent.setup();
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    await user.click(screen.getByRole("button", { name: "Test dispatch" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/carriers/c-1/test?mode=dry_run",
        { method: "POST" }
      );
    });
    expect(await screen.findByText(/Dry-run OK/)).toBeInTheDocument();
    expect(screen.getByText(/3 champs formatés/)).toBeInTheDocument();
  });
});

describe("CarriersSection — active toggle", () => {
  test("toggles is_active via PATCH", async () => {
    const user = userEvent.setup();
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    const toggle = screen.getByRole("switch", { name: /Actif Navex TN/ });
    await user.click(toggle);
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/carriers/c-1",
        expect.objectContaining({ method: "PATCH" })
      );
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.is_active).toBe(false);
  });
});

describe("CarriersSection — add/edit flow", () => {
  test("Ajouter opens panel with adapter selector populated", async () => {
    const user = userEvent.setup();
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByText("Ajouter un transporteur")).toBeInTheDocument();
    expect(screen.getByText("Adaptateur")).toBeInTheDocument();
    expect(screen.getByText("Navex description")).toBeInTheDocument();
  });

  test("Configurer shows masked key with rotation button", async () => {
    const user = userEvent.setup();
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    const configureButtons = screen.getAllByRole("button", { name: "Configurer" });
    await user.click(configureButtons[0]);
    expect(screen.getByText("Configurer le transporteur")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faire tourner" })).toBeInTheDocument();
  });

  test("Rotation unveils password input and submits new key", async () => {
    const user = userEvent.setup();
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    await user.click(screen.getAllByRole("button", { name: "Configurer" })[0]);
    await user.click(screen.getByRole("button", { name: "Faire tourner" }));
    // password input appears
    const pwInput = document.querySelector(
      'input[type="password"]'
    ) as HTMLInputElement;
    expect(pwInput).not.toBeNull();
    await user.type(pwInput, "new-secret-key");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/carriers/c-1",
        expect.objectContaining({ method: "PATCH" })
      );
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.api_key).toBe("new-secret-key");
  });

  test("Editing without rotating does NOT send api_key", async () => {
    const user = userEvent.setup();
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    await user.click(screen.getAllByRole("button", { name: "Configurer" })[0]);
    // Change name
    const nameInputs = screen.getAllByDisplayValue("Navex TN");
    fireEvent.change(nameInputs[0], { target: { value: "Navex v2" } });
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.api_key).toBeUndefined();
    expect(body.name).toBe("Navex v2");
  });
});

describe("CarriersSection — onboarding guide", () => {
  test("opens onboarding panel with adapter list and steps", async () => {
    const user = userEvent.setup();
    render(<CarriersSection role="super_admin" marketId={MARKET_ID} />);
    await user.click(screen.getByRole("button", { name: /Guide d'intégration/ }));
    expect(
      screen.getByRole("dialog", { name: /Guide d'intégration transporteur/ })
    ).toBeInTheDocument();
    expect(screen.getByText("Adaptateurs disponibles")).toBeInTheDocument();
    expect(screen.getByText(/Étapes pour un nouveau carrier/)).toBeInTheDocument();
  });
});
