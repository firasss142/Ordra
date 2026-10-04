// @vitest-environment node
/**
 * Live: what "connect a sheet" sees on the real Converty sheet. Read-only.
 *
 *   npx vitest run -c vitest.live.config.ts inspect
 *
 * Reads `.env.local` (or the file named by ORDRA_ENV_FILE, for a worktree that
 * has none). Prints nothing from the rows — only the header and the count.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { inspectSheet, missingHeaders, classifySheetError } from "../inspect-sheet";
import { ConvertySheetsAdapter } from "@/lib/storefronts/sheets/converty-sheets-adapter";

const SPREADSHEET_ID = "1RT7e_Tmmz3krH3quHNQ6Hmv-ZNWX3IETtVksgAFPln8";

beforeAll(() => {
  const raw = readFileSync(process.env.ORDRA_ENV_FILE ?? `${process.cwd()}/.env.local`, "utf8");
  for (const line of raw.split("\n")) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
});

describe("live: inspecting the Converty sheet before connecting it", () => {
  it("finds every column the Converty adapter needs, and where the data ends", async () => {
    const r = await inspectSheet({ spreadsheetId: SPREADSHEET_ID, sheetName: "converty-orders-bachir" });
    console.log("headers:", r.headers.join(" | "), "· data rows:", r.dataRowCount);
    expect(missingHeaders(r.headers, new ConvertySheetsAdapter().requiredHeaders)).toEqual([]);
    expect(r.dataRowCount).toBeGreaterThan(5000);
  });

  it("names a wrong tab as such", async () => {
    const err = await inspectSheet({ spreadsheetId: SPREADSHEET_ID, sheetName: "no-such-tab-xyz" }).catch((e) => e);
    expect(classifySheetError(err)).toBe("no_tab");
  });

  it("reads a sheet Ordra cannot open as no access", async () => {
    // A well-formed id for a sheet that does not exist: Google answers 404, the
    // same family as a private sheet never shared with the service account.
    const err = await inspectSheet({ spreadsheetId: "1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", sheetName: "Orders" }).catch(
      (e) => e,
    );
    console.log("foreign sheet error:", (err as { code?: number })?.code, String((err as Error)?.message).slice(0, 80));
    expect(classifySheetError(err)).toBe("no_access");
  });
});
