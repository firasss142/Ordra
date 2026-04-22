import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  QueueHeader,
  type BucketKey,
  type AttemptSubfilter,
  type PlanifieSubfilter,
} from "../QueueHeader";
import type { AgentQueueBuckets } from "@/hooks/useAgentQueue";

vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  const messages = (await import("@/messages/fr.json")).default;
  return {
    useTranslations:
      (ns: string) =>
      (key: string, params?: Record<string, unknown>) =>
        resolveTranslation(messages, ns, key, params),
    useLocale: () => "fr",
  };
});

const baseBuckets: AgentQueueBuckets = {
  nouveau: 2,
  tentative_1: 4,
  tentative_2: 3,
  tentative_3: 2,
  tentative_total: 9,
  rappel_prevu: 3,
  livraison_planifiee: 2,
  confirme: 5,
  rejete: 0,
  fermees: 7,
};

function renderHeader(overrides: {
  selectedBucket?: BucketKey;
  attemptSubfilter?: AttemptSubfilter;
  planifieSubfilter?: PlanifieSubfilter;
  onBucketChange?: (b: BucketKey) => void;
  onAttemptSubfilterChange?: (s: AttemptSubfilter) => void;
  onPlanifieSubfilterChange?: (s: PlanifieSubfilter) => void;
} = {}) {
  const onBucketChange = overrides.onBucketChange ?? vi.fn();
  const onAttemptSubfilterChange = overrides.onAttemptSubfilterChange ?? vi.fn();
  const onPlanifieSubfilterChange = overrides.onPlanifieSubfilterChange ?? vi.fn();
  render(
    <QueueHeader
      agentName="Ali Trabelsi"
      stats={{ assigned_count: 10, actioned_count: 4, confirmation_rate: 75 }}
      buckets={baseBuckets}
      selectedBucket={overrides.selectedBucket ?? "a_rappeler"}
      onBucketChange={onBucketChange}
      attemptSubfilter={overrides.attemptSubfilter ?? "all"}
      onAttemptSubfilterChange={onAttemptSubfilterChange}
      planifieSubfilter={overrides.planifieSubfilter ?? "all"}
      onPlanifieSubfilterChange={onPlanifieSubfilterChange}
    />,
  );
  return {
    onBucketChange,
    onAttemptSubfilterChange,
    onPlanifieSubfilterChange,
  };
}

describe("QueueHeader — bucket tabs", () => {
  it("renders five bucket tabs (Nouveau, À rappeler, Planifié, Confirmé, Fermées)", () => {
    renderHeader();
    expect(screen.getByRole("tab", { name: /Nouveau/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /À rappeler/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Planifié/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Confirmé/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Fermées/ })).toBeInTheDocument();
  });

  it("does not render a 'Tous' tab", () => {
    renderHeader();
    expect(screen.queryByRole("tab", { name: /^Tous$/i })).not.toBeInTheDocument();
  });

  it("marks the selected bucket as aria-selected", () => {
    renderHeader({ selectedBucket: "confirme" });
    const tab = screen.getByRole("tab", { name: /Confirmé/ });
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  it("'À rappeler' shows tentative_total (attempts only)", () => {
    renderHeader();
    const tab = screen.getByRole("tab", { name: /À rappeler/ });
    expect(tab).toHaveTextContent("9");
  });

  it("'Planifié' shows rappel_prevu + livraison_planifiee", () => {
    renderHeader();
    const tab = screen.getByRole("tab", { name: /Planifié/ });
    expect(tab).toHaveTextContent("5");
  });

  it("calls onBucketChange when a tab is clicked", () => {
    const onBucketChange = vi.fn();
    renderHeader({ onBucketChange });
    fireEvent.click(screen.getByRole("tab", { name: /Confirmé/ }));
    expect(onBucketChange).toHaveBeenCalledWith("confirme");
  });
});

describe("QueueHeader — À rappeler sub-chips", () => {
  it("no sub-chips when bucket is 'nouveau'", () => {
    renderHeader({ selectedBucket: "nouveau" });
    expect(
      screen.queryByRole("button", { name: /Tentative 2/ }),
    ).not.toBeInTheDocument();
  });

  it("renders Tous, T1, T2, T3 chips inside À rappeler (no Planifié here)", () => {
    renderHeader({ selectedBucket: "a_rappeler" });
    expect(screen.getByRole("button", { name: /^Tous$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentative 1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentative 2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentative 3/ })).toBeInTheDocument();
    // The Planifié sub-chip lives under the new top-level tab now
    expect(
      screen.queryByRole("button", { name: /^Planifié/ }),
    ).not.toBeInTheDocument();
  });

  it("active sub-chip gets aria-pressed='true'", () => {
    renderHeader({ selectedBucket: "a_rappeler", attemptSubfilter: 2 });
    const chip = screen.getByRole("button", { name: /Tentative 2/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onAttemptSubfilterChange with the number when T2 clicked", () => {
    const onAttemptSubfilterChange = vi.fn();
    renderHeader({ selectedBucket: "a_rappeler", onAttemptSubfilterChange });
    fireEvent.click(screen.getByRole("button", { name: /Tentative 2/ }));
    expect(onAttemptSubfilterChange).toHaveBeenCalledWith(2);
  });
});

describe("QueueHeader — Planifié sub-chips", () => {
  it("renders Tous, Rappel, Livraison sub-chips inside Planifié", () => {
    renderHeader({ selectedBucket: "planifie" });
    expect(screen.getByRole("button", { name: /^Tous/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rappel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Livraison/ })).toBeInTheDocument();
  });

  it("calls onPlanifieSubfilterChange with 'livraison' when Livraison clicked", () => {
    const onPlanifieSubfilterChange = vi.fn();
    renderHeader({
      selectedBucket: "planifie",
      onPlanifieSubfilterChange,
    });
    fireEvent.click(screen.getByRole("button", { name: /Livraison/ }));
    expect(onPlanifieSubfilterChange).toHaveBeenCalledWith("livraison");
  });
});
