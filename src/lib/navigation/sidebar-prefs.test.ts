import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readCollapsedGroups, writeCollapsedGroups, readRailPref, writeRailPref } from "./sidebar-prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("collapsed groups", () => {
  it("starts with nothing folded — first visit shows every link", () => {
    expect(readCollapsedGroups()).toEqual([]);
  });

  it("remembers what the person folded", () => {
    writeCollapsedGroups(["finances", "systeme"]);
    expect(readCollapsedGroups()).toEqual(["finances", "systeme"]);
  });

  it("ignores junk rather than breaking the bar", () => {
    localStorage.setItem("ordra.sidebar.collapsed", "{not json");
    expect(readCollapsedGroups()).toEqual([]);
    localStorage.setItem("ordra.sidebar.collapsed", JSON.stringify(["finances", 42, "nope"]));
    expect(readCollapsedGroups()).toEqual(["finances"]);
  });

  it("survives a browser that refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readCollapsedGroups()).toEqual([]);
    expect(() => writeCollapsedGroups(["finances"])).not.toThrow();
    expect(readRailPref()).toBeNull();
    expect(() => writeRailPref(true)).not.toThrow();
  });
});

describe("rail preference", () => {
  it("is unset until the person chooses — the screen width decides meanwhile", () => {
    expect(readRailPref()).toBeNull();
  });

  it("remembers either choice", () => {
    writeRailPref(true);
    expect(readRailPref()).toBe(true);
    writeRailPref(false);
    expect(readRailPref()).toBe(false);
  });
});
