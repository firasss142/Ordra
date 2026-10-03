import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import type { PickupSiteState } from "@/app/api/warehouse/pickup/route";
import { PickupSwitch } from "../PickupSwitch";

/**
 * « Le chauffeur est passé » — one compact line per building.
 *
 * The behaviour is the 2026-09-12 switch's, unchanged (docs/darb-pickup-switch.md):
 * a press is confirmed, then POSTed for ONE building; the server decides who may
 * press and who may undo, and the screen only shows the buttons it was told to.
 * The presentation is the v3 prototype's `.pickup` (phone) and `.pick` (desk).
 */

let sites: PickupSiteState[] = [];
const mutate = vi.fn();
vi.mock("swr", () => ({
  default: () => ({ data: { sites }, mutate, isLoading: false }),
}));

const site = (over: Partial<PickupSiteState>): PickupSiteState => ({
  warehouseId: "B",
  code: "benghazi",
  name: "Benghazi",
  disabled: false,
  disabledAt: null,
  canDisable: true,
  canEnable: false,
  ...over,
});

function renderSwitch(variant: "bench" | "console", locale: "fr" | "ar" = "fr") {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? arMessages : frMessages}>
      <PickupSwitch variant={variant} />
    </NextIntlClientProvider>,
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sites = [site({})];
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sites }) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", vi.fn(() => true));
  mutate.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PickupSwitch — the agent's line (bench)", () => {
  it("is one line: a state dot, the sentence, and the press", () => {
    renderSwitch("bench");
    const line = screen.getByTestId("wh-pickup-site-benghazi");
    expect(line).toHaveAttribute("data-state", "pending");
    expect(within(line).getByText("Le chauffeur Darb n'est pas encore passé")).toBeInTheDocument();
    expect(within(line).getByRole("button", { name: "Il est passé" })).toBeInTheDocument();
  });

  it("asks before switching a building's pickup off, then sends that building only", async () => {
    renderSwitch("bench");
    fireEvent.click(screen.getByRole("button", { name: "Il est passé" }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/warehouse/pickup");
    expect(JSON.parse(init.body)).toEqual({ warehouse_id: "B", disabled: true });
  });

  it("does nothing when the press is not confirmed", () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    renderSwitch("bench");
    fireEvent.click(screen.getByRole("button", { name: "Il est passé" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says when the driver came, and gives an agent no undo — that is a manager's call", () => {
    const at = "2026-10-02T09:20:00Z";
    sites = [site({ disabled: true, disabledAt: at, canDisable: false, canEnable: false })];
    renderSwitch("bench");
    const line = screen.getByTestId("wh-pickup-site-benghazi");
    expect(line).toHaveAttribute("data-state", "done");
    expect(within(line).getByText(`Chauffeur passé à ${time(at)}`)).toBeInTheDocument();
    expect(within(line).queryByRole("button")).toBeNull();
  });

  it("reads in Arabic", () => {
    renderSwitch("bench", "ar");
    expect(screen.getByText("لم يمر سائق درب بعد")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "مرّ السائق" })).toBeInTheDocument();
  });
});

describe("PickupSwitch — the desk, one card per building (console)", () => {
  beforeEach(() => {
    sites = [
      site({ warehouseId: "T", code: "tripoli", name: "Tripoli" }),
      site({ disabled: true, disabledAt: "2026-10-02T09:20:00Z", canDisable: false, canEnable: true }),
    ];
  });

  it("names each building with its own state", () => {
    renderSwitch("console");
    const tripoli = screen.getByTestId("wh-pickup-site-tripoli");
    expect(within(tripoli).getByText("Tripoli")).toBeInTheDocument();
    expect(within(tripoli).getByText("Chauffeur Darb pas encore passé")).toBeInTheDocument();
    expect(within(tripoli).getByRole("button", { name: "Il est passé" })).toBeInTheDocument();
    const benghazi = screen.getByTestId("wh-pickup-site-benghazi");
    expect(within(benghazi).getByText(`Chauffeur passé à ${time("2026-10-02T09:20:00Z")}`)).toBeInTheDocument();
  });

  it("lets a manager undo before midnight", async () => {
    renderSwitch("console");
    fireEvent.click(within(screen.getByTestId("wh-pickup-site-benghazi")).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ warehouse_id: "B", disabled: false });
  });

  it("says so when the server refuses", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    renderSwitch("console");
    fireEvent.click(screen.getByRole("button", { name: "Il est passé" }));
    expect(await screen.findByText("Action impossible. Réessayez.")).toBeInTheDocument();
  });
});
