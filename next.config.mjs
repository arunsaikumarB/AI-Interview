/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei"],
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
    instrumentationHook: true,
  },
};

export default nextConfig;
