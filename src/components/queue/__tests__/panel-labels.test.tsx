import { describe, test, expect } from "vitest";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

/**
 * Label-level defects found reviewing a real Libya order in the detail panel.
 * These are cheap to assert at the message level and were each visible on screen.
 */
describe("order detail panel — labels", () => {
  test("the add-product string does not carry its own plus sign", () => {
    // The component renders a Plus icon and then the label, so a leading "+"
    // in the string produced "+ + Ajouter un produit" on screen.
    expect(fr.orders.detail.addProduct).not.toMatch(/^\s*\+/);
    expect(ar.orders.detail.addProduct).not.toMatch(/^\s*\+/);
  });

  test("delivery details have their own section name", () => {
    // CustomerCard held Adresse/Ville/Note but reused the "client" title, so the
    // panel showed two sections both headed CLIENT.
    expect(fr.orders.detail.delivery).toBeTruthy();
    expect(ar.orders.detail.delivery).toBeTruthy();
    expect(fr.orders.detail.delivery).not.toBe(fr.orders.detail.client);
    expect(ar.orders.detail.delivery).not.toBe(ar.orders.detail.client);
  });

  test("an empty second phone reads as an action, not a stray label", () => {
    // "Téléphone 2" rendered as bare grey text under the phone, looking like a
    // label for a field that was not there.
    expect(fr.orders.detail.addPhone2).toBeTruthy();
    expect(ar.orders.detail.addPhone2).toBeTruthy();
  });

  test("both locales define every panel key the other does", () => {
    const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
    expect(keys(ar.orders.detail)).toEqual(keys(fr.orders.detail));
  });
});
