import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TeamSection } from "../TeamSection";
import type { Role } from "@/types";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock SWR
vi.mock("swr", () => ({
  default: vi.fn(),
}));

import useSWR from "swr";

const mockAgents = [
  {
    id: "agent-1",
    full_name: "Alice Dupont",
    phone: "+21699000001",
    email: "alice@example.com",
    is_active: true,
    market_id: "00000000-0000-0000-0000-000000000001",
  },
  {
    id: "agent-2",
    full_name: "Bob Martin",
    phone: "+21699000002",
    email: "bob@example.com",
    is_active: false,
    market_id: "00000000-0000-0000-0000-000000000001",
  },
];

const mockMarkets = [
  { id: "00000000-0000-0000-0000-000000000001", name: "Tunisia", code: "tn" },
  { id: "00000000-0000-0000-0000-000000000002", name: "Libya", code: "ly" },
];

function setupSWR(agents = mockAgents, markets = mockMarkets) {
  (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string | null) => {
    if (key && key.includes("/api/agents")) {
      return { data: { data: agents }, mutate: vi.fn() };
    }
    if (key && key.includes("/api/markets")) {
      return { data: { data: markets }, mutate: vi.fn() };
    }
    return { data: undefined, mutate: vi.fn() };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: {} }),
  });
  setupSWR();
});

describe("TeamSection", () => {
  describe("rendering", () => {
    it("renders agent table with correct columns", () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      expect(screen.getByText("Nom")).toBeInTheDocument();
      expect(screen.getByText("Téléphone")).toBeInTheDocument();
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("Statut")).toBeInTheDocument();
      expect(screen.getByText("Actions")).toBeInTheDocument();
    });

    it("renders agent rows with name, phone, email", () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      expect(screen.getByText("Alice Dupont")).toBeInTheDocument();
      expect(screen.getByText("+21699000001")).toBeInTheDocument();
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    });

    it("renders green dot for active agent", () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      // first data row = Alice (active)
      const aliceRow = rows[1];
      const dot = within(aliceRow).getByText("●");
      expect(dot).toHaveStyle({ color: "#008060" });
    });

    it("renders grey dot for inactive agent", () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const bobRow = rows[2];
      const dot = within(bobRow).getByText("●");
      expect(dot).toHaveStyle({ color: "#6D7175" });
    });

    it("renders Modifier le mot de passe and Désactiver for active agent", () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      expect(within(aliceRow).getByText("Réinitialiser le mot de passe")).toBeInTheDocument();
      expect(within(aliceRow).getByText("Désactiver")).toBeInTheDocument();
    });

    it("renders Réactiver for inactive agent", () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const bobRow = rows[2];
      expect(within(bobRow).getByText("Réactiver")).toBeInTheDocument();
    });

    it("renders Ajouter button", () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      expect(screen.getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
    });

    it("renders market selector for super_admin", () => {
      render(<TeamSection role="super_admin" marketId="00000000-0000-0000-0000-000000000001" />);
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Tunisia" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Libya" })).toBeInTheDocument();
    });

    it("does not render market selector for market_manager", () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    });

    it("renders empty state when no agents", () => {
      (useSWR as ReturnType<typeof vi.fn>).mockImplementation((key: string | null) => {
        if (key && key.includes("/api/agents")) {
          return { data: { data: [] }, mutate: vi.fn() };
        }
        if (key && key.includes("/api/markets")) {
          return { data: { data: mockMarkets }, mutate: vi.fn() };
        }
        return { data: undefined, mutate: vi.fn() };
      });
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      expect(screen.getByText("Aucun agent configuré")).toBeInTheDocument();
    });
  });

  describe("add agent panel", () => {
    it("opens slide-in panel when Ajouter is clicked", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
      expect(screen.getByText("Ajouter un agent")).toBeInTheDocument();
    });

    it("panel contains Prénom et nom, Téléphone, Email, Mot de passe fields", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
      expect(screen.getByLabelText(/Prénom et nom/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Téléphone/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Mot de passe/i)).toBeInTheDocument();
    });

    it("password field is type=password", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
      expect(screen.getByLabelText(/Mot de passe/i)).toHaveAttribute("type", "password");
    });

    it("password field has show/hide toggle", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
      const toggle = screen.getByRole("button", { name: /^(afficher|masquer)$/i });
      expect(toggle).toBeInTheDocument();
    });

    it("clicking show/hide toggle reveals password", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
      const passwordInput = screen.getByLabelText(/Mot de passe/i);
      expect(passwordInput).toHaveAttribute("type", "password");
      const toggle = screen.getByRole("button", { name: /^(afficher|masquer)$/i });
      await userEvent.click(toggle);
      expect(passwordInput).toHaveAttribute("type", "text");
    });

    it("closes panel when Annuler is clicked", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
      await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
      expect(screen.queryByText("Ajouter un agent")).not.toBeInTheDocument();
    });

    it("calls POST /api/agents on valid submit", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
      await userEvent.type(screen.getByLabelText(/Prénom et nom/i), "Jean Test");
      await userEvent.type(screen.getByLabelText(/Téléphone/i), "+21699123456");
      await userEvent.type(screen.getByLabelText(/Email/i), "jean@test.com");
      await userEvent.type(screen.getByLabelText(/Mot de passe/i), "password123");
      fireEvent.submit(screen.getByRole("button", { name: "Enregistrer" }).closest("form")!);
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/agents",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    it("shows inline error when API returns Email déjà utilisé", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Email déjà utilisé" }),
      });
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      await userEvent.click(screen.getByRole("button", { name: "Ajouter" }));
      await userEvent.type(screen.getByLabelText(/Prénom et nom/i), "Jean Test");
      await userEvent.type(screen.getByLabelText(/Email/i), "existing@test.com");
      await userEvent.type(screen.getByLabelText(/Mot de passe/i), "password123");
      fireEvent.submit(screen.getByRole("button", { name: "Enregistrer" }).closest("form")!);
      await waitFor(() => {
        expect(screen.getByText("Email déjà utilisé")).toBeInTheDocument();
        expect(screen.getByText("Ajouter un agent")).toBeInTheDocument(); // panel stays open
      });
    });
  });

  describe("deactivate agent inline confirmation", () => {
    it("shows inline confirmation text on Désactiver click", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Désactiver"));
      expect(
        screen.getByText(/Désactiver Alice Dupont/i)
      ).toBeInTheDocument();
    });

    it("shows Confirmer la désactivation and Annuler buttons in inline confirmation", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Désactiver"));
      expect(screen.getByRole("button", { name: "Confirmer la désactivation" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    });

    it("cancels inline confirmation on Annuler click", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Désactiver"));
      await userEvent.click(screen.getByRole("button", { name: "Annuler" }));
      expect(screen.queryByRole("button", { name: "Confirmer la désactivation" })).not.toBeInTheDocument();
    });

    it("calls PATCH /api/agents/[id] with action deactivate on confirm", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Désactiver"));
      await userEvent.click(screen.getByRole("button", { name: "Confirmer la désactivation" }));
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/agents/agent-1",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ action: "deactivate" }),
          })
        );
      });
    });

    it("shows Agent désactivé. after successful deactivation", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Désactiver"));
      await userEvent.click(screen.getByRole("button", { name: "Confirmer la désactivation" }));
      await waitFor(() => {
        expect(screen.getByText("Agent désactivé.")).toBeInTheDocument();
      });
    });

    it("does NOT show ordersReturned count in any message", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Désactiver"));
      await userEvent.click(screen.getByRole("button", { name: "Confirmer la désactivation" }));
      await waitFor(() => {
        expect(screen.queryByText(/0 order|0 commande/i)).not.toBeInTheDocument();
      });
    });
  });

  describe("reactivate agent", () => {
    it("calls PATCH /api/agents/[id] with action reactivate on Réactiver click", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const bobRow = rows[2];
      await userEvent.click(within(bobRow).getByText("Réactiver"));
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/agents/agent-2",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ action: "reactivate" }),
          })
        );
      });
    });
  });

  describe("reset password inline form", () => {
    it("shows inline password reset form on Réinitialiser le mot de passe click", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Réinitialiser le mot de passe"));
      expect(screen.getByLabelText(/Nouveau mot de passe/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Confirmer le mot de passe/i)).toBeInTheDocument();
    });

    it("shows validation error when passwords do not match", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Réinitialiser le mot de passe"));
      await userEvent.type(screen.getByLabelText(/Nouveau mot de passe/i), "newpass123");
      await userEvent.type(screen.getByLabelText(/Confirmer le mot de passe/i), "differentpass");
      fireEvent.submit(screen.getByRole("button", { name: /Enregistrer/i }).closest("form")!);
      await waitFor(() => {
        expect(screen.getByText(/correspondent pas|ne correspondent|mots de passe/i)).toBeInTheDocument();
      });
    });

    it("shows validation error when password is less than 8 chars", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Réinitialiser le mot de passe"));
      await userEvent.type(screen.getByLabelText(/Nouveau mot de passe/i), "short");
      await userEvent.type(screen.getByLabelText(/Confirmer le mot de passe/i), "short");
      fireEvent.submit(screen.getByRole("button", { name: /Enregistrer/i }).closest("form")!);
      await waitFor(() => {
        expect(screen.getByText(/8 caractères|minimum/i)).toBeInTheDocument();
      });
    });

    it("calls PATCH /api/agents/[id] with action reset_password on valid submit", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Réinitialiser le mot de passe"));
      await userEvent.type(screen.getByLabelText(/Nouveau mot de passe/i), "newpassword123");
      await userEvent.type(screen.getByLabelText(/Confirmer le mot de passe/i), "newpassword123");
      fireEvent.submit(screen.getByRole("button", { name: /Enregistrer/i }).closest("form")!);
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/agents/agent-1",
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ action: "reset_password", new_password: "newpassword123" }),
          })
        );
      });
    });

    it("shows Mot de passe réinitialisé. after success and collapses form", async () => {
      render(<TeamSection role="market_manager" marketId="00000000-0000-0000-0000-000000000001" />);
      const rows = screen.getAllByRole("row");
      const aliceRow = rows[1];
      await userEvent.click(within(aliceRow).getByText("Réinitialiser le mot de passe"));
      await userEvent.type(screen.getByLabelText(/Nouveau mot de passe/i), "newpassword123");
      await userEvent.type(screen.getByLabelText(/Confirmer le mot de passe/i), "newpassword123");
      fireEvent.submit(screen.getByRole("button", { name: /Enregistrer/i }).closest("form")!);
      await waitFor(() => {
        expect(screen.getByText("Mot de passe réinitialisé.")).toBeInTheDocument();
        expect(screen.queryByLabelText(/Nouveau mot de passe/i)).not.toBeInTheDocument();
      });
    });
  });
});
