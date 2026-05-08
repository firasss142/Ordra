export interface NavexPollResponse {
  trackingNumber: string;
  etat: string | null;
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

// parseDexpressBatchResponse removed: Dexpress has no status API.
