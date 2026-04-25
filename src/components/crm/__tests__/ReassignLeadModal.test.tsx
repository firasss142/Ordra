import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  default: vi.fn(),
}));

import useSWR from "swr";
import { ReassignLeadModal } from "../ReassignLeadModal";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(useSWR).mockReturnValue({
    data: {
      data: [
        { id: "agent-1", full_name: "Alice Dupont", email: "alice@oms.local" },
        { id: "agent-2", full_name: "Bob Martin", email: "bob@oms.local" },
      ],
    },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  } as unknown as ReturnType<typeof useSWR>);
});

const defaultLead = {
  id: "lead-1",
  customer_name: "Test Customer",
  assigned_to: "agent-1",
} as Parameters<typeof ReassignLeadModal>[0]["lead"];

function renderModal(overrides: Partial<React.ComponentProps<typeof ReassignLeadModal>> = {}) {
  return render(
    <ReassignLeadModal
      open={true}
      lead={defaultLead}
      marketId="market-1"
      onClose={vi.fn()}
      onDone={vi.fn()}
      {...overrides}
    />
  );
}

describe("ReassignLeadModal", () => {
  it("renders title", () => {
    renderModal();
    expect(screen.getByText("Réassigner le prospect")).toBeDefined();
  });

  it("renders agent options in select", () => {
    renderModal();
    expect(screen.getByText("Alice Dupont")).toBeDefined();
    expect(screen.getByText("Bob Martin")).toBeDefined();
  });

  it("calls assign API and fires onDone on success", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    renderModal({ onDone });

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "agent-2");

    const submitBtn = screen.getByRole("button", { name: /réassigner/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/leads/lead-1/assign",
        expect.objectContaining({ method: "POST" })
      );
      expect(onDone).toHaveBeenCalled();
    });
  });

  it("shows error message on API failure", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Server error" }),
    });

    renderModal();

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "agent-2");

    const submitBtn = screen.getByRole("button", { name: /réassigner/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeDefined();
    });
  });

  it("requires agent selection before submitting", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderModal({ onDone });

    // Default option is "select agent" placeholder — no valid agent selected
    const submitBtn = screen.getByRole("button", { name: /réassigner/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(onDone).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
