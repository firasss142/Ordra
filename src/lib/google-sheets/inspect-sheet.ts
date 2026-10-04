import { google } from "googleapis";
import { getAuthClient, sheetRange } from "./client";

/**
 * A look at a sheet before it becomes a shop.
 *
 * Connecting a new Converty account is the moment to find out that the sheet
 * was not shared with Ordra, the tab is misspelt, or the export is not a
 * Converty export — not fifteen minutes later as a cron run that fails forever
 * with nobody watching. It also says where the data ends, which is where a
 * "new orders only" import starts.
 */

export type SheetProblem = "no_access" | "no_tab" | "unknown";

export interface SheetInspection {
  headers: string[];
  /** Data rows under the header, up to the last row holding anything. */
  dataRowCount: number;
}

/** The service account's address — what the sheet must be shared with. Never the key. */
export function getServiceAccountEmail(): string | null {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    const email = (JSON.parse(json) as { client_email?: unknown }).client_email;
    return typeof email === "string" && email ? email : null;
  } catch {
    return null;
  }
}

const norm = (h: string) => h.trim().toLowerCase();

export function missingHeaders(headers: string[], required: readonly string[]): string[] {
  const have = new Set(headers.map(norm));
  return required.filter((r) => !have.has(norm(r)));
}

export function classifySheetError(err: unknown): SheetProblem {
  const e = err as { code?: number; status?: number; message?: string };
  const status = e?.code ?? e?.status;
  const message = String(e?.message ?? err ?? "");
  if (status === 403 || status === 404) return "no_access";
  if (status === 400 && /unable to parse range/i.test(message)) return "no_tab";
  return "unknown";
}

/**
 * One read of the whole tab, once, at connection time. Google truncates at the
 * last row holding data, so the length is the data extent — the grid's row
 * count is not, because new rows are written into its blank tail and a cursor
 * set past them would skip them forever.
 */
export async function inspectSheet(params: { spreadsheetId: string; sheetName: string }): Promise<SheetInspection> {
  const sheets = google.sheets({ version: "v4", auth: getAuthClient() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: params.spreadsheetId,
    range: sheetRange(params.sheetName, "A1:Z"),
  });
  const rows = (res.data.values ?? []) as unknown[][];
  const headers = (rows[0] ?? []).map((h) => String(h ?? "").trim());
  return { headers, dataRowCount: Math.max(rows.length - 1, 0) };
}
