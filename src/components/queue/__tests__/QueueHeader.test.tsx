import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  QueueHeader,
  type BucketKey,
  type ClosedSubfilter,
  type EnCoursSubfilter,
  type TentativeSubfilter,
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

const baseClosedCounts: Record<ClosedSubfilter, number> = {
  all: 7,
  uploaded: 2,
  deposit: 0,
  delivered: 0,
  returned: 0,
  cancelled: 0,
  rejected: 3,
};

function renderHeader(overrides: {
  selectedBucket?: BucketKey;
  enCoursSubfilter?: EnCoursSubfilter;
  tentativeSubfilter?: TentativeSubfilter;
  closedSubfilter?: ClosedSubfilter;
  maxAttempts?: number;
  onBucketChange?: (b: BucketKey) => void;
  onEnCoursSubfilterChange?: (s: EnCoursSubfilter) => void;
  onTentativeSubfilterChange?: (s: TentativeSubfilter) => void;
  onClosedSubfilterChange?: (s: ClosedSubfilter) => void;
} = {}) {
  const onBucketChange = overrides.onBucketChange ?? vi.fn();
  const onEnCoursSubfilterChange = overrides.onEnCoursSubfilterChange ?? vi.fn();
  const onTentativeSubfilterChange = overrides.onTentativeSubfilterChange ?? vi.fn();
  const onClosedSubfilterChange = overrides.onClosedSubfilterChange ?? vi.fn();
  render(
    <QueueHeader
      agentName="Ali Trabelsi"
      stats={{ assigned_count: 10, actioned_count: 4, confirmation_rate: 75 }}
      buckets={baseBuckets}
      selectedBucket={overrides.selectedBucket ?? "en_cours"}
      onBucketChange={onBucketChange}
      enCoursSubfilter={overrides.enCoursSubfilter ?? "all"}
      onEnCoursSubfilterChange={onEnCoursSubfilterChange}
      tentativeSubfilter={overrides.tentativeSubfilter ?? "all"}
      onTentativeSubfilterChange={onTentativeSubfilterChange}
      closedSubfilter={overrides.closedSubfilter ?? "all"}
      onClosedSubfilterChange={onClosedSubfilterChange}
      closedCounts={baseClosedCounts}
      maxAttempts={overrides.maxAttempts ?? 3}
    />,
  );
  return {
    onBucketChange,
    onEnCoursSubfilterChange,
    onTentativeSubfilterChange,
    onClosedSubfilterChange,
  };
}

describe("QueueHeader — bucket tabs", () => {
  it("renders four bucket tabs (Nouveau, En cours, Confirmé, Fermées)", () => {
    renderHeader();
    expect(screen.getByRole("tab", { name: /Nouveau/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /En cours/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Confirmé/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Fermées/ })).toBeInTheDocument();
  });

  it("does not render the old 'À rappeler' or 'Planifié' tabs", () => {
    renderHeader();
    expect(screen.queryByRole("tab", { name: /À rappeler/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /^Planifié/ })).not.toBeInTheDocument();
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

  it("'En cours' shows tentative_total + rappel_prevu + livraison_planifiee", () => {
    renderHeader();
    const tab = screen.getByRole("tab", { name: /En cours/ });
    // 9 + 3 + 2 = 14
    expect(tab).toHaveTextContent("14");
  });

  it("calls onBucketChange when a tab is clicked", () => {
    const onBucketChange = vi.fn();
    renderHeader({ onBucketChange });
    fireEvent.click(screen.getByRole("tab", { name: /Confirmé/ }));
    expect(onBucketChange).toHaveBeenCalledWith("confirme");
  });
});

describe("QueueHeader — En cours sub-chips", () => {
  it("no sub-chips when bucket is 'nouveau'", () => {
    renderHeader({ selectedBucket: "nouveau" });
    expect(screen.queryByRole("button", { name: /Rappel/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tentative/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Livraison/ })).not.toBeInTheDocument();
  });

  it("renders Tous, Rappel, Tentative, Livraison chips inside En cours", () => {
    renderHeader({ selectedBucket: "en_cours" });
    expect(screen.getByRole("button", { name: /^Tous/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Rappel/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Tentative/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Livraison/ })).toBeInTheDocument();
  });

  it("active sub-chip gets aria-pressed='true'", () => {
    renderHeader({ selectedBucket: "en_cours", enCoursSubfilter: "rappel" });
    const chip = screen.getByRole("button", { name: /^Rappel/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onEnCoursSubfilterChange with 'rappel' when Rappel clicked", () => {
    const onEnCoursSubfilterChange = vi.fn();
    renderHeader({ selectedBucket: "en_cours", onEnCoursSubfilterChange });
    fireEvent.click(screen.getByRole("button", { name: /^Rappel/ }));
    expect(onEnCoursSubfilterChange).toHaveBeenCalledWith("rappel");
  });

  it("calls onEnCoursSubfilterChange with 'livraison' when Livraison clicked", () => {
    const onEnCoursSubfilterChange = vi.fn();
    renderHeader({ selectedBucket: "en_cours", onEnCoursSubfilterChange });
    fireEvent.click(screen.getByRole("button", { name: /^Livraison/ }));
    expect(onEnCoursSubfilterChange).toHaveBeenCalledWith("livraison");
  });

  it("clicking Tentative chip filters to all attempts (sets en cours subfilter to 'tentative')", () => {
    const onEnCoursSubfilterChange = vi.fn();
    renderHeader({ selectedBucket: "en_cours", onEnCoursSubfilterChange });
    fireEvent.click(screen.getByRole("button", { name: /^Tentative/ }));
    expect(onEnCoursSubfilterChange).toHaveBeenCalledWith("tentative");
  });

  it("Rappel chip count = rappel_prevu", () => {
    renderHeader({ selectedBucket: "en_cours" });
    const chip = screen.getByRole("button", { name: /^Rappel/ });
    expect(chip).toHaveTextContent("3");
  });

  it("Tentative chip count = tentative_total", () => {
    renderHeader({ selectedBucket: "en_cours" });
    const chip = screen.getByRole("button", { name: /^Tentative/ });
    expect(chip).toHaveTextContent("9");
  });

  it("Livraison chip count = livraison_planifiee", () => {
    renderHeader({ selectedBucket: "en_cours" });
    const chip = screen.getByRole("button", { name: /^Livraison/ });
    expect(chip).toHaveTextContent("2");
  });
});

describe("QueueHeader - Fermées sub-chips", () => {
  it("renders the 5 lifecycle bucket chips inside Fermées (uploaded / deposit / delivered / returned / rejected)", () => {
    renderHeader({ selectedBucket: "fermees" });
    expect(screen.getByRole("button", { name: /^Tous/ })).toHaveTextContent("7");
    expect(screen.getByRole("button", { name: /^Téléchargé/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /^En cours/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Livré/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Retourné/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Rejeté/ })).toHaveTextContent("3");
  });

  it("does not render Fermées chips outside the Fermées bucket", () => {
    renderHeader({ selectedBucket: "confirme" });
    expect(screen.queryByRole("button", { name: /^Téléchargé/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Rejeté/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^En cours/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Livré/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Retourné/ })).not.toBeInTheDocument();
  });

  it("active Fermées sub-chip gets aria-pressed='true'", () => {
    renderHeader({ selectedBucket: "fermees", closedSubfilter: "rejected" });
    const chip = screen.getByRole("button", { name: /^Rejeté/ });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onClosedSubfilterChange when closed lifecycle chips are clicked", () => {
    const onClosedSubfilterChange = vi.fn();
    renderHeader({ selectedBucket: "fermees", onClosedSubfilterChange });
    fireEvent.click(screen.getByRole("button", { name: /^Téléchargé/ }));
    fireEvent.click(screen.getByRole("button", { name: /^En cours/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Livré/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Retourné/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Rejeté/ }));
    expect(onClosedSubfilterChange).toHaveBeenNthCalledWith(1, "uploaded");
    expect(onClosedSubfilterChange).toHaveBeenNthCalledWith(2, "deposit");
    expect(onClosedSubfilterChange).toHaveBeenNthCalledWith(3, "delivered");
    expect(onClosedSubfilterChange).toHaveBeenNthCalledWith(4, "returned");
    expect(onClosedSubfilterChange).toHaveBeenNthCalledWith(5, "rejected");
  });
});

describe("QueueHeader — Tentative popover", () => {
  it("does not show T1/T2/T3 options before the Tentative chip is clicked", () => {
    renderHeader({ selectedBucket: "en_cours" });
    expect(screen.queryByRole("menuitem", { name: /Tentative 1/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Tentative 2/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Tentative 3/ })).not.toBeInTheDocument();
  });

  it("clicking Tentative opens a popover with T1, T2, T3 options", () => {
    renderHeader({ selectedBucket: "en_cours" });
    fireEvent.click(screen.getByRole("button", { name: /^Tentative/ }));
    expect(screen.getByRole("menuitem", { name: /Tentative 1/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Tentative 2/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Tentative 3/ })).toBeInTheDocument();
  });

  it("clicking T2 in popover calls onTentativeSubfilterChange with 2", () => {
    const onTentativeSubfilterChange = vi.fn();
    renderHeader({ selectedBucket: "en_cours", onTentativeSubfilterChange });
    fireEvent.click(screen.getByRole("button", { name: /^Tentative/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Tentative 2/ }));
    expect(onTentativeSubfilterChange).toHaveBeenCalledWith(2);
  });

  it("Tentative chip remains open while interacting; second click on chip closes it", () => {
    renderHeader({ selectedBucket: "en_cours" });
    const chip = screen.getByRole("button", { name: /^Tentative/ });
    fireEvent.click(chip);
    expect(screen.getByRole("menuitem", { name: /Tentative 2/ })).toBeInTheDocument();
    fireEvent.click(chip);
    expect(screen.queryByRole("menuitem", { name: /Tentative 2/ })).not.toBeInTheDocument();
  });

  it("when maxAttempts > 3, the third popover item is labeled 'Tentative 3+' (covers attempts 3..max)", () => {
    renderHeader({ selectedBucket: "en_cours", maxAttempts: 5 });
    fireEvent.click(screen.getByRole("button", { name: /^Tentative/ }));
    expect(screen.getByRole("menuitem", { name: /Tentative 3\+/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /^Tentative 3$/ }),
    ).not.toBeInTheDocument();
  });

  it("when maxAttempts <= 3, the third popover item stays as plain 'Tentative 3'", () => {
    renderHeader({ selectedBucket: "en_cours", maxAttempts: 3 });
    fireEvent.click(screen.getByRole("button", { name: /^Tentative/ }));
    expect(screen.getByRole("menuitem", { name: /^Tentative 3$/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /Tentative 3\+/ }),
    ).not.toBeInTheDocument();
  });

  it("active Tentative=3 chip shows '· 3+' badge when maxAttempts > 3", () => {
    renderHeader({
      selectedBucket: "en_cours",
      enCoursSubfilter: "tentative",
      tentativeSubfilter: 3,
      maxAttempts: 5,
    });
    const chip = screen.getByRole("button", { name: /^Tentative/ });
    expect(chip).toHaveTextContent("3+");
  });
});
