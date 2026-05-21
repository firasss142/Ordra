import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { QueueSearchBar, RECENT_SEARCHES_KEY } from "./QueueSearchBar";

const messages = {
  queue: {
    search: {
      placeholder: "Rechercher nom, téléphone, ville, produit…",
      aria: "Rechercher dans la file",
      clear: "Effacer la recherche",
      resultCount: "{count} résultat",
      resultCountPlural: "{count} résultats",
      recentTitle: "Recherches récentes",
      recentClear: "Effacer l’historique",
      shortcutHint: "Appuyez sur / pour rechercher",
      fieldHints: "Astuce : phone:, city:, name:, product:",
    },
  },
};

function wrap(ui: React.ReactNode, locale: "fr" | "ar" = "fr") {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("QueueSearchBar", () => {
  it("renders an input with the localized placeholder", () => {
    render(wrap(<QueueSearchBar value="" onChange={vi.fn()} resultCount={0} isSearching={false} />));
    expect(
      screen.getByPlaceholderText("Rechercher nom, téléphone, ville, produit…"),
    ).toBeDefined();
  });

  it("fires onChange as the user types", () => {
    const onChange = vi.fn();
    render(wrap(<QueueSearchBar value="" onChange={onChange} resultCount={0} isSearching={false} />));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "ali" } });
    expect(onChange).toHaveBeenCalledWith("ali");
  });

  it("shows a clear button when there is a value and clears on click", () => {
    const onChange = vi.fn();
    render(wrap(<QueueSearchBar value="ali" onChange={onChange} resultCount={3} isSearching />));
    const clear = screen.getByRole("button", { name: "Effacer la recherche" });
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("shows the result count while searching", () => {
    render(wrap(<QueueSearchBar value="ali" onChange={vi.fn()} resultCount={3} isSearching />));
    expect(screen.getByText("3 résultats")).toBeDefined();
  });

  it("uses the singular count form for one result", () => {
    render(wrap(<QueueSearchBar value="ali" onChange={vi.fn()} resultCount={1} isSearching />));
    expect(screen.getByText("1 résultat")).toBeDefined();
  });

  it("renders recent searches from localStorage when focused and empty", () => {
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(["tunis", "ali"]));
    const onChange = vi.fn();
    render(wrap(<QueueSearchBar value="" onChange={onChange} resultCount={0} isSearching={false} />));
    fireEvent.focus(screen.getByRole("searchbox"));
    expect(screen.getByText("tunis")).toBeDefined();
    fireEvent.mouseDown(screen.getByText("ali"));
    expect(onChange).toHaveBeenCalledWith("ali");
  });
});
