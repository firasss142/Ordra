"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const t = useTranslations("auth");

  function resolveEmail(input: string): string {
    const trimmed = input.trim().toLowerCase();
    if (trimmed.includes("@")) return trimmed;
    return `${trimmed.replace(/\s+/g, ".")}@oms.local`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: resolveEmail(username),
      password,
    });

    if (authError) {
      setError(t("invalidCredentials"));
      setLoading(false);
      return;
    }

    // Hard navigate to root — middleware will redirect to the correct locale + route
    window.location.href = "/";
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#F6F6F7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: "14px",
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: "0.5rem",
          padding: "2rem",
          width: "100%",
          maxWidth: "400px",
        }}
      >
        <h1
          style={{
            fontSize: "20px",
            fontWeight: 600,
            color: "#1A1A1A",
            marginBottom: "1.5rem",
            marginTop: 0,
          }}
        >
          {t("signIn")}
        </h1>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label
              htmlFor="username"
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: 500,
                color: "#1A1A1A",
                marginBottom: "0.375rem",
              }}
            >
              {t("username")}
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                display: "block",
                width: "100%",
                height: "36px",
                padding: "0 12px",
                border: "1px solid #E1E3E5",
                borderRadius: "0.5rem",
                fontSize: "14px",
                color: "#1A1A1A",
                backgroundColor: "#FFFFFF",
                boxSizing: "border-box",
                outline: "none",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#2C6ECB";
                e.target.style.boxShadow = "0 0 0 2px rgba(44,110,203,0.2)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#E1E3E5";
                e.target.style.boxShadow = "none";
              }}
              placeholder={t("usernamePlaceholder")}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: 500,
                color: "#1A1A1A",
                marginBottom: "0.375rem",
              }}
            >
              {t("password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                display: "block",
                width: "100%",
                height: "36px",
                padding: "0 12px",
                border: "1px solid #E1E3E5",
                borderRadius: "0.5rem",
                fontSize: "14px",
                color: "#1A1A1A",
                backgroundColor: "#FFFFFF",
                boxSizing: "border-box",
                outline: "none",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#2C6ECB";
                e.target.style.boxShadow = "0 0 0 2px rgba(44,110,203,0.2)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#E1E3E5";
                e.target.style.boxShadow = "none";
              }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p
              style={{
                color: "#D72C0D",
                fontSize: "13px",
                marginBottom: "1rem",
                marginTop: 0,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              display: "block",
              width: "100%",
              height: "36px",
              backgroundColor: loading ? "#6D7175" : "#1A1A1A",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "0.5rem",
              fontSize: "14px",
              fontWeight: 500,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? t("signingIn") : t("signIn")}
          </button>
        </form>
      </div>
    </div>
  );
}
