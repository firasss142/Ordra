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
    name: "Navex Tunisie",
    code: "navex",
    market_id: "m1",
    is_active: true,
  },
  {
    id: "c2",
    name: "DExpress Libya",
    code: "dexpress",
    market_id: "m1",
    is_active: true,
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

  it("renders carrier rows with name as primary label", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { data: mockCarriers },
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSWR>);

    render(<CarrierSelect marketId="m1" onSelect={vi.fn()} />);
    expect(screen.getByText("Navex Tunisie")).toBeDefined();
    expect(screen.getByText("DExpress Libya")).toBeDefined();
  });

  it("shows code as secondary chip for each carrier", () => {
    vi.mocked(useSWR).mockReturnValue({
      data: { data: mockCarriers },
      error: undefined,
      isLoading: false,
    } as ReturnType<typeof useSWR>);

    render(<CarrierSelect marketId="m1" onSelect={vi.fn()} />);
    expect(screen.getByText("(navex)")).toBeDefined();
    expect(screen.getByText("(dexpress)")).toBeDefined();
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
