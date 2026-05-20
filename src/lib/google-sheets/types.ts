export interface SheetRow {
  rowIndex: number;
  data: Record<string, string>;
}

export interface FetchRowsOptions {
  spreadsheetId: string;
  sheetName: string;
  fromRow: number;
  maxRows?: number;
}
