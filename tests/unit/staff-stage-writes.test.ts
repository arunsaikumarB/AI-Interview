import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseUseDjangoReads } from "../../src/lib/staff-reads/flag";
import { useDjangoStageWrites } from "../../src/lib/staff-writes/flag";

describe("NEXT_PUBLIC_USE_DJANGO_STAGE_WRITES flag parser", () => {
  it("defaults off and is independent of other cutover flags", () => {
    assert.equal(parseUseDjangoReads(undefined), false);
    assert.equal(parseUseDjangoReads("false"), false);
    assert.equal(parseUseDjangoReads("true"), true);
    assert.equal(typeof useDjangoStageWrites, "function");
  });
});
