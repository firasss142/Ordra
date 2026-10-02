import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import { ShortcutsOverlay } from "../ShortcutsOverlay";

describe("ShortcutsOverlay — F", () => {
  it("lists F for « Voix du client »", () => {
    render(<NextIntlClientProvider locale="fr" messages={fr}><ShortcutsOverlay open onClose={() => {}} /></NextIntlClientProvider>);
    expect(screen.getByText("F")).toBeInTheDocument();
    expect(screen.getByText("Voix du client")).toBeInTheDocument();
  });
});
