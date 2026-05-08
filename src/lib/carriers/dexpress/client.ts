import type { CarrierConfig } from "../types";
import { CarrierDispatchError } from "../errors";
import { scrapeCsrfToken } from "./csrf";
import { isLogoutRedirect } from "./errors";
import {
  loadSession,
  saveSession,
  invalidateSession,
  refreshExpiry,
  type DexpressSession,
} from "./session-store";

const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h, matches the cookie's Max-Age
const SESSION_REFRESH_LEEWAY_MS = 60 * 1000; // refresh if <60s remain

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,ar;q=0.7",
};

export interface MerchantPageResult {
  status: number;
  html: string;
  redirectedToLogin: boolean;
}

export interface MerchantSubmitResult {
  status: number;
  redirectLocation: string | null;
  html: string;
}

export class DexpressClient {
  constructor(
    private readonly carrierId: string,
    private readonly config: CarrierConfig
  ) {}

  async ensureSession(): Promise<DexpressSession> {
    const cached = await loadSession(this.carrierId);
    if (cached && cached.expiresAt.getTime() > Date.now() + SESSION_REFRESH_LEEWAY_MS) {
      return cached;
    }
    return this.login();
  }

  async getMerchantPage(path: string): Promise<MerchantPageResult> {
    return this.requestWithRetry<MerchantPageResult>(async (session) => {
      const response = await this.fetchWithCookie(path, session, {
        method: "GET",
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && isLogoutRedirect(location)) {
        return { kind: "logout" };
      }
      const html = await response.text();
      return {
        kind: "ok",
        result: {
          status: response.status,
          html,
          redirectedToLogin: false,
        },
      };
    });
  }

  async submitMerchantForm(
    path: string,
    fields: Record<string, string>
  ): Promise<MerchantSubmitResult> {
    return this.requestWithRetry<MerchantSubmitResult>(async (session) => {
      const formData = new FormData();
      for (const [k, v] of Object.entries(fields)) formData.append(k, v);

      const baseUrl = this.config.apiEndpoint.replace(/\/$/, "");
      const response = await this.fetchWithCookie(path, session, {
        method: "POST",
        body: formData,
        headers: {
          // Laravel form submissions are typically validated against Referer/Origin.
          // Without these the app can "redirect back with errors" silently.
          Referer: `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`,
          Origin: baseUrl,
        },
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && isLogoutRedirect(location)) {
        return { kind: "logout" };
      }

      const html = response.status === 200 ? await response.text() : "";
      return {
        kind: "ok",
        result: {
          status: response.status,
          redirectLocation: location,
          html,
        },
      };
    });
  }

  // ---- internals ----

  private async login(): Promise<DexpressSession> {
    const baseUrl = this.config.apiEndpoint.replace(/\/$/, "");
    const email = this.config.apiCredentials.email;
    const password = this.config.apiCredentials.password;
    if (!email || !password) {
      throw new CarrierDispatchError(
        "DEXPRESS_MISSING_CREDENTIALS: email and password required"
      );
    }

    // Step 1: GET /login → scrape _token + capture initial cookie
    const getResp = await this.bareFetch(`${baseUrl}/login`, {
      method: "GET",
      headers: { ...BROWSER_HEADERS },
    });
    const getHtml = await getResp.text();
    const token = scrapeCsrfToken(getHtml);
    if (!token) {
      throw new CarrierDispatchError("DEXPRESS_NO_LOGIN_TOKEN");
    }
    const initialCookie = parseLaravelSessionCookie(getResp.headers);
    if (!initialCookie) {
      throw new CarrierDispatchError("DEXPRESS_NO_INITIAL_COOKIE");
    }

    // Step 2: POST /login (urlencoded) with the initial cookie attached
    const body = new URLSearchParams({
      _token: token,
      email,
      password,
    }).toString();

    const postResp = await this.bareFetch(`${baseUrl}/login`, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: `laravel_session=${initialCookie}`,
        Referer: `${baseUrl}/login`,
        Origin: baseUrl,
      },
      body,
      redirect: "manual",
    });

    if (postResp.status !== 302) {
      throw new CarrierDispatchError(
        `DEXPRESS_LOGIN_FAILED: expected 302, got ${postResp.status} (login failed)`
      );
    }

    const authedCookie =
      parseLaravelSessionCookie(postResp.headers) ?? initialCookie;
    const session: DexpressSession = {
      laravelSession: authedCookie,
      xsrfToken: null,
      csrfToken: token,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    };
    await saveSession(this.carrierId, session);
    return session;
  }

  private async fetchWithCookie(
    path: string,
    session: DexpressSession,
    init: RequestInit
  ): Promise<Response> {
    const baseUrl = this.config.apiEndpoint.replace(/\/$/, "");
    const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      Cookie: `laravel_session=${session.laravelSession}`,
    };
    return this.bareFetch(url, {
      ...init,
      headers,
      redirect: "manual",
    });
  }

  private async bareFetch(
    url: string,
    init: RequestInit
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      throw new CarrierDispatchError(`DEXPRESS_NETWORK: ${msg}`);
    }
  }

  /**
   * Run an attempt that returns either { kind: "ok", result } or { kind: "logout" }.
   * On logout: invalidate the session, log in again, and run the attempt once more.
   * Two consecutive logouts → throw.
   */
  private async requestWithRetry<T>(
    attempt: (session: DexpressSession) => Promise<{ kind: "ok"; result: T } | { kind: "logout" }>
  ): Promise<T> {
    let session = await this.ensureSession();
    let outcome = await attempt(session);

    if (outcome.kind === "ok") {
      await this.touchExpiry();
      return outcome.result;
    }

    // Logout: invalidate and re-login
    await invalidateSession(this.carrierId);
    session = await this.login();
    outcome = await attempt(session);

    if (outcome.kind === "ok") {
      await this.touchExpiry();
      return outcome.result;
    }

    throw new CarrierDispatchError(
      "DEXPRESS_SESSION_UNRECOVERABLE: bounced to /login twice in a row"
    );
  }

  private async touchExpiry(): Promise<void> {
    try {
      await refreshExpiry(
        this.carrierId,
        new Date(Date.now() + SESSION_TTL_MS)
      );
    } catch {
      // Non-fatal: a stale expiry will trigger re-login next time, that's fine.
    }
  }
}

function parseLaravelSessionCookie(headers: Headers): string | null {
  // Headers.get returns a comma-joined string for Set-Cookie in some runtimes,
  // but Set-Cookie can contain commas inside Expires=. Use getSetCookie if available.
  const all = (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.();
  const candidates = all && all.length > 0 ? all : (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
  for (const raw of candidates) {
    const m = raw.match(/laravel_session=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}
