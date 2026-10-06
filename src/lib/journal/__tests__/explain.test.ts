import { describe, test, expect } from "vitest";
import { causeKey, explainIssue, EXPLAIN_KEYS } from "../explain";

describe("causeKey — what kind of failure this is, in words a manager understands", () => {
  test.each([
    [{ kind: "db", code: "22P02" }, "bad_value"],
    [{ kind: "db", code: "23505" }, "duplicate"],
    [{ kind: "db", code: "23503" }, "missing_link"],
    [{ kind: "db", code: "23502" }, "missing_field"],
    [{ kind: "db", code: "23514" }, "rule_check"],
    [{ kind: "db", code: "42501" }, "no_permission"],
    [{ kind: "db", code: "PGRST301" }, "no_permission"],
    [{ kind: "db", code: "42703" }, "schema_mismatch"],
    [{ kind: "db", code: "42883" }, "schema_mismatch"],
    [{ kind: "db", code: "42P01" }, "schema_mismatch"],
    [{ kind: "db", code: "PGRST202" }, "schema_mismatch"],
    [{ kind: "db", code: "PGRST204" }, "schema_mismatch"],
    [{ kind: "db", code: "57014" }, "db_slow"],
    [{ kind: "db", code: "40P01" }, "conflict"],
    [{ kind: "db", code: "PGRST116" }, "no_row"],
    [{ kind: "db", code: "P0001" }, "business_rule"],
    [{ kind: "db", code: "network" }, "db_unreachable"],
    [{ kind: "db", code: "08006" }, "db_unreachable"],
    [{ kind: "db", code: "XX000" }, "db_other"],
    [{ kind: "external", code: "timeout" }, "ext_timeout"],
    [{ kind: "external", code: "401" }, "ext_credentials"],
    [{ kind: "external", code: "403" }, "ext_credentials"],
    [{ kind: "external", code: "429" }, "ext_rate_limit"],
    [{ kind: "external", code: "404" }, "ext_not_found"],
    [{ kind: "external", code: "422" }, "ext_refused"],
    [{ kind: "external", code: "503" }, "ext_down"],
    [{ kind: "external", code: "ENOTFOUND" }, "ext_network"],
    [{ kind: "external", code: "ECONNRESET" }, "ext_network"],
    [{ kind: "code", code: "TypeError", detail: "Cannot read properties of undefined (reading 'id')" }, "code_missing_data"],
    [{ kind: "code", code: null, detail: "something else" }, "code_bug"],
  ] as const)("%o → %s", (cause, key) => {
    expect(causeKey(cause)).toBe(key);
  });

  test("no cause at all is « unknown », never a guess", () => {
    expect(causeKey(null)).toBe("unknown");
  });
});

describe("explainIssue — « Pourquoi » and « Que faire » for every problem", () => {
  test("a server error is explained by its cause, and names the table it touched", () => {
    const e = explainIssue("server_error", {
      route: "/api/cities",
      cause_kind: "db",
      cause_code: "22P02",
      cause_target: "cities",
      cause_detail: 'invalid input syntax for type uuid: ""',
    });
    expect(e!.why).toEqual({ key: "cause.bad_value.why", params: { target: "cities" } });
    expect(e!.fix).toEqual({ key: "cause.bad_value.fix", params: { target: "cities" } });
  });

  test("a server error recorded before causes existed says so", () => {
    expect(explainIssue("server_error", { route: "/api/x" })!.why.key).toBe("cause.unknown.why");
  });

  test("an outside service failing is explained by its HTTP answer", () => {
    const e = explainIssue("external_failing", { system: "navex", http_status: 401, code: null });
    expect(e!.why).toEqual({ key: "cause.ext_credentials.why", params: { target: "Navex" } });
  });

  test("an outside timeout without HTTP status uses the code", () => {
    expect(explainIssue("external_failing", { system: "darb_assabil", http_status: null, code: "timeout" })!.why).toEqual({
      key: "cause.ext_timeout.why",
      params: { target: "Darb Assabil" },
    });
  });

  test("a browser crash is explained like a code error", () => {
    expect(
      explainIssue("browser_error", { cause_kind: "code", cause_code: "TypeError", cause_detail: "Cannot read properties of null (reading 'x')", cause_target: "OrdersTable.tsx:120" })!.why,
    ).toEqual({ key: "cause.code_missing_data.why", params: { target: "OrdersTable.tsx:120" } });
  });

  test("a rule that is not about a cause returns null: its own sentences already exist", () => {
    expect(explainIssue("job_hanging", { job: "poll-carriers" })).toBeNull();
  });

  test("every key it can return exists in fr and ar", async () => {
    const fr = (await import("@/messages/fr.json")).default as unknown as { journaux: { explain: Record<string, Record<string, { why: string; fix: string }>> } };
    const ar = (await import("@/messages/ar.json")).default as unknown as typeof fr;
    for (const k of EXPLAIN_KEYS) {
      const [group, key] = k.split(".");
      for (const m of [fr, ar]) {
        expect(m.journaux.explain[group][key]?.why, `${k}.why`).toBeTruthy();
        expect(m.journaux.explain[group][key]?.fix, `${k}.fix`).toBeTruthy();
      }
    }
  });
});
