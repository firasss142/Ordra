import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DexpressStatusTimeline } from "../DexpressStatusTimeline";
import { SLUG_COLOR } from "@/lib/carriers/dexpress/pipeline";

describe("DexpressStatusTimeline — rendering shape", () => {
  it("renders nothing for a null slug (no taxonomy match)", () => {
    const { container } = render(
      <DexpressStatusTimeline currentSlug={null} currentLabel="فى الشركة" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders 5 listitem nodes for any happy-path slug", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
      />,
    );
    const list = screen.getByRole("list", { name: /dexpress timeline/i });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
  });

  it("does not force a direction — inherits from the surrounding locale (RTL panel → RTL flow)", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
      />,
    );
    // The timeline must not set `dir` itself; the parent (panel locale) governs flow.
    expect(
      screen.getByRole("list", { name: /dexpress timeline/i }),
    ).not.toHaveAttribute("dir");
  });
});

describe("DexpressStatusTimeline — node states", () => {
  it("marks every node before the current as past, current as current, later as future", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="OUT_FOR_DELIVERY"
        currentLabel="جارى التوصيل"
      />,
    );
    // We expose data-state on the icon ring so tests + future debugging can
    // inspect lifecycle position without reverse-engineering Tailwind classes.
    const rings = container.querySelectorAll("[data-state]");
    const states = Array.from(rings).map((el) => el.getAttribute("data-state"));
    expect(states).toEqual(["past", "past", "past", "current", "future"]);
  });

  it("only the current node has its label visible", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
      />,
    );
    // The label string should appear exactly once across the whole timeline.
    expect(screen.getAllByText("فى الشركة")).toHaveLength(1);
  });

  it("DELIVERED shows 4 past + 1 current", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="DELIVERED"
        currentLabel="تم التسليم"
      />,
    );
    const states = Array.from(container.querySelectorAll("[data-state]")).map(
      (el) => el.getAttribute("data-state"),
    );
    expect(states).toEqual(["past", "past", "past", "past", "current"]);
  });
});

describe("DexpressStatusTimeline — off-path branching", () => {
  it("RETURNED_AT_COMPANY renders 4 happy-path past + a branch current", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="RETURNED_AT_COMPANY"
        currentLabel="راجع فى الشركة"
      />,
    );
    const rings = container.querySelectorAll("[data-state]");
    expect(rings).toHaveLength(5);
    const last = rings[rings.length - 1];
    expect(last.getAttribute("data-state")).toBe("current");
    expect(last.getAttribute("data-branch")).toBe("true");
    expect(last.getAttribute("data-slug")).toBe("RETURNED_AT_COMPANY");

    // Earlier nodes are NOT branch nodes.
    for (let i = 0; i < 4; i++) {
      expect(rings[i].getAttribute("data-branch")).toBeNull();
    }
  });

  it("AT_CUSTOMER (no happy-path past) shows a single branch node", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="AT_CUSTOMER"
        currentLabel="عند العميل"
      />,
    );
    const rings = container.querySelectorAll("[data-state]");
    expect(rings).toHaveLength(1);
    expect(rings[0].getAttribute("data-branch")).toBe("true");
  });

  it("RECEIPT_REFUSED replaces DELIVERED with the refused branch", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="RECEIPT_REFUSED"
        currentLabel="رفض إستلام"
      />,
    );
    const slugs = Array.from(container.querySelectorAll("[data-slug]")).map(
      (el) => el.getAttribute("data-slug"),
    );
    expect(slugs).not.toContain("DELIVERED");
    expect(slugs[slugs.length - 1]).toBe("RECEIPT_REFUSED");
  });
});

describe("DexpressStatusTimeline — sub-state collapse", () => {
  it("EN_ROUTE_TO_BRANCHES highlights IN_COMPANY as current", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="EN_ROUTE_TO_BRANCHES"
        currentLabel="بالطريق للفروع"
      />,
    );
    const rings = container.querySelectorAll("[data-state]");
    const current = Array.from(rings).find(
      (el) => el.getAttribute("data-state") === "current",
    );
    expect(current?.getAttribute("data-slug")).toBe("IN_COMPANY");
  });
});

describe("DexpressStatusTimeline — tooltips on past/future nodes", () => {
  it("past + future nodes are buttons with an Arabic aria-label; current is NOT a button", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="OUT_FOR_DELIVERY"
        currentLabel="جارى التوصيل"
      />,
    );
    // 4 non-current nodes (3 past + 1 future) become buttons, current does not.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);

    // Their aria-labels are the Arabic taxonomy labels.
    const labels = buttons.map((b) => b.getAttribute("aria-label"));
    expect(labels).toContain("جارى التجهيز"); // BEING_PREPARED
    expect(labels).toContain("فى الشركة"); // IN_COMPANY
    expect(labels).toContain("إلى المندوب"); // SENT_TO_COURIER
    expect(labels).toContain("تم التسليم"); // DELIVERED (future)
    // Current (OUT_FOR_DELIVERY / جارى التوصيل) is not in the button list.
    expect(labels).not.toContain("جارى التوصيل");
  });

  it("tooltip element exists for every past/future node with role=tooltip", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
      />,
    );
    const tooltips = screen.getAllByRole("tooltip");
    // 1 past + 3 future = 4 tooltips, current node has none.
    expect(tooltips).toHaveLength(4);
  });

  it("tooltip carries the Arabic label as text", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
      />,
    );
    const tooltips = screen.getAllByRole("tooltip");
    const texts = tooltips.map((t) => t.textContent?.trim());
    expect(texts).toContain("تم التسليم"); // DELIVERED future
    expect(texts).toContain("جارى التجهيز"); // BEING_PREPARED past
  });

  it("clicking a past/future node toggles aria-expanded (tap to pin tooltip)", async () => {
    const user = userEvent.setup();
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
      />,
    );
    const deliveredButton = screen.getByRole("button", {
      name: "تم التسليم",
    });
    expect(deliveredButton).toHaveAttribute("aria-expanded", "false");

    await user.click(deliveredButton);
    expect(deliveredButton).toHaveAttribute("aria-expanded", "true");

    // Click again → unpin.
    await user.click(deliveredButton);
    expect(deliveredButton).toHaveAttribute("aria-expanded", "false");
  });

  it("Esc dismisses a pinned tooltip", async () => {
    const user = userEvent.setup();
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
      />,
    );
    const deliveredButton = screen.getByRole("button", {
      name: "تم التسليم",
    });
    await user.click(deliveredButton);
    expect(deliveredButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(deliveredButton).toHaveAttribute("aria-expanded", "false");
  });
});

describe("DexpressStatusTimeline — role-conditional manager slug", () => {
  it("agent role: only Arabic label appears under the current node — no SLUG", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
        role="agent"
      />,
    );
    expect(screen.getByText("فى الشركة")).toBeInTheDocument();
    // The slug must NOT appear as inline text on the current node for an agent.
    // (It may still appear inside future-node tooltips? Let's check it doesn't
    // appear as a top-level inline label — querying the text directly is enough
    // because the tooltip-text variants for agents are Arabic-only.)
    expect(screen.queryByText("IN_COMPANY")).not.toBeInTheDocument();
  });

  it("market_manager role: SLUG appears above the Arabic label under the current node", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="OUT_FOR_DELIVERY"
        currentLabel="جارى التوصيل"
        role="market_manager"
      />,
    );
    expect(screen.getByText("OUT_FOR_DELIVERY")).toBeInTheDocument();
    expect(screen.getByText("جارى التوصيل")).toBeInTheDocument();
  });

  it("super_admin role: SLUG also appears", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="DELIVERED"
        currentLabel="تم التسليم"
        role="super_admin"
      />,
    );
    expect(screen.getByText("DELIVERED")).toBeInTheDocument();
  });

  it("manager tooltip text on past/future nodes includes SLUG — Arabic", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
        role="market_manager"
      />,
    );
    // The DELIVERED tooltip should now read "DELIVERED — تم التسليم".
    const button = screen.getByRole("button", {
      name: /DELIVERED — تم التسليم/,
    });
    expect(button).toBeInTheDocument();
  });

  it("agent tooltip stays Arabic-only on past/future nodes", () => {
    render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
        role="agent"
      />,
    );
    // Agent tooltip for DELIVERED should be just "تم التسليم", no SLUG.
    const button = screen.getByRole("button", { name: "تم التسليم" });
    expect(button).toBeInTheDocument();
  });
});

describe("DexpressStatusTimeline — current node per-slug color (inline)", () => {
  // The current node carries the story color as an inline style. The map
  // in pipeline.ts (SLUG_COLOR) is the single source of truth.
  function currentNode(container: HTMLElement) {
    return container.querySelector<HTMLElement>('[data-state="current"]');
  }

  it("DELIVERED current node is green (SLUG_COLOR.DELIVERED)", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="DELIVERED"
        currentLabel="تم التسليم"
      />,
    );
    const cur = currentNode(container);
    // jsdom normalizes #008060 to rgb(0, 128, 96).
    expect(cur?.style.backgroundColor).toBe("rgb(0, 128, 96)");
    // The expected hex is the source of truth in the palette map.
    expect(SLUG_COLOR.DELIVERED).toBe("#008060");
  });

  it("OUT_FOR_DELIVERY current node is purple (SLUG_COLOR.OUT_FOR_DELIVERY)", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="OUT_FOR_DELIVERY"
        currentLabel="جارى التوصيل"
      />,
    );
    expect(currentNode(container)?.style.backgroundColor).toBe(
      "rgb(124, 58, 237)",
    );
    expect(SLUG_COLOR.OUT_FOR_DELIVERY).toBe("#7C3AED");
  });

  it("IN_COMPANY family shares a teal color (sub-states collapse to IN_COMPANY)", () => {
    expect(SLUG_COLOR.IN_COMPANY).toBe("#0D9488");
    expect(SLUG_COLOR.WILL_BE_SENT_TO_BRANCHES).toBe(SLUG_COLOR.IN_COMPANY);
    expect(SLUG_COLOR.EN_ROUTE_TO_BRANCHES).toBe(SLUG_COLOR.IN_COMPANY);
    expect(SLUG_COLOR.ARRIVED_AT_BRANCHES).toBe(SLUG_COLOR.IN_COMPANY);

    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="EN_ROUTE_TO_BRANCHES"
        currentLabel="بالطريق للفروع"
      />,
    );
    // EN_ROUTE_TO_BRANCHES collapses to IN_COMPANY as the current node.
    expect(currentNode(container)?.style.backgroundColor).toBe(
      "rgb(13, 148, 136)",
    );
  });

  it("RECEIPT_REFUSED branch node uses its red", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="RECEIPT_REFUSED"
        currentLabel="رفض إستلام"
      />,
    );
    expect(currentNode(container)?.style.backgroundColor).toBe(
      "rgb(215, 44, 13)",
    );
  });

  it("BEING_PREPARED is indigo, distinct from IN_COMPANY teal", () => {
    expect(SLUG_COLOR.BEING_PREPARED).not.toBe(SLUG_COLOR.IN_COMPANY);
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="BEING_PREPARED"
        currentLabel="جارى التجهيز"
      />,
    );
    expect(currentNode(container)?.style.backgroundColor).toBe(
      "rgb(79, 70, 229)",
    );
  });
});

describe("DexpressStatusTimeline — past nodes are muted gray (validated, done)", () => {
  it("DELIVERED: every past node is filled muted gray, NOT the journey color", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="DELIVERED"
        currentLabel="تم التسليم"
      />,
    );
    const pastNodes = container.querySelectorAll<HTMLElement>('[data-state="past"]');
    expect(pastNodes.length).toBeGreaterThan(0);
    for (const node of Array.from(pastNodes)) {
      // No inline background colour — past nodes use the Tailwind utility classes.
      expect(node.style.backgroundColor).toBe("");
      // The gray look comes from `bg-line` + `text-ink-secondary`.
      expect(node.className).toContain("bg-line");
      expect(node.className).toContain("text-ink-secondary");
    }
  });

  it("OUT_FOR_DELIVERY: past nodes use muted gray, NOT purple", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="OUT_FOR_DELIVERY"
        currentLabel="جارى التوصيل"
      />,
    );
    const pastNodes = container.querySelectorAll<HTMLElement>('[data-state="past"]');
    for (const node of Array.from(pastNodes)) {
      expect(node.style.backgroundColor).toBe("");
      expect(node.className).toContain("bg-line");
    }
  });

  it("future nodes stay outlined neutral gray (border-line-strong, no fill)", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="IN_COMPANY"
        currentLabel="فى الشركة"
      />,
    );
    const futureNodes = container.querySelectorAll<HTMLElement>('[data-state="future"]');
    expect(futureNodes.length).toBe(3);
    for (const node of Array.from(futureNodes)) {
      expect(node.className).toContain("border-line-strong");
      expect(node.className).toContain("bg-surface-card");
      expect(node.style.backgroundColor).toBe("");
    }
  });
});

describe("DexpressStatusTimeline — connector style by segment", () => {
  function getConnectors(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll(".border-t-2"),
    ) as HTMLElement[];
  }

  it("OUT_FOR_DELIVERY: crossed segments are SOLID gray (border-line), current↔future is DASHED gray", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="OUT_FOR_DELIVERY"
        currentLabel="جارى التوصيل"
      />,
    );
    // 5 nodes → 4 connectors. Order:
    // 0: prep→inCompany (past↔past, crossed)
    // 1: inCompany→courier (past↔past, crossed)
    // 2: courier→outForDelivery (past↔current, crossed)
    // 3: outForDelivery→delivered (current↔future, NOT crossed)
    const connectors = getConnectors(container);
    expect(connectors).toHaveLength(4);

    // Crossed segments: solid neutral gray (border-line, no border-dashed).
    for (let i = 0; i < 3; i++) {
      expect(connectors[i].className).toContain("border-line");
      expect(connectors[i].className).not.toContain("border-dashed");
    }
    // Uncrossed: dashed gray.
    expect(connectors[3].className).toContain("border-dashed");
    expect(connectors[3].className).toContain("line-strong");
  });

  it("DELIVERED: every connector is SOLID gray (all crossed) — color stays on the current node only", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="DELIVERED"
        currentLabel="تم التسليم"
      />,
    );
    const connectors = getConnectors(container);
    expect(connectors).toHaveLength(4);
    for (const c of connectors) {
      expect(c.className).toContain("border-line");
      expect(c.className).not.toContain("border-dashed");
      // Connectors are NEVER green — only the current ring carries the color.
      expect(c.style.borderColor).toBe("");
    }
  });

  it("BEING_PREPARED: zero past nodes → every connector is DASHED gray (nothing crossed)", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="BEING_PREPARED"
        currentLabel="جارى التجهيز"
      />,
    );
    const connectors = getConnectors(container);
    expect(connectors).toHaveLength(4);
    for (const c of connectors) {
      expect(c.className).toContain("border-dashed");
      expect(c.className).toContain("line-strong");
    }
  });

  it("RECEIPT_REFUSED: divergence connector into the branch is TINTED with the branch color (red)", () => {
    const { container } = render(
      <DexpressStatusTimeline
        currentSlug="RECEIPT_REFUSED"
        currentLabel="رفض إستلام"
      />,
    );
    const connectors = getConnectors(container);
    expect(connectors).toHaveLength(4);
    // Final connector (index 3) is the one leading into the branch node.
    // Border color is inline so the highlight is the slug's own red.
    expect(connectors[3].style.borderColor).toBe("rgb(215, 44, 13)");
    expect(connectors[3].className).not.toContain("border-dashed");
  });
});
