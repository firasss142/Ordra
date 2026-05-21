import { describe, it, expect } from "vitest";
import { parseQuery } from "./search";
import { highlightSegments } from "./highlight";

describe("highlightSegments", () => {
  it("returns a single non-match segment when there is no query", () => {
    const segs = highlightSegments("Ali Ben Salah", parseQuery(""), "name");
    expect(segs).toEqual([{ text: "Ali Ben Salah", match: false }]);
  });

  it("wraps the matched substring, preserving original casing/accents", () => {
    const segs = highlightSegments("Béja Trabelsi", parseQuery("beja"), "name");
    expect(segs).toEqual([
      { text: "Béja", match: true },
      { text: " Trabelsi", match: false },
    ]);
  });

  it("highlights every term occurrence", () => {
    const segs = highlightSegments("tunis grand tunis", parseQuery("tunis"), "city");
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(["tunis", "tunis"]);
  });

  it("returns plain text when the field is not the prefixed field", () => {
    // query scoped to city should not highlight inside a name field
    const segs = highlightSegments("Tunis Ben Ali", parseQuery("city:tunis"), "name");
    expect(segs).toEqual([{ text: "Tunis Ben Ali", match: false }]);
  });

  it("highlights when the field matches the prefixed field", () => {
    const segs = highlightSegments("Tunis", parseQuery("city:tunis"), "city");
    expect(segs).toEqual([{ text: "Tunis", match: true }]);
  });

  it("does not highlight phone fields (digit normalization is lossy)", () => {
    const segs = highlightSegments("+216 98 12", parseQuery("phone:98"), "phone");
    expect(segs).toEqual([{ text: "+216 98 12", match: false }]);
  });

  it("returns plain text when no term matches", () => {
    const segs = highlightSegments("Sfax", parseQuery("tunis"), "city");
    expect(segs).toEqual([{ text: "Sfax", match: false }]);
  });

  it("handles an empty value", () => {
    expect(highlightSegments("", parseQuery("tunis"), "city")).toEqual([
      { text: "", match: false },
    ]);
  });
});
