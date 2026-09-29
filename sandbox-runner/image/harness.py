"""
HireOS code-runner harness. Runs as PID 1 inside a disposable, network-less,
read-only, non-root container. Candidate code only ever runs in child processes.

Protocol: one JSON request on stdin; exactly one line on stdout:
    <nonce><json result>
Candidate programs write to files on the size-limited tmpfs, never to this
process's stdout, and this process is marked non-dumpable so candidate code
(same uid) cannot open /proc/1/fd/* or ptrace it. PID 1 also ignores signals it
has no handler for, so candidate code cannot kill the harness.

Expected outputs never enter the container: the harness returns raw stdout and
the HireOS server compares it with the hidden expectations.
"""

import ctypes
import json
import os
import resource
import signal
import subprocess
import sys
import time

WORK = "/tmp/work"
MAX_REQUEST = 2 * 1024 * 1024
STDERR_TAIL = 1000
CHILD_ENV = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": WORK, "LANG": "C.UTF-8"}


def set_non_dumpable():
    try:
        libc = ctypes.CDLL(None)
        libc.prctl(4, 0, 0, 0, 0)  # PR_SET_DUMPABLE = 4
    except Exception:
        pass


def reap_and_sweep():
    """Kill every process except the harness (catches setsid/daemonized children), then reap."""
    me = os.getpid()
    for entry in os.listdir("/proc"):
        if entry.isdigit() and int(entry) != me:
            try:
                os.kill(int(entry), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid == 0:
            time.sleep(0.01)


def sanitize(text):
    return text.replace(WORK + "/", "").replace(WORK, "")[-STDERR_TAIL:]


def run_limited(cmd, stdin_bytes, timeout_ms, max_output):
    out_path = os.path.join(WORK, "stdout.bin")
    err_path = os.path.join(WORK, "stderr.bin")
    cpu_seconds = int(timeout_ms / 1000) + 1

    def limit_child():
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_output, max_output))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        try:
            with open("/proc/self/oom_score_adj", "w") as f:
                f.write("1000")
        except OSError:
            pass

    timed_out = False
    started = time.monotonic()
    with open(out_path, "wb") as fo, open(err_path, "wb") as fe:
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=fo,
                stderr=fe,
                cwd=WORK,
                env=CHILD_ENV,
                preexec_fn=limit_child,
                start_new_session=True,
                close_fds=True,
            )
        except OSError as exc:
            return {"spawnError": str(exc.__class__.__name__)}
        try:
            proc.communicate(input=stdin_bytes, timeout=timeout_ms / 1000)
        except subprocess.TimeoutExpired:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
            proc.wait()
    elapsed_ms = int((time.monotonic() - started) * 1000)
    reap_and_sweep()

    with open(out_path, "rb") as f:
        stdout = f.read(max_output)
    out_size = os.path.getsize(out_path)
    with open(err_path, "rb") as f:
        stderr = f.read(64 * 1024).decode("utf-8", "replace")
    return {
        "returncode": proc.returncode,
        "timedOut": timed_out,
        "stdout": stdout.decode("utf-8", "replace"),
        "outputLimit": out_size >= max_output,
        "stderr": stderr,
        "runtimeMs": elapsed_ms,
    }


def classify(r):
    if "spawnError" in r:
        return "PROCESS_LIMIT"
    err = r["stderr"]
    # V8 can stall after reporting heap exhaustion; the report is the evidence, not the stall.
    if "heap out of memory" in err or "Reached heap limit" in err:
        return "MEMORY_LIMIT"
    if r["timedOut"]:
        return "TIMEOUT"
    if r["outputLimit"] or r["returncode"] == -signal.SIGXFSZ:
        return "OUTPUT_LIMIT"
    if r["returncode"] == -signal.SIGKILL or "MemoryError" in err:
        return "MEMORY_LIMIT"
    if r["returncode"] != 0:
        if "Resource temporarily unavailable" in err or "EAGAIN" in err:
            return "PROCESS_LIMIT"
        return "RUNTIME_ERROR"
    return "OK"


def emit(nonce, payload):
    sys.stdout.write(nonce + json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main():
    set_non_dumpable()
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    try:
        req = json.loads(raw[:MAX_REQUEST])
        nonce = str(req["nonce"])
        language = req["language"]
        source = req["source"]
        tests = req["tests"]
        limits = req["limits"]
    except Exception:
        sys.stdout.write("BAD_REQUEST\n")
        return
    if len(raw) > MAX_REQUEST or language not in ("python", "javascript"):
        emit(nonce, {"status": "INFRA_ERROR", "detail": "bad request"})
        return

    per_test_ms = int(limits["perTestTimeoutMs"])
    max_output = int(limits["maxOutputBytes"])
    memory_mb = int(limits["memoryMb"])

    os.makedirs(WORK, mode=0o700, exist_ok=True)
    filename = "solution.py" if language == "python" else "solution.js"
    path = os.path.join(WORK, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(source)

    if language == "python":
        check = [
            "python3", "-I", "-S", "-B", "-c",
            "import sys,traceback\n"
            "try:\n"
            "    compile(open(sys.argv[1],encoding='utf-8').read(),'solution.py','exec')\n"
            "except Exception as e:\n"
            "    sys.stderr.write(''.join(traceback.format_exception_only(type(e),e)))\n"
            "    sys.exit(1)\n",
            path,
        ]
        run = ["python3", "-I", "-S", "-B", path]
    else:
        check = ["node", "--check", path]
        run = ["node", "--max-old-space-size=%d" % max(32, memory_mb - 64), path]

    compiled = run_limited(check, b"", 5000, max_output)
    if compiled.get("timedOut") or compiled.get("returncode", 1) != 0:
        emit(nonce, {
            "status": "COMPILE_ERROR",
            "compileError": sanitize(compiled.get("stderr", "") or "Compilation failed"),
            "tests": [],
            "memoryMb": None,
        })
        return

    results = []
    for test in tests:
        r = run_limited(run, str(test["input"]).encode("utf-8"), per_test_ms, max_output)
        outcome = classify(r)
        results.append({
            "id": str(test["id"]),
            "outcome": outcome,
            "stdout": r.get("stdout", "") if outcome == "OK" else "",
            "stderrTail": sanitize(r.get("stderr", "")),
            "runtimeMs": r.get("runtimeMs"),
        })

    peak_kb = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    emit(nonce, {
        "status": "OK",
        "compileError": None,
        "tests": results,
        "memoryMb": round(peak_kb / 1024, 1),
    })


if __name__ == "__main__":
    main()
