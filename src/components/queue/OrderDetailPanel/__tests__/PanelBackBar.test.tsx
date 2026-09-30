import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PanelBackBar } from "../PanelBackBar";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

describe("PanelBackBar", () => {
  it("titles the screen with the customer, since the panel now covers the list", () => {
    render(<PanelBackBar name="Ali Farj Abdeljalil" locale="fr" onClose={vi.fn()} />);

    expect(screen.getByText("Ali Farj Abdeljalil")).toBeInTheDocument();
  });

  it("goes back", () => {
    const onClose = vi.fn();
    render(<PanelBackBar name="Ali" locale="fr" onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("gives the control a thumb-sized target", () => {
    render(<PanelBackBar name="Ali" locale="fr" onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Fermer" }).className).toContain("h-11");
  });

  it("stays out of the desktop panel, which has a list beside it and an X in its header", () => {
    const { container } = render(<PanelBackBar name="Ali" locale="fr" onClose={vi.fn()} />);

    expect(container.firstElementChild?.className).toContain("lg:hidden");
  });

  it("points the chevron back the way the reader came, in either script", () => {
    const { container: fr } = render(<PanelBackBar name="Ali" locale="fr" onClose={vi.fn()} />);
    const { container: ar } = render(<PanelBackBar name="علي" locale="ar" onClose={vi.fn()} />);

    expect(fr.querySelector("svg")?.getAttribute("class")).not.toContain("-scale-x-100");
    expect(ar.querySelector("svg")?.getAttribute("class")).toContain("-scale-x-100");
  });
});
