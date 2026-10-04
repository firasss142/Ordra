import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import { AlertsBell } from "../AlertsBell";
import type { AuthUser } from "@/types";

const openPanel = vi.fn();
vi.mock("@/context/alerts-panel", () => ({ useAlertsPanel: () => ({ openPanel }) }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

const user: AuthUser = {
  id: "u", email: "a@b.c", full_name: "A", avatar_url: null,
  role: "market_manager", market_id: "m1", locale: "fr", direction: "ltr",
};

function mockTotal(total: number) {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ total }) }) as Response) as unknown as typeof fetch;
}
const renderBell = (variant?: "pill" | "rail") =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AlertsBell user={user} variant={variant} />
    </SWRConfig>,
  );

beforeEach(() => openPanel.mockReset());
afterEach(() => cleanup());

describe("AlertsBell", () => {
  it("shows the count beside the bell, not perched on its corner", async () => {
    mockTotal(143);
    renderBell();
    const button = await screen.findByRole("button", { name: "Alertes — 143 active(s)" });
    expect(button).toHaveTextContent("143");
    expect(button.querySelector(".sb-badge")).not.toBeNull();
  });

  it("caps like every other count", async () => {
    mockTotal(2310);
    renderBell();
    expect(await screen.findByText("999+")).toBeInTheDocument();
  });

  it("is a plain bell when nothing is active", async () => {
    mockTotal(0);
    renderBell();
    const button = await screen.findByRole("button", { name: "Alertes" });
    expect(button).not.toHaveTextContent(/\d/);
  });

  it("opens the alerts panel", async () => {
    mockTotal(3);
    renderBell();
    fireEvent.click(await screen.findByRole("button", { name: /Alertes/ }));
    expect(openPanel).toHaveBeenCalled();
  });

  it("keeps the number in its name and shows only a dot in the 64 px rail", async () => {
    mockTotal(143);
    renderBell("rail");
    const button = await screen.findByRole("button", { name: "Alertes — 143 active(s)" });
    expect(button.querySelector(".sb-rdot")).not.toBeNull();
    expect(button).not.toHaveTextContent("143");
  });
});
