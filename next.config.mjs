/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
    instrumentationHook: true,
  },
};

export default nextConfig;
