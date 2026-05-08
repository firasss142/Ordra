import { describe, test, expect } from "vitest";
import { parseFormErrors, isLogoutRedirect } from "./errors";

describe("parseFormErrors", () => {
  test("binds an error to the nearest preceding input by name", () => {
    const html = `
      <input type="text" name="phone">
      <div class="invalid-feedback">numéro requis</div>
    `;
    expect(parseFormErrors(html).errors).toEqual([
      { field: "phone", message: "numéro requis" },
    ]);
  });

  test("handles multiple distinct fields", () => {
    const html = `
      <input name="phone">
      <div class="invalid-feedback">required</div>
      <input name="address">
      <div class="invalid-feedback">address required</div>
    `;
    const { errors } = parseFormErrors(html);
    expect(errors).toEqual([
      { field: "phone", message: "required" },
      { field: "address", message: "address required" },
    ]);
  });

  test("preserves multiple errors on the same field", () => {
    const html = `
      <input name="phone">
      <div class="invalid-feedback">too short</div>
      <div class="invalid-feedback">invalid format</div>
    `;
    const { errors } = parseFormErrors(html);
    expect(errors).toEqual([
      { field: "phone", message: "too short" },
      { field: "phone", message: "invalid format" },
    ]);
  });

  test("returns field=null when no input precedes the error div", () => {
    const html = `
      <div class="invalid-feedback">global error</div>
      <input name="phone">
    `;
    const { errors } = parseFormErrors(html);
    expect(errors).toEqual([{ field: null, message: "global error" }]);
  });

  test("strips inner HTML tags", () => {
    const html = `
      <input name="phone">
      <div class="invalid-feedback"><strong>required</strong><br>now</div>
    `;
    const { errors } = parseFormErrors(html);
    expect(errors).toEqual([{ field: "phone", message: "requirednow" }]);
  });

  test("skips empty error divs", () => {
    const html = `
      <input name="phone">
      <div class="invalid-feedback"></div>
      <input name="address">
      <div class="invalid-feedback">required</div>
    `;
    const { errors } = parseFormErrors(html);
    expect(errors).toEqual([{ field: "address", message: "required" }]);
  });

  test("matches select and textarea inputs as field anchors", () => {
    const html = `
      <select name="to_state"><option>x</option></select>
      <div class="invalid-feedback">choose state</div>
      <textarea name="notes"></textarea>
      <div class="invalid-feedback">notes too long</div>
    `;
    const { errors } = parseFormErrors(html);
    expect(errors).toEqual([
      { field: "to_state", message: "choose state" },
      { field: "notes", message: "notes too long" },
    ]);
  });

  test("returns empty list when there are no errors", () => {
    const html = `<form><input name="phone"></form>`;
    expect(parseFormErrors(html).errors).toEqual([]);
  });
});

describe("isLogoutRedirect", () => {
  test("matches /login", () => {
    expect(isLogoutRedirect("/login")).toBe(true);
  });

  test("matches /login with query string", () => {
    expect(isLogoutRedirect("/login?expired=1")).toBe(true);
  });

  test("matches absolute URL ending in /login", () => {
    expect(isLogoutRedirect("https://portal.dexpress.ly/login")).toBe(true);
  });

  test("does not match /merchant", () => {
    expect(isLogoutRedirect("/merchant")).toBe(false);
  });

  test("does not match /merchant/login-history", () => {
    expect(isLogoutRedirect("/merchant/login-history")).toBe(false);
  });

  test("returns false on null", () => {
    expect(isLogoutRedirect(null)).toBe(false);
  });
});
