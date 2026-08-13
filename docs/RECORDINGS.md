# Logisoft HireOS — secondary camera recordings

Human-review artifacts only. Never sent to an LLM, never used for AI scoring,
and never used to auto-change hiring stage.

## Where they are stored

Local disk under `STORAGE_ROOT` (default `./storage`):

```
storage/interviews/{sessionId}/secondary-camera/{recordingId}/
  chunk-000000.part
  recording.webm
  meta.json
```

`/storage` is not a public static directory. Playback is only via the
authenticated recruiter API:

`GET /api/interviews/{id}/secondary-recording/file`

## Who can access them

- Same-organization staff who can manage the pipeline (recruiter / HR / hiring manager / super admin)
- Candidates: denied
- Other organizations: denied
- Unauthenticated: denied
- Secondary device: cannot download the finalized file

## Retention

Do not retain recordings indefinitely.

Recommended: delete the interview folder when the application or organization
is removed, or after your local retention window (for example 90 days).

There is no cloud backup. Deleting files under `STORAGE_ROOT` is permanent.
