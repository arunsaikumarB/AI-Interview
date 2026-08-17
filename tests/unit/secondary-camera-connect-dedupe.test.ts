/**
 * Secondary camera connect/disconnect must be transition-only.
 *
 * Recruiter UI showed seven "Secondary camera connected" rows in one minute
 * after a single interruption: in-memory lastSignaled was wiped on Next.js
 * reload, then connect/heartbeat/frame/GET all persisted CONNECTED again.
 *
 *   npx tsx --test tests/unit/secondary-camera-connect-dedupe.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collapseConsecutiveSecondaryLinkEvents,
  shouldPersistSecondaryCameraSignal,
} from "../../src/lib/secondary-camera-signals";

describe("shouldPersistSecondaryCameraSignal — CONNECTED", () => {
  it("writes the first connect", () => {
    assert.equal(
      shouldPersistSecondaryCameraSignal({
        next: "CONNECTED",
        lastPersisted: null,
      }),
      true,
    );
  });

  it("does not write another connect while already connected", () => {
    assert.equal(
      shouldPersistSecondaryCameraSignal({
        next: "CONNECTED",
        lastPersisted: "CONNECTED",
      }),
      false,
    );
  });

  it("writes connect after a real disconnect", () => {
    assert.equal(
      shouldPersistSecondaryCameraSignal({
        next: "CONNECTED",
        lastPersisted: "DISCONNECTED",
      }),
      true,
    );
  });
});

describe("shouldPersistSecondaryCameraSignal — DISCONNECTED", () => {
  it("writes disconnect only after a connect", () => {
    assert.equal(
      shouldPersistSecondaryCameraSignal({
        next: "DISCONNECTED",
        lastPersisted: "CONNECTED",
      }),
      true,
    );
  });

  it("does not write disconnect when never connected", () => {
    assert.equal(
      shouldPersistSecondaryCameraSignal({
        next: "DISCONNECTED",
        lastPersisted: null,
      }),
      false,
    );
  });

  it("does not write a second disconnect", () => {
    assert.equal(
      shouldPersistSecondaryCameraSignal({
        next: "DISCONNECTED",
        lastPersisted: "DISCONNECTED",
      }),
      false,
    );
  });
});

describe("shouldPersistSecondaryCameraSignal — poll / HMR storm", () => {
  it("seven CONNECTED polls after one interruption still persist once", () => {
    let last: "CONNECTED" | "DISCONNECTED" | null = "DISCONNECTED";
    let writes = 0;
    for (let i = 0; i < 7; i++) {
      if (
        shouldPersistSecondaryCameraSignal({
          next: "CONNECTED",
          lastPersisted: last,
        })
      ) {
        writes += 1;
        last = "CONNECTED";
      }
    }
    assert.equal(writes, 1);
    assert.equal(last, "CONNECTED");
  });
});

describe("collapseConsecutiveSecondaryLinkEvents", () => {
  it("collapses seven consecutive connected rows to one", () => {
    const events = [
      { id: "d", type: "SECONDARY_CAMERA_DISCONNECTED" },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`,
        type: "SECONDARY_CAMERA_CONNECTED",
      })),
    ];
    const out = collapseConsecutiveSecondaryLinkEvents(events);
    assert.deepEqual(
      out.map((e) => e.type),
      ["SECONDARY_CAMERA_DISCONNECTED", "SECONDARY_CAMERA_CONNECTED"],
    );
    assert.equal(out[1]?.id, "c0");
  });

  it("keeps a real reconnect after a disconnect", () => {
    const out = collapseConsecutiveSecondaryLinkEvents([
      { type: "SECONDARY_CAMERA_CONNECTED" },
      { type: "SECONDARY_CAMERA_DISCONNECTED" },
      { type: "SECONDARY_CAMERA_CONNECTED" },
    ]);
    assert.deepEqual(
      out.map((e) => e.type),
      [
        "SECONDARY_CAMERA_CONNECTED",
        "SECONDARY_CAMERA_DISCONNECTED",
        "SECONDARY_CAMERA_CONNECTED",
      ],
    );
  });

  it("drops duplicate connects even when integrity signals sit between them", () => {
    const out = collapseConsecutiveSecondaryLinkEvents([
      { type: "SECONDARY_CAMERA_CONNECTED" },
      { type: "SECONDARY_NO_FACE" },
      { type: "SECONDARY_CAMERA_CONNECTED" },
      { type: "SECONDARY_PERSON_MOVED" },
      { type: "SECONDARY_CAMERA_CONNECTED" },
    ]);
    assert.deepEqual(
      out.map((e) => e.type),
      [
        "SECONDARY_CAMERA_CONNECTED",
        "SECONDARY_NO_FACE",
        "SECONDARY_PERSON_MOVED",
      ],
    );
  });

  it("does not drop person, device, or attention signals", () => {
    const out = collapseConsecutiveSecondaryLinkEvents([
      { type: "SECONDARY_MULTIPLE_PERSONS" },
      { type: "SECONDARY_DEVICE_VISIBLE" },
      { type: "SECONDARY_ATTENTION_DEVIATION" },
    ]);
    assert.equal(out.length, 3);
  });
});
