import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { secondaryCameraNotUsed } from "../../src/lib/secondary-camera-usage";

describe("secondaryCameraNotUsed — report panel neutral state", () => {
  it("completed interview that never paired a device and has no signals is 'not used'", () => {
    assert.equal(
      secondaryCameraNotUsed({ deviceStatus: "NONE", interviewStatus: "COMPLETED", secondaryEventCount: 0 }),
      true,
    );
  });

  it("any stored secondary signal keeps the real signal panel", () => {
    assert.equal(
      secondaryCameraNotUsed({ deviceStatus: "NONE", interviewStatus: "COMPLETED", secondaryEventCount: 1 }),
      false,
    );
  });

  for (const deviceStatus of ["WAITING", "CONNECTED", "DISCONNECTED"]) {
    it(`device status ${deviceStatus} keeps the real signal panel`, () => {
      assert.equal(
        secondaryCameraNotUsed({ deviceStatus, interviewStatus: "COMPLETED", secondaryEventCount: 0 }),
        false,
      );
    });
  }

  for (const interviewStatus of ["IN_PROGRESS", "WAITING"]) {
    it(`live interview (${interviewStatus}) keeps the live panel`, () => {
      assert.equal(
        secondaryCameraNotUsed({ deviceStatus: "NONE", interviewStatus, secondaryEventCount: 0 }),
        false,
      );
    });
  }
});
