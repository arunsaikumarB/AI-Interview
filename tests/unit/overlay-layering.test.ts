import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import tailwindConfig from "../../tailwind.config";

const SRC = path.resolve(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
const files = sourceFiles(SRC).map((file) => ({ file: rel(file), text: fs.readFileSync(file, "utf8") }));
const read = (file: string) => files.find((f) => f.file === file)?.text ?? "";

// Full-screen overlays allowed outside the shared primitives, and only because they portal to <body>.
const PORTALED_OVERLAYS = ["components/integrity-ui.tsx"];

describe("overlay layering", () => {
  it("defines the documented z-index scale", () => {
    const zIndex = tailwindConfig.theme?.extend?.zIndex as Record<string, string> | undefined;
    assert.deepEqual(zIndex, { sticky: "30", modal: "50", popover: "60", toast: "100" });
  });

  it("has no hand-rolled full-screen overlays outside components/ui", () => {
    const offenders = files
      .filter(({ file, text }) => !file.startsWith("components/ui/") && /\bfixed\s+inset-0\b/.test(text))
      .map(({ file }) => file)
      .filter((file) => !PORTALED_OVERLAYS.includes(file));
    assert.deepEqual(offenders, [], "Use components/ui/dialog or sheet (Base UI portals) instead");
  });

  it("allowed full-screen overlays portal to document.body", () => {
    for (const file of PORTALED_OVERLAYS) {
      const text = read(file);
      assert.match(text, /createPortal\(/, `${file} must use createPortal`);
      assert.match(text, /document\.body/, `${file} must portal to document.body`);
    }
  });

  it("uses scale tokens instead of raw page-level z-index utilities", () => {
    // Small local values (z-10 inside a card) are fine; page-level layers must use the scale.
    const raw = /(?<![\w-])z-(?:[3-9]\d|\d{3,}|\[[^\]]+\])(?![\w-])/;
    const offenders = files.filter(({ text }) => raw.test(text)).map(({ file }) => file);
    assert.deepEqual(offenders, [], "Use z-sticky / z-modal / z-popover / z-toast");
  });

  it("overlay primitives render through Base UI portals with the right layer", () => {
    for (const [file, layer] of [
      ["components/ui/dialog.tsx", "z-modal"],
      ["components/ui/sheet.tsx", "z-modal"],
      ["components/ui/select.tsx", "z-popover"],
      ["components/ui/dropdown-menu.tsx", "z-popover"],
    ] as const) {
      const text = read(file);
      assert.match(text, /\.Portal\b/, `${file} must render through a Portal`);
      assert.ok(text.includes(layer), `${file} must use ${layer}`);
    }
  });

  it("Compose Email uses the shared portal dialog", () => {
    const text = read("components/compose-email-dialog.tsx");
    assert.match(text, /from "@\/components\/ui\/dialog"/);
    assert.match(text, /<DialogContent\b/);
    assert.doesNotMatch(text, /\bfixed\s+inset-0\b/);
  });
});
