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

  it("a refused pickup request throws with the HTTP status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: jwt(3600) }, 201))
      .mockResolvedValueOnce(json({ message: "Forbidden" }, 403));
    const portal = new XDeliveryPortal({ email: "a@b.c", password: "pw" }, fetchMock);
    await expect(portal.requestPickup(["id-1"])).rejects.toThrow("403");
  });
});
