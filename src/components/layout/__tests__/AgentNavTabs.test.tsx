import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { AgentNavTabs } from "@/components/layout/AgentNavTabs";
import type { AuthUser } from "@/types";

vi.mock("next/navigation", () => ({ usePathname: () => "/fr/delivery" }));
vi.mock("swr", async (orig) => ({ ...(await orig<typeof import("swr")>()), preload: vi.fn() }));

const user = { id: "a1", email: "a@x", full_name: "Hend", avatar_url: null, role: "agent", market_id: "m", locale: "fr", direction: "ltr" } as AuthUser;

describe("AgentNavTabs", () => {
  it("offers File, Prospects, Livraison and Commissions — Livraison replaces the old follow-ups tab", () => {
    render(<NextIntlClientProvider locale="fr" messages={fr}><AgentNavTabs user={user} /></NextIntlClientProvider>);
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/fr/queue", "/fr/leads", "/fr/delivery", "/fr/commissions"]);
    expect(screen.getByRole("link", { name: /Livraison/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("link", { name: /Relances|Suivis/ })).toBeNull();
  });

  it("the Livraison tab counts the parcels that need the agent now: returns to save plus act-now", async () => {
    const rows = [{ bucket: "returning" }, { bucket: "act_now" }, { bucket: "act_now" }, { bucket: "waiting_carrier" }, { bucket: "done" }];
    render(
      <SWRConfig value={{ provider: () => new Map(), fetcher: () => ({ rows }) }}>
        <NextIntlClientProvider locale="fr" messages={fr}><AgentNavTabs user={user} /></NextIntlClientProvider>
      </SWRConfig>,
    );
    await waitFor(() => expect(screen.getByRole("link", { name: /Livraison/ }).textContent).toContain("3"));
  });
});
