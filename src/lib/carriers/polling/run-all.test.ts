import { describe, it, expect, vi } from "vitest";
import { runAllCarrierPolls } from "./run-all";

const navex = { carrierCode: "navex" as const, polled: 2, processed: 2, ignored: 0, errored: 0 };
const xd = { carrierCode: "xdelivery" as const, polled: 5, processed: 4, ignored: 1, errored: 0 };

describe("runAllCarrierPolls", () => {
  it("runs every carrier and concatenates the results", async () => {
    const r = await runAllCarrierPolls([async () => [navex], async () => xd]);
    expect(r).toEqual([navex, xd]);
  });

  it("one carrier failing does not stop the others", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runAllCarrierPolls([
      async () => {
        throw new Error("navex down");
      },
      async () => xd,
    ]);
    expect(r).toEqual([xd]);
    spy.mockRestore();
  });

  it("throws when every carrier failed, so the job run is marked failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runAllCarrierPolls([
        async () => {
          throw new Error("a");
        },
        async () => {
          throw new Error("b");
        },
      ]),
    ).rejects.toThrow("a");
    spy.mockRestore();
  });
});
