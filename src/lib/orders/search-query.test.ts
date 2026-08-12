import { describe, test, expect } from "vitest";
import {
  applySearch,
  parseSearch,
  termToOrFilter,
  toNationalDigits,
} from "./search-query";

describe("toNationalDigits", () => {
  test("reduces every way this data writes one number to the same string", () => {
    // Measured on the live table: 461 orders store the trunk zero, 1,011 store
    // a +216 country code, the rest store bare local digits. All three are the
    // same customer and must be one search.
    for (const written of [
      "925782017",
      "0925782017",
      "+218925782017",
      "00218 925 782 017",
      "(0)925-782-017",
    ]) {
      expect(toNationalDigits(written)).toBe("925782017");
    }
  });

  test("keeps a short digit string whole rather than reading it as a country code", () => {
    // "216" typed alone is three digits someone is looking for, not a prefix to
    // strip — stripping it would leave an empty search that matches everything.
    expect(toNationalDigits("216")).toBe("216");
    expect(toNationalDigits("2160")).toBe("2160");
  });

  test("never returns nothing for a number that was all zeros", () => {
    expect(toNationalDigits("000")).toBe("000");
  });
});

describe("parseSearch", () => {
  test("treats a typed phone number as its national digits", () => {
    const [term] = parseSearch("0925782017");
    expect(term.phone).toBe("925782017");
    expect(term.value).toBe("925782017");
  });

  test("ANDs the words, so two half-remembered facts narrow instead of widen", () => {
    const terms = parseSearch("salima 925");
    expect(terms).toHaveLength(2);
    expect(terms.map((t) => t.value)).toEqual(["salima", "925"]);
  });

  test("keeps a quoted phrase whole", () => {
    const terms = parseSearch('"borj cedria" doll');
    expect(terms.map((t) => t.value)).toEqual(["borj cedria", "doll"]);
  });

  test("aims a term at one field when it carries a prefix", () => {
    expect(parseSearch("ville:sfax")[0]).toMatchObject({ field: "city", value: "sfax" });
    expect(parseSearch("tel:0925782017")[0]).toMatchObject({ field: "phone", phone: "925782017" });
    expect(parseSearch("suivi:AB12")[0]).toMatchObject({ field: "tracking", value: "AB12" });
  });

  test("reads the same prefixes in French and in English", () => {
    expect(parseSearch("produit:doll")[0].field).toBe("product");
    expect(parseSearch("product:doll")[0].field).toBe("product");
  });

  test("leaves an unknown prefix as literal text", () => {
    // A customer note like "note:urgent" is text, not a field this box knows.
    const [term] = parseSearch("note:urgent");
    expect(term.field).toBeNull();
    expect(term.value).toBe("note urgent");
  });

  test("drops a one-character term, which costs a full scan to match everything", () => {
    expect(parseSearch("a")).toEqual([]);
    // Unless it was asked for by field, where the narrowness is the point.
    expect(parseSearch("ville:s")).toHaveLength(1);
  });

  test("cannot be made to inject filter syntax", () => {
    // `,` and `)` close a PostgREST or=(…) list; `%` and `_` are ILIKE
    // wildcards. A customer really is named "O'Brien (Sfax)".
    const [term] = parseSearch('"O\'Brien (Sfax), 100%"');
    expect(term.value).not.toMatch(/[%_,()]/);
    expect(term.value).toContain("Brien");
  });

  test("stops at four terms rather than intersecting bitmaps forever", () => {
    expect(parseSearch("one two three four five six")).toHaveLength(4);
  });

  test("an empty or blank box searches nothing at all", () => {
    expect(parseSearch("")).toEqual([]);
    expect(parseSearch("   ")).toEqual([]);
  });
});

describe("termToOrFilter", () => {
  test("a bare number searches the phone columns as well as the text ones", () => {
    const filter = termToOrFilter(parseSearch("925782017")[0]);
    expect(filter).toContain("customer_phone.ilike.%925782017%");
    expect(filter).toContain("customer_phone_2.ilike.%925782017%");
    expect(filter).toContain("external_id.ilike.%925782017%");
  });

  test("a field-restricted term touches only that field", () => {
    const filter = termToOrFilter(parseSearch("ville:sfax")[0]);
    expect(filter).toBe("customer_city.ilike.%sfax%");
  });

  test("searches every column a dispatcher can see on the row", () => {
    const filter = termToOrFilter(parseSearch("doll")[0]);
    for (const col of [
      "customer_name",
      "customer_city",
      "customer_address",
      "product_name",
      "external_id",
      "tracking_number",
    ]) {
      expect(filter).toContain(`${col}.ilike.%doll%`);
    }
  });
});

describe("applySearch", () => {
  test("issues one or() per term, which PostgREST ANDs", () => {
    const calls: string[] = [];
    const fake = {
      or(f: string) {
        calls.push(f);
        return this;
      },
    };
    applySearch(fake, "salima 925");
    expect(calls).toHaveLength(2);
  });

  test("leaves the query untouched when there is nothing to search", () => {
    const calls: string[] = [];
    const fake = {
      or(f: string) {
        calls.push(f);
        return this;
      },
    };
    applySearch(fake, "");
    applySearch(fake, undefined);
    expect(calls).toEqual([]);
  });
});
