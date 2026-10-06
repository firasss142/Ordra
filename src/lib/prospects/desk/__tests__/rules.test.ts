import { describe, expect, it } from "vitest";
import { parseRules } from "../rules";

const ok = {
  enabled: true,
  rej: { on: true, delay_days: 3, subreasons: ["changement_avis", "prix_eleve"] },
  ret: { on: false },
  old: { on: true, after_days: 30 },
  dist: { hour: 9, file_cap: 15, release_days: 3, max_tries: 3 },
};

describe("parseRules", () => {
  it("accepts a complete, sane settings object", () => {
    expect(parseRules(ok)).toEqual({ ok: true, value: ok });
  });

  it("refuses numbers outside what makes sense, naming the field", () => {
    expect(parseRules({ ...ok, dist: { ...ok.dist, hour: 24 } })).toEqual({ ok: false, field: "dist.hour" });
    expect(parseRules({ ...ok, dist: { ...ok.dist, file_cap: 0 } })).toEqual({ ok: false, field: "dist.file_cap" });
    expect(parseRules({ ...ok, rej: { ...ok.rej, delay_days: 61 } })).toEqual({ ok: false, field: "rej.delay_days" });
    expect(parseRules({ ...ok, old: { ...ok.old, after_days: 3 } })).toEqual({ ok: false, field: "old.after_days" });
  });

  it("refuses a sub-reason that is never recoverable", () => {
    expect(parseRules({ ...ok, rej: { ...ok.rej, subreasons: ["non_commande"] } })).toEqual({ ok: false, field: "rej.subreasons" });
  });

  it("refuses junk", () => {
    expect(parseRules(null)).toEqual({ ok: false, field: "body" });
    expect(parseRules({ ...ok, ret: "yes" })).toEqual({ ok: false, field: "ret" });
  });
});
