import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@supabase/supabase-js", "focus-trap-react"],
  },
  async redirects() {
    return [
      {
        source: "/:locale(fr|ar)/to-ship",
        destination: "/:locale/warehouse/dispatch",
        permanent: true,
      },
      // Suivi transporteur and Tableau livraison were retired on 2026-10-03;
      // Transporteurs replaces both. Not permanent: browsers cache 308s forever.
      {
        source: "/:locale(fr|ar)/in-delivery/:path*",
        destination: "/:locale/carriers",
        permanent: false,
      },
      {
        source: "/:locale(fr|ar)/warehouse/carrier-tracking",
        destination: "/:locale/carriers",
        permanent: false,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
