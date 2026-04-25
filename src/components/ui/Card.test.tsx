import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Card, CardHeader, CardBody } from "./Card";

describe("Card", () => {
  it("renders children inside a card surface", () => {
    render(
      <Card>
        <div>content</div>
      </Card>,
    );
    expect(screen.getByText("content")).toBeDefined();
  });

  it("applies card surface classes", () => {
    const { container } = render(<Card>x</Card>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/bg-surface-card/);
    expect(root.className).toMatch(/border/);
    expect(root.className).toMatch(/rounded-card/);
  });

  it("forwards extra className", () => {
    const { container } = render(<Card className="extra">x</Card>);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/extra/);
  });

  it("renders CardHeader and CardBody children", () => {
    render(
      <Card>
        <CardHeader>Header</CardHeader>
        <CardBody>Body</CardBody>
      </Card>,
    );
    expect(screen.getByText("Header")).toBeDefined();
    expect(screen.getByText("Body")).toBeDefined();
  });

  it("CardHeader has bottom border styling", () => {
    const { container } = render(<CardHeader>H</CardHeader>);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/border-b/);
  });
});
