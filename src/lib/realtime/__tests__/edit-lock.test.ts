import { describe, test, expect, vi } from "vitest";
import { createEditLockRegistry } from "@/lib/realtime/edit-lock";

describe("edit-lock registry", () => {
  test("is unlocked by default", () => {
    const reg = createEditLockRegistry();
    expect(reg.isLocked("orders", "o-1")).toBe(false);
  });

  test("lock/unlock toggles state", () => {
    const reg = createEditLockRegistry();
    reg.lock("orders", "o-1");
    expect(reg.isLocked("orders", "o-1")).toBe(true);
    reg.unlock("orders", "o-1");
    expect(reg.isLocked("orders", "o-1")).toBe(false);
  });

  test("locks are scoped per (table, rowId) — locking one row doesn't lock another", () => {
    const reg = createEditLockRegistry();
    reg.lock("orders", "o-1");
    expect(reg.isLocked("orders", "o-2")).toBe(false);
    expect(reg.isLocked("order_items", "o-1")).toBe(false);
  });

  test("supports multiple holders per row (refcounted) — unlocks only when all release", () => {
    const reg = createEditLockRegistry();
    reg.lock("orders", "o-1"); // field A focused
    reg.lock("orders", "o-1"); // field B focused while A still editing
    reg.unlock("orders", "o-1"); // A commits
    expect(reg.isLocked("orders", "o-1")).toBe(true);
    reg.unlock("orders", "o-1"); // B commits
    expect(reg.isLocked("orders", "o-1")).toBe(false);
  });

  test("notifies subscribers when a row unlocks (so callers can flush queued patches)", () => {
    const reg = createEditLockRegistry();
    const onUnlock = vi.fn();
    const unsubscribe = reg.onUnlock(onUnlock);

    reg.lock("orders", "o-1");
    reg.unlock("orders", "o-1");

    expect(onUnlock).toHaveBeenCalledWith({ table: "orders", rowId: "o-1" });
    unsubscribe();

    reg.lock("orders", "o-2");
    reg.unlock("orders", "o-2");
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  test("over-unlock is a no-op and does not fire onUnlock", () => {
    const reg = createEditLockRegistry();
    const onUnlock = vi.fn();
    reg.onUnlock(onUnlock);

    reg.unlock("orders", "o-1"); // never locked
    expect(onUnlock).not.toHaveBeenCalled();
  });
});
