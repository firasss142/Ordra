import { describe, it, expect, vi } from "vitest";
import { syncOneStorefront } from "./sync-engine";
import type { SheetSyncConfig, SyncEngineDeps } from "./sync-engine";
import { PayloadMappingError } from "@/lib/storefronts/errors";

const CONFIG: SheetSyncConfig = {
  storefront_id: "sf-uuid",
  spreadsheet_id: "sheet-id",
  sheet_name: "Orders",
  platform: "converty",
  is_active: true,
  market_id: "market-uuid",
};

const ROW_1 = {
  rowIndex: 1,
  data: {
    "QR Code": "qr1",
    "Name": "Ali",
    "Phone": "911000001",
    "City": "Tripoli",
    "Address": "Addr 1",
    "Products": "Product A x 2",
    "Quantity": "2",
    "Status": "pending",
    "Note": "",
    "Delivery Price": "0",
    "Total Price": "100",
    "Delivery Company": "none",
    "Barcode": "",
    "Created At": "",
    "Updated At": "",
    "Reference": "100",
  },
};

const ROW_2 = { ...ROW_1, rowIndex: 2, data: { ...ROW_1.data, "QR Code": "qr2" } };
const ROW_3 = { ...ROW_1, rowIndex: 3, data: { ...ROW_1.data, "QR Code": "qr3" } };

function makeDeps(overrides: Partial<SyncEngineDeps> = {}): SyncEngineDeps {
  return {
    fetchRows: vi.fn().mockResolvedValue([ROW_1, ROW_2]),
    processRow: vi.fn().mockResolvedValue({ status: "created", orderId: "ord-uuid" }),
    getLastRow: vi.fn().mockResolvedValue(0),
    setLastRow: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("syncOneStorefront", () => {
  it("returns empty result and does nothing for inactive config", async () => {
    const deps = makeDeps();
    const result = await syncOneStorefront({ ...CONFIG, is_active: false }, deps);

    expect(deps.fetchRows).not.toHaveBeenCalled();
    expect(result.rows_fetched).toBe(0);
    expect(result.rows_imported).toBe(0);
  });

  it("calls fetchRows starting from lastRow + 1", async () => {
    const deps = makeDeps({ getLastRow: vi.fn().mockResolvedValue(5) });
    await syncOneStorefront(CONFIG, deps);

    expect(deps.fetchRows).toHaveBeenCalledWith(
      expect.objectContaining({ fromRow: 6 })
    );
  });

  it("calls fetchRows with correct spreadsheet params", async () => {
    const deps = makeDeps();
    await syncOneStorefront(CONFIG, deps);

    expect(deps.fetchRows).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: CONFIG.spreadsheet_id,
        sheetName: CONFIG.sheet_name,
      })
    );
  });

  it("calls processRow once per fetched row", async () => {
    const deps = makeDeps();
    await syncOneStorefront(CONFIG, deps);

    expect(deps.processRow).toHaveBeenCalledTimes(2);
  });

  it("increments rows_imported for each 'created' row", async () => {
    const deps = makeDeps({
      fetchRows: vi.fn().mockResolvedValue([ROW_1, ROW_2, ROW_3]),
      processRow: vi.fn().mockResolvedValue({ status: "created", orderId: "x" }),
    });
    const result = await syncOneStorefront(CONFIG, deps);

    expect(result.rows_imported).toBe(3);
    expect(result.rows_fetched).toBe(3);
  });

  it("increments rows_duplicate for each 'duplicate' row", async () => {
    const deps = makeDeps({
      processRow: vi.fn().mockResolvedValue({ status: "duplicate", orderId: "x" }),
    });
    const result = await syncOneStorefront(CONFIG, deps);

    expect(result.rows_duplicate).toBe(2);
    expect(result.rows_imported).toBe(0);
  });

  it("increments rows_errored and records error message on PayloadMappingError — does not call processRow", async () => {
    const badRow = { rowIndex: 1, data: { ...ROW_1.data, "QR Code": "" } };
    const deps = makeDeps({
      fetchRows: vi.fn().mockResolvedValue([badRow]),
    });
    const result = await syncOneStorefront(CONFIG, deps);

    expect(result.rows_errored).toBe(1);
    expect(result.rows_imported).toBe(0);
    expect(deps.processRow).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(1);
  });

  it("calls setLastRow with the highest processed row index", async () => {
    const deps = makeDeps({
      fetchRows: vi.fn().mockResolvedValue([ROW_1, ROW_2]),
    });
    await syncOneStorefront(CONFIG, deps);

    expect(deps.setLastRow).toHaveBeenCalledWith(CONFIG.storefront_id, 2);
  });

  it("does NOT call setLastRow when no rows were fetched", async () => {
    const deps = makeDeps({ fetchRows: vi.fn().mockResolvedValue([]) });
    await syncOneStorefront(CONFIG, deps);

    expect(deps.setLastRow).not.toHaveBeenCalled();
  });

  it("advances last_row even for errored rows (to avoid infinite retry on bad data)", async () => {
    const badRow = { rowIndex: 1, data: { ...ROW_1.data, "QR Code": "" } };
    const goodRow = { ...ROW_2, rowIndex: 2 };
    const deps = makeDeps({
      fetchRows: vi.fn().mockResolvedValue([badRow, goodRow]),
    });
    await syncOneStorefront(CONFIG, deps);

    expect(deps.setLastRow).toHaveBeenCalledWith(CONFIG.storefront_id, 2);
  });

  it("returns storefront_id in result", async () => {
    const deps = makeDeps();
    const result = await syncOneStorefront(CONFIG, deps);

    expect(result.storefront_id).toBe(CONFIG.storefront_id);
  });

  it("returns empty errors array on clean run", async () => {
    const deps = makeDeps();
    const result = await syncOneStorefront(CONFIG, deps);

    expect(result.errors).toEqual([]);
  });
});

/**
 * The guarantees that came out of the four-day outage: every run was killed at
 * 55s before its single end-of-batch commit, so it redid the same work forever
 * and the cursor never moved.
 */
describe("syncOneStorefront — surviving a kill", () => {
  it("commits the cursor after every row, not once at the end", async () => {
    // This is the whole fix. A batch commit means a killed run keeps nothing;
    // 384 consecutive runs imported the same rows and committed none of them.
    const deps = makeDeps({ fetchRows: vi.fn().mockResolvedValue([ROW_1, ROW_2, ROW_3]) });
    await syncOneStorefront(CONFIG, deps);

    expect(deps.setLastRow).toHaveBeenCalledTimes(3);
    expect((deps.setLastRow as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toEqual([
      1, 2, 3,
    ]);
  });

  it("keeps the rows it finished when a later row throws", async () => {
    // Row 2 explodes in a way nothing anticipated. Row 1 is still imported and
    // still committed — the old engine would have discarded both.
    const processRow = vi
      .fn()
      .mockResolvedValueOnce({ status: "created", orderId: "ord-1" })
      .mockRejectedValueOnce(new Error("connection reset"));
    const deps = makeDeps({ processRow });

    const result = await syncOneStorefront(CONFIG, deps);

    expect(result.rows_imported).toBe(1);
    expect(result.rows_errored).toBe(1);
    expect(deps.setLastRow).toHaveBeenLastCalledWith("sf-uuid", 2);
  });

  it("stops before its deadline and says there is more to do", async () => {
    // Better to hand back after two rows than to be killed on the fiftieth.
    let clock = 0;
    const deps = makeDeps({
      fetchRows: vi.fn().mockResolvedValue([ROW_1, ROW_2, ROW_3]),
      now: () => {
        clock += 3_000;
        return clock;
      },
    });

    const result = await syncOneStorefront(CONFIG, deps, { deadlineAt: 12_000 });

    expect(result.rows_imported).toBeLessThan(3);
    expect(result.has_more).toBe(true);
  });

  it("reports more work when the window came back full", async () => {
    const deps = makeDeps({ fetchRows: vi.fn().mockResolvedValue([ROW_1, ROW_2]) });
    const result = await syncOneStorefront(CONFIG, deps, { maxRows: 2 });
    expect(result.has_more).toBe(true);
  });

  it("does not claim more work when the sheet ran out", async () => {
    const deps = makeDeps({ fetchRows: vi.fn().mockResolvedValue([ROW_1]) });
    const result = await syncOneStorefront(CONFIG, deps, { maxRows: 50 });
    expect(result.has_more).toBe(false);
  });
});

describe("syncOneStorefront — rows that cannot be imported", () => {
  it("writes the row down before stepping over it", async () => {
    // The old loop advanced the cursor at the top of the body, so a row that
    // failed to map was skipped permanently and the only trace was an errors
    // array returned to pg_net, which discards it.
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const processRow = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", error: "no product match" })
      .mockResolvedValueOnce({ status: "created", orderId: "ord-2" });
    const deps = makeDeps({ processRow, recordFailure });

    await syncOneStorefront(CONFIG, deps);

    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ rowIndex: 1, message: "no product match" }),
    );
    expect(recordFailure.mock.invocationCallOrder[0]).toBeLessThan(
      (deps.setLastRow as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
  });

  it("keeps going after a bad row rather than blocking the queue behind it", async () => {
    const processRow = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", error: "bad city" })
      .mockResolvedValueOnce({ status: "created", orderId: "ord-2" });
    const deps = makeDeps({ processRow, recordFailure: vi.fn() });

    const result = await syncOneStorefront(CONFIG, deps);

    expect(result.rows_imported).toBe(1);
    expect(result.rows_errored).toBe(1);
    expect(result.last_row).toBe(2);
  });

  it("survives having nowhere to record the failure", async () => {
    // recordFailure is optional; a caller without one must not crash the run.
    const processRow = vi.fn().mockResolvedValue({ status: "error", error: "nope" });
    const deps = makeDeps({ processRow });
    await expect(syncOneStorefront(CONFIG, deps)).resolves.toMatchObject({ rows_errored: 2 });
  });
});

describe("syncOneStorefront — bookkeeping must never stall the import", () => {
  it("keeps importing when the failure record cannot be written", async () => {
    // Not hypothetical: the failed-rows table shipped with a partial unique key,
    // which made every ON CONFLICT raise 42P10. Because recordFailure sits
    // outside the per-row try, that throw skipped the cursor commit — one
    // unimportable row would have stalled the sync forever.
    const processRow = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", error: "no product match" })
      .mockResolvedValueOnce({ status: "created", orderId: "ord-2" });
    const recordFailure = vi.fn().mockRejectedValue(new Error("42P10"));
    const deps = makeDeps({ processRow, recordFailure });

    const result = await syncOneStorefront(CONFIG, deps);

    // Row 2 still imported, and the cursor still moved past both.
    expect(result.rows_imported).toBe(1);
    expect(deps.setLastRow).toHaveBeenLastCalledWith("sf-uuid", 2);
    // And the bookkeeping failure is itself reported rather than swallowed.
    expect(result.errors.some((e) => /could not record failure/.test(e.message))).toBe(true);
  });
});

describe("syncOneStorefront — rows the adapter says to leave out", () => {
  // Converty marks a checkout the merchant removed as Status 'deleted'. That is
  // not an order and not a failure: it must not reach processRow, must not be
  // written to the failed-rows table (where it would sit forever as noise),
  // and must still move the cursor so it is never re-read.
  const DELETED_ROW = {
    rowIndex: 1,
    data: { ...ROW_1.data, "QR Code": "qr-del", "Status": "deleted" },
  };

  it("skips a 'deleted' row without importing or recording a failure", async () => {
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      fetchRows: vi.fn().mockResolvedValue([DELETED_ROW, ROW_2]),
      recordFailure,
    });

    const result = await syncOneStorefront(CONFIG, deps);

    expect(deps.processRow).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(result.rows_skipped).toBe(1);
    expect(result.rows_imported).toBe(1);
    expect(result.rows_errored).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("advances the cursor past a skipped row", async () => {
    const deps = makeDeps({ fetchRows: vi.fn().mockResolvedValue([DELETED_ROW]) });
    const result = await syncOneStorefront(CONFIG, deps);
    expect(deps.setLastRow).toHaveBeenCalledWith(CONFIG.storefront_id, 1);
    expect(result.last_row).toBe(1);
  });

  it("imports a row whose Name is blank instead of failing it", async () => {
    // The other half of the same hot fix: a blank Name used to throw
    // PayloadMappingError here and land in failed rows. It is a lead.
    const blankName = { rowIndex: 1, data: { ...ROW_1.data, "Name": "" } };
    const deps = makeDeps({ fetchRows: vi.fn().mockResolvedValue([blankName]) });

    const result = await syncOneStorefront(CONFIG, deps);

    expect(deps.processRow).toHaveBeenCalledTimes(1);
    expect(result.rows_imported).toBe(1);
    expect(result.rows_errored).toBe(0);
  });
});
