import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HealthDot } from "./HealthDot";

describe("HealthDot", () => {
  it("renders an accessible label per health state", () => {
    render(<HealthDot health="green" label="Sain" />);
    expect(screen.getByLabelText("Sain")).toBeInTheDocument();
  });

  it("uses success color for green", () => {
    render(<HealthDot health="green" label="OK" />);
    const dot = screen.getByLabelText("OK");
    expect(dot.style.backgroundColor).toBe("rgb(0, 128, 96)");
  });

  it("uses warning color for amber", () => {
    render(<HealthDot health="amber" label="Surveiller" />);
    expect(screen.getByLabelText("Surveiller").style.backgroundColor).toBe("rgb(185, 137, 0)");
  });

  it("uses critical color for red", () => {
    render(<HealthDot health="red" label="Déficitaire" />);
    expect(screen.getByLabelText("Déficitaire").style.backgroundColor).toBe("rgb(215, 44, 13)");
  });
});
