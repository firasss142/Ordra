import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { AccessAvatar } from "../parts";

const salima = { full_name: "salima", email: "salima@oms.local", role: "agent" as const, avatar_url: "https://cdn.example/salima-portrait.jpg" };

describe("AccessAvatar", () => {
  /*
   * A portrait photo used to set its own height: the avatar is a grid box and
   * `h-full` inside an auto grid track resolves against the image itself, so a
   * tall picture grew out of the circle (seen on the preview, 2026-10-03, with
   * real profile photos). The photo must fill the frame, never size it.
   */
  it("pins a photo to the circle instead of letting it size the avatar", () => {
    const { container } = render(<AccessAvatar user={salima} />);
    const frame = container.firstElementChild as HTMLElement;
    const img = container.querySelector("img")!;
    const clip = img.parentElement as HTMLElement;
    expect(frame.className).toMatch(/\brelative\b/);
    // The photo sits in an absolutely positioned, round, clipping layer: out of
    // the grid's track sizing, and cut to the circle whatever its proportions.
    for (const c of ["absolute", "inset-0", "overflow-hidden", "rounded-full"]) expect(clip.className).toContain(c);
    for (const c of ["h-full", "w-full", "object-cover"]) expect(img.className).toContain(c);
  });

  it("keeps the presence beat outside the clipped photo, so it is never cut", () => {
    const { container } = render(<AccessAvatar user={salima} presence="online" />);
    const frame = container.firstElementChild as HTMLElement;
    const beat = frame.querySelector("i")!;
    expect(beat.parentElement).toBe(frame);
    expect(frame.querySelector("img")!.parentElement).not.toBe(frame);
  });

  it("falls back to the initials when the photo cannot load", () => {
    const { container, getByText } = render(<AccessAvatar user={salima} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(getByText("S")).toBeInTheDocument();
  });
});
