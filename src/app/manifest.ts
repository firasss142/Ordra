import type { MetadataRoute } from "next";

/** Installable investor portal (mobile-first). Staff routes are unaffected. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ordra — Portefeuille investisseur",
    short_name: "Ordra",
    description: "Suivi transparent de vos contrats : part, relevés, retraits.",
    start_url: "/investor",
    display: "standalone",
    background_color: "#FAFAF8",
    theme_color: "#FAFAF8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
