import { describe, test, expect } from "vitest";
import { POST, GET } from "./route";
import { NextRequest } from "next/server";

const params = { params: Promise.resolve({ sourceId: "tn-meta-1" }) };

describe("webhook stub — Meta", () => {
  test("POST returns 501", async () => {
    const req = new NextRequest(
      new URL("/api/webhooks/meta/tn-meta-1", "http://localhost:3000"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { method: "POST", body: "{}" } as any
    );
    const res = await POST(req, params);
    expect(res.status).toBe(501);
  });

  test("GET (subscription verification) returns 501", async () => {
    const res = await GET();
    expect(res.status).toBe(501);
  });
});
