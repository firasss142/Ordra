import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";
import { CampaignCard } from "../CampaignCard";
import type { CampaignResult } from "@/lib/prospects/console";

/** Prototype: whatsapp-manager-v1.html?screen=campagne (the two .ccard blocks). */
const NOW = Date.parse("2026-09-25T10:00:00Z"); // 12:00 in Tripoli
const base: CampaignResult = { id: "c1", name: "Sérum · clients 60–120 j", offer: "−15 % sur le 50 ml", audience: 412, called: 0, converted: 0, revenue: 0, created_at: "2026-09-25T10:00:00Z", channel: "wa", pool: 0 };
const wa = (over: Partial<NonNullable<CampaignResult["whatsapp"]>>): NonNullable<CampaignResult["whatsapp"]> => ({
  launch_status: "pending_template", language: "ar", template_status: "PENDING", template_name: "ordra_camp_serum_260925", template_rejected_reason: null,
  queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, skipped: 0, ...over,
});

function mount(campaign: CampaignResult, handlers: Partial<Parameters<typeof CampaignCard>[0]> = {}, lang: "fr" | "ar" = "fr") {
  return render(
    <NextIntlClientProvider locale={lang} messages={lang === "fr" ? fr : ar} timeZone="Africa/Tripoli">
      <CampaignCard campaign={campaign} marketCode="ly" locale={lang} now={NOW} tz="Africa/Tripoli"
        onSee={vi.fn()} onLaunch={vi.fn()} onCheckStatus={vi.fn()} onResubmit={vi.fn()} {...handlers} />
    </NextIntlClientProvider>,
  );
}

const cell = (label: string) => within(screen.getByTestId("wa-funnel")).getByText(label).parentElement!;

describe("CampaignCard — sent from the business number", () => {
  it("pending: « Depuis le numéro Ordra », the template « En attente », a draft, a status check, launch disabled", async () => {
    const onCheckStatus = vi.fn();
    mount({ ...base, whatsapp: wa({}) }, { onCheckStatus });
    expect(screen.getByText("Depuis le numéro Ordra")).toBeInTheDocument();
    expect(screen.getByTestId("wa-template-status")).toHaveTextContent("Modèle");
    expect(screen.getByTestId("wa-template-status")).toHaveTextContent("En attente");
    expect(screen.getByTestId("wa-template-status")).not.toHaveTextContent("PENDING");
    expect(screen.getByText("Brouillon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lancer la campagne/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Vérifier le statut/ }));
    expect(onCheckStatus).toHaveBeenCalled();
  });

  it("the funnel is there before launch too, at zero, so the card does not change shape later", () => {
    mount({ ...base, whatsapp: wa({}) });
    for (const label of ["En file", "Envoyés", "Remis", "Lus", "Réponses", "Échecs"]) {
      expect(within(cell(label)).getByText("0")).toBeInTheDocument();
    }
  });

  it("approved and ready: « Approuvé », « Prête à lancer », launch is enabled and fires", async () => {
    const onLaunch = vi.fn();
    mount({ ...base, whatsapp: wa({ launch_status: "ready", template_status: "APPROVED" }) }, { onLaunch });
    expect(screen.getByTestId("wa-template-status")).toHaveTextContent("Approuvé");
    expect(screen.getByText("Prête à lancer")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /Lancer la campagne/ });
    expect(btn).toBeEnabled();
    await userEvent.click(btn);
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("rejected: « Refusé », the reason and « Modifier et resoumettre »", async () => {
    const onResubmit = vi.fn();
    mount({ ...base, whatsapp: wa({ launch_status: "rejected", template_status: "REJECTED", template_rejected_reason: "INVALID_FORMAT — une variable ne peut pas terminer le corps du message." }) }, { onResubmit });
    expect(screen.getByTestId("wa-template-status")).toHaveTextContent("Refusé");
    expect(screen.getByText(/INVALID_FORMAT/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Modifier et resoumettre/ }));
    expect(onResubmit).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("launched: the funnel, and the launched line « Lancée hier 10:00 · 96 prospects · 60/h · 10–20 h »", () => {
    mount({
      ...base, name: "Montre X2 · Benghazi", audience: 96, called: 6,
      whatsapp: wa({
        launch_status: "launched", template_status: "APPROVED", queued: 56, sent: 40, delivered: 37, read: 29, replied: 6, failed: 1,
        launched_at: "2026-09-24T08:00:00Z", rate: 60, window: "10-20",
      }),
    });
    for (const [label, n] of [["En file", "56"], ["Envoyés", "40"], ["Remis", "37"], ["Lus", "29"], ["Réponses", "6"], ["Échecs", "1"]]) {
      expect(within(cell(label)).getByText(n)).toBeInTheDocument();
    }
    expect(screen.getByText("Lancée hier 10:00 · 96 prospects · 60/h · 10–20 h")).toBeInTheDocument();
    expect(screen.getByText("En cours")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lancer la campagne/ })).not.toBeInTheDocument();
  });

  it("messages Meta refused under its marketing cap count as failures and say so", () => {
    mount({ ...base, whatsapp: wa({ launch_status: "launched", template_status: "APPROVED", failed: 1, skipped: 3, skipped_marketing_cap: 2 }) });
    const failures = cell("Échecs");
    expect(within(failures).getByText("3")).toBeInTheDocument();
    expect(failures).toHaveTextContent("· 2 cap marketing");
  });

  it("no marketing-cap note when nothing was capped", () => {
    mount({ ...base, whatsapp: wa({ launch_status: "launched", template_status: "APPROVED", failed: 1 }) });
    expect(cell("Échecs")).not.toHaveTextContent("cap marketing");
  });

  it("an agent-sent campaign shows none of it", () => {
    mount({ ...base, channel: "wa_call" });
    expect(screen.queryByText("Depuis le numéro Ordra")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wa-template-status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("wa-funnel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lancer la campagne/ })).not.toBeInTheDocument();
  });

  it("Arabic: translated statuses and the launched line", () => {
    mount({
      ...base, audience: 96,
      whatsapp: wa({ launch_status: "launched", template_status: "APPROVED", launched_at: "2026-09-24T08:00:00Z", rate: 60, window: "10-20" }),
    }, {}, "ar");
    expect(screen.getByText("من رقم Ordra")).toBeInTheDocument();
    expect(screen.getByTestId("wa-template-status")).toHaveTextContent("معتمد");
    expect(screen.getByText("أُطلقت أمس 10:00 · 96 عميلاً · 60/س · 10–20")).toBeInTheDocument();
  });
});

describe("CampaignCard — a template that never reached Meta", () => {
  it("a failed submission (draft) can be corrected and resubmitted from the card", async () => {
    const onResubmit = vi.fn();
    mount({ ...base, whatsapp: wa({ launch_status: "draft", template_status: null, template_name: null }) }, { onResubmit });
    await userEvent.click(screen.getByRole("button", { name: /Modifier et resoumettre/ }));
    expect(onResubmit).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Lancer la campagne/ })).toBeDisabled();
  });
});
