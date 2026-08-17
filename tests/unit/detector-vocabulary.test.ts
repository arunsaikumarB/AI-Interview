/**
 * R6.2 — the detector model and the label sets must not silently diverge.
 *
 * F-DIAG root cause: DEVICE_VISIBLE / DEVICE_INTERACTION were unreachable
 * because the model never emitted a label in PHONE_LABELS. Nothing in the
 * codebase tied PHONE_LABELS / LAPTOP_LABELS to the model actually shipped, so
 * a vocabulary mismatch disabled a whole proctoring signal in total silence.
 *
 * This test reads labels.txt out of the vendored .tflite (MediaPipe appends it
 * as a zip entry) and pins the relationship. It fails loudly if the model asset
 * is swapped, the label sets are edited, or a label stops existing.
 *
 * It deliberately does NOT assert "every label exists": several entries are
 * known-dead today (see DEAD_* below). Removing them is a product change and is
 * out of R6.2 scope — so they are pinned instead, and the test fails if that
 * set changes in either direction.
 *
 *   npx tsx --test tests/unit/detector-vocabulary.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

// npm scripts run from the repo root; tsx transpiles to CJS so import.meta is unavailable.
const REPO = process.cwd();
const MODELS_DIR = join(REPO, "public", "mediapipe", "models");

/** Must match src/lib/secondary-integrity-client.ts and scripts/setup-mediapipe.mjs. */
const EXPECTED_MODEL_FILE = "efficientdet_lite2.tflite";

/** Copies of the sets in src/lib/secondary-integrity-cv.ts. */
const PHONE_LABELS = ["cell phone", "mobile phone", "phone"];
const LAPTOP_LABELS = ["laptop", "tv", "monitor", "computer"];

/**
 * Entries with no counterpart in the model's vocabulary. They are inert: they
 * can never match a detection. Pinned so the situation cannot drift unnoticed.
 */
const DEAD_PHONE_LABELS = ["mobile phone", "phone"];
const DEAD_LAPTOP_LABELS = ["monitor", "computer"];

/** MediaPipe stores labels.txt as a zip entry appended to the .tflite. */
function readModelLabels(file: string): string[] {
  const path = join(MODELS_DIR, file);
  if (!existsSync(path)) return [];
  const out = execFileSync(
    "python",
    [
      "-c",
      [
        "import sys,zipfile",
        "z=zipfile.ZipFile(sys.argv[1])",
        "sys.stdout.write(z.read('labels.txt').decode('utf-8','replace'))",
      ].join("\n"),
      path,
    ],
    { encoding: "utf-8" },
  );
  return out
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
}

const modelPresent = existsSync(join(MODELS_DIR, EXPECTED_MODEL_FILE));
const labels = modelPresent ? readModelLabels(EXPECTED_MODEL_FILE) : [];

describe("R6.2 detector vocabulary validation", () => {
  it("the configured model asset is vendored", () => {
    assert.ok(
      modelPresent,
      `${EXPECTED_MODEL_FILE} missing from public/mediapipe/models — run: npm run setup:mediapipe`,
    );
  });

  it("the model exposes a readable label vocabulary", () => {
    assert.ok(labels.length > 0, "no labels.txt found inside the model");
    assert.equal(labels.length, 90, "expected the COCO-90 vocabulary");
  });

  it("CRITICAL: at least one PHONE_LABELS entry exists, or device detection is dead", () => {
    const live = PHONE_LABELS.filter((l) => labels.includes(l));
    assert.ok(
      live.length > 0,
      `No PHONE_LABELS entry exists in ${EXPECTED_MODEL_FILE}. ` +
        `SECONDARY_DEVICE_VISIBLE and SECONDARY_DEVICE_INTERACTION cannot fire. ` +
        `Model labels sample: ${labels.slice(0, 8).join(", ")}…`,
    );
    assert.deepEqual(live, ["cell phone"], "the live phone label changed");
  });

  it("CRITICAL: at least one LAPTOP_LABELS entry exists, or laptopBaseline never forms", () => {
    const live = LAPTOP_LABELS.filter((l) => labels.includes(l));
    assert.ok(live.length > 0, "no LAPTOP_LABELS entry exists in the model");
    assert.deepEqual(live, ["laptop", "tv"], "the live laptop labels changed");
  });

  it("dead PHONE_LABELS entries are exactly the known set", () => {
    const dead = PHONE_LABELS.filter((l) => !labels.includes(l));
    assert.deepEqual(
      dead,
      DEAD_PHONE_LABELS,
      `PHONE_LABELS dead-entry set changed. Live labels must be re-validated ` +
        `against ${EXPECTED_MODEL_FILE}.`,
    );
  });

  it("dead LAPTOP_LABELS entries are exactly the known set", () => {
    const dead = LAPTOP_LABELS.filter((l) => !labels.includes(l));
    assert.deepEqual(
      dead,
      DEAD_LAPTOP_LABELS,
      `LAPTOP_LABELS dead-entry set changed. Live labels must be re-validated ` +
        `against ${EXPECTED_MODEL_FILE}.`,
    );
  });

  it("REGRESSION: the model has no 'tablet' class — tablets cannot trigger a device signal", () => {
    // Documents a known limitation, not a defect to fix here. In Run F the
    // tablet was classified 'book' (0.408) and correctly ignored.
    assert.equal(labels.includes("tablet"), false);
    assert.equal(labels.includes("book"), true);
  });

  it("the runtime and the setup script reference the same model file", () => {
    const client = readFileSync(
      join(REPO, "src", "lib", "secondary-integrity-client.ts"),
      "utf-8",
    );
    const setup = readFileSync(
      join(REPO, "scripts", "setup-mediapipe.mjs"),
      "utf-8",
    );
    assert.ok(
      client.includes(`/mediapipe/models/${EXPECTED_MODEL_FILE}`),
      "secondary-integrity-client.ts does not load the expected model",
    );
    assert.ok(
      setup.includes(EXPECTED_MODEL_FILE),
      "setup-mediapipe.mjs does not vendor the expected model",
    );
    assert.equal(
      client.includes("efficientdet_lite0"),
      false,
      "stale lite0 reference in the runtime",
    );
    assert.equal(
      setup.includes("efficientdet_lite0"),
      false,
      "stale lite0 reference in the setup script",
    );
  });
});
