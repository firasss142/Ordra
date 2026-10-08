/**
 * X-Delivery web-app API — the PORTAL door, not the documented company API.
 *
 * Only one thing in Ordra needs it: the pickup request ("Demande d'enlèvement"),
 * which X-Delivery offers nowhere else. Without it no parcel is ever collected.
 * Owner approved storing the portal login on 2026-10-05.
 *
 * Observed 2026-10-05 (portal-api.md in the main checkout's research folder):
 *   - `POST /api/auth/signin {email,password}` → `{ accessToken }`, a HS256 JWT
 *     valid 8 h. The API key is refused here (401).
 *   - `GET /api/parcels/searchTerm/{barcode|phone}` → `{ records }`; the pickup
 *     call wants their internal `_id`, which only this returns.
 *   - `POST /api/manifests/collectParcels {parcels:[_id], type:"COLLECTED"}`
 *     moves the parcels CREATED → PENDING ("À enlever").
 *
 * Observed 2026-10-08 (read from their web app, then proven live on the account):
 *   - `GET /api/manifests?company=&type=COLLECTED|RETURN|EXCHANGE&startDate=&endDate=`
 *     → `{ records, totalDocuments }`, parcels populated. The date filter is on
 *     the manifest's `createdAt`; no server paging.
 *   - `PATCH /api/manifests/remove-parcels/{id} {parcelIds}` and
 *     `DELETE /api/manifests/{id}` undo a pickup list: the parcels go back to
 *     CREATED ("En attente"). An OWNER account may call both (HTTP 200, 2026-10-08).
 *
 * ⚠️ Manifest and parcel answers embed our `company` object, API key in clear.
 * They are reduced to the fields below the moment they arrive; nothing else
 * from them is returned, logged or stored.
 *
 * UNDOCUMENTED: it may change without notice, so every failure throws with the
 * HTTP status and the caller logs it; nothing here is allowed to block an upload.
 * The password is never put in an error message.
 */

export const XDELIVERY_PORTAL_API = "https://app.x-delivery.io/api";

export interface PortalLogin {
  email: string;
  password: string;
}

export interface PortalParcel {
  barcode: string;
  id: string;
  status: string;
}

export type PortalManifestType = "COLLECTED" | "RETURN" | "EXCHANGE";

export interface PortalManifest {
  id: string;
  /** The number printed as a barcode on the sheet. Pickup lists often have none. */
  code: string | null;
  status: string;
  type: string;
  createdAt: string | null;
  parcels: PortalParcel[];
}

type FetchLike = typeof fetch;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;

function toParcel(raw: unknown): PortalParcel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r._id);
  const barcode = str(r.code);
  if (!id || !barcode) return null;
  return { barcode, id, status: str(r.status) ?? "" };
}

function toManifest(raw: unknown): PortalManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r._id);
  if (!id) return null;
  return {
    id,
    code: str(r.code),
    status: str(r.status) ?? "",
    type: str(r.type) ?? "",
    createdAt: str(r.createdAt),
    parcels: (Array.isArray(r.parcels) ? r.parcels : [])
      .map(toParcel)
      .filter((p): p is PortalParcel => p !== null),
  };
}

/** Re-sign this long before the token expires. */
const EXPIRY_MARGIN_MS = 60_000;

function claimsOf(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export class XDeliveryPortal {
  private token: string | null = null;
  private expiresAt = 0;
  /** Our company id, read from the token: the manifest list must be filtered by it. */
  private company: string | null = null;

  constructor(
    private readonly login: PortalLogin,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async bearer(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) return this.token;
    const res = await this.fetchImpl(`${XDELIVERY_PORTAL_API}/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.login.email, password: this.login.password }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Connexion au portail X-Delivery refusée (HTTP ${res.status})`);
    const body = (await res.json().catch(() => null)) as { accessToken?: unknown } | null;
    if (typeof body?.accessToken !== "string" || !body.accessToken) {
      throw new Error("Connexion au portail X-Delivery : réponse sans jeton");
    }
    this.token = body.accessToken;
    const claims = claimsOf(this.token);
    this.expiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : 0;
    this.company = str(claims.company);
    return this.token;
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const token = await this.bearer();
    const res = await this.fetchImpl(`${XDELIVERY_PORTAL_API}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Portail X-Delivery ${path} : HTTP ${res.status}`);
    return res.json().catch(() => null);
  }

  /** Their internal id for each barcode they know. Unknown barcodes are absent. */
  async findParcels(barcodes: string[]): Promise<PortalParcel[]> {
    const out: PortalParcel[] = [];
    for (const barcode of barcodes) {
      const body = (await this.call(`/parcels/searchTerm/${encodeURIComponent(barcode)}`)) as {
        records?: { _id?: unknown; code?: unknown; status?: unknown }[];
      } | null;
      const hit = (body?.records ?? []).find((r) => String(r.code) === barcode);
      if (hit && typeof hit._id === "string") {
        out.push({ barcode, id: hit._id, status: String(hit.status ?? "") });
      }
    }
    return out;
  }

  /** "Demande d'enlèvement": one COLLECTED manifest for these parcels. */
  async requestPickup(parcelIds: string[]): Promise<void> {
    if (parcelIds.length === 0) return;
    await this.call("/manifests/collectParcels", {
      method: "POST",
      body: JSON.stringify({ parcels: parcelIds, type: "COLLECTED" }),
    });
  }

  /** Our manifests of one type created inside [since, until]. */
  async listManifests(type: PortalManifestType, since: Date, until: Date): Promise<PortalManifest[]> {
    await this.bearer();
    // Without the filter the endpoint answers for every company the token may see.
    if (!this.company) throw new Error("Portail X-Delivery : pas de « company » dans le jeton");
    const q = new URLSearchParams({
      company: this.company,
      type,
      startDate: since.toISOString(),
      endDate: until.toISOString(),
    });
    const body = (await this.call(`/manifests?${q.toString()}`)) as { records?: unknown[] } | null;
    return (body?.records ?? []).map(toManifest).filter((m): m is PortalManifest => m !== null);
  }

  /** Takes these parcels off a pickup list; X-Delivery puts them back to CREATED. */
  async removeParcelsFromManifest(manifestId: string, parcelIds: string[]): Promise<void> {
    if (parcelIds.length === 0) return;
    await this.call(`/manifests/remove-parcels/${encodeURIComponent(manifestId)}`, {
      method: "PATCH",
      body: JSON.stringify({ parcelIds }),
    });
  }

  /** Deletes a whole pickup list; its parcels go back to CREATED. */
  async deleteManifest(manifestId: string): Promise<void> {
    await this.call(`/manifests/${encodeURIComponent(manifestId)}`, { method: "DELETE" });
  }
}
