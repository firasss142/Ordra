import { describe, it, expect } from "vitest";
import { manifestRpcErrorResponse, normalizeScannedCode, pickupErrorResponse, rpcDetailCode } from "./api";
import { PickupError } from "@/lib/carriers/xdelivery/pickup";

describe("manifest route helpers", () => {
  it("reads the refusal code from the RPC's DETAIL", () => {
    expect(rpcDetailCode({ details: '{"code":"DELIVERED_CONFLICT"}' })).toBe("DELIVERED_CONFLICT");
    expect(rpcDetailCode({ details: "not json" })).toBeNull();
    expect(rpcDetailCode(null)).toBeNull();
  });

  it("maps a refusal to the status the screen branches on", async () => {
    const r = manifestRpcErrorResponse({ message: "Ce colis est « livré »", details: '{"code":"DELIVERED_CONFLICT"}' });
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error_code: "DELIVERED_CONFLICT", message: "Ce colis est « livré »" });
    expect(manifestRpcErrorResponse({ details: '{"code":"WRONG_SITE"}' }).status).toBe(403);
    expect(manifestRpcErrorResponse({ details: '{"code":"BAD_CODE"}' }).status).toBe(400);
  });

  it("an error without a code is a 500, not a conflict the screen would try to explain", () => {
    expect(manifestRpcErrorResponse({ message: "boom" }).status).toBe(500);
  });

  it("a pickup refusal keeps its code; X-Delivery failing is a 502 to retry", async () => {
    const refused = pickupErrorResponse(new PickupError("NOTHING_TO_REQUEST", "Aucun colis"));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error_code).toBe("NOTHING_TO_REQUEST");

    const down = pickupErrorResponse(new Error("Portail X-Delivery /manifests : HTTP 502"));
    expect(down.status).toBe(502);
    expect((await down.json()).error_code).toBe("CARRIER_UNAVAILABLE");

    const login = pickupErrorResponse(new Error("Connexion au portail X-Delivery refusée (HTTP 401)"));
    expect((await login.json()).error_code).toBe("PORTAL_LOGIN_REFUSED");
  });

  it("anything else is rethrown for the route's error journal", () => {
    expect(() => pickupErrorResponse(new Error("db down"))).toThrow("db down");
  });

  it("a scanned code loses every space, wherever the scanner put them", () => {
    expect(normalizeScannedCode(" 6117 9121 7700 001\n")).toBe("611791217700001");
    expect(normalizeScannedCode(42)).toBe("");
  });
});
