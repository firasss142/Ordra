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

type FetchLike = typeof fetch;

/** Re-sign this long before the token expires. */
const EXPIRY_MARGIN_MS = 60_000;

function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export class XDeliveryPortal {
  private token: string | null = null;
  private expiresAt = 0;

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
    this.expiresAt = expiryOf(this.token);
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
}
