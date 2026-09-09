import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CustomerCard } from "../CustomerCard";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const frMessages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(frMessages, ns, key, params),
    useLocale: () => "fr",
  };
});

function renderCard(overrides: Partial<React.ComponentProps<typeof CustomerCard>> = {}) {
  return render(
    <CustomerCard
      address="Hay Andalus, rue 9"
      city="Tripoli"
      note={null}
      carrierName="Darb Assabil"
      trackingNumber="SH-1"
      canEdit
      isLibyaOrder
      darbDestinations={[]}
      darbDestinationId={null}
      loadCities={async () => []}
      onCommitAddress={() => {}}
      onCommitCity={() => {}}
      onCommitDarbDestination={() => {}}
      onCommitNote={() => {}}
      {...overrides}
    />,
  );
}

describe("CustomerCard — failed save", () => {
  // A failed address or destination save used to show nothing here: saveError
  // was rendered only inside OrderItemsCard, so the dispatcher saw a 2.5s
  // header flash and a field that silently snapped back.
  it("names the reason a save did not land", () => {
    renderCard({ saveError: "Modifiée entre-temps par un autre utilisateur." });

    expect(
      screen.getByText("Modifiée entre-temps par un autre utilisateur."),
    ).toBeInTheDocument();
  });

  it("says nothing when the last save was fine", () => {
    renderCard();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks the message as an alert so it is announced", () => {
    renderCard({ saveError: "Erreur d'enregistrement" });

    expect(screen.getByRole("alert")).toHaveTextContent("Erreur d'enregistrement");
  });
});
