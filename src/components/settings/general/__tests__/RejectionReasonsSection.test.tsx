import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { RejectionReasonConfig } from "@/types/rejection-config";

const mockRows = vi.fn<() => RejectionReasonConfig[]>(() => []);
const mockMutate = vi.fn();

vi.mock("@/hooks/useRejectionReasons", () => ({
  useRejectionReasons: () => ({
    rows: mockRows(),
    error: null,
    isLoading: false,
    mutate: mockMutate,
  }),
}));

import { RejectionReasonsSection } from "../RejectionReasonsSection";

const cfg = (
  key: string,
  parent_key: string | null,
  over: Partial<RejectionReasonConfig> = {},
): RejectionReasonConfig => ({
  id: `id-${key}`,
  market_id: "m-tn",
  parent_key,
  key,
  label_fr: key,
  label_ar: `ar-${key}`,
  short_fr: key,
  short_ar: `ar-${key}`,
  sort_order: 0,
  is_active: true,
  requires_note: false,
  created_at: "",
  updated_at: "",
  ...over,
});

const TAXONOMY = [
  cfg("refus_client", null, { label_fr: "Refus client" }),
  cfg("prix_eleve", "refus_client", {
    label_fr: "Prix trop élevé",
    short_fr: "Prix",
  }),
  cfg("achete_ailleurs", "refus_client", {
    label_fr: "Acheté ailleurs",
    short_fr: "Ailleurs",
  }),
  cfg("injoignable", null, { label_fr: "Injoignable", sort_order: 1 }),
];

function mockFetch(impl?: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = impl?.(url, init) ?? { data: {} };
    return {
      ok: true,
      json: async () => body,
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const groupCard = (name: string) =>
  screen
    .getAllByTestId("rejection-group")
    .find((el) => within(el).queryByDisplayValue(name) || el.textContent?.includes(name))!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockRows.mockReturnValue(TAXONOMY);
});

describe("RejectionReasonsSection — reading the taxonomy", () => {
  it("shows each group with its own sub-reasons nested under it", () => {
    render(<RejectionReasonsSection marketId="m-tn" />);

    const groups = screen.getAllByTestId("rejection-group");
    expect(groups).toHaveLength(2);

    expect(within(groups[0]).getByDisplayValue("Refus client")).toBeDefined();
    expect(within(groups[0]).getByDisplayValue("Prix trop élevé")).toBeDefined();
    expect(within(groups[0]).getByDisplayValue("Acheté ailleurs")).toBeDefined();
    expect(within(groups[1]).queryByDisplayValue("Prix trop élevé")).toBeNull();
  });

  // The preview is the real badge, so it cannot drift from the column.
  it("previews every reason as the column's own badge: rejected red, the group's icon", () => {
    render(<RejectionReasonsSection marketId="m-tn" />);

    const [refus, injoignable] = screen.getAllByTestId("rejection-group");
    const refusBadges = within(refus).getAllByTestId("order-status");
    expect(refusBadges.length).toBe(3); // the group + its two sub-reasons
    for (const b of refusBadges) {
      expect(b).toHaveAttribute("data-hue", "red");
      expect(b.querySelector(".lucide-thumbs-down")).not.toBeNull();
    }
    const [injBadge] = within(injoignable).getAllByTestId("order-status");
    expect(injBadge).toHaveAttribute("data-hue", "red");
    expect(injBadge.querySelector(".lucide-phone-off")).not.toBeNull();
  });

  // Groups mirror a Postgres enum: no add, no delete, ever.
  it("offers no way to delete or add a group", () => {
    render(<RejectionReasonsSection marketId="m-tn" />);

    expect(screen.queryByRole("button", { name: /ajouter un motif/i })).toBeNull();
    for (const g of screen.getAllByTestId("rejection-group")) {
      expect(
        within(g).queryByRole("button", { name: /supprimer le groupe/i }),
      ).toBeNull();
    }
  });
});

describe("RejectionReasonsSection — editing", () => {
  it("saves a renamed sub-reason", async () => {
    const fetchMock = mockFetch();
    render(<RejectionReasonsSection marketId="m-tn" />);

    const input = screen.getByDisplayValue("Prix trop élevé");
    fireEvent.change(input, { target: { value: "Prix jugé trop élevé" } });
    fireEvent.blur(input);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings/rejection-reasons/id-prix_eleve");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({
      label_fr: "Prix jugé trop élevé",
    });
  });

  it("does not write when a field is blurred unchanged", async () => {
    const fetchMock = mockFetch();
    render(<RejectionReasonsSection marketId="m-tn" />);

    fireEvent.blur(screen.getByDisplayValue("Prix trop élevé"));

    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  // A free colour choice is how « Commande non réelle » ended up in the teal of
  // a shipped parcel. Every rejection is the same red; the group is the icon.
  it("offers no colour choice for a group", () => {
    render(<RejectionReasonsSection marketId="m-tn" />);

    expect(within(groupCard("Refus client")).queryByLabelText(/couleur/i)).toBeNull();
  });

  it("adds a sub-reason to the group it was opened from", async () => {
    const fetchMock = mockFetch();
    render(<RejectionReasonsSection marketId="m-tn" />);

    fireEvent.click(
      within(groupCard("Injoignable")).getByRole("button", {
        name: /ajouter un sous-motif/i,
      }),
    );

    const form = screen.getByTestId("rejection-draft");
    fireEvent.change(within(form).getByLabelText(/^clé/i), {
      target: { value: "boite_vocale" },
    });
    fireEvent.change(within(form).getByLabelText(/libellé \(fr\)/i), {
      target: { value: "Tombe sur la boîte vocale" },
    });
    fireEvent.change(within(form).getByLabelText(/libellé \(ar\)/i), {
      target: { value: "البريد الصوتي" },
    });
    fireEvent.change(within(form).getByLabelText(/court \(fr\)/i), {
      target: { value: "Vocale" },
    });
    fireEvent.change(within(form).getByLabelText(/court \(ar\)/i), {
      target: { value: "صوتي" },
    });
    fireEvent.click(within(form).getByRole("button", { name: /^créer$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/settings/rejection-reasons");
    expect(JSON.parse(init?.body as string)).toMatchObject({
      market_id: "m-tn",
      parent_key: "injoignable",
      key: "boite_vocale",
      short_fr: "Vocale",
    });
  });

  // The key is written into orders.rejection_subreason; a space or a capital
  // there is a row nothing can resolve later.
  it("refuses a malformed key before it reaches the API", async () => {
    const fetchMock = mockFetch();
    render(<RejectionReasonsSection marketId="m-tn" />);

    fireEvent.click(
      within(groupCard("Injoignable")).getByRole("button", {
        name: /ajouter un sous-motif/i,
      }),
    );
    const form = screen.getByTestId("rejection-draft");
    fireEvent.change(within(form).getByLabelText(/^clé/i), {
      target: { value: "Boîte Vocale" },
    });
    for (const re of [/libellé \(fr\)/i, /libellé \(ar\)/i, /court \(fr\)/i, /court \(ar\)/i]) {
      fireEvent.change(within(form).getByLabelText(re), { target: { value: "x" } });
    }
    fireEvent.click(within(form).getByRole("button", { name: /^créer$/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/clé/i);
  });
});

describe("RejectionReasonsSection — deleting", () => {
  it("warns with the real number of orders before retiring a used reason", async () => {
    const fetchMock = mockFetch((url) =>
      url.includes("id-prix_eleve") ? { data: {}, usage: 213 } : { data: {} },
    );
    render(<RejectionReasonsSection marketId="m-tn" />);

    fireEvent.click(
      screen.getByRole("button", { name: /supprimer « Prix trop élevé »/i }),
    );

    await screen.findByRole("dialog");
    expect(screen.getByRole("dialog")).toHaveTextContent("213");
    // The truthful verb: this reason is not going away.
    expect(screen.getByRole("dialog")).toHaveTextContent(/retir/i);
  });

  it("offers a plain delete when nothing uses the reason", async () => {
    mockFetch(() => ({ data: {}, usage: 0 }));
    render(<RejectionReasonsSection marketId="m-tn" />);

    fireEvent.click(
      screen.getByRole("button", { name: /supprimer « Prix trop élevé »/i }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/aucune commande/i);
  });

  it("sends the DELETE once confirmed", async () => {
    const fetchMock = mockFetch(() => ({ data: {}, usage: 0, mode: "deleted" }));
    render(<RejectionReasonsSection marketId="m-tn" />);

    fireEvent.click(
      screen.getByRole("button", { name: /supprimer « Prix trop élevé »/i }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /confirmer/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([u, i]) =>
            u === "/api/settings/rejection-reasons/id-prix_eleve" &&
            i?.method === "DELETE",
        ),
      ).toBe(true),
    );
  });
});

describe("RejectionReasonsSection — retired reasons", () => {
  beforeEach(() => {
    mockRows.mockReturnValue([
      ...TAXONOMY,
      cfg("doublon", "refus_client", {
        label_fr: "Doublon",
        is_active: false,
      }),
    ]);
  });

  it("keeps a retired reason visible and marked, not hidden", () => {
    render(<RejectionReasonsSection marketId="m-tn" />);

    const row = screen
      .getAllByTestId("rejection-sub")
      .find((el) => within(el).queryByDisplayValue("Doublon"))!;

    expect(row).toHaveAttribute("data-retired", "true");
  });

  it("restores a retired reason", async () => {
    const fetchMock = mockFetch();
    render(<RejectionReasonsSection marketId="m-tn" />);

    fireEvent.click(screen.getByRole("button", { name: /réactiver « Doublon »/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      is_active: true,
    });
  });
});
