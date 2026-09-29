"""
Coding execution: one disposable container per request.

The docker command line is a fixed argument list (no shell, no interpolation of
candidate data). Candidate source and test inputs travel only on stdin.
"""

import json
import secrets
import subprocess
import time

IMAGE = "hireos-code-runner:v1"
LABEL = "hireos.sandbox=1"
LANGUAGES = ("python", "javascript")

HARD = {
    "source_max_bytes": 32 * 1024,
    "max_tests": 20,
    "input_max_bytes": 64 * 1024,
    "per_test_timeout_ms": 5000,
    "memory_mb": 256,
    "max_output_bytes": 64 * 1024,
    "container_stdout_max": 4 * 1024 * 1024,
    "wall_max_s": 60,
}
PIDS_LIMIT = "64"
TMPFS = "/tmp:rw,nosuid,nodev,noexec,size=16m"
OUTCOMES = {"OK", "RUNTIME_ERROR", "TIMEOUT", "OUTPUT_LIMIT", "MEMORY_LIMIT", "PROCESS_LIMIT"}


class BadRequest(Exception):
    pass


def _clamp(value, lo, hi):
    try:
        v = int(value)
    except (TypeError, ValueError):
        raise BadRequest("invalid limit")
    return max(lo, min(hi, v))


def validate(body):
    if not isinstance(body, dict) or set(body) != {"language", "source", "tests", "limits"}:
        raise BadRequest("unexpected fields")
    language = body["language"]
    source = body["source"]
    tests = body["tests"]
    limits = body["limits"]
    if language not in LANGUAGES:
        raise BadRequest("unsupported language")
    if not isinstance(source, str) or not source.strip() or "\x00" in source:
        raise BadRequest("invalid source")
    if len(source.encode("utf-8")) > HARD["source_max_bytes"]:
        raise BadRequest("source too large")
    if not isinstance(tests, list) or not 1 <= len(tests) <= HARD["max_tests"]:
        raise BadRequest("invalid tests")
    clean_tests = []
    for t in tests:
        if not isinstance(t, dict) or set(t) != {"id", "input"}:
            raise BadRequest("invalid test")
        if not isinstance(t["id"], str) or not 1 <= len(t["id"]) <= 32:
            raise BadRequest("invalid test id")
        if not isinstance(t["input"], str) or len(t["input"].encode("utf-8")) > HARD["input_max_bytes"]:
            raise BadRequest("invalid test input")
        clean_tests.append({"id": t["id"], "input": t["input"]})
    if not isinstance(limits, dict):
        raise BadRequest("invalid limits")
    clean_limits = {
        "perTestTimeoutMs": _clamp(limits.get("perTestTimeoutMs"), 100, HARD["per_test_timeout_ms"]),
        "memoryMb": _clamp(limits.get("memoryMb"), 64, HARD["memory_mb"]),
        "maxOutputBytes": _clamp(limits.get("maxOutputBytes"), 1024, HARD["max_output_bytes"]),
    }
    return language, source, clean_tests, clean_limits


def docker_args(name, memory_mb):
    return [
        "docker", "run", "--rm", "-i",
        "--name", name,
        "--label", LABEL,
        "--network", "none",
        "--read-only",
        "--tmpfs", TMPFS,
        "--pids-limit", PIDS_LIMIT,
        "--memory", "%dm" % memory_mb,
        "--memory-swap", "%dm" % memory_mb,
        "--cpus", "1",
        "--ulimit", "nofile=256:256",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--ipc", "none",
        "--hostname", "sandbox",
        "--log-driver", "none",
        "--user", "10001:10001",
        "--workdir", "/tmp",
        IMAGE,
    ]


def force_remove(name):
    try:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=20)
    except Exception:
        pass


def sweep_leftovers():
    """Remove sandbox containers left behind by a crashed runner."""
    try:
        out = subprocess.run(
            ["docker", "ps", "-aq", "--filter", "label=" + LABEL],
            capture_output=True, text=True, timeout=20,
        ).stdout.split()
        for cid in out:
            subprocess.run(["docker", "rm", "-f", cid], capture_output=True, timeout=20)
        return len(out)
    except Exception:
        return -1


def execute(body):
    language, source, tests, limits = validate(body)
    name = "hireos-sbx-" + secrets.token_hex(8)
    nonce = "HIREOS-" + secrets.token_hex(16) + ":"
    payload = json.dumps(
        {"nonce": nonce, "language": language, "source": source, "tests": tests, "limits": limits}
    ).encode("utf-8")
    wall_s = min(
        HARD["wall_max_s"],
        10 + 5 + len(tests) * (limits["perTestTimeoutMs"] / 1000 + 0.5),
    )

    started = time.monotonic()
    proc = None
    try:
        proc = subprocess.Popen(
            docker_args(name, limits["memoryMb"]),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        try:
            out, _err = proc.communicate(input=payload, timeout=wall_s)
        except subprocess.TimeoutExpired:
            subprocess.run(["docker", "kill", name], capture_output=True, timeout=20)
            proc.kill()
            proc.communicate()
            return {"status": "TIMEOUT", "wallMs": int((time.monotonic() - started) * 1000)}
        wall_ms = int((time.monotonic() - started) * 1000)

        if len(out) > HARD["container_stdout_max"]:
            return {"status": "RESOURCE_VIOLATION", "violation": "OUTPUT", "wallMs": wall_ms}

        line = None
        for candidate in out.decode("utf-8", "replace").splitlines():
            if candidate.startswith(nonce):
                line = candidate[len(nonce):]
        if line is None:
            if proc.returncode == 137:
                return {"status": "RESOURCE_VIOLATION", "violation": "MEMORY", "wallMs": wall_ms}
            return {"status": "INFRA_ERROR", "wallMs": wall_ms}

        result = json.loads(line)
        return shape(result, wall_ms)
    except FileNotFoundError:
        return {"status": "INFRA_ERROR", "detail": "docker unavailable"}
    finally:
        if proc is not None and proc.poll() is None:
            proc.kill()
        force_remove(name)


def shape(result, wall_ms):
    status = result.get("status")
    if status == "COMPILE_ERROR":
        return {
            "status": "COMPILE_ERROR",
            "compileError": str(result.get("compileError") or "")[:2000],
            "tests": [],
            "memoryMb": None,
            "wallMs": wall_ms,
        }
    if status != "OK":
        return {"status": "INFRA_ERROR", "wallMs": wall_ms}
    tests = []
    for t in result.get("tests", []):
        outcome = t.get("outcome")
        tests.append({
            "id": str(t.get("id"))[:32],
            "outcome": outcome if outcome in OUTCOMES else "RUNTIME_ERROR",
            "stdout": str(t.get("stdout") or "")[: HARD["max_output_bytes"]],
            "stderrTail": str(t.get("stderrTail") or "")[:1000],
            "runtimeMs": t.get("runtimeMs") if isinstance(t.get("runtimeMs"), int) else None,
        })
    memory = result.get("memoryMb")
    return {
        "status": "OK",
        "compileError": None,
        "tests": tests,
        "memoryMb": memory if isinstance(memory, (int, float)) else None,
        "wallMs": wall_ms,
    }
