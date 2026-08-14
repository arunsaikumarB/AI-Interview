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

const MODELS = [
  {
    file: "blaze_face_short_range.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
  },
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
  {
    file: "efficientdet_lite0.tflite",
    url: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
  },
];

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

for (const model of MODELS) {
  const dest = join(outModels, model.file);
  if (existsSync(dest)) {
    console.log(`[setup-mediapipe] ${model.file} already present — skipped`);
    continue;
  }
  console.log(`[setup-mediapipe] Downloading ${model.file}…`);
  const res = await fetch(model.url);
  if (!res.ok) {
    console.error(
      `[setup-mediapipe] ${model.file} download failed: ${res.status}`,
    );
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(
    `[setup-mediapipe] Wrote ${model.file} (${buf.length} bytes)`,
  );
}

console.log("[setup-mediapipe] Done. Models served from /mediapipe/* only.");
