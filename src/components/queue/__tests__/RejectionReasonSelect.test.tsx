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

  // iOS Safari zooms the page into a focused field under 16px and stays
  // zoomed — the sheet around the note ends up cropped off the screen.
  it("sets the note at 16px on a phone, so iOS does not zoom into it", () => {
    render(<RejectionReasonSelect onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Autre"));
    expect(screen.getByPlaceholderText("Précisez…").className).toMatch(/(^|\s)text-\[16px\]/);
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

// The sheet arms its submit button from what this picker reports. Reporting
// only complete answers was half the contract: an answer that STOPS being
// complete has to be reported too, or the button stays armed with a reason the
// agent can no longer see on screen.
describe("RejectionReasonSelect — withdrawing an answer", () => {
  it("withdraws the answer when the agent goes back to the groups", () => {
    const onClear = vi.fn();
    render(<RejectionReasonSelect onSelect={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByText("Refus client"));
    fireEvent.click(screen.getByText("Acheté ailleurs"));
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Retour"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("withdraws the answer when the note is erased", () => {
    const onClear = vi.fn();
    render(<RejectionReasonSelect onSelect={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByText("Autre"));
    const note = screen.getByPlaceholderText("Précisez…");
    fireEvent.change(note, { target: { value: "déménagé" } });
    expect(onClear).not.toHaveBeenCalled();

    fireEvent.change(note, { target: { value: "   " } });
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("RejectionReasonSelect — an answer the caller already chose", () => {
  // At the attempt ceiling the sheet pre-arms « Injoignable › Ne répond pas ».
  // The picker used to open on the group with nothing highlighted while the
  // submit button was already live — the agent could not see what they were
  // about to record.
  it("shows the pre-chosen sub-reason as chosen", () => {
    render(
      <RejectionReasonSelect
        onSelect={vi.fn()}
        defaultGroup="injoignable"
        defaultSub="pas_de_reponse"
      />,
    );
    expect(
      screen.getByRole("button", { name: "Ne répond pas" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Raccroche au téléphone" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  // What is shown as chosen is what is armed. The sheet used to pre-arm only
  // when its « Rejeté » card was tapped, so opening straight on the rejection
  // — the panel's « Refuser », i.e. every phone — showed « Ne répond pas »
  // highlighted above a dead button.
  it("reports the pre-chosen answer as the answer, without a tap", () => {
    const onSelect = vi.fn();
    render(
      <RejectionReasonSelect
        onSelect={onSelect}
        defaultGroup="injoignable"
        defaultSub="pas_de_reponse"
      />,
    );
    expect(onSelect).toHaveBeenCalledWith("injoignable", "pas_de_reponse", undefined);
  });

  it("reports nothing for a pre-chosen group alone — that is not an answer", () => {
    const onSelect = vi.fn();
    render(<RejectionReasonSelect onSelect={onSelect} defaultGroup="injoignable" />);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("RejectionReasonSelect — the way back out", () => {
  // One back control, whose meaning follows the pane: to the groups from a
  // group's sub-reasons, and out of the rejection from the groups. The sheet
  // used to stack its own « Retour » above the picker's — two buttons with the
  // same word and different destinations.
  it("offers a way back out of the rejection from the groups", () => {
    const onBack = vi.fn();
    render(<RejectionReasonSelect onSelect={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByText("Retour"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("goes back to the groups, not out, from a group's sub-reasons", () => {
    const onBack = vi.fn();
    render(<RejectionReasonSelect onSelect={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByText("Injoignable"));
    fireEvent.click(screen.getByText("Retour"));
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText("Refus client")).toBeDefined();
  });
});
