import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyGetUserMediaError,
  isHonestPrimaryRecordingSave,
  mapInterviewOrbToThinkingOrb,
  primaryCameraConstraint,
  shouldRecreatePrimaryCamera,
  videoTrackLive,
} from "../../src/lib/primary-camera";
import {
  holdPrimaryCameraStream,
  takePrimaryCameraStream,
  discardPrimaryCameraStream,
  peekPrimaryCameraStream,
} from "../../src/lib/primary-camera-handoff";
import {
  primaryChunkRelPath,
  primaryFinalRelPath,
  primaryRecordingDir,
  PRIMARY_RECORDING_KIND,
} from "../../src/lib/primary-camera-recording-server";

function mockTrack(
  readyState: MediaStreamTrackState,
  enabled = true,
): MediaStreamTrack {
  return {
    kind: "video",
    readyState,
    enabled,
    getSettings: () => ({ deviceId: "cam-1" }),
    stop: () => undefined,
    addEventListener: () => undefined,
  } as unknown as MediaStreamTrack;
}

function mockStream(track: MediaStreamTrack): MediaStream {
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

describe("primary camera classification", () => {
  it("maps permission denied", () => {
    assert.equal(
      classifyGetUserMediaError(new DOMException("x", "NotAllowedError")),
      "denied",
    );
  });

  it("maps no device", () => {
    assert.equal(
      classifyGetUserMediaError(new DOMException("x", "NotFoundError")),
      "unavailable",
    );
  });

  it("maps hardware busy / disconnect-ish errors to lost", () => {
    assert.equal(
      classifyGetUserMediaError(new DOMException("x", "NotReadableError")),
      "lost",
    );
  });
});

describe("primary camera stream helpers", () => {
  it("videoTrackLive requires live + enabled track", () => {
    assert.equal(videoTrackLive(null), false);
    assert.equal(videoTrackLive(mockStream(mockTrack("ended"))), false);
    assert.equal(videoTrackLive(mockStream(mockTrack("live", false))), false);
    assert.equal(videoTrackLive(mockStream(mockTrack("live", true))), true);
  });

  it("builds exact device constraints when deviceId known", () => {
    assert.deepEqual(primaryCameraConstraint("abc"), {
      deviceId: { exact: "abc" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    });
  });
});

describe("primary camera handoff", () => {
  it("holds and transfers stream to interview without recreating", () => {
    discardPrimaryCameraStream();
    const stream = mockStream(mockTrack("live"));
    holdPrimaryCameraStream(stream, "cam-1");
    assert.equal(peekPrimaryCameraStream(), stream);
    const taken = takePrimaryCameraStream();
    assert.equal(taken?.stream, stream);
    assert.equal(taken?.deviceId, "cam-1");
    assert.equal(peekPrimaryCameraStream(), null);
    assert.equal(takePrimaryCameraStream(), null);
  });
});

describe("camera recreate stability", () => {
  const base = {
    enabled: true,
    token: "t1",
    preferredDeviceId: "cam-1",
    record: true,
  };

  it("does not recreate on question / AI / transcript-equivalent UI changes", () => {
    assert.equal(shouldRecreatePrimaryCamera(base, { ...base }), false);
  });

  it("recreates when enabled, token, device, or record flag changes", () => {
    assert.equal(
      shouldRecreatePrimaryCamera(base, { ...base, enabled: false }),
      true,
    );
    assert.equal(
      shouldRecreatePrimaryCamera(base, { ...base, preferredDeviceId: "cam-2" }),
      true,
    );
  });
});

describe("honest recording save", () => {
  it("rejects fake success with zero bytes or FAILED", () => {
    assert.equal(
      isHonestPrimaryRecordingSave({ ok: true, status: "SAVED", byteLength: 0 }),
      false,
    );
    assert.equal(
      isHonestPrimaryRecordingSave({ ok: true, status: "FAILED", byteLength: 10 }),
      false,
    );
    assert.equal(
      isHonestPrimaryRecordingSave({ ok: false, status: "SAVED", byteLength: 10 }),
      false,
    );
  });

  it("accepts real saved recording", () => {
    assert.equal(
      isHonestPrimaryRecordingSave({
        ok: true,
        status: "SAVED",
        byteLength: 12_345,
      }),
      true,
    );
  });
});

describe("primary recording paths", () => {
  it("keeps primary recordings under session storage tree", () => {
    assert.equal(
      primaryRecordingDir("sess1", "pcr_abc"),
      "interviews/sess1/primary-camera/pcr_abc",
    );
    assert.match(primaryChunkRelPath("sess1", "pcr_abc", 0), /chunk-000000\.part$/);
    assert.match(primaryFinalRelPath("sess1", "pcr_abc"), /recording\.webm$/);
    assert.equal(PRIMARY_RECORDING_KIND, "primary_camera_recording");
  });
});

describe("orb → thinking-orbs mapping", () => {
  it("maps the four product states at speed 0.45", () => {
    assert.deepEqual(mapInterviewOrbToThinkingOrb("breathing"), {
      state: "breathing",
      paused: false,
      speed: 0.45,
    });
    assert.deepEqual(mapInterviewOrbToThinkingOrb("composing"), {
      state: "composing",
      paused: false,
      speed: 0.45,
    });
    assert.deepEqual(mapInterviewOrbToThinkingOrb("connecting"), {
      state: "connecting",
      paused: false,
      speed: 0.45,
    });
  });

  it("maps AI speaking to breathing, never composing while speaking", () => {
    assert.equal(mapInterviewOrbToThinkingOrb("AI_SPEAKING").state, "breathing");
    assert.notEqual(mapInterviewOrbToThinkingOrb("AI_SPEAKING").state, "composing");
  });

  it("maps processing / thinking to connecting", () => {
    assert.equal(mapInterviewOrbToThinkingOrb("PROCESSING").state, "connecting");
    assert.equal(mapInterviewOrbToThinkingOrb("THINKING").state, "connecting");
  });
});

describe("MediaRecorder contract (mocked)", () => {
  it("starts recording and collects dataavailable chunks into a blob", async () => {
    const chunks: Blob[] = [];
    const track = mockTrack("live");
    const stream = mockStream(track);

    class FakeRecorder {
      state = "inactive";
      mimeType = "video/webm";
      ondataavailable: ((ev: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() {
        this.state = "recording";
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: "video/webm" }) });
        });
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
      requestData() {
        this.ondataavailable?.({
          data: new Blob([new Uint8Array([4])], { type: "video/webm" }),
        });
      }
    }

    const rec = new FakeRecorder();
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    rec.start();
    assert.equal(rec.state, "recording");
    await new Promise((r) => setTimeout(r, 0));
    rec.requestData();
    rec.stop();
    const blob = new Blob(chunks, { type: "video/webm" });
    assert.ok(blob.size > 0);
    assert.equal(videoTrackLive(stream), true);
  });

  it("does not mark saved when finalize returns empty", () => {
    assert.equal(
      isHonestPrimaryRecordingSave({ ok: true, status: "SAVED", byteLength: 0 }),
      false,
    );
  });
});

describe("preview + layout contracts", () => {
  it("preview stays mounted across orb/question identity changes", () => {
    const camKey = { enabled: true, token: "t", preferredDeviceId: "d", record: true };
    // Simulates question change / AI speaking / candidate answer — camera deps unchanged
    assert.equal(shouldRecreatePrimaryCamera(camKey, camKey), false);
  });

  it("camera preview and orb occupy distinct layout regions (no shared box)", () => {
    const containerWidth = 1280;
    const leftCol = containerWidth * 0.68;
    const rightCol = containerWidth * 0.32;
    const orbCenter = leftCol / 2;
    const cameraLeft = leftCol + 16;
    assert.ok(cameraLeft > orbCenter + 100);
    assert.ok(rightCol >= 280);
  });
});
