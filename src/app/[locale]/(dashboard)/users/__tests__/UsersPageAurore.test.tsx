import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthUser } from "@/types";
import { installFakeApi, renderAccess } from "@/test/helpers/accessHarness";
import { accessUser, TRIPOLI } from "@/test/helpers/accessUsers";

vi.mock("focus-trap-react", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { UsersPageClient } from "../UsersPageClient";

/**
 * Accès in « Aurore calme » (docs/design-system.md): the page paints its own
 * aurora under `.acx`, opens on crumb + title, and a person's role hue follows
 * them — the selected row and their file wear it.
 */

const ADMIN: AuthUser = { id: "u-super.admin", email: "admin@oms.tn", full_name: "Super Admin", avatar_url: null, role: "super_admin", market_id: null, locale: "fr", direction: "ltr" };
const roqaya = accessUser({ full_name: "roqaya" });
const tarek = accessUser({ full_name: "tarek", role: "warehouse_agent", warehouse_id: TRIPOLI });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 3, 15, 30));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Accès in Aurore", () => {
  it("paints its own ground under .acx and never the old flat page colour", async () => {
    installFakeApi([roqaya, tarek]);
    const { container } = renderAccess(<UsersPageClient user={ADMIN} />);
    await screen.findByText("roqaya");
    const root = container.querySelector(".acx");
    expect(root).not.toBeNull();
    expect(root?.className).not.toMatch(/bg-surface-page|min-h-screen/);
  });

  it("opens on the breadcrumb, then the title", async () => {
    installFakeApi([roqaya]);
    renderAccess(<UsersPageClient user={ADMIN} />);
    const nav = await screen.findByRole("navigation", { name: "Fil d'Ariane" });
    expect(nav).toHaveTextContent(/Équipe\s*\/\s*Accès/);
    expect(screen.getByRole("heading", { level: 1, name: "Accès" })).toBeInTheDocument();
  });

  it("tints the selected row and the open file in the person's role hue", async () => {
    installFakeApi([roqaya, tarek]);
    renderAccess(<UsersPageClient user={ADMIN} />);
    await userEvent.click(await screen.findByRole("button", { name: "Ouvrir la fiche de tarek" }));
    const row = screen.getAllByRole("row").find((r) => within(r).queryByText("tarek"));
    expect(row).toHaveAttribute("data-selected", "true");
    expect(row?.className).toContain("tone-warehouse");
    const file = screen.getByRole("dialog", { name: "tarek" });
    expect(file.className).toContain("acx-drawer");
    expect(file.className).toContain("tone-warehouse");
  });

  it("keeps the no-building alert to six people, the rest one click away", async () => {
    const stranded = Array.from({ length: 8 }, (_, i) => accessUser({ full_name: `wh${i + 1}`, role: "warehouse_agent", warehouse_id: null }));
    installFakeApi(stranded);
    renderAccess(<UsersPageClient user={ADMIN} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("8 agents entrepôt n'ont pas d'entrepôt");
    expect(within(alert).getAllByRole("button", { name: /Affecter/ })).toHaveLength(6);
    const more = within(alert).getByRole("button", { name: "+2 autres" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(within(alert).getAllByRole("button", { name: /Affecter/ })).toHaveLength(8);
    expect(within(alert).queryByRole("button", { name: "+2 autres" })).not.toBeInTheDocument();
  });

  it("draws the loading state in the page's shape, announced once", () => {
    installFakeApi([roqaya]);
    renderAccess(<UsersPageClient user={ADMIN} />);
    const status = screen.getByRole("status", { name: "Chargement des comptes" });
    expect(status.querySelectorAll(".acx-sk-role")).toHaveLength(6);
  });
});

/**
 * The flat 2026-10-03 palette (#15171A ink, #4F555B / #656B72 greys, #ECEEF0 /
 * #F3F4F6 fills) and rem-sized Tailwind classes (root font is 14px) must not
 * creep back: Accès reads its colours from acces.css tokens and sizes in px.
 */
const DIR = join(__dirname, "../../../../../components/admin/access");
const FILES = [
  ...readdirSync(DIR).filter((f) => f.endsWith(".tsx")).map((f) => join(DIR, f)),
  join(__dirname, "../UsersPageClient.tsx"),
];
const OLD_HEX = /#(?:15171A|4F555B|656B72|ECEEF0|F3F4F6|F7F8F9|E3E5E8|F2F3F5|EDEEF1)\b/gi;
const SIZED = "(?:p|px|py|pt|pb|ps|pe|m|mx|my|mt|mb|ms|me|gap|gap-x|gap-y|h|w|min-h|min-w|max-h|max-w|size|top|bottom|start|end|inset)";
const REM = new RegExp(`(?:^|[\\s"'\`:])-?${SIZED}-(?:\\d+(?:\\.5)?)(?=[\\s"'\`])|(?:^|[\\s"'\`:])(?:text|leading)-(?:xs|sm|base|lg|xl|2xl)(?=[\\s"'\`])`, "g");

describe("Accès styles come from acces.css, in px", () => {
  for (const file of FILES) {
    it(file.split("/").pop()!, () => {
      const src = readFileSync(file, "utf8");
      expect(src.match(OLD_HEX) ?? []).toEqual([]);
      expect((src.match(REM) ?? []).map((h) => h.trim()).filter((h) => !/-0$/.test(h))).toEqual([]);
    });
  }
});
