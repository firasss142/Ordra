import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

vi.mock("swr", () => ({ default: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: (fn: () => Promise<{ default: unknown }>) => fn }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import useSWR from "swr";
import { LeadsTable } from "./LeadsTable";
import type { Lead } from "@/types/lead";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    market_id: "market-1",
    source: "manual_call",
    source_external_id: null,
    source_platform: null,
    status: "new",
    customer_name: "Alice",
    customer_phone: "+216 22 333 444",
    customer_city: "Tunis",
    customer_address: null,
    product_interest_id: null,
    product_interest_note: null,
    notes: null,
    assigned_to: null,
    callback_scheduled_at: null,
    lost_reason: null,
    lost_note: null,
    converted_order_id: null,
    campaign_id: null,
    raw_payload: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    is_hot: false,
    has_duplicate: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSWR).mockReturnValue({
    data: { data: [makeLead()], pagination: { page: 1, limit: 50, total: 1 } },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  } as unknown as ReturnType<typeof useSWR>);
});

function renderTable(overrides = {}) {
  return render(
    <LeadsTable
      marketId="market-1"
      locale="fr"
      isSuperAdmin={false}
      {...overrides}
    />
  );
}

describe("LeadsTable", () => {
  it("renders column headers", () => {
    renderTable();
    expect(screen.getByText("Client")).toBeDefined();
    expect(screen.getByText("Téléphone")).toBeDefined();
    expect(screen.getByText("Statut")).toBeDefined();
  });

  it("renders lead row with customer name", () => {
    renderTable();
    expect(screen.getByText("Alice")).toBeDefined();
  });

  it("renders call-now link with tel: href", () => {
    renderTable();
    const link = screen.getByRole("link", { name: /appeler/i });
    expect(link.getAttribute("href")).toBe("tel:+216 22 333 444");
  });

  it("requests only visible statuses when bucket-filtered", () => {
    renderTable({ visibleStatuses: ["qualified", "won"] });
    const key = vi.mocked(useSWR).mock.calls[0]?.[0];
    const url = new URL(String(key), "http://localhost:3000");
    expect(url.searchParams.get("statuses")).toBe("qualified,won");
  });

  it("does NOT show convert button when status is not qualified", () => {
    renderTable();
    expect(screen.queryByRole("button", { name: /convertir/i })).toBeNull();
  });

  it("shows convert button when status is qualified", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: {
        data: [makeLead({ status: "qualified" })],
        pagination: { page: 1, limit: 50, total: 1 },
      },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    } as unknown as ReturnType<typeof useSWR>);
    renderTable();
    expect(screen.getByRole("button", { name: /convertir/i })).toBeDefined();
  });
});
