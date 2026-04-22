export interface NavexPollResponse {
  trackingNumber: string;
  etat: string | null;
  rawBody: unknown;
}

export interface DexpressPollResult {
  trackingNumber: string;
  statusKey: number;
  nameStatus: string;
  rawBody: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseNavexResponse(
  trackingNumber: string,
  httpBody: unknown
): NavexPollResponse {
  let record: Record<string, unknown> | null = null;

  if (Array.isArray(httpBody) && httpBody.length > 0 && isRecord(httpBody[0])) {
    record = httpBody[0] as Record<string, unknown>;
  } else if (isRecord(httpBody)) {
    record = httpBody;
  }

  if (!record) {
    return { trackingNumber, etat: null, rawBody: httpBody };
  }

  const etatRaw = record.etat;
  const etat =
    typeof etatRaw === "string" && etatRaw.trim() !== "" ? etatRaw : null;

  return { trackingNumber, etat, rawBody: httpBody };
}

export function parseDexpressBatchResponse(
  httpBody: unknown
): DexpressPollResult[] {
  if (!isRecord(httpBody)) return [];
  if (httpBody.code !== 4000) return [];

  const data = httpBody.data;
  if (!Array.isArray(data)) return [];

  const results: DexpressPollResult[] = [];
  for (const entry of data) {
    if (!isRecord(entry)) continue;
    const snum = entry.order_snum;
    const key = entry.status_key;
    const name = entry.name_status;
    if (
      (typeof snum !== "number" && typeof snum !== "string") ||
      typeof key !== "number" ||
      typeof name !== "string"
    ) {
      continue;
    }
    results.push({
      trackingNumber: String(snum),
      statusKey: key,
      nameStatus: name,
      rawBody: entry,
    });
  }
  return results;
}
