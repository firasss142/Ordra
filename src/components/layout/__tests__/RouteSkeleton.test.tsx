import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { render } from "@testing-library/react";
import { RouteSkeleton } from "../RouteSkeleton";

const GLOBALS = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");

describe("RouteSkeleton", () => {
  it("announces itself as a busy region", () => {
    const { getByRole } = render(<RouteSkeleton />);
    const region = getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
  });

  it("draws the page skeleton: header, tiles, toolbar, list rows", () => {
    const { container } = render(<RouteSkeleton tiles={4} rows={6} />);
    expect(container.querySelector(".rsk-head")).not.toBeNull();
    expect(container.querySelectorAll(".rsk-tiles > .rsk-card")).toHaveLength(4);
    expect(container.querySelector(".rsk-bar")).not.toBeNull();
    expect(container.querySelectorAll(".rsk-list > .rsk-row")).toHaveLength(6);
  });

  it("leaves out what a page does not have", () => {
    const { container } = render(<RouteSkeleton tiles={0} toolbar={false} />);
    expect(container.querySelector(".rsk-tiles")).toBeNull();
    expect(container.querySelector(".rsk-bar")).toBeNull();
  });

  it("draws cards instead of a list for card pages", () => {
    const { container } = render(<RouteSkeleton body="cards" cards={3} />);
    expect(container.querySelector(".rsk-list")).toBeNull();
    expect(container.querySelectorAll(".rsk-cards > .rsk-card")).toHaveLength(3);
  });

  it("paints the plain ground for the pages that have one", () => {
    const { getByRole } = render(<RouteSkeleton ground="plain" />);
    expect(getByRole("status")).toHaveClass("rsk", "rsk-plain");
  });

  // It paints before any feature stylesheet has arrived: every class must live in globals.css.
  it("uses only classes that globals.css defines", () => {
    const { container } = render(<RouteSkeleton tiles={4} ground="plain" />);
    const { container: cards } = render(<RouteSkeleton body="cards" />);
    const classes = new Set(
      [...container.querySelectorAll("*"), ...cards.querySelectorAll("*")].flatMap((el) => [...el.classList]),
    );
    expect(classes.size).toBeGreaterThan(5);
    for (const c of classes) expect(GLOBALS).toContain(`.${c}`);
  });
});
