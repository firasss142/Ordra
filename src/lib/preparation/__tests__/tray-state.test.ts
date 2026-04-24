import { describe, test, expect } from "vitest";
import {
  createTrayRow,
  markPrinted,
  markScanned,
  markError,
  clearError,
  type TrayRow,
} from "../tray-state";

function row(overrides?: Partial<TrayRow>): TrayRow {
  return createTrayRow({
    id: "order-1",
    shortId: "ORDER-1",
    city: "Tunis",
    customer: "Alice",
    productLabel: "Widget x 2",
    quantity: 2,
    stockLevel: 10,
    ...overrides,
  });
}

describe("createTrayRow", () => {
  test("starts in ready_to_print state", () => {
    expect(row().state).toBe("ready_to_print");
  });

  test("has no error, printedAt, or scannedAt initially", () => {
    const r = row();
    expect(r.errorReason).toBeUndefined();
    expect(r.printedAt).toBeUndefined();
    expect(r.scannedAt).toBeUndefined();
  });
});

describe("markPrinted", () => {
  test("transitions ready_to_print → printed", () => {
    const r = markPrinted(row());
    expect(r.state).toBe("printed");
  });

  test("sets printedAt timestamp", () => {
    const before = Date.now();
    const r = markPrinted(row());
    expect(r.printedAt).toBeGreaterThanOrEqual(before);
  });

  test("is idempotent — printed stays printed", () => {
    const r = markPrinted(markPrinted(row()));
    expect(r.state).toBe("printed");
  });

  test("does not transition from scanned state", () => {
    const already = { ...row(), state: "scanned" as const, scannedAt: Date.now() };
    const r = markPrinted(already);
    expect(r.state).toBe("scanned");
  });
});

describe("markScanned", () => {
  test("transitions printed → scanned", () => {
    const printed = markPrinted(row());
    const r = markScanned(printed, 8);
    expect(r.state).toBe("scanned");
  });

  test("sets scannedAt and stockLevel", () => {
    const before = Date.now();
    const r = markScanned(markPrinted(row()), 7);
    expect(r.scannedAt).toBeGreaterThanOrEqual(before);
    expect(r.stockLevel).toBe(7);
  });

  test("transitions error → scanned (idempotent recovery)", () => {
    const errored = markError(markPrinted(row()), "STOCK_UNDERFLOW");
    const r = markScanned(errored, 5);
    expect(r.state).toBe("scanned");
    expect(r.errorReason).toBeUndefined();
  });

  test("does not transition from ready_to_print", () => {
    const r = markScanned(row(), 5);
    expect(r.state).toBe("ready_to_print");
  });

  test("is idempotent — scanned stays scanned", () => {
    const scanned = markScanned(markPrinted(row()), 5);
    const r = markScanned(scanned, 3);
    expect(r.state).toBe("scanned");
    expect(r.stockLevel).toBe(5);
  });
});

describe("markError", () => {
  test("adds error reason to printed row", () => {
    const r = markError(markPrinted(row()), "NO_LABEL_PRINTED");
    expect(r.state).toBe("error");
    expect(r.errorReason).toBe("NO_LABEL_PRINTED");
  });

  test("adds error to ready_to_print row", () => {
    const r = markError(row(), "ORDER_NOT_FOUND");
    expect(r.state).toBe("error");
  });

  test("does not override a scanned row with an error", () => {
    const scanned = markScanned(markPrinted(row()), 5);
    const r = markError(scanned, "STOCK_UNDERFLOW");
    expect(r.state).toBe("scanned");
  });
});

describe("clearError", () => {
  test("returns errored row back to printed", () => {
    const errored = markError(markPrinted(row()), "STOCK_UNDERFLOW");
    const r = clearError(errored);
    expect(r.state).toBe("printed");
    expect(r.errorReason).toBeUndefined();
  });

  test("no-op on ready_to_print", () => {
    const r = clearError(row());
    expect(r.state).toBe("ready_to_print");
  });

  test("no-op on scanned", () => {
    const scanned = markScanned(markPrinted(row()), 5);
    const r = clearError(scanned);
    expect(r.state).toBe("scanned");
  });
});
