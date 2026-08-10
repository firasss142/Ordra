import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { RejectionReasonSelect } from "../RejectionReasonSelect";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) =>
      resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RejectionReasonSelect — choosing a group", () => {
  it("opens on the five groups, not on eighteen sub-reasons", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    for (const label of [
      "Refus client",
      "Commande non réelle",
      "Injoignable",
      "Livraison impossible",
      "Autre",
    ]) {
      expect(screen.getByText(label), label).toBeDefined();
    }
    // A sub-reason must not be reachable until its group is chosen.
    expect(screen.queryByText("Acheté ailleurs")).toBeNull();
  });

  it("does not report a selection until a sub-reason is chosen", () => {
    // The old picker fired on the group click, which is exactly how `autre`
    // became the fastest way to close the sheet.
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Injoignable"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows that group's sub-reasons after the group is chosen", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Injoignable"));
    expect(screen.getByText("Ne répond pas")).toBeDefined();
    expect(screen.getByText("Le numéro est à quelqu'un d'autre")).toBeDefined();
    // and only that group's
    expect(screen.queryByText("Acheté ailleurs")).toBeNull();
  });

  it("reports the group and sub-reason together", () => {
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Refus client"));
    fireEvent.click(screen.getByText("Acheté ailleurs"));
    expect(onSelect).toHaveBeenCalledWith("refus_client", "achete_ailleurs", undefined);
  });

  it("can go back and pick a different group", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Injoignable"));
    fireEvent.click(screen.getByText("Retour"));
    expect(screen.getByText("Refus client")).toBeDefined();
    expect(screen.queryByText("Ne répond pas")).toBeNull();
  });
});

describe("RejectionReasonSelect — autre", () => {
  it("asks for a note instead of a sub-reason", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Autre"));
    expect(screen.getByPlaceholderText("Précisez…")).toBeDefined();
  });

  it("reports a null sub-reason and the note text", () => {
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Autre"));
    fireEvent.change(screen.getByPlaceholderText("Précisez…"), {
      target: { value: "le client a déménagé" },
    });
    expect(onSelect).toHaveBeenCalledWith("autre", null, "le client a déménagé");
  });

  it("does not report anything while the note is still empty", () => {
    // 440 orders carry `autre` with no note. The reason is gone for good on
    // every one of them; an empty note must not count as an answer.
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Autre"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("RejectionReasonSelect — the postpone escape", () => {
  it("offers rescheduling as an alternative to rejecting", () => {
    const onPostpone = vi.fn();
    render(<RejectionReasonSelect onSelect={vi.fn()} onPostpone={onPostpone} />);
    fireEvent.click(screen.getByText("Le client veut plus tard"));
    expect(onPostpone).toHaveBeenCalled();
  });

  it("is hidden when the caller cannot reschedule", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    expect(screen.queryByText("Le client veut plus tard")).toBeNull();
  });

  it("never reports postponing as a rejection reason", () => {
    // "Wants it later" is a callback. Recording it as a rejection both loses
    // the sale and inflates the rejection rate.
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} onPostpone={vi.fn()} />);
    fireEvent.click(screen.getByText("Le client veut plus tard"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
