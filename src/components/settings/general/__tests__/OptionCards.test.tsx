import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionCards } from "../OptionCards";

const OPTS = [
  { value: "reject", label: "Rejeter automatiquement", hint: "motif injoignable" },
  { value: "flag", label: "Signaler au manager", hint: "reste en file" },
  { value: "none", label: "Ne rien faire", hint: "l'agent décide" },
];

describe("OptionCards", () => {
  it("renders every option as a radio with its label", () => {
    render(<OptionCards value="none" onChange={() => {}} options={OPTS} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(screen.getByText("Rejeter automatiquement")).toBeInTheDocument();
    expect(screen.getByText("Ne rien faire")).toBeInTheDocument();
  });

  it("marks the selected option as checked", () => {
    render(<OptionCards value="flag" onChange={() => {}} options={OPTS} />);
    const selected = screen.getByRole("radio", { name: /Signaler au manager/ });
    expect(selected).toHaveAttribute("aria-checked", "true");
    const other = screen.getByRole("radio", { name: /Ne rien faire/ });
    expect(other).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the option value when a card is clicked", async () => {
    const onChange = vi.fn();
    render(<OptionCards value="none" onChange={onChange} options={OPTS} />);
    await userEvent.click(screen.getByRole("radio", { name: /Rejeter automatiquement/ }));
    expect(onChange).toHaveBeenCalledWith("reject");
  });

  it("does not call onChange when disabled", async () => {
    const onChange = vi.fn();
    render(<OptionCards value="none" onChange={onChange} options={OPTS} disabled />);
    await userEvent.click(screen.getByRole("radio", { name: /Rejeter automatiquement/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
