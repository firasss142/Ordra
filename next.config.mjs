import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@supabase/supabase-js", "focus-trap-react"],
  },
};

export default withNextIntl(nextConfig);
