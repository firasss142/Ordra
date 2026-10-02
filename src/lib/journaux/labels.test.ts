import { describe, it, expect } from "vitest";
import fr from "@/messages/fr.json";
import { MARKET_SETTINGS_KEYS } from "@/types/settings";
import { LABELLED_SETTING_KEYS, LABELLED_USER_EVENTS } from "./labels";

const j = (fr as unknown as { journaux: { keys: Record<string, string>; userEvents: Record<string, string> } }).journaux;

describe("Journaux labels", () => {
  it("names every key of the catalog, and only those", () => {
    expect([...LABELLED_SETTING_KEYS].sort()).toEqual(Object.keys(j.keys).sort());
    expect([...LABELLED_USER_EVENTS].sort()).toEqual(Object.keys(j.userEvents).sort());
  });

  it("names every market setting the history can hold", () => {
    expect(MARKET_SETTINGS_KEYS.filter((k) => !LABELLED_SETTING_KEYS.has(k))).toEqual([]);
  });
});
