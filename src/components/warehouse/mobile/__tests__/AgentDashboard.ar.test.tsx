import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import arMessages from "@/messages/ar.json";
import { AgentDashboard } from "../AgentDashboard";
import type { WarehouseSummary } from "@/lib/warehouse/summary";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("swr", () => ({ default: () => ({ data: undefined }) }));

const summary = (oldestPrepareHours: number) =>
  ({
    queue: { toPrepare: 7, oldestPrepareHours, returnsInbox: 0, toHandOver: 0 },
    day: { scannedToday: 3, returnsToday: 0 },
    trend: [],
    lowStock: [],
  }) as unknown as WarehouseSummary;

function renderAr(s: WarehouseSummary) {
  return render(
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      <AgentDashboard summary={s} dailyGoal={40} locale="ar" />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

/**
 * The agent's home screen in Arabic. The oldest-parcel age on the
 * Préparation task used to be written with French units ("3 j") inside an
 * otherwise Arabic sentence.
 */
describe("AgentDashboard — Arabic locale", () => {
  it("writes the oldest parcel's age with the Arabic day unit", () => {
    const { container } = renderAr(summary(72));
    expect(container.textContent).toContain("الأقدم 3 ي");
    expect(container.textContent).not.toMatch(/\d+ j\b/);
  });

  it("writes the oldest parcel's age with the Arabic hour unit", () => {
    const { container } = renderAr(summary(5));
    expect(container.textContent).toContain("الأقدم 5 س");
    expect(container.textContent).not.toMatch(/\d+ h\b/);
  });
});
