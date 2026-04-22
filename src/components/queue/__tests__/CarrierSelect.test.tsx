import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { CarrierSelect } from "../CarrierSelect";

// Mock SWR
vi.mock("swr", () => ({
  default: vi.fn(),
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

import useSWR from "swr";

const mockCarriers = [
  {
    id: "c1",
    carrier_type: "navex",
    sender_name: "Navex Tunisie",
    is_active: true,
    market_id: "m1",
    api_key_encrypted: "",
    api_base_url: null,
    sender_location: null,
  },
  {
    id: "c2",
    carrier_type: "dexpress",
    sender_name: null,
    is_active: true,
    market_id: "m1",
    api_key_encrypted: "",
    api_base_url: null,
    sender_location: null,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CarrierSelect", () => {
  it("shows loading text while fetching", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    } as ReturnType<typeof useSWR>);

    render(<CarrierSelect marketId="m1" onSelect={vi.fn()} />);
    expect(screen.getByText("Chargement des transporteurs…")).toBeDefined();
  });

  it("renders nothing and reports 0 via onCarriersLoaded when no carriers", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { data: [] },
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSWR>);

    const onCarriersLoaded = vi.fn();
    const { container } = render(
      <CarrierSelect marketId="m1" onSelect={vi.fn()} onCarriersLoaded={onCarriersLoaded} />
    );
    expect(container.firstChild).toBeNull();
    expect(onCarriersLoaded).toHaveBeenCalledWith(0);
  });

  it("renders carrier rows with sender_name when available", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { data: mockCarriers },
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSWR>);

    render(<CarrierSelect marketId="m1" onSelect={vi.fn()} />);
    expect(screen.getByText("Navex Tunisie")).toBeDefined();
  });

  it("renders carrier_type as label when sender_name is null", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { data: mockCarriers },
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSWR>);

    render(<CarrierSelect marketId="m1" onSelect={vi.fn()} />);
    expect(screen.getByText("dexpress")).toBeDefined();
  });

  it("shows carrier_type badge for each carrier", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { data: mockCarriers },
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSWR>);

    render(<CarrierSelect marketId="m1" onSelect={vi.fn()} />);
    // Both should have their type shown
    const badges = screen.getAllByText(/navex|dexpress/);
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("calls onSelect with carrier when row is clicked", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { data: mockCarriers },
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSWR>);

    const onSelect = vi.fn();
    render(<CarrierSelect marketId="m1" onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Navex Tunisie"));
    expect(onSelect).toHaveBeenCalledWith(mockCarriers[0]);
  });

  it("highlights selected carrier with 2px border", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { data: mockCarriers },
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSWR>);

    render(<CarrierSelect marketId="m1" onSelect={vi.fn()} />);
    const row = screen.getByText("Navex Tunisie").closest("div");
    fireEvent.click(row!);
    expect(row?.style.borderWidth).toBe("2px");
  });
});
