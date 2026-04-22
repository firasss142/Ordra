import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SettingsNav } from "../SettingsNav";
import type { Role } from "@/types";

vi.mock("next-intl", () => ({
  useLocale: () => "fr",
}));

describe("SettingsNav", () => {
  it("uses absolute locale-prefixed href for statuses", () => {
    render(<SettingsNav role="super_admin" activeSection="general" />);
    const link = screen.getByText("Statuts (Pipelines)").closest("a");
    expect(link?.getAttribute("href")).toBe("/fr/settings/statuses");
  });

  it("uses absolute locale-prefixed href for section links", () => {
    render(<SettingsNav role="super_admin" activeSection="general" />);
    const link = screen.getByText("Transporteurs").closest("a");
    expect(link?.getAttribute("href")).toBe("/fr/settings?section=carriers");
  });

  it("renders 4 section links for super_admin", () => {
    render(<SettingsNav role="super_admin" activeSection="general" />);
    expect(screen.getByText("Paramètres généraux")).toBeInTheDocument();
    expect(screen.getByText("Transporteurs")).toBeInTheDocument();
    expect(screen.getByText("Storefronts")).toBeInTheDocument();
    expect(screen.getByText("Marchés")).toBeInTheDocument();
  });

  it("renders only general for market_manager", () => {
    render(<SettingsNav role="market_manager" activeSection="general" />);
    expect(screen.getByText("Paramètres généraux")).toBeInTheDocument();
    expect(screen.queryByText("Transporteurs")).not.toBeInTheDocument();
    expect(screen.queryByText("Storefronts")).not.toBeInTheDocument();
    expect(screen.queryByText("Équipe")).not.toBeInTheDocument();
    expect(screen.queryByText("Marchés")).not.toBeInTheDocument();
  });

  it("marks active section with aria-current='page'", () => {
    render(<SettingsNav role="super_admin" activeSection="carriers" />);
    const activeLink = screen.getByText("Transporteurs").closest("a");
    expect(activeLink).toHaveAttribute("aria-current", "page");
    const inactiveLink = screen.getByText("Paramètres généraux").closest("a");
    expect(inactiveLink).not.toHaveAttribute("aria-current", "page");
  });

  it("renders nothing for agent role", () => {
    const { container } = render(
      <SettingsNav role={"agent" as Role} activeSection="general" />
    );
    expect(container.firstChild).toBeNull();
  });
});
