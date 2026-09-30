import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { QueueSearchBar } from "../QueueSearchBar";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

vi.mock("swr", () => ({
  default: () => ({ data: undefined }),
  preload: vi.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

/**
 * The prototype's phone behaviour: the navbar shows a compact trigger, and
 * tapping it opens a full-screen sheet with the field focused and a back
 * button — an inline dropdown under a 44px pill is unusable on a phone.
 */
describe("QueueSearchBar — phone sheet", () => {
  it("renders a compact trigger on phones rather than the full field", () => {
    render(<QueueSearchBar variant="navbar" value="" onChange={() => {}} />);
    const trigger = screen.getByTestId("search-trigger");
    expect(trigger.className).toMatch(/lg:hidden/);
  });

  it("opens a full-screen sheet when the trigger is tapped", () => {
    render(<QueueSearchBar variant="navbar" value="" onChange={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("search-trigger"));
    const sheet = screen.getByRole("dialog");
    expect(sheet.className).toMatch(/fixed/);
    expect(sheet.className).toMatch(/lg:hidden/);
  });

  it("closes the sheet on the back button", () => {
    render(<QueueSearchBar variant="navbar" value="" onChange={() => {}} />);
    fireEvent.click(screen.getByTestId("search-trigger"));
    fireEvent.click(screen.getByTestId("search-sheet-back"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the desktop field present and unhidden on large screens", () => {
    const { container } = render(
      <QueueSearchBar variant="navbar" value="" onChange={() => {}} />,
    );
    const field = container.querySelector('[data-testid="search-field"]');
    expect(field?.className).toMatch(/hidden lg:flex/);
  });
});
