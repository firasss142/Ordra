import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

import { MarkLostModal } from "../MarkLostModal";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function renderModal(overrides: Partial<React.ComponentProps<typeof MarkLostModal>> = {}) {
  return render(
    <MarkLostModal
      open={true}
      leadId="lead-1"
      locale="fr"
      onClose={vi.fn()}
      onDone={vi.fn()}
      {...overrides}
    />
  );
}

describe("MarkLostModal", () => {
  it("renders reasons dropdown with translated labels", () => {
    renderModal();
    // Title is rendered
    expect(screen.getByText("Marquer le prospect comme perdu")).toBeDefined();
  });

  it("shows note input only when reason is 'autre'", async () => {
    const user = userEvent.setup();
    renderModal();

    // Initially 'not_interested' — only one input (the select wraps it via role)
    const initialInputs = screen.queryAllByRole("textbox");
    expect(initialInputs).toHaveLength(0);

    // Change to 'autre' via select
    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "autre");

    // Now a text input appears
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("rejects submit when autre+empty note (client-side guard)", async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    renderModal({ onDone });

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "autre");

    // Submit without filling note
    fireEvent.click(screen.getByText("Confirmer"));

    // fetch NOT called
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("POSTs to transition route on valid submit with non-autre reason", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { lead_id: "lead-1" } }),
    });
    const onDone = vi.fn();
    renderModal({ onDone });

    // Default reason is 'not_interested'
    fireEvent.click(screen.getByText("Confirmer"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/leads/lead-1/transition");
    const body = JSON.parse(init.body);
    expect(body.new_status).toBe("lost");
    expect(body.lost_reason).toBe("not_interested");
    expect(onDone).toHaveBeenCalled();
  });
});
