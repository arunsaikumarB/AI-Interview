/**
 * F-05 audit evidence — placement and baseline must be durably recorded.
 *
 * Run D could not prove the R1 invariant because
 * `InterviewSession.secondaryPlacementConfirmedAt` is cleared on disconnect
 * (heartbeat/route.ts:71), so after the run there was nothing left to check.
 * These records are append-only TimelineEvents and survive disconnect,
 * reconnect, placement reset and session completion.
 *
 * Evidence only: no detection, threshold or termination behaviour is involved.
 *
 *   npx tsx --test tests/unit/secondary-audit-evidence.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SECONDARY_AUDIT_KIND,
  baselineFollowsPlacement,
  parseBaselineReport,
  secondaryBaselineAuditPayload,
  secondaryPlacementAuditPayload,
} from "../../src/lib/integrity";

const SESSION = "cmsvnuqw9001z10jnuib3l3u0";
const PLACEMENT = new Date("2026-08-16T10:30:26.400Z");
const BASELINE = new Date("2026-08-16T10:30:32.437Z");

describe("F-05 audit — placement payload", () => {
  it("carries the kind, session and an ISO timestamp", () => {
    const p = secondaryPlacementAuditPayload({
      sessionId: SESSION,
      confirmedAt: PLACEMENT,
    });
    assert.equal(p.kind, SECONDARY_AUDIT_KIND.placementConfirmed);
    assert.equal(p.kind, "secondary_placement_confirmed");
    assert.equal(p.sessionId, SESSION);
    assert.equal(p.confirmedAt, "2026-08-16T10:30:26.400Z");
  });

  it("carries the advisory flags every proctoring payload uses", () => {
    const p = secondaryPlacementAuditPayload({
      sessionId: SESSION,
      confirmedAt: PLACEMENT,
    });
    assert.equal(p.advisoryOnly, true);
    assert.equal(p.noAtsStageChange, true);
    assert.equal(p.noAiInput, true);
    assert.equal(p.source, "secondary_camera");
  });
});

describe("F-05 audit — baseline payload", () => {
  it("records the baseline and the placement it belongs to", () => {
    const p = secondaryBaselineAuditPayload({
      sessionId: SESSION,
      capturedAt: BASELINE,
      settled: true,
      placementConfirmedAt: PLACEMENT,
    });
    assert.equal(p.kind, "secondary_baseline_captured");
    assert.equal(p.sessionId, SESSION);
    assert.equal(p.capturedAt, "2026-08-16T10:30:32.437Z");
    assert.equal(p.placementConfirmedAt, "2026-08-16T10:30:26.400Z");
    assert.equal(p.settled, true);
  });

  it("REGRESSION: stamps invariantHeld so the R1 ordering is checkable from the row", () => {
    const good = secondaryBaselineAuditPayload({
      sessionId: SESSION,
      capturedAt: BASELINE,
      settled: true,
      placementConfirmedAt: PLACEMENT,
    });
    assert.equal(good.invariantHeld, true);

    // The Run C failure shape: baseline predates placement.
    const bad = secondaryBaselineAuditPayload({
      sessionId: SESSION,
      capturedAt: new Date("2026-08-16T09:45:38.500Z"),
      settled: false,
      placementConfirmedAt: new Date("2026-08-16T09:46:07.774Z"),
    });
    assert.equal(bad.invariantHeld, false);
  });

  it("an unpaired baseline is recorded, not discarded, and flagged", () => {
    const p = secondaryBaselineAuditPayload({
      sessionId: SESSION,
      capturedAt: BASELINE,
      settled: true,
      placementConfirmedAt: null,
    });
    assert.equal(p.placementConfirmedAt, null);
    assert.equal(p.invariantHeld, false);
  });
});

describe("F-05 audit — invariant helper", () => {
  it("baseline after placement holds", () => {
    assert.equal(baselineFollowsPlacement(BASELINE, PLACEMENT), true);
  });
  it("equal timestamps hold (>=, not >)", () => {
    assert.equal(baselineFollowsPlacement(PLACEMENT, PLACEMENT), true);
  });
  it("baseline before placement fails", () => {
    assert.equal(baselineFollowsPlacement(PLACEMENT, BASELINE), false);
  });
  it("no placement fails", () => {
    assert.equal(baselineFollowsPlacement(BASELINE, null), false);
  });
});

describe("F-05 audit — heartbeat body parsing", () => {
  it("BACKWARD COMPAT: heartbeats without baseline fields are ignored, not errors", () => {
    assert.equal(parseBaselineReport({}), null);
    assert.equal(parseBaselineReport({ disconnect: true }), null);
    assert.equal(parseBaselineReport(undefined), null);
    assert.equal(parseBaselineReport(null), null);
  });

  it("accepts a well-formed report", () => {
    const r = parseBaselineReport({
      baselineCapturedAt: new Date().toISOString(),
      baselineSettled: true,
    });
    assert.ok(r);
    assert.equal(r!.settled, true);
  });

  it("settled defaults to false when absent or not exactly true", () => {
    const iso = new Date().toISOString();
    assert.equal(parseBaselineReport({ baselineCapturedAt: iso })!.settled, false);
    assert.equal(
      parseBaselineReport({ baselineCapturedAt: iso, baselineSettled: "yes" })!.settled,
      false,
    );
  });

  it("rejects malformed timestamps", () => {
    for (const bad of ["", "   ", "not-a-date", "2026-13-45T99:99:99Z", 12345, {}, true]) {
      assert.equal(
        parseBaselineReport({ baselineCapturedAt: bad }),
        null,
        `should reject ${JSON.stringify(bad)}`,
      );
    }
  });

  it("rejects an implausible device clock rather than storing bad evidence", () => {
    const wayOff = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    assert.equal(parseBaselineReport({ baselineCapturedAt: wayOff }), null);
    const longAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    assert.equal(parseBaselineReport({ baselineCapturedAt: longAgo }), null);
  });
});

describe("F-05 audit — reconnect pairing", () => {
  it("each baseline pairs with the most recent preceding placement", () => {
    const p1 = new Date("2026-08-16T10:00:00.000Z");
    const b1 = new Date("2026-08-16T10:00:07.000Z");
    // Phone drops, reconnects, placement re-confirmed.
    const p2 = new Date("2026-08-16T10:05:00.000Z");
    const b2 = new Date("2026-08-16T10:05:08.000Z");

    const first = secondaryBaselineAuditPayload({
      sessionId: SESSION,
      capturedAt: b1,
      settled: true,
      placementConfirmedAt: p1,
    });
    const second = secondaryBaselineAuditPayload({
      sessionId: SESSION,
      capturedAt: b2,
      settled: true,
      placementConfirmedAt: p2,
    });

    assert.equal(first.placementConfirmedAt, p1.toISOString());
    assert.equal(second.placementConfirmedAt, p2.toISOString());
    assert.notEqual(first.capturedAt, second.capturedAt);
    assert.equal(first.invariantHeld, true);
    assert.equal(second.invariantHeld, true);
  });
});
