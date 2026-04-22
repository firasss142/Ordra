import { describe, it, expect } from "vitest";
import { mapNavexEvent, mapDexpressEvent } from "../carrier-webhook-engine";

describe("mapNavexEvent", () => {
  it("maps package_received to deposit with decrement", () => {
    const result = mapNavexEvent("package_received");
    expect(result).toEqual({
      status_to: "deposit",
      stock_effect: "decrement",
      actor_note: "Navex: package_received",
    });
  });

  it("maps deposit (alias) to deposit with decrement", () => {
    const result = mapNavexEvent("deposit");
    expect(result).toEqual({
      status_to: "deposit",
      stock_effect: "decrement",
      actor_note: "Navex: deposit",
    });
  });

  it("maps in_transit to in_transit with no stock effect", () => {
    const result = mapNavexEvent("in_transit");
    expect(result).toEqual({
      status_to: "in_transit",
      stock_effect: "none",
      actor_note: "Navex: in_transit",
    });
  });

  it("maps delivered to delivered with no stock effect", () => {
    const result = mapNavexEvent("delivered");
    expect(result).toEqual({
      status_to: "delivered",
      stock_effect: "none",
      actor_note: "Navex: delivered",
    });
  });

  it("maps return_initiated to to_be_returned with no stock effect", () => {
    const result = mapNavexEvent("return_initiated");
    expect(result).toEqual({
      status_to: "to_be_returned",
      stock_effect: "none",
      actor_note: "Navex: return_initiated",
    });
  });

  it("maps returned to returned with increment and damaged false", () => {
    const result = mapNavexEvent("returned");
    expect(result).toEqual({
      status_to: "returned",
      stock_effect: "increment",
      damaged: false,
      actor_note: "Navex: returned",
    });
  });

  it("maps damaged_return to returned with no stock effect and damaged true", () => {
    const result = mapNavexEvent("damaged_return");
    expect(result).toEqual({
      status_to: "returned",
      stock_effect: "none",
      damaged: true,
      actor_note: "Navex: damaged_return",
    });
  });

  it("returns null for unknown event", () => {
    expect(mapNavexEvent("unknown_event")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(mapNavexEvent("")).toBeNull();
  });
});

describe("mapDexpressEvent", () => {
  it("maps package_received to deposit with decrement", () => {
    const result = mapDexpressEvent("package_received");
    expect(result).toEqual({
      status_to: "deposit",
      stock_effect: "decrement",
      actor_note: "Dexpress: package_received",
    });
  });

  it("maps deposit (alias) to deposit with decrement", () => {
    const result = mapDexpressEvent("deposit");
    expect(result).toEqual({
      status_to: "deposit",
      stock_effect: "decrement",
      actor_note: "Dexpress: deposit",
    });
  });

  it("maps in_transit to in_transit with no stock effect", () => {
    const result = mapDexpressEvent("in_transit");
    expect(result).toEqual({
      status_to: "in_transit",
      stock_effect: "none",
      actor_note: "Dexpress: in_transit",
    });
  });

  it("maps delivered to delivered with no stock effect", () => {
    const result = mapDexpressEvent("delivered");
    expect(result).toEqual({
      status_to: "delivered",
      stock_effect: "none",
      actor_note: "Dexpress: delivered",
    });
  });

  it("maps return_initiated to to_be_returned with no stock effect", () => {
    const result = mapDexpressEvent("return_initiated");
    expect(result).toEqual({
      status_to: "to_be_returned",
      stock_effect: "none",
      actor_note: "Dexpress: return_initiated",
    });
  });

  it("maps returned to returned with increment and damaged false", () => {
    const result = mapDexpressEvent("returned");
    expect(result).toEqual({
      status_to: "returned",
      stock_effect: "increment",
      damaged: false,
      actor_note: "Dexpress: returned",
    });
  });

  it("maps damaged_return to returned with no stock effect and damaged true", () => {
    const result = mapDexpressEvent("damaged_return");
    expect(result).toEqual({
      status_to: "returned",
      stock_effect: "none",
      damaged: true,
      actor_note: "Dexpress: damaged_return",
    });
  });

  it("returns null for unknown event", () => {
    expect(mapDexpressEvent("unknown_event")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(mapDexpressEvent("")).toBeNull();
  });
});
