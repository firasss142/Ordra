import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GeneralSettingsForm } from "../GeneralSettingsForm";
import type { MarketSettings } from "@/types/settings";

const validSettings: MarketSettings = {
  delivery_fee: 7,
  return_fee: 3,
  packing_cost: 1,
  max_call_attempts: 3,
  assignment_algorithm: "round_robin",
  active_agents_only: false,
};

describe("GeneralSettingsForm", () => {
  it("renders Frais de livraison as a number input", () => {
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/Frais de livraison/i)).toHaveAttribute("type", "number");
  });

  it("renders Frais de retour as a number input", () => {
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/Frais de retour/i)).toHaveAttribute("type", "number");
  });

  it("renders Coût d'emballage as a number input", () => {
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText(/Coût d'emballage/i)).toHaveAttribute("type", "number");
  });

  it("renders Tentatives max as a number input with min=1 and max=10", () => {
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText(/Tentatives max/i);
    expect(input).toHaveAttribute("type", "number");
    expect(input).toHaveAttribute("min", "1");
    expect(input).toHaveAttribute("max", "10");
  });

  it("renders Algorithme d'affectation as a select with 5 options", () => {
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={vi.fn()} />);
    const select = screen.getByLabelText(/Algorithme d'affectation/i);
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Manuel" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Round Robin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Charge de travail" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Par produit/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Par région/i })).toBeInTheDocument();
  });

  it("renders Enregistrer submit button", () => {
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeInTheDocument();
  });

  it("shows validation error when delivery_fee is negative", async () => {
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText(/Frais de livraison/i);
    await userEvent.clear(input);
    await userEvent.type(input, "-1");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(screen.getByText(/invalide|négatif|positive|positif|required|requis/i)).toBeInTheDocument();
    });
  });

  it("shows validation error when max_call_attempts is 0", async () => {
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={vi.fn()} />);
    const input = screen.getByLabelText(/Tentatives max/i);
    await userEvent.clear(input);
    await userEvent.type(input, "0");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      const container = input.closest("div");
      expect(container?.querySelector("p")).toHaveTextContent(/invalide|minimum|min|required|requis/i);
    });
  });

  it("renders 'Agents actifs uniquement' checkbox when algorithm is not manual", () => {
    render(
      <GeneralSettingsForm
        initialValues={{ ...validSettings, assignment_algorithm: "round_robin" }}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByLabelText(/Agents actifs uniquement/i)).toBeInTheDocument();
  });

  it("does not render 'Agents actifs uniquement' checkbox when algorithm is manual", () => {
    render(
      <GeneralSettingsForm
        initialValues={{ ...validSettings, assignment_algorithm: "manual" }}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.queryByLabelText(/Agents actifs uniquement/i)).not.toBeInTheDocument();
  });

  it("includes active_agents_only in form submission", async () => {
    const onSubmit = vi.fn();
    render(
      <GeneralSettingsForm
        initialValues={{ ...validSettings, assignment_algorithm: "round_robin", active_agents_only: false }}
        onSubmit={onSubmit}
      />
    );
    const checkbox = screen.getByLabelText(/Agents actifs uniquement/i);
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ active_agents_only: true })
      );
    });
  });

  it("calls onSubmit with correct MarketSettings shape on valid submit", async () => {
    const onSubmit = vi.fn();
    render(<GeneralSettingsForm initialValues={validSettings} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          delivery_fee: expect.any(Number),
          return_fee: expect.any(Number),
          packing_cost: expect.any(Number),
          max_call_attempts: expect.any(Number),
          assignment_algorithm: expect.any(String),
        })
      );
    });
  });
});
