import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";

const report = vi.fn();
vi.mock("@/components/journal/ClientErrorReporter", () => ({ reportBrowserError: (...a: unknown[]) => report(...a) }));

import ErrorPage from "../error";

function renderIt(reset = vi.fn()) {
  const error = Object.assign(new TypeError("Cannot read properties of undefined (reading 'map')"), { digest: "abc123" });
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ErrorPage error={error} reset={reset} />
    </NextIntlClientProvider>,
  );
  return reset;
}

describe("the page-level crash screen", () => {
  test("says what happened calmly and offers to try again", () => {
    const reset = renderIt();
    expect(screen.getByRole("heading", { name: "Cette page a rencontré un problème" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /accueil/i })).toHaveAttribute("href", "/");
  });

  test("reports the crash to Journaux once, with its digest", () => {
    report.mockClear();
    renderIt();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({
      kind: "boundary",
      name: "TypeError",
      message: "Cannot read properties of undefined (reading 'map')",
      digest: "abc123",
    });
  });
});
