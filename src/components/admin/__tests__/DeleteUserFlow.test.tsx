import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("focus-trap-react", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
  };
});

import { DeleteUserFlow } from "../DeleteUserFlow";

function renderFlow(overrides: Partial<React.ComponentProps<typeof DeleteUserFlow>> = {}) {
  const onClose = vi.fn();
  const onDelete = vi.fn().mockResolvedValue({ ordersReturned: 0 });
  const onSuccess = vi.fn();
  render(
    <DeleteUserFlow
      userId="u-1"
      userName="Jane Doe"
      open={true}
      onClose={onClose}
      onDelete={onDelete}
      onSuccess={onSuccess}
      {...overrides}
    />
  );
  return { onClose, onDelete, onSuccess };
}

describe("DeleteUserFlow", () => {
  it("renders nothing when open=false", () => {
    const onClose = vi.fn();
    const onDelete = vi.fn();
    const onSuccess = vi.fn();
    render(
      <DeleteUserFlow
        userId="u-1"
        userName="Jane Doe"
        open={false}
        onClose={onClose}
        onDelete={onDelete}
        onSuccess={onSuccess}
      />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the user name in the title", () => {
    renderFlow();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
  });

  it("calls onDelete with userId and then onSuccess with ordersReturned on confirm", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue({ ordersReturned: 3 });
    const { onSuccess } = renderFlow({ onDelete });

    const buttons = screen.getAllByRole("button");
    const confirm = buttons.find((b) => /supprimer/i.test(b.textContent ?? ""));
    expect(confirm).toBeTruthy();
    await user.click(confirm!);

    expect(onDelete).toHaveBeenCalledWith("u-1");
    expect(onSuccess).toHaveBeenCalledWith(3);
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const { onClose, onDelete } = renderFlow();
    const cancel = screen.getByRole("button", { name: /annuler/i });
    await user.click(cancel);
    expect(onClose).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("surfaces error message and keeps modal open when onDelete throws", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockRejectedValue(new Error("Boom"));
    const { onSuccess, onClose } = renderFlow({ onDelete });

    const confirm = screen
      .getAllByRole("button")
      .find((b) => /supprimer/i.test(b.textContent ?? ""))!;
    await user.click(confirm);

    expect(await screen.findByText("Boom")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
