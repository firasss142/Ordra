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

// SWR returns empty data by default (no markets/products needed for these tests)
vi.mock("swr", () => ({
  default: vi.fn(() => ({ data: undefined })),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

import { NewLeadModal } from "../NewLeadModal";

function render_modal(
  extra: Partial<React.ComponentProps<typeof NewLeadModal>> = {}
) {
  return render(
    <NewLeadModal
      open={true}
      onClose={vi.fn()}
      onCreated={vi.fn()}
      locale="fr"
      defaultMarketId="market-1"
      {...extra}
    />
  );
}

describe("NewLeadModal", () => {
  it("renders without initialStatus (default form state)", () => {
    render_modal();
    expect(screen.getByText("Nouveau prospect")).toBeDefined();
  });

  it("shows callback datetime field when initialStatus is callback_scheduled", () => {
    render_modal({ initialStatus: "callback_scheduled" });
    // The callback datetime input must appear
    expect(screen.getByLabelText(/rappel/i)).toBeDefined();
  });

  it("does not show callback datetime field when initialStatus is attempt_1", () => {
    render_modal({ initialStatus: "attempt_1" });
    expect(screen.queryByLabelText(/rappel/i)).toBeNull();
  });

  it("includes initial_status in the POST body when initialStatus is provided", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "lead-99" } }),
    });

    render_modal({ initialStatus: "qualified" });

    await user.type(screen.getByLabelText(/nom/i), "Test Client");
    await user.type(screen.getByLabelText(/téléphone/i), "12345678");

    const submitBtn = screen.getByRole("button", { name: /créer/i });
    await user.click(submitBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.initial_status).toBe("qualified");
  });

  it("a Libya lead's city is a Darb zone name the order conversion can resolve, not a French governorate", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "lead-ly" } }),
    });
    // No markets are loaded in this harness, so the market is inferred from
    // the locale: "ar" → Libya.
    render_modal({ locale: "ar" });

    await user.type(screen.getByLabelText(/nom/i), "علي");
    await user.type(screen.getByLabelText(/téléphone/i), "912345678");
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.click(await screen.findByRole("option", { name: /^طرابلس/ }));
    await user.click(await screen.findByRole("option", { name: /جنزور/ }));
    expect(screen.getByRole("button", { name: /طرابلس/ })).toHaveTextContent("جنزور");

    await user.click(screen.getByRole("button", { name: /créer/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // The zone name alone: the intake resolver maps it to (طرابلس, جنزور).
    expect(body.customer_city).toBe("جنزور");
  });
});
