# UAT FINDING F-05 — Enhanced proctoring terminates legitimate interviews on ordinary candidate movement

**Severity:** **HIGH**
**Status:** Open — root cause identified, **no code changed**
**Date:** 2026-08-16
**Source:** Physical secondary-camera UAT, Run C (real phone, real candidate)
**Related:** [HIREOS_FULL_INTEGRATION_UAT.md](HIREOS_FULL_INTEGRATION_UAT.md) §12, [UAT_ENHANCED_SECONDARY_CAMERA.md](UAT_ENHANCED_SECONDARY_CAMERA.md)

> This document is diagnosis only. No policy, threshold, prompt, schema or architecture was modified. Remediation options in §9 are proposals awaiting approval.

---

## 1. Summary

With Enhanced proctoring active, a legitimate interview was **terminated 44 seconds after it started, before the candidate answered a single question**. No misconduct occurred. The terminating signal was `PERSON_MOVED`, fired three times in 23 seconds because the candidate's normal seated posture did not match a pose baseline captured ~29 seconds earlier **while they were still positioning the phone**.

The behaviour is reproducible and, once the baseline is wrong, **deterministic**: the candidate is compared against an unreachable reference for the rest of the session, so every warning cycle re-fires until the budget is exhausted.

| Run | Placement confirmed | Monitoring armed | Outcome | Duration | Questions answered |
|---|---|---|---|---|---|
| A | yes | yes | **TERMINATED** `secondary_person_missing` | 180 s | partial |
| B | no | **no** (inert) | COMPLETED | 147 s | 3 of 3 |
| C | yes | yes | **TERMINATED** `secondary_person_moved` | **44 s** | **0 of 1** |

**Both sessions where integrity monitoring was actually armed terminated. The only session that completed was the one where monitoring never armed.** That is the core of the finding.

The recording pipeline behaved correctly throughout — Run C's recording assembled, verified (h264 1920×1080 + aac, 42.4 s), passed `proctoring_artifacts`, and `Application.stage` was never touched. The defect is confined to integrity signal generation and the termination budget.

---

## 2. Exact code path

| Step | File | Line | Behaviour |
|---|---|---|---|
| 1 | `src/components/secondary-camera-client.tsx` | `493-543` | `useEffect` creates and starts the monitor. Guard: `if (phoneTerminated \|\| !connected \|\| !camReady \|\| !videoRef.current) return;` — **dependency array is `[phoneTerminated, connected, camReady, code, stopAll]`**. Placement confirmation is *not* a dependency and *not* a guard. |
| 2 | `src/lib/secondary-integrity-client.ts` | `588-591` | `start()` sets `warmupUntil = Date.now() + WARMUP_MS` (6 000 ms). |
| 3 | `src/lib/secondary-integrity-client.ts` | `644-646` | `setInterval(sample, SAMPLE_MS)` — `SAMPLE_MS = 400` (`:61`). |
| 4 | `src/lib/secondary-integrity-client.ts` | `401-412` | While `inWarmup`, each frame with a visible pose pushes a `PoseBaseline` sample and **returns early** (no detection). |
| 5 | `src/lib/secondary-integrity-client.ts` | `414-416` | First frame after warmup: `if (!baseline && poseSamples.length >= 5) baseline = captureBaseline(poseSamples);` — **assigned once, never reassigned anywhere in the file.** |
| 6 | `src/lib/secondary-integrity-cv.ts` | `122-136` | `captureBaseline` = per-field **median** of the warm-up samples. |
| 7 | `src/lib/secondary-integrity-client.ts` | `436-451` | Per frame: `isOutOfPosition(current, baseline)` → hold `PERSON_MOVED_MS` → `post("PERSON_MOVED")`. |
| 8 | `src/lib/secondary-integrity-client.ts` | `261-268` | `post()` gates on `emitEvents()` and a per-kind `EVENT_COOLDOWN_MS` (8 000 ms), then attaches `episodeId: newEpisodeId(kind)`. |
| 9 | `src/lib/secondary-integrity-client.ts` | `72-74` | `newEpisodeId()` = `${kind}-${Date.now()}-${random}` — **a new id on every post**. |
| 10 | `src/components/secondary-camera-client.tsx` | `155-157` | `emitEventsRef.current = Boolean(meta?.placementConfirmed && meta.interviewStatus === "IN_PROGRESS")` — placement gates **emission only**, long after the baseline is frozen. |
| 11 | `src/app/api/interview/secondary/[code]/integrity/route.ts` | `34-` | Receives the signal, delegates to `recordSecondaryIntegrityViolation`. |
| 12 | `src/lib/integrity-server.ts` | `417-441` | Server episode dedup: matches only if `recentMeta.episodeId === params.episodeId` within `episodeCooldownMs * 4` = 6 000 ms. |
| 13 | `src/lib/integrity-server.ts` | `443` | `infoOnly = SECONDARY_INFO_KINDS.has(kind)` — only `PERSON_RETURNED`, `DEVICE_REMOVED`, `PERSON_RETURNED_TO_ONE` are free. |
| 14 | `src/lib/integrity-server.ts` | `533-535` | `nextMoves = fresh.integrityCameraMoveCount + 1; shouldTerminate = nextMoves >= terminateAt;` |
| 15 | `src/lib/integrity-server.ts` | `549-567` | On terminate: session → `TERMINATED`, `endedAt` set, `integrityTerminatedReason` written, advisory `OTHER` timeline event created with `noAtsStageChange: true`. |
| 16 | `src/app/api/interview/[token]/proctoring/secondary/route.ts` | `193-` | `action: "confirm_placement"` verifies status is `CONNECTED` and stamps `secondaryPlacementConfirmedAt`. **It does not signal the phone to recapture the baseline.** |

Verified absent: `grep` for `recapture`, `resetBaseline`, `baseline = null` across the client and monitor returns **no matches**. `resume()` (`:649-662`) clears the per-signal timers (`movedSince`, `missingSince`, `lookingSince`, …) and re-warms for ≤2 500 ms but **deliberately leaves `baseline` intact**.

---

## 3. Thresholds

**Detection geometry** — `src/lib/secondary-integrity-cv.ts:138-149`, all in normalized (0–1) frame coordinates:

```ts
export function isOutOfPosition(current, baseline): boolean {
  const standUp  = baseline.hipY - current.hipY >= 0.16;
  const leftSeat = Math.abs(current.torsoX - baseline.torsoX) >= 0.22 ||
                   Math.abs(current.torsoY - baseline.torsoY) >= 0.20;
  const closer   = current.shoulderSpan - baseline.shoulderSpan >= 0.18;
  return standUp || leftSeat || closer;
}
```

`torsoY` is the midpoint of shoulders and hips; `shoulderSpan` is horizontal shoulder width — a proxy for distance from camera.

**Timing** — `src/lib/secondary-integrity-cv.ts:24-40`:

| Constant | Value | Role |
|---|---|---|
| `WARMUP_MS` | 6 000 ms | Baseline sampling window |
| `SAMPLE_MS` (client `:61`) | 400 ms | ⇒ ~15 samples per baseline |
| `PERSON_MOVED_MS` | 2 000 ms | Hold before `PERSON_MOVED` fires |
| `ATTENTION_MS` | 2 500 ms | Hold before `ATTENTION_DEVIATION` |
| `EVENT_COOLDOWN_MS` | 8 000 ms | Minimum gap between posts **of the same kind** |
| `PERSON_MISSING_MS` | 1 800 ms | Hold before `PERSON_MISSING` |

**Policy** — `src/lib/integrity.ts:38-43`:

```ts
export const SECONDARY_INTEGRITY_POLICY = {
  warningLimit: 3,
  terminateAt: 4,
  episodeCooldownMs: 1500,
} as const;
```

Applies whenever `proctoringMode === "ENHANCED"` and the session is `IN_PROGRESS`. **It is not gated on `integrityMode = STRICT`** — Run C ran with `integrityMode = STANDARD` and still terminated.

---

## 4. Run C event sequence

Session `cmsvmbojl006alds17v489fcx`, candidate Taylor Testcase (TEST fixture), TEXT + ENHANCED + STANDARD.

| Wall clock | Event | Source |
|---|---|---|
| 09:44:23 | `INTERVIEW_SCHEDULED` | timeline |
| 09:44:59 | Proctoring + recording consent recorded | timeline |
| **09:45:32.500** | **First `SECONDARY_CAMERA_CONNECTED`** → `camReady && connected` → `monitor.start()` | ProctoringEvent |
| 09:45:32.5 – 09:45:38.5 | **WARMUP — ~15 pose samples collected while the candidate positions and props the phone** | derived (`WARMUP_MS`) |
| **~09:45:38.5** | **Baseline frozen** (median of setup-posture samples) | derived (`:414`) |
| 09:45:38 – 09:46:07 | Candidate settles into interview posture (**29 s**) — baseline **not** updated | — |
| **09:46:07.774** | `secondaryPlacementConfirmedAt` stamped | InterviewSession |
| 09:46:10.234 | `startedAt` — `emitEvents` becomes true | InterviewSession |
| 09:46:18 | `SECONDARY_ATTENTION_DEVIATION` → count **1** | ProctoringEvent |
| 09:46:32 | `SECONDARY_PERSON_MOVED` → count **2** | ProctoringEvent |
| 09:46:44 | `SECONDARY_PERSON_MOVED` → count **3** | ProctoringEvent |
| 09:46:55 | `SECONDARY_PERSON_MOVED` → count **4** → **TERMINATE** | ProctoringEvent |
| 09:46:54.423 | `endedAt`, `integrityTerminatedReason = secondary_person_moved` | InterviewSession |
| 09:46:54 | Advisory `OTHER` timeline event `integrity_terminated`, `noAtsStageChange: true` | TimelineEvent |

Interview length **44.2 s**. Questions asked **1**, answered **0**.

### Why each event fired

- **The baseline is wrong.** It was captured 09:45:32.5–09:45:38.5, the six seconds immediately after the phone camera came up — precisely when the candidate is holding, angling and propping the device. That posture is leaning forward, arm extended, torso low and close to the lens: high `shoulderSpan`, low `torsoY`, offset `torsoX`.
- **`ATTENTION_DEVIATION` (09:46:18).** `attentionDeviated` needs `|noseX − baseline.noseX| ≥ 0.14` **and** `|noseX − torsoX| ≥ 0.16`. A baseline `noseX` taken while looking down at the phone sits well off the settled head position, so simply facing the laptop satisfies the first term.
- **`PERSON_MOVED` ×3 (09:46:32 / :44 / :55).** Sitting back from the setup lean changes all three discriminants at once — `torsoY` rises, `torsoX` shifts, `shoulderSpan` shrinks. Any one of `≥0.20`, `≥0.22`, `≥0.18` is enough, and they are OR-ed. Normal settled posture is therefore *permanently* "out of position" relative to a setup-time baseline.
- **Why three times and not once.** In `:444-450`:
  ```ts
  if (isOutOfPosition(current, baseline)) {
    if (movedSince == null) movedSince = now;
    if (now - movedSince >= PERSON_MOVED_MS) { movedSince = now + 60_000; await post("PERSON_MOVED"); }
  } else {
    movedSince = null;          // ← any single in-position frame resets the timer
  }
  ```
  The `movedSince = now + 60_000` is intended as a ~60 s suppression, but **the `else` branch defeats it**: one frame back near baseline resets `movedSince` to `null`, so the next deviation starts a fresh 2 s countdown. Re-firing is then limited only by `EVENT_COOLDOWN_MS` (8 s). Observed gaps were **12 s and 11 s** — both clear of the cooldown.
- **The warning loop guarantees escalation.** While a warning popup is open, `isPaused` halts sampling and the server does not consume a chance (`:517-530`). The candidate dismisses it, `resume()` clears `movedSince` and re-warms — **but leaves the bad baseline in place**. The candidate is immediately out of position again. Warn → dismiss → re-fire → warn … until `terminateAt`.

### Termination calculation

```
integrityCameraMoveCount starts at 0
09:46:18  ATTENTION_DEVIATION  nextMoves = 0 + 1 = 1   1 >= 4 ? no  → warning 1 of 3
09:46:32  PERSON_MOVED         nextMoves = 1 + 1 = 2   2 >= 4 ? no  → warning 2 of 3
09:46:44  PERSON_MOVED         nextMoves = 2 + 1 = 3   3 >= 4 ? no  → warning 3 of 3
09:46:55  PERSON_MOVED         nextMoves = 3 + 1 = 4   4 >= 4 ? YES → TERMINATED
                                                        reason = secondaryTerminateReason("PERSON_MOVED")
                                                               = "secondary_person_moved"
```

Elapsed from first signal to termination: **37 seconds**.

---

## 5. Audit questions

**1. How is the placement baseline captured?**
As the per-field **median** of pose samples collected during a fixed 6 000 ms warm-up that begins the moment the phone camera is ready (`secondary-integrity-client.ts:414-416`, `secondary-integrity-cv.ts:122-136`). Fields: `hipY`, `torsoY`, `torsoX`, `shoulderSpan`, `noseX`. At `SAMPLE_MS = 400` that is ~15 samples. It is assigned once and never reassigned.

**2. Does baseline capture occur after the candidate has settled?**
**No.** It completes ~6 s after the camera comes up. In Run C the baseline was frozen at ~09:45:38.5 and placement was confirmed at 09:46:07.8 — a **29-second gap** in which the candidate settled. Placement confirmation is not in the monitor's `useEffect` dependency array and triggers no recapture. This is the primary root cause.

**3. `PERSON_MOVED` threshold and cooldown.**
Fires when any of `standUp ≥ 0.16`, `|Δ torsoX| ≥ 0.22`, `|Δ torsoY| ≥ 0.20`, `Δ shoulderSpan ≥ 0.18` holds for `PERSON_MOVED_MS = 2 000 ms`. Re-post limited by `EVENT_COOLDOWN_MS = 8 000 ms` per kind. The intended 60 s self-suppression is ineffective (see §4).

**4. Is normal post-placement settling incorrectly counted?**
**Yes.** Settling is exactly the transition from setup posture to interview posture, which is the largest posture change in the whole session — and it is measured against the setup posture. Sitting back is not merely counted once: because the baseline is never corrected, the settled posture remains out-of-position indefinitely, so the signal re-fires on every cycle. The signal is also *observationally* wrong: it reports "candidate moved away" when the candidate has moved *into* the correct position.

**5. Should `PERSON_MOVED` consume the same budget as stronger signals?**
It currently does, and it should not. All non-info kinds increment one shared counter, `integrityCameraMoveCount` (`integrity-server.ts:533`). There is no weighting, so a posture shift costs exactly as much as `EXTRA_PERSON` (another human in frame) or `DEVICE_INTERACTION` (reaching for a phone). Only `PERSON_RETURNED`, `DEVICE_REMOVED` and `PERSON_RETURNED_TO_ONE` are free (`integrity.ts:32-36`). A single mis-set baseline can therefore reach a terminal outcome using only the weakest signal class. The field name itself (`integrityCameraMoveCount`) suggests it was originally scoped to camera movement and was later overloaded to carry every secondary signal.

**6. Are consecutive `PERSON_MOVED` events one episode or several?**
**Several — each is fully independent.** Two dedup mechanisms exist and neither collapses them:
- Client: `EVENT_COOLDOWN_MS` 8 s only rate-limits; Run C's gaps were 11–12 s.
- Server: dedup requires an identical `episodeId` within 6 s, but `newEpisodeId()` mints a fresh random id on **every** post (`:72-74`), so the comparison can never match for genuinely repeated behaviour. It guards only against a literal duplicate POST (e.g. a network retry).

There is no notion of a continuing episode — one unbroken condition producing repeated posts is counted as N separate violations.

**7. Is the termination policy appropriate for a hiring interview?**
Not as configured. Concerns, in order of severity:
- Four episodes with no severity weighting is a small budget when the weakest signal can fire repeatedly from one root condition.
- It is not gated on `STRICT`; a `STANDARD` interview terminated.
- The candidate is given no route back: the warning says what to fix, but with a bad baseline the "correct" position is unreachable.
- The consequence is maximal and irreversible mid-interview — the session ends and the candidate cannot resume.
- The stored reason (`secondary_person_moved`) and recruiter label ("Interview ended (candidate not visible on secondary camera)") describe candidate behaviour, so a reviewer reads a tooling fault as a candidate fault. The report is correctly marked `advisory_only` / `not_a_cheating_verdict` and `Application.stage` is untouched — the containment is sound — but the framing still prejudices human review.
- Observed false-positive rate in this UAT: **2 of 2 monitored sessions (100%)**, one before any question was answered.

**8. Can device-visible and second-person signals be reached without ordinary movement consuming the budget?**
Partially, and not reliably in practice.
- `DEVICE_VISIBLE` / `DEVICE_INTERACTION` derive from `unexpectedPhones(dets, laptopBaseline)` (`cv.ts:191`), keyed on the **laptop** box, independent of the pose baseline. In principle they can fire without it.
- `EXTRA_PERSON` / `MULTIPLE_PERSONS` use `extraPersonsInPrimaryZone`, and the zone comes from `primaryZoneFromBaseline(baseline)` (`cv.ts:274-288`) — derived from `baseline.torsoX`, `baseline.torsoY` and `baseline.shoulderSpan`. **A wrong baseline mis-places and mis-sizes the detection zone**, so second-person detection is directly degraded by the same defect.
- Empirically, in Run C the pose detector consumed the entire budget in 37 s and terminated before any object-class signal could fire. Raising a phone into frame inherently moves the torso, so `PERSON_MOVED` tends to win the race against `DEVICE_VISIBLE`.

**Consequence for UAT coverage:** tests #12, #13, #15 and #16 are currently **unreachable through the intended physical choreography**. They are blocked by this finding, not merely unperformed.

---

## 6. Impact

- **Candidate harm.** A real candidate loses their interview through normal settling. Run C ended with 0 of 1 questions answered.
- **Recruiter mis-signal.** The report presents a tooling artefact in candidate-behaviour language.
- **Coverage loss.** Four secondary-camera UAT tests cannot be executed until this is addressed.
- **Enhanced mode is not currently fit for candidate-facing use.** Standard proctoring and the recording pipeline are unaffected.

### What is *not* affected (verified)

| Guarantee | Status |
|---|---|
| `Application.stage` / `status` | **Untouched** — `APPLIED/ACTIVE`, `updatedAt 08:11`, predating all three runs |
| Recording pipeline | Run C assembled, verified h264 1920×1080 + aac, 42.4 s |
| Artifact honesty | `proctoring_artifacts` **9/9 ok, 0 missing** |
| Chunk retention | `chunks_preserved: true` |
| AI isolation | 0 evaluations reference proctoring; report `not_ai_input: true` |
| Advisory framing | `advisory_only`, `not_a_cheating_verdict`, `noAtsStageChange` all set |

---

## 7. Reproduction

1. Create an ENHANCED interview (`integrityMode` may be `STANDARD`).
2. Pair a phone via QR; **hold the phone in your hand while the camera initialises** and keep holding for ≥6 s.
3. Prop the phone, sit back into normal interview posture, wait ~20 s.
4. Confirm placement on the host, start the interview.
5. Sit normally.

Expected under the defect: `PERSON_MOVED` within ~10 s, repeating every ~8–12 s, terminating on the 4th episode in under a minute.

---

## 8. Contributing factors, ranked

| # | Factor | Location | Weight |
|---|---|---|---|
| 1 | Baseline captured at camera-ready, not at placement confirmation | `secondary-camera-client.tsx:493-543` | **Primary** |
| 2 | Baseline never recaptured or adapted for the whole session | `secondary-integrity-client.ts:414-416` | **Primary** |
| 3 | 60 s self-suppression defeated by the `else { movedSince = null }` reset | `secondary-integrity-client.ts:444-450` | High |
| 4 | `episodeId` regenerated per post ⇒ server episode dedup is inert | `secondary-integrity-client.ts:72-74` | High |
| 5 | One shared, unweighted counter for all signal classes | `integrity-server.ts:533` | High |
| 6 | `terminateAt: 4` with no severity weighting | `integrity.ts:38-43` | Medium |
| 7 | Termination not gated on `STRICT` | `integrity-server.ts:414-416` | Medium |
| 8 | Extra-person zone derived from the same suspect baseline | `secondary-integrity-cv.ts:274-288` | Medium |

---

## 9. Recommended remediation options

Not implemented. Presented for approval; R1 and R2 are the minimum viable fix.

### R1 — Capture the baseline at placement confirmation *(primary, smallest change)*
Trigger baseline capture when `placementConfirmed` flips true, not when the camera becomes ready. The host has just asserted the framing is correct and the candidate is seated — the only moment the posture is known-good.
*Change:* add `meta.placementConfirmed` to the monitor's dependency/gating and expose a `captureBaselineNow()` the client calls on that transition.
*Risk:* low. *Addresses:* factors 1, 2, 8.

### R2 — Make a continuing condition one episode
Do not reset `movedSince` on a single in-position frame; require the condition to be *stably* clear (e.g. ≥3 consecutive clear samples, ~1.2 s) before re-arming, and keep one stable `episodeId` for the duration of an unbroken episode so the server's existing dedup engages.
*Risk:* low. *Addresses:* factors 3, 4, 6.

### R3 — Weight signals by severity
Separate the shared counter, or weight it: soft posture signals (`PERSON_MOVED`, `ATTENTION_DEVIATION`) cost less than strong ones (`EXTRA_PERSON`, `DEVICE_INTERACTION`, `DEVICE_VISIBLE`). Consider making soft signals **advisory-only, never terminating** — they are review indicators, which is what the report already calls them.
*Risk:* medium (policy change — needs HR sign-off). *Addresses:* factors 5, 6.

### R4 — Re-baseline after an acknowledged warning
When a candidate acknowledges a posture warning and returns to a stable position, recapture the baseline. Without this, any corrective action is futile.
*Risk:* low–medium (must not let a candidate "walk" the baseline out of frame — bound recapture to a sane region and a maximum number of recaptures).
*Addresses:* factor 2.

### R5 — Gate termination on STRICT, warn-only in STANDARD
Align secondary-camera termination with the browser-integrity path, which already returns early when `mode !== "STRICT"` (`integrity-server.ts:93`). In STANDARD, record signals and warn, never terminate.
*Risk:* low. *Addresses:* factor 7.

### R6 — Neutral operator-facing language for tooling-driven endings
Distinguish "ended by automated environment check" from candidate-behaviour phrasing, and surface the baseline-capture time so a reviewer can judge reliability.
*Risk:* very low.

### R7 — Calibration feedback before start
Show the candidate a live "position OK" indicator derived from the same `isOutOfPosition` check, and refuse to start until it has been continuously OK for a few seconds. Turns an invisible failure into a visible pre-flight.
*Risk:* medium (UX work). Strongest long-term option; pairs well with R1.

**Suggested sequence:** R1 + R2 (root cause and episode accounting) → R5 (contain blast radius) → R3 + R4 (policy, with HR) → R6 → R7.

---

## 10. Tests that should be added

### Unit — `tests/unit/secondary-integrity-cv.test.ts` (extend)
1. Settled posture vs a **setup-time** baseline (leaning, arm extended, larger `shoulderSpan`) must **not** be `isOutOfPosition` once R1 recaptures at placement.
2. Each discriminant at its exact boundary: `standUp` 0.16, `torsoX` 0.22, `torsoY` 0.20, `shoulderSpan` 0.18 — assert just-below does not fire and just-above does.
3. `captureBaseline` median rejects a minority of outlier setup frames.
4. `attentionDeviated` does not fire for a settled head when the baseline `noseX` was captured looking down at the phone.
5. `primaryZoneFromBaseline` produces a sane zone for both a setup-time and a settled baseline; assert the settled zone contains the candidate.

### Unit — new, episode accounting *(currently untested)*
6. One unbroken out-of-position condition spanning 30 s emits **exactly one** episode.
7. A single in-position frame mid-condition does **not** re-arm the counter (R2).
8. `episodeId` is stable for the duration of one episode and changes only between episodes.
9. Genuinely separate episodes (clear for ≥ the stability window, then deviate again) do produce distinct ids.

### Backend — `backend/` or `src/lib/integrity-server.ts` coverage
10. Four soft signals do **not** terminate once weighting lands (R3); four strong signals do.
11. `STANDARD` mode never terminates from secondary signals (R5); `STRICT` does.
12. Server episode dedup actually collapses repeats when `episodeId` is stable.
13. Termination always writes the advisory timeline event with `noAtsStageChange: true` and never mutates `Application.stage` — pin the guarantee that held here.

### Integration / regression
14. **Baseline timing invariant:** assert `baselineCapturedAt >= secondaryPlacementConfirmedAt`. This single assertion would have caught F-05.
15. Simulated-frame harness: a scripted pose sequence (setup → settle → sit still for 3 min) must produce **zero** violations and complete normally.
16. A scripted sequence with a genuine second person entering the primary zone must still produce `MULTIPLE_PERSONS` — proving R1–R3 did not blunt real detection.

---

## 11. Remediation implemented — R1 + R2 + R5 (2026-08-16)

Approved scope only. **R3 (severity weighting) and R4 (auto re-baselining) were NOT implemented.**

| Item | File | Change |
|---|---|---|
| R1 | `src/lib/secondary-integrity-cv.ts` | `isSettled()`, `BASELINE_MIN_SAMPLES`, `BASELINE_SETTLE_TOLERANCE` (0.06), `BASELINE_MAX_WAIT_MS` (15 s) |
| R1 | `src/lib/secondary-integrity-client.ts` | Baseline window opens **only** when `placementConfirmed()` is true; pre-placement samples are discarded; a rolling window must be `isSettled` (or hit the 15 s cap) before capture; `baselineCapturedAt` recorded and exposed |
| R1 | `src/components/secondary-camera-client.tsx` | `placementConfirmedRef` passed to the monitor as `placementConfirmed` |
| R2 | `src/lib/secondary-integrity-cv.ts` | `createEpisodeTracker()` + `SECONDARY_EPISODE_CLEAR_MS` (4 s) |
| R2 | `src/lib/secondary-integrity-client.ts` | `PERSON_MISSING` / `PERSON_MOVED` / `ATTENTION_DEVIATION` now episode-tracked; `post()` accepts a stable `episodeId`; `resume()` resets trackers but deliberately **not** the baseline (that would be R4) |
| R5 | `src/lib/integrity.ts` | `secondaryTerminationEnabled()`, `shouldTerminateSecondary()` |
| R5 | `src/lib/integrity-server.ts` | Termination decision delegated to `shouldTerminateSecondary({ mode, nextCount })` |

### Behaviour before / after

| | Before | After |
|---|---|---|
| Baseline timing | Frozen ~6 s after camera-ready, during phone setup | Only after placement confirmation **and** a settled window |
| Pre-placement samples | Became the permanent baseline | Discarded |
| Invariant | none | `baselineCapturedAt >= placementConfirmedAt` structurally guaranteed |
| One continuous condition | Re-fired every ~8–12 s, one violation each | Reports **once**; flicker cannot re-arm |
| `episodeId` | New random id per post — server dedup inert | One stable id per episode — dedup can match |
| STANDARD + 4 signals | **TERMINATED** | Warns, records, **never terminates** |
| STRICT + 4 signals | TERMINATED | TERMINATED (unchanged) |

### Runtime verification (API-level, no physical device)

Two ENHANCED sessions, full pairing handshake (connect → heartbeat → frame → `confirm_placement`), then 6 × `PERSON_MOVED`:

```
STANDARD  #1 warn1/3 rec=True  IN_PROGRESS viol=1
          #4 warn3/3 rec=True  IN_PROGRESS viol=4   ← previously TERMINATED here
          #6 warn3/3 rec=True  IN_PROGRESS viol=6   6 signals retained for review
STRICT    #4 term=True         TERMINATED  viol=4   ← unchanged
          #5 rec=False         TERMINATED  (further posts correctly rejected)
```

Consent gate re-proven: 12 posts made before placement/recording consent were all rejected with `Secondary camera placement and recording consent required`, and the violation count stayed 0.

### Regression

| Suite | Result |
|---|---|
| Unit (`npm run test:unit`) | **55 pass** (21 new F-05) |
| Isolation (`npm run test:isolation`) | **27 pass** |
| Django (`manage.py test`) | **160 pass** |
| `npx next lint` | **0 errors** |
| `npm run build` | **succeeds** |
| **Total** | **242 tests, 0 failures** |

Preserved and re-verified: `Application.stage` still `APPLIED/ACTIVE` at `updatedAt 08:11` (predating all UAT); signals carry `signalOnly`, `noAutoVerdict`, `noAtsStageChange`, `noAiInput`; the STRICT termination timeline event remains `advisoryOnly: true` / `noAtsStageChange: true`; recording, chunk and Prisma schema code untouched.

---

## 12. Status and next steps

- Physical secondary-camera UAT is **PAUSED** at operator instruction.
- Tests **#12, #13, #15, #16** are **BLOCKED** by this finding.
- Tests **#1–#11, #14, #17–#25** already have real-device evidence (see the final UAT report).
- **No code has been modified.** Awaiting approval of a remediation option before any change and before physical UAT resumes.
