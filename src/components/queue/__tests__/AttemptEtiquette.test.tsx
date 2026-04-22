import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AttemptEtiquette } from "../AttemptEtiquette";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

describe("AttemptEtiquette", () => {
  it("renders 'Tentative 1' for attempt_1", () => {
    render(
      <AttemptEtiquette status="attempt_1" attemptsCount={1} callbackAt={null} />,
    );
    expect(screen.getByRole("note", { name: /Tentative 1/ })).toBeInTheDocument();
  });

  it("renders 'Tentative 2' for attempt_2", () => {
    render(
      <AttemptEtiquette status="attempt_2" attemptsCount={2} callbackAt={null} />,
    );
    expect(screen.getByRole("note", { name: /Tentative 2/ })).toBeInTheDocument();
  });

  it("renders 'Tentative 3 (final)' for attempt_3", () => {
    render(
      <AttemptEtiquette status="attempt_3" attemptsCount={3} callbackAt={null} />,
    );
    expect(screen.getByRole("note", { name: /Tentative 3/ })).toBeInTheDocument();
    expect(screen.getByText(/final/)).toBeInTheDocument();
  });

  it("renders a scheduled callback with time for a future callback", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    render(
      <AttemptEtiquette
        status="callback_scheduled"
        attemptsCount={1}
        callbackAt={future}
        now={new Date()}
      />,
    );
    expect(screen.getByRole("note", { name: /Rappel/ })).toBeInTheDocument();
  });

  it("renders 'Rappel en retard' for an overdue callback", () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    render(
      <AttemptEtiquette
        status="callback_scheduled"
        attemptsCount={2}
        callbackAt={past}
        now={new Date()}
      />,
    );
    expect(
      screen.getByRole("note", { name: /Rappel en retard/ }),
    ).toBeInTheDocument();
  });

  it("returns null for non-attempt, non-callback statuses", () => {
    const { container } = render(
      <AttemptEtiquette status="assigned" attemptsCount={0} callbackAt={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
