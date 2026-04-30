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
    ];
  },
};

export default withNextIntl(nextConfig);
