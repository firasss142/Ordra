import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("swr", () => ({ default: vi.fn() }));
import useSWR from "swr";

import { CarriersPanel } from "../CarriersPanel";

const MK_TN = "00000000-0000-0000-0000-000000000001";

const CARRIERS = [
  { id: "c-navex", market_id: MK_TN, name: "Navex", code: "navex", api_endpoint: "", delivery_fee: 6, return_fee: 4, is_active: true },
  { id: "c-test", market_id: MK_TN, name: "TestCarrier3", code: "TC3", api_endpoint: "", delivery_fee: 0, return_fee: 0, is_active: true },
];

const PERF = [
  { carrier_id: "c-navex", delivered: 100, returned: 10, delivery_rate_30d: 0.73, median_transit_hours: 48, sample_size: 137 },
];

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string | null) => {
    if (key && key.includes("/performance")) return { data: { data: PERF }, mutate: vi.fn() };
    if (key && key.includes("/api/carriers")) return { data: { data: CARRIERS }, mutate, isLoading: false };
    return { data: undefined, mutate: vi.fn() };
  });
  vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
});

function mount(readOnly = false) {
  return render(<CarriersPanel role="super_admin" marketId={MK_TN} currency="TND" readOnly={readOnly} />);
}

describe("CarriersPanel", () => {
  it("lists carriers with fees and delivery rate", () => {
    mount();
    expect(screen.getByText("Navex")).toBeInTheDocument();
    const navexRow = screen.getByText("Navex").closest("tr")!;
    expect(within(navexRow).getByText(/6\.000 TND/)).toBeInTheDocument();
    expect(within(navexRow).getByText(/73/)).toBeInTheDocument(); // delivery rate 73%
  });

  it("archives a carrier via the ⋯ menu (DELETE without hard flag)", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Actions Navex/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Archiver" }));
    expect(global.fetch).toHaveBeenCalledWith("/api/carriers/c-navex", { method: "DELETE" });
  });

  it("hard-deletes with typed-name confirm via the hard endpoint", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Actions TestCarrier3/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Supprimer définitivement" }));
    const btn = await screen.findByRole("button", { name: /Supprimer définitivement/ });
    expect(btn).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("TestCarrier3"), "TestCarrier3");
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(global.fetch).toHaveBeenCalledWith("/api/carriers/c-test?hard=true", { method: "DELETE" });
  });

  it("tests reachability from the ⋯ menu", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({ reachable: true }), { status: 200 }));
    mount();
    await userEvent.click(screen.getByRole("button", { name: /Actions Navex/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Tester/ }));
    expect(global.fetch).toHaveBeenCalledWith("/api/carriers/c-navex/test?mode=reachability", { method: "POST" });
  });

  it("read-only disables the active toggle", () => {
    mount(true);
    expect(screen.getByRole("switch", { name: /Actif Navex/ })).toBeDisabled();
  });
});
