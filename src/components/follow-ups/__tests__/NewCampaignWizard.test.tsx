import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

vi.mock("swr", () => ({
  default: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

import { NewCampaignWizard } from "../NewCampaignWizard";

function renderWizard(props: Partial<React.ComponentProps<typeof NewCampaignWizard>> = {}) {
  return render(
    <NewCampaignWizard
      open={true}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      marketId="mkt-tn"
      {...props}
    />
  );
}

describe("NewCampaignWizard", () => {
  it("renders filter step (step 1) by default", () => {
    renderWizard();
    expect(screen.getByText(/nouvelle campagne/i)).toBeDefined();
    // Should show filter form with the preview button
    expect(screen.getByRole("button", { name: /aperçu|preview/i })).toBeDefined();
  });

  it("does not render when open=false", () => {
    renderWizard({ open: false });
    expect(screen.queryByText(/nouvelle campagne/i)).toBeNull();
  });

  it("step 1 preview button calls the preview API", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { matched_count: 10, skipped_active_followup: 2, sample: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /aperçu|preview/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/follow-up-campaigns/preview",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("step 2 shows matched count and skipped count", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { matched_count: 15, skipped_active_followup: 3, sample: [
            { order_id: "o1", customer_name: "Alice", phone: "+21611111111", city: "Tunis", product_name: "P1", created_at: "2026-04-10T00:00:00Z" },
          ] },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /aperçu|preview/i }));

    await waitFor(() => {
      expect(screen.getByText(/15/)).toBeDefined();
    });
  });

  it("step 3 confirm calls create API and invokes onCreated", async () => {
    // Step 1 → preview
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { matched_count: 5, skipped_active_followup: 0, sample: [] },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    // Step 3 → create
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { campaign_id: "c1", created_count: 5, skipped_count: 0 } }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    );

    const onCreated = vi.fn();
    renderWizard({ onCreated });

    // Step 1 → click Preview
    fireEvent.click(screen.getByRole("button", { name: /aperçu|preview/i }));

    // Wait for step 2
    await waitFor(() => {
      expect(screen.getByText(/5/)).toBeDefined();
    });

    // Move to step 3 (name + confirm)
    const nextBtn = screen.getByRole("button", { name: /suivant|confirmer|nommer/i });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeDefined();
    });

    // Enter name
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Biovera Avril" } });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /créer|confirmer|lancer/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/follow-up-campaigns",
        expect.objectContaining({ method: "POST" })
      );
      expect(onCreated).toHaveBeenCalledWith("c1", 5);
    });
  });
});
