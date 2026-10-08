import { describe, it, expect, vi } from "vitest";
import { XDeliveryPortal } from "./portal";

function jwt(expSecondsFromNow: number): string {
  const payload = Buffer.from(
    JSON.stringify({ role: "OWNER", exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  ).toString("base64url");
  return `h.${payload}.s`;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("XDeliveryPortal", () => {
  it("signs in with email + password and sends the token as Bearer", async () => {
    const token = jwt(8 * 3600);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: token }, 201))
      .mockResolvedValueOnce(json({ records: [{ _id: "id-611", code: "611", status: "CREATED" }] }));
    const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);

    const ids = await portal.findParcels(["611"]);
    expect(ids).toEqual([{ barcode: "611", id: "id-611", status: "CREATED" }]);

    const [signinUrl, signinInit] = fetchMock.mock.calls[0];
    expect(signinUrl).toBe("https://app.x-delivery.io/api/auth/signin");
    expect(JSON.parse(signinInit.body)).toEqual({ email: "a@b.c", password: "pw" });
    const [searchUrl, searchInit] = fetchMock.mock.calls[1];
    expect(searchUrl).toBe("https://app.x-delivery.io/api/parcels/searchTerm/611");
    expect(searchInit.headers.Authorization).toBe(`Bearer ${token}`);
  });

  it("reuses the token until it is about to expire", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: jwt(8 * 3600) }, 201))
      .mockResolvedValue(json({ records: [] }));
    const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
    await portal.findParcels(["1"]);
    await portal.findParcels(["2"]);
    const signins = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/auth/signin"));
    expect(signins).toHaveLength(1);
  });

  it("signs in again when the token is within a minute of expiry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: jwt(30) }, 201))
      .mockResolvedValueOnce(json({ records: [] }))
      .mockResolvedValueOnce(json({ accessToken: jwt(8 * 3600) }, 201))
      .mockResolvedValueOnce(json({ records: [] }));
    const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
    await portal.findParcels(["1"]);
    await portal.findParcels(["2"]);
    const signins = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/auth/signin"));
    expect(signins).toHaveLength(2);
  });

  it("a refused login is an error that names the cause, never the password", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ message: "Unauthorized" }, 401));
    const portal = new XDeliveryPortal({ email: "a@b.c", password: "secret-pw" }, fetchMock);
    const err = await portal.findParcels(["1"]).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/connexion au portail X-Delivery refusée/i);
    expect((err as Error).message).not.toContain("secret-pw");
  });

  it("only keeps the record whose code IS the barcode (searchTerm also matches phones)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: jwt(3600) }, 201))
      .mockResolvedValueOnce(
        json({
          records: [
            { _id: "other", code: "999", status: "DELIVERED" },
            { _id: "mine", code: "611", status: "CREATED" },
          ],
        }),
      );
    const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
    expect(await portal.findParcels(["611"])).toEqual([{ barcode: "611", id: "mine", status: "CREATED" }]);
  });

  it("requests pickup for the given parcel ids as one COLLECTED manifest", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: jwt(3600) }, 201))
      .mockResolvedValueOnce(json({ _id: "manifest-1" }, 201));
    const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
    await portal.requestPickup(["id-1", "id-2"]);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://app.x-delivery.io/api/manifests/collectParcels");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ parcels: ["id-1", "id-2"], type: "COLLECTED" });
  });

  describe("manifests", () => {
    const tokenFor = (company: string) => {
      const payload = Buffer.from(
        JSON.stringify({ role: "OWNER", company, exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString("base64url");
      return `h.${payload}.s`;
    };

    it("lists one type of manifest for our company over a window, reduced to what Ordra uses", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ accessToken: tokenFor("co-1") }, 201))
        .mockResolvedValueOnce(
          json({
            totalDocuments: 1,
            records: [
              {
                _id: "m-1",
                code: "1791369888000",
                status: "ACCEPTED",
                type: "RETURN",
                createdAt: "2026-10-07T10:44:48.266Z",
                // The real answer embeds our company with the API key in clear.
                company: { apiKey: "SECRET-KEY", taxNumber: "X" },
                parcels: [
                  { _id: "p-1", code: 611, status: "PENDING_RETURNS", customerName: "Client", company: { apiKey: "SECRET-KEY" } },
                  { _id: "p-2", code: "612", status: "PENDING_RETURNS" },
                ],
              },
            ],
          }),
        );
      const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
      const since = new Date("2026-10-01T00:00:00.000Z");
      const until = new Date("2026-10-08T00:00:00.000Z");

      const lists = await portal.listManifests("RETURN", since, until);

      expect(lists).toEqual([
        {
          id: "m-1",
          code: "1791369888000",
          status: "ACCEPTED",
          type: "RETURN",
          createdAt: "2026-10-07T10:44:48.266Z",
          parcels: [
            { barcode: "611", id: "p-1", status: "PENDING_RETURNS" },
            { barcode: "612", id: "p-2", status: "PENDING_RETURNS" },
          ],
        },
      ]);
      expect(JSON.stringify(lists)).not.toContain("SECRET-KEY");
      const url = new URL(fetchMock.mock.calls[1][0]);
      expect(url.pathname).toBe("/api/manifests");
      expect(url.searchParams.get("company")).toBe("co-1");
      expect(url.searchParams.get("type")).toBe("RETURN");
      expect(url.searchParams.get("startDate")).toBe(since.toISOString());
      expect(url.searchParams.get("endDate")).toBe(until.toISOString());
    });

    it("a manifest without parcels or code still comes back, with empty values", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ accessToken: tokenFor("co-1") }, 201))
        .mockResolvedValueOnce(json({ records: [{ _id: "m-2", status: "PENDING", type: "COLLECTED" }] }));
      const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
      const [m] = await portal.listManifests("COLLECTED", new Date(0), new Date());
      expect(m).toMatchObject({ id: "m-2", code: null, createdAt: null, parcels: [] });
    });

    it("without a company in the token, listing is refused rather than asking for everyone's lists", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(json({ accessToken: jwt(3600) }, 201));
      const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
      await expect(portal.listManifests("RETURN", new Date(0), new Date())).rejects.toThrow(/company/i);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("removes parcels from a manifest with their own PATCH", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ accessToken: jwt(3600) }, 201))
        .mockResolvedValueOnce(json({ ok: true }));
      const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
      await portal.removeParcelsFromManifest("m-1", ["p-1", "p-2"]);
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe("https://app.x-delivery.io/api/manifests/remove-parcels/m-1");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body)).toEqual({ parcelIds: ["p-1", "p-2"] });
    });

    it("removing nothing sends nothing", async () => {
      const fetchMock = vi.fn();
      const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
      await portal.removeParcelsFromManifest("m-1", []);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("deletes a whole manifest", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ accessToken: jwt(3600) }, 201))
        .mockResolvedValueOnce(json({ ok: true }));
      const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
      await portal.deleteManifest("m-1");
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe("https://app.x-delivery.io/api/manifests/m-1");
      expect(init.method).toBe("DELETE");
    });

    it("an id is path-encoded, never spliced raw into the URL", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(json({ accessToken: jwt(3600) }, 201))
        .mockResolvedValueOnce(json({ ok: true }));
      const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
      await portal.deleteManifest("../parcels");
      expect(fetchMock.mock.calls[1][0]).toBe("https://app.x-delivery.io/api/manifests/..%2Fparcels");
    });
  });

  it("a refused pickup request throws with the HTTP status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: jwt(3600) }, 201))
      .mockResolvedValueOnce(json({ message: "Forbidden" }, 403));
    const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
    await expect(portal.requestPickup(["id-1"])).rejects.toThrow("403");
  });
});
