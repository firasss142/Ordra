import { describe, it, expect } from "vitest";
import { parseRunParams } from "../run-url";
import { rollHref, runHref } from "@/components/warehouse/bench/bench-format";

/**
 * The address Sortir opens the run with. Sortir builds it, the scan page reads
 * it: this pins the two together so they cannot drift apart.
 */

const ID = "3f2a9c1e-8b7d-4e21-9a0c-5d6e7f8a9b0c";

/** What the page receives: Next has already decoded the query. */
function received(href: string) {
  const q = new URL(href, "http://x").searchParams;
  return { roll: q.get("roll") ?? undefined, order: q.get("order") ?? undefined };
}

describe("parseRunParams", () => {
  it("reads « Commencer » on a roll, as Sortir writes it", () => {
    expect(parseRunParams(received(rollHref("ar", "#D80A0A")))).toEqual({ roll: "#d80a0a", order: null });
  });

  it("reads a parcel tapped on Sortir, with its roll", () => {
    const href = runHref("fr", { id: ID, zone: { colorHex: "#339307" } } as Parameters<typeof runHref>[1]);
    expect(parseRunParams(received(href))).toEqual({ roll: "#339307", order: ID });
  });

  it("reads a parcel with no known roll", () => {
    const href = runHref("fr", { id: ID, zone: { colorHex: null } } as Parameters<typeof runHref>[1]);
    expect(parseRunParams(received(href))).toEqual({ roll: null, order: ID });
  });

  it("accepts the hex without its « # »", () => {
    expect(parseRunParams({ roll: "339307" })).toEqual({ roll: "#339307", order: null });
  });

  it("ignores anything that is not a colour or an order id", () => {
    expect(parseRunParams({ roll: "red", order: "1; drop" })).toEqual({ roll: null, order: null });
    expect(parseRunParams({ roll: ["339307", "d80a0a"], order: undefined })).toEqual({ roll: null, order: null });
  });
});
