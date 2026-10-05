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
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei", "thinking-orbs"],
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "@napi-rs/canvas"],
    instrumentationHook: true,
    // Loaded from disk at runtime, so file tracing cannot see them: the pdfjs worker
    // (without it the standalone server reads no PDF text), and the OCR child process
    // with its packages (canvas native binary + ICU data, Tesseract, English data).
    outputFileTracingIncludes: {
      "/**/*": [
        "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
        "./scripts/ocr-child.mjs",
        "./node_modules/@napi-rs/**/*",
        "./node_modules/{tesseract.js,tesseract.js-core,bmp-js,idb-keyval,is-url,node-fetch,whatwg-url,tr46,webidl-conversions,regenerator-runtime,wasm-feature-detect,zlibjs}/**/*",
        "./node_modules/@tesseract.js-data/eng/4.0.0_best_int/*",
      ],
    },
  },
  async headers() {
    return [
      { source: "/_next/static/:path*", headers: STATIC_ASSET_SECURITY_HEADERS },
      { source: "/mediapipe/:path*", headers: STATIC_ASSET_SECURITY_HEADERS },
    ];
  },
};

export default nextConfig;
