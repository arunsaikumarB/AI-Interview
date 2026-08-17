/**
 * R-1: middleware owns the per-request headers (the CSP carries a nonce), but
 * its matcher skips anything containing a dot — /_next/static/** and the
 * vendored /mediapipe/** assets. Those still need at least nosniff, so they
 * are covered here. CSP is deliberately not repeated: it would be sent twice.
 */
const STATIC_ASSET_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei"],
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
    instrumentationHook: true,
  },
  async headers() {
    return [
      { source: "/_next/static/:path*", headers: STATIC_ASSET_SECURITY_HEADERS },
      { source: "/mediapipe/:path*", headers: STATIC_ASSET_SECURITY_HEADERS },
    ];
  },
};

export default nextConfig;
