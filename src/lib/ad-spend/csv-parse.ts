export type CsvSource = "meta" | "tiktok" | "unknown";

export interface ParsedAdSpendRow {
  campaign_name: string;
  period_start: string; // YYYY-MM-DD
  period_end: string;
  amount: number;
}

interface ColumnMap {
  campaign: string[];
  start: string[];
  end: string[];
  amount: string[];
}

const MAPS: Record<Exclude<CsvSource, "unknown">, ColumnMap> = {
  meta: {
    campaign: ["campaign name", "campaign"],
    start: ["reporting starts", "date start", "start"],
    end: ["reporting ends", "date stop", "end"],
    amount: ["amount spent (tnd)", "amount spent (usd)", "amount spent", "spend"],
  },
  tiktok: {
    campaign: ["campaign name", "campaign"],
    start: ["start date", "date start"],
    end: ["end date", "date end"],
    amount: ["cost", "total cost", "spend"],
  },
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function detectSource(csvText: string): CsvSource {
  const firstLine = csvText.split(/\r?\n/)[0]?.toLowerCase() ?? "";
  if (firstLine.includes("amount spent") || firstLine.includes("reporting starts")) {
    return "meta";
  }
  if (
    (firstLine.includes("cost") && firstLine.includes("start date")) ||
    firstLine.includes("tiktok")
  ) {
    return "tiktok";
  }
  return "unknown";
}

function findColumn(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.toLowerCase().trim());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand);
    if (idx !== -1) return idx;
  }
  return -1;
}

export function parseAdSpendCsv(csvText: string): {
  source: CsvSource;
  rows: ParsedAdSpendRow[];
} {
  const source = detectSource(csvText);
  if (source === "unknown") return { source, rows: [] };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { source, rows: [] };

  const header = parseCsvLine(lines[0]);
  const map = MAPS[source];

  const idx = {
    campaign: findColumn(header, map.campaign),
    start: findColumn(header, map.start),
    end: findColumn(header, map.end),
    amount: findColumn(header, map.amount),
  };

  if (idx.campaign < 0 || idx.start < 0 || idx.end < 0 || idx.amount < 0) {
    return { source, rows: [] };
  }

  const rows: ParsedAdSpendRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const campaign = cells[idx.campaign];
    const start = cells[idx.start];
    const end = cells[idx.end];
    const amountStr = cells[idx.amount];
    if (!campaign || !start || !end || !amountStr) continue;
    const amount = Number(amountStr.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    rows.push({
      campaign_name: campaign,
      period_start: start,
      period_end: end,
      amount,
    });
  }

  return { source, rows };
}
