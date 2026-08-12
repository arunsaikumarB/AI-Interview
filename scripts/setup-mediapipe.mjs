/**
 * Vendor MediaPipe wasm + face-detector model into /public/mediapipe
 * so the browser never fetches CDN assets at runtime.
 *
 * Usage: node scripts/setup-mediapipe.mjs
 */
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgWasm = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const outDir = join(root, "public", "mediapipe");
const outWasm = join(outDir, "wasm");
const outModels = join(outDir, "models");

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const MODEL_FILE = join(outModels, "blaze_face_short_range.tflite");

if (!existsSync(pkgWasm)) {
  console.error(
    "[setup-mediapipe] Missing @mediapipe/tasks-vision wasm. Run npm install first.",
  );
  process.exit(1);
}

mkdirSync(outWasm, { recursive: true });
mkdirSync(outModels, { recursive: true });

cpSync(pkgWasm, outWasm, { recursive: true });
console.log(`[setup-mediapipe] Copied wasm → public/mediapipe/wasm`);

if (!existsSync(MODEL_FILE)) {
  console.log(`[setup-mediapipe] Downloading face detector model…`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`[setup-mediapipe] Model download failed: ${res.status}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(MODEL_FILE, buf);
  console.log(
    `[setup-mediapipe] Wrote model (${buf.length} bytes) → public/mediapipe/models/`,
  );
} else {
  console.log(`[setup-mediapipe] Model already present — skipped download`);
}

console.log("[setup-mediapipe] Done. Face detector uses /mediapipe/* only.");
