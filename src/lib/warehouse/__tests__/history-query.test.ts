import { describe, it, expect } from "vitest";
import { warehouseHistoryQuerySchema } from "../list-filters";

/**
 * The Journal's chips ask for « reception » and « count » — families the
 * ledger has had since 2026-10-02. The query schema did not list them, so the
 * API answered 400 and the two chips showed an empty journal.
 */
describe("warehouseHistoryQuerySchema", () => {
  it.each(["all", "print", "handover", "scan", "return", "reception", "count", "adjust", "writeoff"])(
    "accepts the %s family",
    (kind) => {
      expect(warehouseHistoryQuerySchema.safeParse({ kind }).success).toBe(true);
    },
  );
});
