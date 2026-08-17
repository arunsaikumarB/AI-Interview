import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUseDjangoReads } from "../../src/lib/staff-reads/flag";
import {
  isAcceptedEnqueue,
  isTerminalAsyncStatus,
  normalizeAsyncStatus,
} from "../../src/lib/staff-async/flag";
import { staffAsyncLabel } from "../../src/lib/staff-async/label";

describe("NEXT_PUBLIC_USE_DJANGO_ASYNC flag parser", () => {
  it("defaults off (same parser as reads)", () => {
    assert.equal(parseUseDjangoReads(undefined), false);
    assert.equal(parseUseDjangoReads("true"), true);
  });
});

describe("async status helpers", () => {
  it("normalizes queued variants", () => {
    assert.equal(normalizeAsyncStatus("queued"), "QUEUED");
    assert.equal(normalizeAsyncStatus("already_processing"), "ALREADY_PROCESSING");
    assert.equal(normalizeAsyncStatus("idle"), "IDLE");
  });

  it("accepts enqueue acknowledgements only", () => {
    assert.equal(isAcceptedEnqueue("queued"), true);
    assert.equal(isAcceptedEnqueue("already_processing"), true);
    assert.equal(isAcceptedEnqueue("failed"), false);
    assert.equal(isAcceptedEnqueue(""), false);
  });

  it("stops polling on terminal states", () => {
    assert.equal(isTerminalAsyncStatus("COMPLETED"), true);
    assert.equal(isTerminalAsyncStatus("failed"), true);
    assert.equal(isTerminalAsyncStatus("QUEUED"), false);
  });

  it("maps labels without redesigning copy", () => {
    assert.equal(staffAsyncLabel("QUEUED"), "Queued");
    assert.equal(staffAsyncLabel("PROCESSING"), "Processing");
  });
});
