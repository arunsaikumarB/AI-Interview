/**
 * V3.0 coding sandbox — REAL execution/isolation tests (security tests 1–15,
 * coding integration and cleanup). Requires Docker, the hireos-code-runner:v1
 * image and a running sandbox runner (npm run sandbox:setup && npm run sandbox:runner).
 * Nothing is mocked: every program below runs inside the real sandbox.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { before, describe, it } from "node:test";
import { runCode, runnerAvailable, sandboxContainers, sleep, LIMITS } from "./helpers";

const SLOW = { ...LIMITS, perTestTimeoutMs: 5000 };

function lines(body: any, index = 0): string[] {
  return String(body?.tests?.[index]?.stdout ?? "").split("\n").filter(Boolean);
}

function assertNoLeftovers() {
  assert.deepEqual(sandboxContainers(), [], "sandbox containers must be removed after every execution");
}

before(async () => {
  assert.ok(await runnerAvailable(), "sandbox runner is not running — start it with `npm run sandbox:runner`");
});

describe("coding sandbox security (real execution)", () => {
  it("#1 cannot write outside the sandbox or read privileged host files; no host mounts", async () => {
    const src = `
import os
out = []
for p in ["/etc/pwned", "/usr/pwned", "/opt/harness/harness.py", "/pwned", "/root/pwned"]:
    try:
        with open(p, "a") as f:
            f.write("x")
        out.append("WROTE " + p)
    except Exception:
        out.append("DENIED " + p)
try:
    open("/etc/shadow").read()
    out.append("READ_SHADOW")
except Exception:
    out.append("NO_SHADOW")
for line in open("/proc/mounts"):
    out.append("MOUNT " + line.split()[1])
print("\\n".join(out))
`;
    const r = await runCode("python", src);
    assert.equal(r.status, 200);
    const out = lines(r.body);
    assert.equal(out.filter((l) => l.startsWith("WROTE")).length, 0, out.join("\n"));
    assert.ok(out.includes("NO_SHADOW"));
    const mounts = out.filter((l) => l.startsWith("MOUNT ")).map((l) => l.slice(6));
    const allowed = (m: string) =>
      m === "/" || m === "/tmp" || ["/etc/resolv.conf", "/etc/hostname", "/etc/hosts"].includes(m) || /^\/(proc|dev|sys)(\/|$)/.test(m);
    assert.deepEqual(mounts.filter((m) => !allowed(m)), [], `unexpected mounts: ${mounts.join(", ")}`);
    assertNoLeftovers();
  });

  it("#2 cannot read HireOS environment variables (Python and Node)", async () => {
    const py = await runCode("python", `
import os, json
env = dict(os.environ)
try:
    open("/proc/1/environ").read()
    env["__PID1_ENV__"] = "READABLE"
except Exception:
    pass
print(json.dumps(sorted(env)))
`);
    const pyKeys = JSON.parse(lines(py.body)[0] ?? "[]");
    assert.deepEqual(pyKeys.filter((k: string) => !["PATH", "HOME", "LANG", "LC_CTYPE"].includes(k)), []);
    const js = await runCode("javascript", "console.log(JSON.stringify(Object.keys(process.env).sort()))");
    const jsKeys = JSON.parse(lines(js.body)[0] ?? "[]");
    assert.deepEqual(jsKeys.filter((k: string) => !["PATH", "HOME", "LANG"].includes(k)), []);
    assertNoLeftovers();
  });

  it("#3 #4 #5 no .env, no HireOS source, no Prisma/database credentials anywhere in the sandbox filesystem", async () => {
    const src = `
import os
hits = []
NEEDLES = [b"ats_local_dev", b"ai_recruitment_os", b"AUTH_SECRET=", b"ai-recruitment-os", b"SANDBOX_RUNNER_SECRET"]
for root, dirs, files in os.walk("/"):
    # /tmp/work holds only this program, which necessarily contains the needles.
    if root.startswith(("/proc", "/sys", "/dev", "/tmp/work")):
        dirs[:] = []
        continue
    for name in files:
        path = os.path.join(root, name)
        if name.startswith(".env") or name in ("schema.prisma", "id_rsa", "id_ed25519", "next.config.mjs"):
            hits.append("NAME " + path)
        try:
            if os.path.islink(path) or os.path.getsize(path) > 2_000_000:
                continue
            with open(path, "rb") as f:
                data = f.read()
        except Exception:
            continue
        for n in NEEDLES:
            if n in data:
                hits.append("CONTENT " + path + " " + n.decode())
for p in ["/app", "/src", "/workspace", "/storage", "/prisma"]:
    if os.path.exists(p):
        hits.append("DIR " + p)
print("HITS " + str(len(hits)))
print("\\n".join(hits[:20]))
`;
    const r = await runCode("python", src, [""], SLOW);
    assert.equal(r.body?.tests?.[0]?.outcome, "OK", JSON.stringify(r.body));
    assert.equal(lines(r.body)[0], "HITS 0", lines(r.body).join("\n"));
    assertNoLeftovers();
  });

  it("#6 #7 #8 #9 #10 no production DB, Docker socket, localhost services, internal network or internet", async () => {
    const targets = [
      "prod-db-host host.docker.internal 55432",
      "prod-db-bridge 172.17.0.1 55432",
      "prod-db-desktop 192.168.65.254 55432",
      "prod-db-name aros-postgres 5432",
      "local-next 127.0.0.1 3000",
      "local-django 127.0.0.1 8000",
      "local-runner 127.0.0.1 8010",
      "local-ollama 127.0.0.1 11434",
      "local-redis 127.0.0.1 6379",
      "sql-sandbox 127.0.0.1 55433",
      "ollama-name aros-ollama 11434",
      "internal-10 10.0.0.1 80",
      "internal-172 172.18.0.1 80",
      "lan-host 192.168.1.8 3000",
      "internet-ip 1.1.1.1 443",
      "internet-dns 8.8.8.8 53",
      "internet-name example.com 443",
      "docker-socket /var/run/docker.sock 0",
      "docker-socket-alt /run/docker.sock 0",
      "interfaces - 0",
    ];
    const src = `
import os, socket, sys
label, host, port = sys.stdin.read().split()
if label.startswith("docker-socket"):
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.connect(host)
        print("OPEN " + label)
    except Exception:
        print("BLOCKED " + label)
elif label == "interfaces":
    print("IFACES " + ",".join(sorted(l.split(":")[0].strip() for l in open("/proc/net/dev").read().splitlines()[2:])))
else:
    try:
        s = socket.create_connection((host, int(port)), timeout=2)
        s.close()
        print("OPEN " + label)
    except Exception as e:
        print("BLOCKED " + label + " " + type(e).__name__)
`;
    const r = await runCode("python", src, targets.map((t) => `${t}\n`), SLOW);
    assert.equal(r.body?.tests?.length, targets.length, JSON.stringify(r.body).slice(0, 500));
    const results = r.body.tests.map((t: any, i: number) => ({ target: targets[i], outcome: t.outcome, out: t.stdout.trim() }));
    const open = results.filter((x: any) => x.out.startsWith("OPEN"));
    assert.deepEqual(open, [], JSON.stringify(open));
    // A lookup that never completes within the per-test limit is also unreachable — never OPEN.
    const unexpected = results.filter((x: any) => !(x.out.startsWith("BLOCKED") || x.out.startsWith("IFACES") || x.outcome === "TIMEOUT"));
    assert.deepEqual(unexpected, [], JSON.stringify(unexpected));
    assert.equal(results.at(-1).out, "IFACES lo", "only the loopback interface may exist");

    const jsTargets = ["1.1.1.1 443", "127.0.0.1 3000", "172.17.0.1 55432", "host.docker.internal 55432"];
    const js = await runCode(
      "javascript",
      `const net=require("net");const [h,p]=require("fs").readFileSync(0,"utf8").trim().split(" ");
const s=net.connect({host:h,port:Number(p),timeout:2000});
const done=(r)=>{console.log(r+" "+h);s.destroy();};
s.on("connect",()=>done("OPEN"));s.on("error",()=>done("BLOCKED"));s.on("timeout",()=>done("BLOCKED"));`,
      jsTargets.map((t) => `${t}\n`),
      SLOW,
    );
    assert.equal(js.body?.tests?.length, jsTargets.length, JSON.stringify(js.body));
    for (const t of js.body.tests) {
      assert.ok(!String(t.stdout).startsWith("OPEN"), JSON.stringify(t));
      assert.ok(String(t.stdout).startsWith("BLOCKED") || t.outcome === "TIMEOUT", JSON.stringify(t));
    }
    assertNoLeftovers();
  });

  it("#11 cannot spawn unlimited processes; a fork bomb is contained and the harness survives", async () => {
    const counter = `
import os, time
n = 0
for _ in range(500):
    try:
        pid = os.fork()
    except OSError:
        break
    if pid == 0:
        time.sleep(30)
        os._exit(0)
    n += 1
print(n)
`;
    const r = await runCode("python", counter, ["", "second"]);
    const spawned = Number(lines(r.body, 0)[0]);
    assert.ok(Number.isFinite(spawned) && spawned < 64, `spawned ${spawned} processes (limit 64)`);

    const bomb = "import os\nwhile True:\n    try:\n        os.fork()\n    except OSError:\n        pass\n";
    const echo = "import sys\nprint(sys.stdin.read().strip())\n";
    const b = await runCode("python", bomb, [""]);
    assert.equal(b.status, 200);
    assert.ok(["TIMEOUT", "PROCESS_LIMIT", "RUNTIME_ERROR"].includes(b.body?.tests?.[0]?.outcome), JSON.stringify(b.body));
    const after = await runCode("python", echo, ["still alive\n"]);
    assert.equal(lines(after.body)[0], "still alive");
    assertNoLeftovers();
  });

  it("#12 cannot consume unlimited memory (Python + Node); the harness survives", async () => {
    const py = await runCode(
      "python",
      "chunks = []\nwhile True:\n    chunks.append(bytearray(16 * 1024 * 1024))\n",
      ["", ""],
    );
    assert.equal(py.body?.tests?.[0]?.outcome, "MEMORY_LIMIT", JSON.stringify(py.body));
    const js = await runCode("javascript", "const a=[];while(true){a.push(new Array(1e6).fill(1.5));}");
    assert.equal(js.body?.tests?.[0]?.outcome, "MEMORY_LIMIT", JSON.stringify(js.body));
    assertNoLeftovers();
  });

  it("#13 cannot run indefinitely (per-test timeout, bounded wall clock)", async () => {
    const started = Date.now();
    const r = await runCode("python", "while True:\n    pass\n", ["", ""], { ...LIMITS, perTestTimeoutMs: 1000 });
    const elapsed = Date.now() - started;
    assert.deepEqual(r.body?.tests?.map((t: any) => t.outcome), ["TIMEOUT", "TIMEOUT"]);
    assert.ok(elapsed < 20_000, `took ${elapsed} ms`);
    const js = await runCode("javascript", "for(;;){}", [""], { ...LIMITS, perTestTimeoutMs: 1000 });
    assert.equal(js.body?.tests?.[0]?.outcome, "TIMEOUT");
    assertNoLeftovers();
  });

  it("#14 cannot write unlimited output", async () => {
    const r = await runCode("python", 'import sys\nwhile True:\n    sys.stdout.write("x" * 65536)\n');
    assert.equal(r.body?.tests?.[0]?.outcome, "OUTPUT_LIMIT", JSON.stringify(r.body).slice(0, 400));
    assert.equal(r.body?.tests?.[0]?.stdout, "");
    const js = await runCode("javascript", 'const s="y".repeat(65536);for(;;){process.stdout.write(s);}');
    assert.ok(["OUTPUT_LIMIT", "RUNTIME_ERROR"].includes(js.body?.tests?.[0]?.outcome), JSON.stringify(js.body).slice(0, 400));
    assert.ok(JSON.stringify(js.body).length < 70_000);
    assertNoLeftovers();
  });

  it("#15 cannot escape the execution directory (read-only root, noexec + size-capped tmpfs)", async () => {
    const src = `
import os, subprocess
out = []
os.chdir("/")
for p in ["/escape", "/usr/local/bin/escape", "/home/escape"]:
    try:
        open(p, "w").write("x"); out.append("WROTE " + p)
    except Exception:
        out.append("DENIED " + p)
try:
    os.symlink("/etc", "/tmp/work/etc_link")
    open("/tmp/work/etc_link/escape", "w").write("x")
    out.append("WROTE via symlink")
except Exception:
    out.append("DENIED via symlink")
try:
    with open("/tmp/work/big", "wb") as f:
        for _ in range(40):
            f.write(b"0" * (1024 * 1024))
    out.append("TMPFS_UNBOUNDED")
except Exception:
    out.append("TMPFS_CAPPED")
os.remove("/tmp/work/big")
with open("/tmp/work/run.sh", "w") as f:
    f.write("#!/bin/sh\\necho EXECUTED\\n")
os.chmod("/tmp/work/run.sh", 0o755)
try:
    r = subprocess.run(["/tmp/work/run.sh"], capture_output=True, text=True)
    out.append("EXEC " + r.stdout.strip())
except Exception:
    out.append("NOEXEC")
print("\\n".join(out))
`;
    const r = await runCode("python", src, [""], SLOW);
    const out = lines(r.body);
    assert.equal(out.filter((l) => l.startsWith("WROTE")).length, 0, out.join("\n"));
    assert.ok(out.includes("TMPFS_CAPPED"), out.join("\n"));
    assert.ok(out.includes("NOEXEC"), out.join("\n"));
    assertNoLeftovers();
  });
});

describe("coding runtime integration (real execution)", () => {
  it("success, compile error (Python + JS), runtime error", async () => {
    const ok = await runCode("javascript", 'console.log(require("fs").readFileSync(0,"utf8").trim().toUpperCase())', ["abc\n"]);
    assert.equal(lines(ok.body)[0], "ABC");
    const pyCompile = await runCode("python", "def broken(:\n    pass\n");
    assert.equal(pyCompile.body?.status, "COMPILE_ERROR");
    assert.match(pyCompile.body?.compileError, /SyntaxError/);
    assert.doesNotMatch(pyCompile.body?.compileError, /\/tmp\/work/);
    const jsCompile = await runCode("javascript", "function (");
    assert.equal(jsCompile.body?.status, "COMPILE_ERROR");
    const crash = await runCode("python", "raise ValueError('boom')\n");
    assert.equal(crash.body?.tests?.[0]?.outcome, "RUNTIME_ERROR");
    assert.match(crash.body?.tests?.[0]?.stderrTail, /ValueError/);
    assertNoLeftovers();
  });

  it("cleanup after an infrastructure failure (container killed mid-run)", async () => {
    const pending = runCode("python", "while True:\n    pass\n", ["", "", ""], { ...LIMITS, perTestTimeoutMs: 5000 });
    let killed = false;
    for (let i = 0; i < 40 && !killed; i++) {
      await sleep(250);
      const ids = sandboxContainers();
      if (ids.length) {
        execFileSync("docker", ["kill", ...ids], { stdio: "ignore" });
        killed = true;
      }
    }
    assert.ok(killed, "sandbox container never appeared");
    const r = await pending;
    assert.equal(r.status, 200);
    assert.ok(["INFRA_ERROR", "RESOURCE_VIOLATION"].includes(r.body?.status), JSON.stringify(r.body));
    await sleep(500);
    assertNoLeftovers();
  });
});
