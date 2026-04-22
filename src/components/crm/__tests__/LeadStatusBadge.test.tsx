import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeadStatusBadge } from "../LeadStatusBadge";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

describe("LeadStatusBadge", () => {
  it("renders translated label for 'new'", () => {
    render(<LeadStatusBadge status="new" />);
    expect(screen.getByText("Nouveau")).toBeDefined();
  });

  it("renders translated label for 'won'", () => {
    render(<LeadStatusBadge status="won" />);
    expect(screen.getByText("Gagné")).toBeDefined();
  });

  it("renders translated label for 'lost'", () => {
    render(<LeadStatusBadge status="lost" />);
    expect(screen.getByText("Perdu")).toBeDefined();
  });

  it("renders translated label for 'callback_scheduled'", () => {
    render(<LeadStatusBadge status="callback_scheduled" />);
    expect(screen.getByText("Rappel prévu")).toBeDefined();
  });
});
