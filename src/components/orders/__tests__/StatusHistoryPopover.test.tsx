import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StatusHistoryPopover } from "../StatusHistoryPopover";
import type { OrderHistoryDetail } from "@/hooks/useOrderHistory";

const intlMockState = vi.hoisted(() => ({ locale: "fr" }));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  const arMessages = (await import("@/messages/ar.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(intlMockState.locale === "ar" ? arMessages : frMessages, ns, key, params),
    useLocale: () => intlMockState.locale,
  };
});

// Drive the hook's return value per-test.
const hookState = vi.hoisted(() => ({
  detail: null as OrderHistoryDetail | null,
  isLoading: false,
  error: undefined as unknown,
}));

vi.mock("@/hooks/useOrderHistory", () => ({
  useOrderHistory: (_orderId: string | null, _enabled: boolean) => hookState,
}));

// Endpoint returns entries in CHRONOLOGICAL order (oldest first).
const TWO_ENTRIES: OrderHistoryDetail = {
  customer_name: "Yathreb B.",
  source_platform: "shopify",
  entries: [
    {
      id: "h1",
      from_status: null,
      to_status: "pending",
      actor_type: "system",
      actor_name: null,
      actor_avatar_url: null,
      created_at: "2026-05-22T16:00:00.000Z",
    },
    {
      id: "h2",
      from_status: "pending",
      to_status: "confirmed",
      actor_type: "agent",
      actor_name: "Sarah B.",
      actor_avatar_url: null,
      created_at: "2026-05-22T17:02:00.000Z",
    },
  ],
};

function reset() {
  intlMockState.locale = "fr";
  hookState.detail = null;
  hookState.isLoading = false;
  hookState.error = undefined;
}

afterEach(() => {
  reset();
  vi.restoreAllMocks();
});

function renderPopover() {
  return render(
    <StatusHistoryPopover orderId="order-1">
      <span>Confirmé</span>
    </StatusHistoryPopover>,
  );
}

describe("StatusHistoryPopover", () => {
  it("renders the trigger child and no popover at rest", () => {
    renderPopover();
    expect(screen.getByText("Confirmé")).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the popover on hover and shows the customer name header", async () => {
    hookState.detail = TWO_ENTRIES;
    const user = userEvent.setup();
    renderPopover();

    await user.hover(screen.getByText("Confirmé"));

    await waitFor(() => expect(screen.getByRole("dialog")).toBeDefined());
    expect(screen.getByText("Yathreb B.")).toBeDefined();
  });

  it("renders entries chronologically (oldest first — intake at top)", async () => {
    hookState.detail = TWO_ENTRIES;
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    const dialog = await screen.findByRole("dialog");
    const items = dialog.querySelectorAll("li");
    expect(items.length).toBe(2);
    // First list item = oldest (intake / pending); last item = newest (confirmed).
    expect(items[0].textContent).toContain("En attente");
    expect(items[1].textContent).toContain("Confirmé");
  });

  it("shows the actor name for an agent and the System label for a system entry", async () => {
    hookState.detail = TWO_ENTRIES;
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    await screen.findByRole("dialog");
    expect(screen.getByText(/Sarah B\./)).toBeDefined();
    expect(screen.getByText(/Système/)).toBeDefined();
  });

  it("renders the empty state when there is no history", async () => {
    hookState.detail = { customer_name: "Yathreb B.", source_platform: null, entries: [] };
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    await screen.findByRole("dialog");
    expect(screen.getByText("Aucun historique pour le moment.")).toBeDefined();
  });

  it("renders the from → to transition on non-intake cards", async () => {
    hookState.detail = TWO_ENTRIES;
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    const dialog = await screen.findByRole("dialog");
    // Newest card (confirmed) is now LAST in the list; it transitions from
    // "En attente" → "Confirmé".
    const newest = dialog.querySelectorAll("li")[1];
    expect(newest.textContent).toContain("En attente");
    expect(newest.textContent).toContain("→");
  });

  it("does NOT render a transition on the intake card (from_status null)", async () => {
    hookState.detail = TWO_ENTRIES;
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    const dialog = await screen.findByRole("dialog");
    // Intake is now FIRST in the list (oldest).
    const intake = dialog.querySelectorAll("li")[0];
    expect(intake.textContent).not.toContain("→");
  });

  it("does not render any note text", async () => {
    // Note that the source data no longer carries `note` — so the popover
    // physically cannot render note text. This guards the contract.
    hookState.detail = TWO_ENTRIES;
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).not.toMatch(/Confirme par l'agent/i);
    expect(dialog.textContent).not.toMatch(/Order received via webhook/i);
  });

  it("uses a system glyph (not a '?' avatar) for system actors", async () => {
    hookState.detail = TWO_ENTRIES;
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    const dialog = await screen.findByRole("dialog");
    // Intake (system) is the first card in chronological order.
    const intake = dialog.querySelectorAll("li")[0];
    // Initials-fallback "?" must not appear for the system row.
    expect(intake.textContent).not.toMatch(/\?/);
    // The system row identifies itself via aria-label on its glyph.
    expect(intake.querySelector('[aria-label="Système"]')).not.toBeNull();
  });

  it("renders the storefront SourceLogo on the intake card when source_platform is set", async () => {
    hookState.detail = { ...TWO_ENTRIES, source_platform: "google_sheets" };
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    const dialog = await screen.findByRole("dialog");
    // SourceLogo renders an element with aria-label / title = "Google Sheets".
    expect(dialog.querySelector('[aria-label="Google Sheets"]')).not.toBeNull();
  });

  it("renders the loading state while fetching", async () => {
    hookState.isLoading = true;
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    await screen.findByRole("dialog");
    expect(screen.getByText("Chargement…")).toBeDefined();
  });

  it("renders the error state on fetch failure", async () => {
    hookState.error = new Error("boom");
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    await screen.findByRole("dialog");
    expect(screen.getByText("Impossible de charger l'historique.")).toBeDefined();
  });

  it("mirrors to RTL (dir=rtl) in the Arabic locale", async () => {
    intlMockState.locale = "ar";
    hookState.detail = TWO_ENTRIES;
    const user = userEvent.setup();
    renderPopover();
    await user.hover(screen.getByText("Confirmé"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("dir")).toBe("rtl");
  });
});
