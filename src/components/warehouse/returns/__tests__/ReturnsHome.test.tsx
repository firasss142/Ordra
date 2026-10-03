import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { ReturnsHome } from "../ReturnsHome";
import type { ReturnsPayload } from "@/app/api/warehouse/returns/returns-data";
import { atDarb, onTheWay } from "./fixtures";

/**
 * « Rentrer » on the agent's phone (prototype R.returns + R.verdict).
 *
 * Two lists for the agent's building: what Darb holds for us (receivable, one
 * tap opens the verdict) and what is still on the road (greyed, inert). There
 * is no scan field here — scanning lives on the centre Scan button, whose sheet
 * lands on `?order=<id>`, which opens the same verdict.
 */
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useLocale: () => "fr",
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
  };
});

let params = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/fr/warehouse/returns",
  useSearchParams: () => params,
}));

let pageData: ReturnsPayload | undefined;
let pageError: Error | undefined;
const mutate = vi.fn();
const swrKeys: string[] = [];
vi.mock("swr", () => ({
  default: (key: string) => {
    swrKeys.push(key);
    return { data: pageData, error: pageError, isLoading: false, mutate };
  },
}));

const souad = atDarb("o-souad", { hoursAtDarb: 96 });
const mounir = atDarb("o-mounir", {
  hoursAtDarb: 25, customer_name: "منير", customer_city: "الزاوية",
  product_name: "دمية ملاكمة · صغير", darb_reason: "no_answer",
});

function payload(over: Partial<ReturnsPayload> = {}): ReturnsPayload {
  return {
    orders: [mounir, souad],
    nextCursor: null,
    onTheWay: [onTheWay("w-1"), onTheWay("w-2", { customer_city: "مصراتة" }), onTheWay("w-3", { customer_city: "بنغازي" })],
    processed: [],
    ...over,
  };
}

/** A label whose count sits in its own isolated span (`.num`). */
function label(text: string) {
  return screen.getByText(
    (_, el) => el?.textContent === text && Array.from(el.children).every((c) => c.textContent !== text),
  );
}

function show(p = payload()) {
  pageData = p;
  return render(<ReturnsHome marketId="m-ly" siteName="بنغازي" dateLabel="jeudi 2 octobre" />);
}

beforeEach(() => {
  params = new URLSearchParams();
  pageError = undefined;
  push.mockClear();
  replace.mockClear();
  mutate.mockClear();
  swrKeys.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReturnsHome — the list", () => {
  it("opens with building · date, the title and the rule — and no scan field", () => {
    show();
    expect(screen.getByText("بنغازي · jeudi 2 octobre")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Rentrer" })).toBeInTheDocument();
    expect(screen.getByText("Aucun colis n'est reçu avant que Darb l'ait enregistré en retour.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("lists what Darb holds for us, longest-held first", () => {
    show();
    expect(label("Chez Darb pour nous · 2")).toBeInTheDocument();
    const rows = screen.getAllByTestId("wh-return-row");
    expect(rows[0]).toHaveTextContent("مصحف القرآن تدبر وعمل");
    expect(rows[1]).toHaveTextContent("دمية ملاكمة · صغير");
  });

  it("greys what is still on the road, and none of it can be tapped", () => {
    show();
    expect(label("En route — pas encore recevables · 3")).toBeInTheDocument();
    const onway = screen.getAllByTestId("wh-return-onway");
    expect(onway).toHaveLength(3);
    onway.forEach((r) => expect(within(r).queryByRole("button")).toBeNull());
  });

  it("hides the road section when nothing is on the way", () => {
    show(payload({ onTheWay: [] }));
    expect(screen.queryByText(/En route/)).toBeNull();
  });

  it("says plainly when Darb holds nothing for us", () => {
    show(payload({ orders: [] }));
    expect(label("Chez Darb pour nous · 0")).toBeInTheDocument();
    expect(screen.getByText("Rien chez Darb pour nous.")).toBeInTheDocument();
  });

  it("a tap opens the verdict through the URL, so the Scan sheet can land there too", () => {
    show();
    fireEvent.click(screen.getAllByTestId("wh-return-row")[0]);
    expect(push).toHaveBeenCalledWith("/fr/warehouse/returns?order=o-souad");
  });

  it("a failed load names itself and offers a retry", () => {
    pageError = new Error("500");
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Impossible de charger les retours.");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(mutate).toHaveBeenCalled();
  });

  it("an agent with no building is told why the screen is empty", () => {
    show({ orders: [], nextCursor: null, onTheWay: [], processed: [], siteUnassigned: true });
    expect(screen.getByText(/bâtiment/i)).toBeInTheDocument();
    expect(screen.queryByText(/Chez Darb pour nous/)).toBeNull();
  });
});

describe("ReturnsHome — the verdict (?order=)", () => {
  it("opens on the parcel: back, tracking number, title, the parcel in hand", () => {
    params = new URLSearchParams("order=o-souad");
    show();
    expect(screen.getByRole("button", { name: "Retour à la liste" })).toBeInTheDocument();
    expect(screen.getByText("SHo-souad")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Rentrer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Intact/ })).toBeInTheDocument();
    expect(screen.queryByText(/Chez Darb pour nous/)).toBeNull();
  });

  it("back closes the verdict onto the list", () => {
    params = new URLSearchParams("order=o-souad");
    show();
    fireEvent.click(screen.getByRole("button", { name: "Retour à la liste" }));
    expect(replace).toHaveBeenCalledWith("/fr/warehouse/returns");
  });

  it("recording a verdict refreshes the list, returns to it and says what happened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) }));
    params = new URLSearchParams("order=o-souad");
    const { rerender } = show();
    fireEvent.click(screen.getByRole("button", { name: /Intact/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/fr/warehouse/returns"));
    expect(mutate).toHaveBeenCalled();
    params = new URLSearchParams();
    rerender(<ReturnsHome marketId="m-ly" siteName="بنغازي" dateLabel="jeudi 2 octobre" />);
    expect(screen.getByRole("status")).toHaveTextContent("Reçu · en stock +1");
  });

  it("refuses a parcel that is not receivable at this building", () => {
    params = new URLSearchParams("order=o-elsewhere");
    show();
    expect(screen.getByText("Ce colis n'est pas parmi les retours recevables ici.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Intact/ })).toBeNull();
  });
});
