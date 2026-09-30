import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { GeneralSettingsGroups } from "../GeneralSettingsGroups";
import { DEFAULT_MARKET_SETTINGS } from "@/types/settings";
import frMessages from "@/messages/fr.json";

// next/navigation — useSearchParams is read for the initial tab.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

// The WhatsApp tab reads the market's connection and templates.
vi.mock("@/hooks/useWhatsAppAvailability", () => ({
  useWhatsAppAvailability: () => ({ availability: null, active: false, isLoading: false }),
}));
vi.mock("@/hooks/useWhatsAppTemplates", () => ({
  useWhatsAppTemplates: () => ({ templates: [], isLoading: false, mutate: vi.fn() }),
}));

// CommissionsSection self-fetches; stub fetch so it doesn't hit the network.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ data: {} }), { status: 200 }),
  );
});

const messages = {
  nav: { markets: { tn: "Tunisie", ly: "Libye" } },
  settings: { commissions: {} },
  whatsappAdmin: frMessages.whatsappAdmin,
};

const TN = "00000000-0000-0000-0000-000000000001";

function mount(role: "super_admin" | "market_manager" = "super_admin", readOnly = false) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <GeneralSettingsGroups
        initialValues={DEFAULT_MARKET_SETTINGS}
        marketId={TN}
        role={role}
        readOnly={readOnly}
      />
    </NextIntlClientProvider>,
  );
}

describe("GeneralSettingsGroups (redesigned tabs)", () => {
  it("shows the five redesigned tabs and neither Finance nor Libellés", () => {
    mount();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(
      expect.arrayContaining(["Opérations", "Alertes", "Équipe", "Objectifs", "Commissions"]),
    );
    expect(tabs.join(" ")).not.toMatch(/Finance/);
    expect(tabs.join(" ")).not.toMatch(/Libellés/);
  });

  it("opens on Opérations with the Confirmation card and the new after-attempts option", () => {
    mount();
    expect(screen.getByText("Confirmation")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Rejeter automatiquement/ })).toBeInTheDocument();
  });

  it("switches to Alertes and shows a threshold field", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: "Alertes" }));
    expect(screen.getByText("Taux d'erreur transporteur")).toBeInTheDocument();
  });

  it("switches to Objectifs and shows a goal field", async () => {
    mount();
    await userEvent.click(screen.getByRole("tab", { name: "Objectifs" }));
    expect(screen.getByText("Commandes traitées / agent / jour")).toBeInTheDocument();
  });

  it("hides the Commissions tab for market_manager (rates are super_admin-only)", () => {
    mount("market_manager");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.join(" ")).not.toMatch(/Commissions/);
  });

  it("shows the Commissions tab for super_admin", () => {
    mount("super_admin");
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs.join(" ")).toMatch(/Commissions/);
  });

  it("in readOnly mode the Opérations save button is absent", () => {
    mount("market_manager", true);
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).not.toBeInTheDocument();
  });

  it("market_manager: the WhatsApp tab is read-only with its note, while Opérations keeps its save", async () => {
    mount("market_manager");
    expect(screen.getAllByRole("button", { name: /Enregistrer/ }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("tab", { name: "WhatsApp" }));
    expect(screen.getByText("Lecture seule — les identifiants et les réglages sont modifiés par un super_admin.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).not.toBeInTheDocument();
    for (const sw of screen.getAllByRole("switch")) expect(sw).toBeDisabled();
  });

  it("super_admin edits the WhatsApp tab", async () => {
    mount("super_admin");
    await userEvent.click(screen.getByRole("tab", { name: "WhatsApp" }));
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Notifications automatiques" })).toBeEnabled();
    expect(screen.queryByText(/Lecture seule/)).not.toBeInTheDocument();
  });
});
