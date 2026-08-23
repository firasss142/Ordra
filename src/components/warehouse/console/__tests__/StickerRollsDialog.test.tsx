import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StickerRollsDialog } from "../StickerRollsDialog";
import type { RollRow } from "../ScanStation";
import messages from "@/messages/fr.json";

/**
 * Registering a roll is the on-switch for the whole sticker guard: with no open
 * roll the bench accepts any number. So the form's job is to make a WRONG roll
 * hard to register — a bad range either refuses good stickers all day or waves
 * through foreign ones, and Darb will not catch either.
 */

const accounts = [
  { id: "c-tripoli", name: "Darb Assabil - Tripoli" },
  { id: "c-benghazi", name: "Darb Assabil — Benghazi" },
];

function roll(overrides: Partial<RollRow> = {}): RollRow {
  return {
    id: "r1",
    carrier_id: "c-tripoli",
    color_hex: "#339307",
    colour_fr: "Vert",
    name_fr: "Région orientale",
    name_ar: "المنطقة الشرقية",
    label: "Rouleau vert",
    range_start: 889188,
    range_end: 889287,
    status: "open",
    capacity: 100,
    consumed: 42,
    remaining: 58,
    next_number: 889230,
    ...overrides,
  };
}

function open(props: { rolls?: RollRow[] } = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <StickerRollsDialog
        rolls={props.rolls ?? [roll()]}
        accounts={accounts}
        onClose={onClose}
        onChanged={onChanged}
      />
    </NextIntlClientProvider>,
  );
  return { onClose, onChanged };
}

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("StickerRollsDialog — what is on the shelf", () => {
  test("lists each roll with what is left on it", () => {
    open();
    expect(screen.getByText(/Rouleau vert/)).toBeInTheDocument();
    expect(screen.getByText(/889188/)).toBeInTheDocument();
    expect(screen.getByText(/889287/)).toBeInTheDocument();
    expect(screen.getByText("58")).toBeInTheDocument();
  });

  test("says plainly when nothing is registered, since that disables the guard", () => {
    open({ rolls: [] });
    expect(screen.getByText(/Aucun rouleau/i)).toBeInTheDocument();
  });

  test("an exhausted roll is shown but not offered as usable", () => {
    open({ rolls: [roll({ status: "exhausted", remaining: 0 })] });
    expect(screen.getByText(/Épuisé/i)).toBeInTheDocument();
  });
});

describe("StickerRollsDialog — registering one", () => {
  test("posts the roll and reports the change", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { onChanged } = open();

    fill(/Premier numéro/i, "496900");
    fill(/Dernier numéro/i, "496999");
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer le rouleau/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({
      carrier_id: "c-tripoli",
      range_start: 496900,
      range_end: 496999,
    });
  });

  test("the colour choices are Darb's nine and nothing else", () => {
    open();
    const select = screen.getByLabelText(/Couleur du rouleau/i);
    // A tenth colour would create a zone no destination can ever match.
    expect(within(select).getAllByRole("option")).toHaveLength(9);
    expect(within(select).getByRole("option", { name: /Vert lime/ })).toBeInTheDocument();
  });

  test("shows how many stickers the range covers, before it is submitted", () => {
    open();
    fill(/Premier numéro/i, "496900");
    fill(/Dernier numéro/i, "496999");
    expect(screen.getByText(/100 stickers/i)).toBeInTheDocument();
  });

  test("cannot be submitted empty", () => {
    open();
    expect(screen.getByRole("button", { name: /Enregistrer le rouleau/i })).toBeDisabled();
  });

  test("refuses to submit a range that runs backwards", () => {
    open();
    fill(/Premier numéro/i, "496999");
    fill(/Dernier numéro/i, "496900");
    expect(screen.getByRole("button", { name: /Enregistrer le rouleau/i })).toBeDisabled();
  });

  test("refuses a span too wide to be a physical roll", () => {
    open();
    fill(/Premier numéro/i, "100000");
    fill(/Dernier numéro/i, "200000");
    expect(screen.getByRole("button", { name: /Enregistrer le rouleau/i })).toBeDisabled();
  });

  test("refuses a number too short to be a sticker", () => {
    open();
    fill(/Premier numéro/i, "42");
    fill(/Dernier numéro/i, "99");
    expect(screen.getByRole("button", { name: /Enregistrer le rouleau/i })).toBeDisabled();
  });

  test("surfaces the overlap refusal in the operator's words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "Cette plage chevauche un rouleau déjà enregistré" }),
      }),
    );
    open();
    fill(/Premier numéro/i, "889200");
    fill(/Dernier numéro/i, "889250");
    fireEvent.click(screen.getByRole("button", { name: /Enregistrer le rouleau/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/chevauche/i),
    );
  });
});

describe("StickerRollsDialog — closing one", () => {
  test("marks a roll exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const { onChanged } = open();

    fireEvent.click(screen.getByRole("button", { name: /Marquer épuisé/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ id: "r1", status: "exhausted" });
  });
});

describe("StickerRollsDialog — getting out", () => {
  test("Escape closes it", () => {
    const { onClose } = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
