import { google } from "googleapis";
import type { SheetRow, FetchRowsOptions } from "./types";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const DEFAULT_MAX_ROWS = 500;

function getAuthClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!json) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");

  const credentials = JSON.parse(json) as {
    client_email: string;
    private_key: string;
  };

  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

export async function fetchSheetRows(options: FetchRowsOptions): Promise<SheetRow[]> {
  const { spreadsheetId, sheetName, fromRow, maxRows = DEFAULT_MAX_ROWS } = options;

  const auth = getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${sheetName}'!A1:Z`,
  });

  const values = response.data.values;
  if (!values || values.length < 2) return [];

  const headers = (values[0] as unknown[]).map((h) => String(h ?? "").trim());
  const dataRows = values.slice(1);

  const result: SheetRow[] = [];
  let count = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const rowIndex = i + 1;
    if (rowIndex < fromRow) continue;
    if (count >= maxRows) break;

    const cells = dataRows[i] as unknown[];
    const data: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) {
        data[headers[j]] = String(cells[j] ?? "").trim();
      }
    }

    // Skip completely empty rows
    const hasContent = Object.values(data).some((v) => v !== "");
    if (!hasContent) continue;

    result.push({ rowIndex, data });
    count++;
  }

  return result;
}
