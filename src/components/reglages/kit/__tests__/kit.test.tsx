import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import frMessages from "@/messages/fr.json";

const intl = vi.hoisted(() => ({ messages: {} as Record<string, unknown> }));
vi.mock("next-intl", async () => {
  const { resolveTranslation } = await import("@/test/helpers/mockNextIntl");
  return {
    useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => resolveTranslation(intl.messages, ns, key, params),
    useLocale: () => "fr",
  };
});
const toast = vi.fn();
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ show: toast }) }));
const swr = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("swr", () => ({ default: (key: string | null) => ({ data: key ? swr.data : undefined, isLoading: false, mutate: vi.fn() }) }));

import { Switch } from "../Switch";
import { NumberField } from "../NumberField";
import { SettingRow } from "../SettingRow";
import { OptionCards } from "../OptionCards";
import { SaveBar } from "../SaveBar";
import { HistoryButton } from "../HistoryButton";
import { ReglagesFormProvider, useRegisterSaver } from "../../form-context";

beforeEach(() => {
  intl.messages = frMessages as Record<string, unknown>;
  toast.mockReset();
  swr.data = undefined;
});

describe("Switch", () => {
  it("is a switch that reports its state and flips on click", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Boutique active" />);
    const sw = screen.getByRole("switch", { name: "Boutique active" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    await userEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does nothing when disabled", async () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} label="x" disabled />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("NumberField", () => {
  it("emits numbers as you type, null when empty, and shows its unit", async () => {
    const onChange = vi.fn();
    render(<NumberField value={8} onChange={onChange} unit="appels" label="Nombre maximum d'appels" />);
    const input = screen.getByRole("spinbutton", { name: "Nombre maximum d'appels" });
    expect(screen.getByText("appels")).toBeInTheDocument();
    await userEvent.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
    await userEvent.type(input, "6");
    expect(onChange).toHaveBeenLastCalledWith(6);
  });
});

describe("SettingRow", () => {
  it("shows the label, the help and marks itself changed", () => {
    render(<SettingRow label="Doublon probable" help="Si un client recommande…" control={<span>ctl</span>} dirty />);
    const row = screen.getByTestId("setting-row");
    expect(row).toHaveAttribute("data-dirty", "true");
    expect(screen.getByText("Doublon probable")).toBeInTheDocument();
    expect(screen.getByText("Si un client recommande…")).toBeInTheDocument();
  });
});

describe("OptionCards", () => {
  it("is a radio group; picking an option reports it", async () => {
    const onChange = vi.fn();
    render(
      <OptionCards
        label="Méthode"
        value="manual"
        onChange={onChange}
        options={[
          { value: "manual", label: "Manuelle", description: "Un manager affecte" },
          { value: "round_robin", label: "Tour à tour", description: "À tour de rôle" },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: /Manuelle/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: /Tour à tour/ }));
    expect(onChange).toHaveBeenCalledWith("round_robin");
  });
});

function Dirty({ id, count, save, reset, validate }: { id: string; count: number; save: () => Promise<void>; reset: () => void; validate?: () => string | null }) {
  useRegisterSaver(id, { count, save, reset, validate });
  return null;
}

describe("SaveBar", () => {
  it("stays hidden while nothing changed", () => {
    render(
      <ReglagesFormProvider>
        <SaveBar />
      </ReglagesFormProvider>,
    );
    expect(screen.queryByRole("button", { name: "Enregistrer" })).not.toBeInTheDocument();
  });

  it("counts every change across cards, saves them all and says so", async () => {
    const save1 = vi.fn().mockResolvedValue(undefined);
    const save2 = vi.fn().mockResolvedValue(undefined);
    render(
      <ReglagesFormProvider>
        <SaveBar />
        <Dirty id="a" count={1} save={save1} reset={vi.fn()} />
        <Dirty id="b" count={1} save={save2} reset={vi.fn()} />
      </ReglagesFormProvider>,
    );
    expect(await screen.findByText("2 modifications non enregistrées")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(save1).toHaveBeenCalled());
    expect(save2).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Réglages enregistrés" }));
  });

  it("Annuler throws every change away", async () => {
    const reset = vi.fn();
    render(
      <ReglagesFormProvider>
        <SaveBar />
        <Dirty id="a" count={1} save={vi.fn()} reset={reset} />
      </ReglagesFormProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Annuler" }));
    expect(reset).toHaveBeenCalled();
  });

  it("a failed save keeps the changes and says what happened", async () => {
    const save = vi.fn().mockRejectedValue(new Error("Ce réglage est modifiable par un administrateur seulement."));
    render(
      <ReglagesFormProvider>
        <SaveBar />
        <Dirty id="a" count={1} save={save} reset={vi.fn()} />
      </ReglagesFormProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Ce réglage est modifiable par un administrateur seulement.")).toBeInTheDocument();
    expect(screen.getByText("1 modification non enregistrée")).toBeInTheDocument();
  });
});

describe("SaveBar — a card can veto the save", () => {
  it("runs every card's check first and saves nothing when one refuses", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <ReglagesFormProvider>
        <SaveBar />
        <Dirty id="shares" count={0} save={vi.fn()} reset={vi.fn()} validate={() => "La répartition doit faire exactement 100 %."} />
        <Dirty id="settings" count={1} save={save} reset={vi.fn()} />
      </ReglagesFormProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("La répartition doit faire exactement 100 %.")).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("HistoryButton", () => {
  it("lists real changes only — a format migration is not a change", async () => {
    swr.data = {
      data: [
        { id: "1", old_value: { value: 5 }, new_value: { value: 8 }, changed_at: "2026-05-22T10:00:00Z", users: { full_name: "Super Admin" } },
        { id: "2", old_value: { type: "manual" }, new_value: { value: "manual" }, changed_at: "2026-05-18T10:00:00Z", users: { full_name: "Admin" } },
      ],
    };
    render(<HistoryButton marketId="m" settingKey="max_call_attempts" label="Nombre maximum d'appels" />);
    await userEvent.click(screen.getByRole("button", { name: "Historique des modifications" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Super Admin");
    expect(dialog).toHaveTextContent("5");
    expect(dialog).toHaveTextContent("8");
    expect(dialog).not.toHaveTextContent("Admin manual");
    expect(dialog.querySelectorAll("li")).toHaveLength(1);
  });

  it("says when a setting has never been changed", async () => {
    swr.data = { data: [] };
    render(<HistoryButton marketId="m" settingKey="sla_minutes" label="Délai" />);
    await userEvent.click(screen.getByRole("button", { name: "Historique des modifications" }));
    expect(await screen.findByText("Aucune modification enregistrée : c’est la valeur d’origine.")).toBeInTheDocument();
  });
});

