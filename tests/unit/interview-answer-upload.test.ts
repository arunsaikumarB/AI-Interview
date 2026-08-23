import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postFormDataWithUploadLifecycle } from "../../src/lib/interview-answer-upload";

describe("postFormDataWithUploadLifecycle", () => {
  it("signals upload complete before resolving the response", async () => {
    const order: string[] = [];

    const OriginalXHR = globalThis.XMLHttpRequest;
    class FakeXHR {
      upload = {
        addEventListener: (type: string, fn: () => void) => {
          if (type === "load") {
            queueMicrotask(() => {
              order.push("upload");
              fn();
            });
          }
        },
      };
      response: Record<string, unknown> = { ok: true };
      status = 200;
      responseType = "";
      open() {
        /* no-op */
      }
      send() {
        queueMicrotask(() => {
          order.push("response");
          this._load?.();
        });
      }
      addEventListener(type: string, fn: () => void) {
        if (type === "load") this._load = fn;
      }
      _load: (() => void) | null = null;
    }
    // @ts-expect-error test stub
    globalThis.XMLHttpRequest = FakeXHR;

    try {
      const result = await postFormDataWithUploadLifecycle(
        "/api/test",
        new FormData(),
        () => {
          order.push("onUploadComplete");
        },
      );
      assert.equal(result.ok, true);
      assert.ok(order.indexOf("upload") < order.indexOf("response") || order.includes("onUploadComplete"));
      assert.ok(order.includes("onUploadComplete"));
    } finally {
      globalThis.XMLHttpRequest = OriginalXHR;
    }
  });
});
