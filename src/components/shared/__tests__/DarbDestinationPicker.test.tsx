import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

import { DarbDestinationPicker } from "../DarbDestinationPicker";
import type { DarbDestinationOption } from "@/lib/carriers/darb-destination-search";

const ROWS: DarbDestinationOption[] = [
  { id: 1, city: "اجدابيا", area: "اجدابيا" },
  { id: 2, city: "بنغازي", area: "بنغازي" },
  { id: 3, city: "بنغازي", area: "قمينس" },
  { id: 4, city: "طرابلس", area: "جنزور" },
  { id: 5, city: "طرابلس", area: "عين زارة" },
  { id: 6, city: "الجفرة", area: "هون" },
  { id: 7, city: "الجفرة", area: "سوكنة" },
];

function setup(props: Partial<React.ComponentProps<typeof DarbDestinationPicker>> = {}) {
  const onSelect = vi.fn();
  render(
    <DarbDestinationPicker destinations={ROWS} value={null} onSelect={onSelect} {...props} />,
  );
  return { onSelect };
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

describe("DarbDestinationPicker — field variant", () => {
  test("closed: shows the placeholder, then the chosen city and zone", () => {
    setup();
    expect(screen.getByRole("button", { name: /ville ou zone/i })).toBeInTheDocument();
    setup({ value: { city: "طرابلس", area: "جنزور" } });
    const field = screen.getByRole("button", { name: /طرابلس/ });
    expect(field).toHaveTextContent("طرابلس");
    expect(field).toHaveTextContent("جنزور");
  });

  test("open: pinned cities lead the browse list; a single-area city is one click", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));

    const list = screen.getByRole("listbox");
    const options = within(list).getAllByRole("option");
    expect(options[0]).toHaveTextContent("طرابلس");
    expect(options[1]).toHaveTextContent("بنغازي");
    // A multi-area city says how many zones it hides.
    expect(options[0]).toHaveTextContent("2 zones");

    await user.click(within(list).getByRole("option", { name: /اجدابيا/ }));
    expect(onSelect).toHaveBeenCalledWith(ROWS[0]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("a multi-area city drills into its zones, centre first, with a way back", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.click(screen.getByRole("option", { name: /بنغازي/ }));

    const list = screen.getByRole("listbox");
    const options = within(list).getAllByRole("option");
    expect(options[0]).toHaveTextContent("بنغازي");
    expect(options[0]).toHaveTextContent(/centre/i);
    expect(options[1]).toHaveTextContent("قمينس");
    expect(within(list).queryByText("جنزور")).toBeNull();

    expect(screen.getByRole("button", { name: /toutes les villes/i })).toBeInTheDocument();
    await user.click(options[1]);
    expect(onSelect).toHaveBeenCalledWith(ROWS[2]);
  });

  test("typing searches every city and zone at once, with the city as a group heading", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.type(screen.getByRole("combobox"), "جنزور");

    const list = screen.getByRole("listbox");
    expect(within(list).getByText("طرابلس")).toBeInTheDocument(); // group heading
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(ROWS[3]);
  });

  test("search tolerates Arabic spelling variants", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.type(screen.getByRole("combobox"), "سوكنه");
    expect(screen.getByRole("option", { name: /سوكنة/ })).toBeInTheDocument();
  });

  test("arrow keys move the highlight; Enter picks it", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    // Order: طرابلس (drill), بنغازي (drill), اجدابيا, الجفرة → third row is اجدابيا.
    expect(onSelect).toHaveBeenCalledWith(ROWS[0]);
  });

  test("Escape closes the list without reaching the dialog behind it", async () => {
    const user = userEvent.setup();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outer);
  });

  test("no match reads as a sentence, not an empty box", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText(/aucune destination/i)).toBeInTheDocument();
  });
});

describe("DarbDestinationPicker — the details that make it feel finished", () => {
  test("the field reads city and zone as two things, and can be cleared", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    setup({ value: { city: "طرابلس", area: "جنزور" }, onClear });
    const field = screen.getByRole("button", { name: /طرابلس/ });
    expect(field).toHaveTextContent("طرابلس");
    expect(field).toHaveTextContent("جنزور");
    await user.click(screen.getByRole("button", { name: /effacer/i }));
    expect(onClear).toHaveBeenCalled();
  });

  test("typing on the focused field opens the list with that text as the query", async () => {
    const user = userEvent.setup();
    setup();
    screen.getByRole("button", { name: /ville ou zone/i }).focus();
    await user.keyboard("جنز");
    expect(screen.getByRole("combobox")).toHaveValue("جنز");
    expect(screen.getByRole("option", { name: /جنزور/ })).toBeInTheDocument();
  });

  test("the matched part of a result is highlighted", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /ville ou زone|ville ou zone/i }));
    await user.type(screen.getByRole("combobox"), "زار");
    const option = screen.getByRole("option", { name: /عين زارة/ });
    const mark = option.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("زار");
  });

  test("says how many results matched", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.type(screen.getByRole("combobox"), "ا");
    expect(screen.getByText(/\d+ résultats?/)).toBeInTheDocument();
  });

  test("remembers the last destinations picked and offers them first next time", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.click(screen.getByRole("option", { name: /^طرابلس/ }));
    await user.click(screen.getByRole("option", { name: /جنزور/ }));
    expect(onSelect).toHaveBeenCalledWith(ROWS[3]);

    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    const recents = screen.getByRole("group", { name: /récents/i });
    await user.click(within(recents).getByRole("button", { name: /جنزور/ }));
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[3]);
  });

  test("shows the keyboard it understands", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    expect(screen.getByText(/esc/i)).toBeInTheDocument();
  });

  test("inside a city, the header names it and offers all cities again", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /ville ou zone/i }));
    await user.click(screen.getByRole("option", { name: /^بنغازي/ }));
    const back = screen.getByRole("button", { name: /toutes les villes/i });
    expect(back).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "بنغازي" })).toBeInTheDocument();
    await user.click(back);
    expect(screen.getByRole("option", { name: /^طرابلس/ })).toBeInTheDocument();
  });
});

describe("DarbDestinationPicker — the dropdown must not be clipped", () => {
  test("the open panel escapes its container instead of being cut off by it", () => {
    // In the Livraison tab the trigger is a small "Changer" link inside a
    // narrow panel. Anchoring a 300px dropdown to it with `absolute` pushed
    // the list past the panel edge, clipping the city names off-screen.
    // Portalling to <body> and positioning against the viewport is what the
    // console's Popover already does for the same reason.
    setup({ value: null });
    fireEvent.click(screen.getByRole("button", { name: /ville ou zone/i }));

    const list = screen.getByRole("listbox");
    const panel = list.closest("[data-destination-panel]") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.position).toBe("fixed");
  });

  test("a city row still renders its name beside the zone count", () => {
    // The screenshot showed count pills with no city names: the names were
    // rendered but clipped. Assert the row carries both.
    setup({ value: null });
    fireEvent.click(screen.getByRole("button", { name: /ville ou zone/i }));

    const tripoli = screen.getByRole("option", { name: /^طرابلس/ });
    expect(tripoli).toHaveTextContent("طرابلس");
    expect(tripoli).toHaveTextContent("2 zones");
  });

  test("closing removes the portalled panel from the document", () => {
    setup({ value: null });
    fireEvent.click(screen.getByRole("button", { name: /ville ou zone/i }));
    expect(document.querySelector("[data-destination-panel]")).not.toBeNull();

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(document.querySelector("[data-destination-panel]")).toBeNull();
  });

  test("the inline variant stays in the flow — nothing to clip, nothing to portal", () => {
    // The dispatch step owns its whole column; portalling it would detach it
    // from the form it belongs to.
    setup({ variant: "inline" });
    const list = screen.getAllByRole("listbox")[0];
    expect(list.closest("[data-destination-panel]")).toBeNull();
  });
});

describe("DarbDestinationPicker — inline variant (dispatch step)", () => {
  test("with no scope, cities and zones sit side by side: pick a city, its zones appear", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup({ variant: "inline" });
    const cities = screen.getByRole("listbox", { name: /villes/i });
    expect(within(cities).getAllByRole("option")[0]).toHaveTextContent("طرابلس");
    // Nothing chosen yet → the zones pane asks for a city.
    expect(screen.getByText(/choisissez une ville/i)).toBeInTheDocument();

    await user.click(within(cities).getByRole("option", { name: /^بنغازي/ }));
    const zones = screen.getByRole("listbox", { name: /zones/i });
    expect(within(zones).getAllByRole("option")[0]).toHaveTextContent("بنغازي");
    await user.click(within(zones).getByRole("option", { name: /قمينس/ }));
    expect(onSelect).toHaveBeenCalledWith(ROWS[2]);
  });

  test("a single-zone city in the left pane selects at once", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup({ variant: "inline" });
    await user.click(screen.getByRole("option", { name: /اجدابيا/ }));
    expect(onSelect).toHaveBeenCalledWith(ROWS[0]);
  });

  test("list is open at once and the current pair is marked selected", () => {
    setup({ variant: "inline", value: { city: "الجفرة", area: "سوكنة" }, scopeCity: "الجفرة" });
    const list = screen.getByRole("listbox");
    const selected = within(list).getByRole("option", { name: /سوكنة/ });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(within(list).getByRole("option", { name: /هون/ })).toHaveAttribute("aria-selected", "false");
  });

  test("scoped to one city: only that city's zones, no back button", () => {
    setup({ variant: "inline", scopeCity: "طرابلس" });
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(2);
    expect(within(list).queryByText(/قمينس/)).toBeNull();
    expect(screen.queryByRole("button", { name: /toutes les villes/i })).toBeNull();
  });

  test("clicking a zone reports the pair", () => {
    const { onSelect } = setup({ variant: "inline", scopeCity: "طرابلس" });
    fireEvent.click(screen.getByRole("option", { name: /عين زارة/ }));
    expect(onSelect).toHaveBeenCalledWith(ROWS[4]);
  });
});
