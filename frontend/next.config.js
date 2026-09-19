/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Tree-shake + optimize the two biggest icon/chart imports; each page
    // only pulls the components it actually renders.
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

module.exports = nextConfig;
