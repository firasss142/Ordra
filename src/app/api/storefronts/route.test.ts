import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockActor = vi.fn();
const mockInsert = vi.fn();
const mockInspect = vi.fn();
const mockSetLastRow = vi.fn();
const mockSources = vi.fn();
const mockUpdate = vi.fn();
const mockGetSyncState = vi.fn();
const mockDelete = vi.fn();
/** What the cursor store holds, as the route would read it back. */
let cursors: Record<string, { last_row: number }> = {};

vi.mock("@/lib/auth/actor", () => ({ getActor: () => mockActor() }));
vi.mock("@/lib/journal/route-errors", () => ({
  withRouteErrors: (_r: string, _m: string, h: unknown) => h,
}));
vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((v: string) => `enc:${v}`),
  maskCredential: vi.fn(() => "••••••••"),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: () => ({
      delete: () => ({
        eq: async (_c: string, id: string) => {
          mockDelete(id);
          return { data: null, error: null };
        },
      }),
      update: (patch: unknown) => {
        mockUpdate(patch);
        return { eq: async () => ({ data: null, error: null }) };
      },
      insert: (row: unknown) => {
        mockInsert(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "sf-new", ...(row as object) }, error: null }),
          }),
        };
      },
    }),
  }),
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/google-sheets/inspect-sheet", async (orig) => ({
  ...(await orig<typeof import("@/lib/google-sheets/inspect-sheet")>()),
  inspectSheet: (...a: unknown[]) => mockInspect(...a),
  getServiceAccountEmail: () => "ordra@x.iam.gserviceaccount.com",
}));
vi.mock("@/lib/google-sheets/sync-state", () => ({
  setLastRowForStorefront: (...a: unknown[]) => mockSetLastRow(...a),
  getSyncState: (...a: unknown[]) => mockGetSyncState(...a),
}));
vi.mock("@/lib/google-sheets/sources-config", async (orig) => ({
  ...(await orig<typeof import("@/lib/google-sheets/sources-config")>()),
  getSheetsSources: (...a: unknown[]) => mockSources(...a),
}));

import { POST } from "./route";

const SHEET_ID = "1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8";
const CONVERTY_HEADERS = ["QR Code", "Reference", "Name", "Phone", "Address", "City", "Products", "Quantity", "Total Price", "Status"];

function post(body: Record<string, unknown>) {
  return new NextRequest(new URL("http://localhost/api/storefronts"), { method: "POST", body: JSON.stringify(body) });
}

function sheetBody(config: Record<string, unknown> = {}) {
  return {
    market_id: "m-ly",
    name: "Converty — compte 2",
    platform: "google_sheets",
    config: { spreadsheet: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, sheet_name: "Orders", import_from: "now", ...config },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockActor.mockResolvedValue({ actor: { id: "u1", role: "super_admin", market_id: null } });
  mockInspect.mockResolvedValue({ headers: CONVERTY_HEADERS, dataRowCount: 5422 });
  mockSources.mockResolvedValue([]);
  cursors = {};
  mockSetLastRow.mockImplementation(async (_c: unknown, _m: string, id: string, row: number) => {
    cursors[id] = { last_row: row };
  });
  mockGetSyncState.mockImplementation(async () => cursors);
});

describe("POST /api/storefronts — platforms", () => {
  test("refuses a platform Ordra has no adapter for", async () => {
    const res = await POST(post({ market_id: "m-ly", name: "X", platform: "rogue" }));
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test("still creates a webhook shop with its encrypted secret", async () => {
    const res = await POST(post({ market_id: "m-ly", name: "Shopify 2", platform: "shopify", webhook_secret: "s3cret-s3cret-s3cret" }));
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ platform: "shopify", webhook_secret: "enc:s3cret-s3cret-s3cret" }));
  });
});

describe("POST /api/storefronts — a Converty account through Google Sheets", () => {
  test("stores the sheet on the storefront row and starts after the existing rows", async () => {
    const res = await POST(post(sheetBody()));
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        market_id: "m-ly",
        platform: "google_sheets",
        // storefronts.webhook_secret is NOT NULL in the live schema; a sheet shop
        // receives no webhook, so it gets an unusable random one, encrypted.
        webhook_secret: expect.stringMatching(/^enc:[0-9a-f]{64}$/),
        config: { spreadsheet_id: SHEET_ID, sheet_name: "Orders", sheet_adapter: "converty" },
      }),
    );
    expect(mockSetLastRow).toHaveBeenCalledWith(expect.anything(), "m-ly", "sf-new", 5422);
  });

  test("is created archived and only switched on once its cursor is in place", async () => {
    // Live before the cursor exists, a cron tick in between would import the
    // account's entire history as new orders.
    await POST(post(sheetBody()));
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
    expect(mockUpdate).toHaveBeenCalledWith({ is_active: true });
  });

  test("is removed, not left half-made, when the cursor did not stick", async () => {
    // An archived shop with no cursor would import its whole history the day
    // someone switched it on. It has no orders yet, so it can simply go.
    mockSetLastRow.mockResolvedValue(undefined);
    const res = await POST(post(sheetBody()));
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("cursor_failed");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith("sf-new");
  });

  test("is removed when the cursor write throws", async () => {
    mockSetLastRow.mockRejectedValue(new Error("statement timeout"));
    const res = await POST(post(sheetBody()));
    expect(res.status).toBe(500);
    expect(mockDelete).toHaveBeenCalledWith("sf-new");
  });

  test("imports the whole history when asked to — the cursor is written as 0, explicitly", async () => {
    // Explicit, so that "no cursor at all" always means a broken creation.
    const res = await POST(post(sheetBody({ import_from: "all" })));
    expect(res.status).toBe(201);
    expect(mockSetLastRow).toHaveBeenCalledWith(expect.anything(), "m-ly", "sf-new", 0);
    expect(mockUpdate).toHaveBeenCalledWith({ is_active: true });
  });

  test("rejects something that is not a sheet link or id", async () => {
    const res = await POST(post(sheetBody({ spreadsheet: "my sheet" })));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_sheet");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test("says which address to share with when Ordra cannot open the sheet", async () => {
    mockInspect.mockRejectedValue({ code: 403, message: "The caller does not have permission" });
    const res = await POST(post(sheetBody()));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "no_access", service_account: "ordra@x.iam.gserviceaccount.com" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test("names a wrong tab", async () => {
    mockInspect.mockRejectedValue({ code: 400, message: "Unable to parse range: 'Ordres'!A1:Z" });
    const res = await POST(post(sheetBody()));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("no_tab");
  });

  test("refuses a sheet that is not a Converty export, naming the missing columns", async () => {
    mockInspect.mockResolvedValue({ headers: ["Order", "Phone"], dataRowCount: 10 });
    const res = await POST(post(sheetBody()));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "missing_columns", columns: ["QR Code", "Total Price", "Products"] });
  });

  test("says which columns it did read, so a wrong tab is visible at a glance", async () => {
    mockInspect.mockResolvedValue({ headers: ["Order", "Phone", "", "Items"], dataRowCount: 10 });
    const res = await POST(post(sheetBody()));
    expect((await res.json()).found).toEqual(["Order", "Phone", "Items"]);
  });

  test("refuses the same sheet and tab twice in one market — the rows would import into two shops", async () => {
    mockSources.mockResolvedValue([
      { storefront_id: "sf-1", market_id: "m-ly", spreadsheet_id: SHEET_ID, sheet_name: "orders", platform: "converty", is_active: true },
    ]);
    const res = await POST(post(sheetBody()));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("already_connected");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test("only a super admin connects a shop", async () => {
    mockActor.mockResolvedValue({ actor: { id: "u2", role: "market_manager", market_id: "m-ly" } });
    const res = await POST(post(sheetBody()));
    expect(res.status).toBe(403);
    expect(mockInspect).not.toHaveBeenCalled();
  });
});
