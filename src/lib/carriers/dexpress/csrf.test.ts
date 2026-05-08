import { describe, test, expect } from "vitest";
import { scrapeCsrfToken } from "./csrf";

describe("scrapeCsrfToken", () => {
  test("extracts the _token from a Laravel form input", () => {
    const html = `
      <form method="POST" action="/login">
        <input type="hidden" name="_token" value="LkElQXgt6poZAbCdEfGh1234567890">
        <input type="email" name="email">
      </form>
    `;
    expect(scrapeCsrfToken(html)).toBe("LkElQXgt6poZAbCdEfGh1234567890");
  });

  test("returns the first _token when multiple are present", () => {
    const html = `
      <input name="_token" value="first-token">
      <input name="_token" value="second-token">
    `;
    expect(scrapeCsrfToken(html)).toBe("first-token");
  });

  test("returns null when no token is present", () => {
    const html = `<form><input name="email"></form>`;
    expect(scrapeCsrfToken(html)).toBeNull();
  });

  test("returns null on empty string", () => {
    expect(scrapeCsrfToken("")).toBeNull();
  });
});
