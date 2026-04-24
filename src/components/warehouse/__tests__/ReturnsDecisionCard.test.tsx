import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, params?: Record<string, unknown>) => {
      const parts = namespace
        ? `${namespace}.${key}`.split(".")
        : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) {
        val = (val as Record<string, unknown>)?.[p];
      }
      if (typeof val !== "string") return key;
      if (!params) return val;
      return val.replace(/\{(\w+)(?:,[^}]*)?\}/g, (_, k) =>
        String(params[k] ?? ""),
      );
    };
  },
}));

import { ReturnsDecisionCard } from "../ReturnsDecisionCard";

const order = {
  id: "order-123",
  customer_name: "Amina K.",
  customer_city: "Sfax",
  product_id: "prod-1",
  product_name: "Crème hydratante",
  quantity: 2,
};

const rate = { returned: 3, damaged: 0, total: 25, return_rate_percent: 12 };

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn() as unknown as typeof fetch;
});

describe("ReturnsDecisionCard — restock path", () => {
  it("shows restock + damage options and the return rate", () => {
    render(
      <ReturnsDecisionCard
        order={order}
        rate={rate}
        onAddToBatch={vi.fn()}
        onCommitNow={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Remettre en stock/i)).toBeInTheDocument();
    expect(screen.getByText(/Marquer endommagé/i)).toBeInTheDocument();
    expect(screen.getByText(/12% de retours/)).toBeInTheDocument();
  });

  it("calls onAddToBatch with is_damaged=false on restock add", async () => {
    const addSpy = vi.fn();
    render(
      <ReturnsDecisionCard
        order={order}
        rate={rate}
        onAddToBatch={addSpy}
        onCommitNow={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText(/Remettre en stock/i));
    await userEvent.click(
      screen.getByRole("button", { name: /Ajouter au lot/i }),
    );
    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order-123",
        is_damaged: false,
        return_reason: null,
      }),
    );
  });
});

describe("ReturnsDecisionCard — damage path", () => {
  it("requires a reason before commit", async () => {
    const commitSpy = vi.fn();
    render(
      <ReturnsDecisionCard
        order={order}
        rate={rate}
        onAddToBatch={vi.fn()}
        onCommitNow={commitSpy}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText(/Marquer endommagé/i));
    const commitBtn = screen.getByRole("button", {
      name: /Valider maintenant/i,
    });
    expect(commitBtn).toBeDisabled();
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it("requires a note when reason=Autre", async () => {
    render(
      <ReturnsDecisionCard
        order={order}
        rate={rate}
        onAddToBatch={vi.fn()}
        onCommitNow={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText(/Marquer endommagé/i));
    await userEvent.click(screen.getByRole("radio", { name: /Autre/i }));
    const commitBtn = screen.getByRole("button", {
      name: /Valider maintenant/i,
    });
    expect(commitBtn).toBeDisabled();
    const noteInput = screen.getByPlaceholderText(/Préciser la raison/i);
    await userEvent.type(noteInput, "colis ouvert");
    expect(commitBtn).not.toBeDisabled();
  });

  it("passes reason + note to commit", async () => {
    const commitSpy = vi.fn();
    render(
      <ReturnsDecisionCard
        order={order}
        rate={rate}
        onAddToBatch={vi.fn()}
        onCommitNow={commitSpy}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText(/Marquer endommagé/i));
    await userEvent.click(
      screen.getByRole("radio", { name: /Dégât transporteur/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Valider maintenant/i }),
    );
    expect(commitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order-123",
        is_damaged: true,
        return_reason: "carrier_damage",
        return_reason_note: null,
        return_photo_url: null,
      }),
    );
  });
});

describe("ReturnsDecisionCard — photo upload", () => {
  it("uploads file and includes return_photo_url when adding to batch", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ path: "m-1/order-123/uuid.jpeg" }),
    });
    const addSpy = vi.fn();
    render(
      <ReturnsDecisionCard
        order={order}
        rate={rate}
        onAddToBatch={addSpy}
        onCommitNow={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText(/Marquer endommagé/i));
    await userEvent.click(
      screen.getByRole("radio", { name: /Défaut produit/i }),
    );
    const fileInput = screen.getByLabelText(/Ajouter une photo/i) as HTMLInputElement;
    const file = new File(["hello"], "damage.jpg", { type: "image/jpeg" });
    await userEvent.upload(fileInput, file);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/warehouse/returns/photo",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await userEvent.click(
      screen.getByRole("button", { name: /Ajouter au lot/i }),
    );
    expect(addSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        return_photo_url: "m-1/order-123/uuid.jpeg",
      }),
    );
  });
});
