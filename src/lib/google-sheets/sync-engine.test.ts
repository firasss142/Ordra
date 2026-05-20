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
