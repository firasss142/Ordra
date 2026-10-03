import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The app's root font size is 14px, so every rem-based Tailwind size (h-8, px-4, gap-3,
 * rounded-lg…) renders 12.5 % smaller than the prototype it copies — a 32px calendar day
 * becomes 28px and its activity dot slides under the circle. Prototype
 * voix-du-client-manager-v6 is written in pixels, so the manager screen is too.
 */
const FILES = ["FeedbackWorkspace.tsx", "OverviewBlocks.tsx", "FeedbackTable.tsx", "DateRangeControl.tsx"];
const SIZED = "(?:p|px|py|pt|pb|ps|pe|pl|pr|m|mx|my|mt|mb|ms|me|ml|mr|gap|gap-x|gap-y|h|w|min-h|min-w|max-h|max-w|size|top|bottom|left|right|start|end|inset|space-x|space-y)";
const REM_SPACING = new RegExp(`(?:^|[\\s"'\`:])-?${SIZED}-(?:\\d+(?:\\.5)?)(?=[\\s"'\`])`, "g");
const REM_RADIUS = /(?:^|[\s"'`:])rounded(?:-[setblr]{1,2})?(?:-(?:sm|md|lg|xl|2xl|3xl))?(?=[\s"'`])/g;
const REM_TEXT = /(?:^|[\s"'`:])(?:text|leading)-(?:xs|sm|base|lg|xl|2xl|3xl|\d+)(?=[\s"'`])/g;

describe("manager screen sizes are in pixels, like the prototype", () => {
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(join(__dirname, "..", f), "utf8");
      const hits = [...(src.match(REM_SPACING) ?? []), ...(src.match(REM_RADIUS) ?? []), ...(src.match(REM_TEXT) ?? [])]
        .map((h) => h.trim().replace(/^["'`:]/, ""))
        .filter((h) => !/-0$/.test(h));
      expect(hits).toEqual([]);
    });
  }
});
