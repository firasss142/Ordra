import { describe, it, expect } from "vitest";
import { highlight } from "../highlight";

const hits = (text: string, q: string) =>
  highlight(text, q)
    .filter((s) => s.hit)
    .map((s) => s.text);

describe("highlight", () => {
  it("marks the matched letters in the text as written, whatever spelling was typed", () => {
    expect(highlight("أحمد الورفلي", "احمد")).toEqual([
      { text: "أحمد", hit: true },
      { text: " الورفلي", hit: false },
    ]);
    expect(hits("سالمة الأحمدي", "احمد")).toEqual(["أحمد"]);
    expect(hits("فاطمة الزوي", "فاطمه")).toEqual(["فاطمة"]);
  });

  it("ignores accents the way the search does", () => {
    expect(hits("Hèla Ben Salah", "hela")).toEqual(["Hèla"]);
  });

  it("marks every word of a multi-word query", () => {
    expect(hits("Salima Ben Ali · Sfax", "sfax salima")).toEqual(["Salima", "Sfax"]);
  });

  it("marks a whole phone number that the typed digits found, in any format", () => {
    expect(hits("+218913456721", "091 345 67")).toEqual(["+218913456721"]);
    expect(hits("0925782017", "0913")).toEqual([]);
  });

  it("leaves text untouched when nothing matched", () => {
    expect(highlight("Salima", "xyz")).toEqual([{ text: "Salima", hit: false }]);
    expect(highlight("", "xyz")).toEqual([]);
  });
});
