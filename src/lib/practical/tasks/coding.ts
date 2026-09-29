import type { CodingLanguage, CodingTask, CodingTestCase } from "../types";

/**
 * Curated, versioned coding tasks. Programs read stdin and write stdout, so the
 * same task works for every supported language. Hidden test inputs and all
 * expected outputs stay on the server — only visibleTests reach the browser.
 *
 * Bump `version` whenever tests or instructions change; submissions record the
 * version they ran against.
 */

/** Deterministic PRNG so generated hidden tests are identical on every boot. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

const STARTER: Record<CodingLanguage, string> = {
  python: [
    "import sys",
    "",
    "",
    "def main():",
    "    data = sys.stdin.read()",
    "    # Parse the input and print the answer.",
    "",
    "",
    'if __name__ == "__main__":',
    "    main()",
    "",
  ].join("\n"),
  javascript: [
    'const data = require("fs").readFileSync(0, "utf8");',
    "// Parse the input and print the answer with console.log().",
    "",
  ].join("\n"),
};

const STANDARD_LIMITS = { perTestTimeoutMs: 2000, memoryMb: 256, maxOutputBytes: 64 * 1024 };

// -----------------------------------------------------------------------------
// EASY — balanced brackets
// -----------------------------------------------------------------------------

function bracketsBalanced(s: string): boolean {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch in pairs) {
      if (stack.pop() !== pairs[ch]) return false;
    }
  }
  return stack.length === 0;
}

function randomBalanced(rand: () => number, length: number): string {
  const open = ["(", "[", "{"];
  const close: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  let out = "";
  while (out.length + stack.length < length) {
    if (stack.length === 0 || rand() < 0.55) {
      const o = open[randInt(rand, 0, 2)]!;
      stack.push(o);
      out += o;
    } else {
      out += close[stack.pop()!];
    }
  }
  while (stack.length) out += close[stack.pop()!];
  return out;
}

function bracketCase(id: string, name: string, line: string): CodingTestCase {
  return { id, name, input: `${line}\n`, expected: bracketsBalanced(line) ? "YES" : "NO" };
}

const balancedRand = mulberry32(0xb4a1);
const longBalanced = randomBalanced(balancedRand, 20000);

export const BALANCED_BRACKETS: CodingTask = {
  kind: "CODING",
  key: "coding-balanced-brackets",
  version: 1,
  difficulty: "EASY",
  title: "Balanced brackets",
  instructions: [
    "The input is a single line containing only the characters ( ) [ ] { }. The line may be empty.",
    "Print YES if every bracket is closed by the matching bracket type in the correct order, otherwise print NO.",
  ].join("\n\n"),
  constraints: ["0 ≤ line length ≤ 60,000", "Deeply nested input is possible — avoid recursion limits."],
  languages: ["python", "javascript"],
  starterCode: STARTER,
  visibleTests: [
    bracketCase("v1", "Mixed nesting", "([]{})"),
    bracketCase("v2", "Crossed pairs", "([)]"),
    bracketCase("v3", "Nested groups", "{[()()]}"),
  ],
  hiddenTests: [
    bracketCase("h1", "Empty line", ""),
    bracketCase("h2", "Only openers", "((("),
    bracketCase("h3", "Closer first", "}{"),
    bracketCase("h4", "Deep nesting", "(".repeat(30000) + ")".repeat(30000)),
    bracketCase("h5", "Long balanced", longBalanced),
    bracketCase("h6", "Long, last bracket wrong", longBalanced.slice(0, -1) + (longBalanced.endsWith(")") ? "]" : ")")),
    bracketCase("h7", "Interleaved", "[(])"),
  ],
  limits: STANDARD_LIMITS,
  timeLimitMinutes: 30,
};

// -----------------------------------------------------------------------------
// MEDIUM — merge intervals
// -----------------------------------------------------------------------------

function mergeIntervals(list: [number, number][]): [number, number][] {
  const sorted = [...list].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function intervalCase(id: string, name: string, list: [number, number][]): CodingTestCase {
  return {
    id,
    name,
    input: `${list.length}\n${list.map(([a, b]) => `${a} ${b}\n`).join("")}`,
    expected: mergeIntervals(list)
      .map(([a, b]) => `${a} ${b}`)
      .join("\n"),
  };
}

function randomIntervals(seed: number, n: number, span: number, maxLen: number): [number, number][] {
  const rand = mulberry32(seed);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = randInt(rand, -span, span);
    out.push([a, a + randInt(rand, 0, maxLen)]);
  }
  return out;
}

export const MERGE_INTERVALS: CodingTask = {
  kind: "CODING",
  key: "coding-merge-intervals",
  version: 1,
  difficulty: "MEDIUM",
  title: "Merge overlapping intervals",
  instructions: [
    "The first line contains n. Each of the next n lines contains two integers a b (a ≤ b) describing a closed interval [a, b].",
    "Merge every group of overlapping intervals. Intervals that touch (one ends exactly where the next starts) also merge.",
    "Print the merged intervals sorted by start, one per line as \"a b\". Print nothing when n is 0.",
  ].join("\n\n"),
  constraints: ["0 ≤ n ≤ 5,000", "-1,000,000,000 ≤ a ≤ b ≤ 1,000,000,000", "Input intervals are not sorted."],
  languages: ["python", "javascript"],
  starterCode: STARTER,
  visibleTests: [
    intervalCase("v1", "Classic overlap", [
      [1, 3],
      [2, 6],
      [8, 10],
      [15, 18],
    ]),
    intervalCase("v2", "Touching intervals", [
      [1, 4],
      [4, 5],
    ]),
    intervalCase("v3", "Unsorted, no overlap", [
      [5, 7],
      [1, 2],
      [3, 4],
    ]),
  ],
  hiddenTests: [
    intervalCase("h1", "Empty input", []),
    intervalCase("h2", "Single point", [[-5, -5]]),
    intervalCase("h3", "Fully contained", [
      [1, 10],
      [2, 3],
      [4, 5],
    ]),
    intervalCase("h4", "Extreme values", [
      [-1000000000, 0],
      [0, 1000000000],
      [-3, -2],
    ]),
    intervalCase("h5", "Many sparse intervals", randomIntervals(0x1e7a, 3000, 1_000_000, 50)),
    intervalCase("h6", "Many dense intervals", randomIntervals(0x2f11, 3000, 20_000, 40)),
  ],
  limits: STANDARD_LIMITS,
  timeLimitMinutes: 45,
};

// -----------------------------------------------------------------------------
// HARD — shortest path in a grid
// -----------------------------------------------------------------------------

function shortestPath(grid: string[]): number {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let start = -1;
  let end = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r]![c] === "S") start = r * cols + c;
      if (grid[r]![c] === "E") end = r * cols + c;
    }
  }
  const dist = new Int32Array(rows * cols).fill(-1);
  const queue = new Int32Array(rows * cols);
  let head = 0;
  let tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++]!;
    if (cur === end) return dist[cur]!;
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const next = nr * cols + nc;
      if (dist[next] !== -1 || grid[nr]![nc] === "#") continue;
      dist[next] = dist[cur]! + 1;
      queue[tail++] = next;
    }
  }
  return -1;
}

function gridCase(id: string, name: string, grid: string[]): CodingTestCase {
  return {
    id,
    name,
    input: `${grid.length} ${grid[0]!.length}\n${grid.join("\n")}\n`,
    expected: String(shortestPath(grid)),
  };
}

function randomGrid(seed: number, rows: number, cols: number, wallRate: number): string[] {
  const rand = mulberry32(seed);
  const g: string[][] = [];
  for (let r = 0; r < rows; r++) {
    g.push(Array.from({ length: cols }, () => (rand() < wallRate ? "#" : ".")));
  }
  g[0]![0] = "S";
  g[rows - 1]![cols - 1] = "E";
  return g.map((row) => row.join(""));
}

function serpentine(size: number): string[] {
  const g: string[][] = [];
  for (let r = 0; r < size; r++) {
    if (r % 2 === 0) g.push(Array.from({ length: size }, () => "."));
    else {
      const row = Array.from({ length: size }, () => "#");
      row[r % 4 === 1 ? size - 1 : 0] = ".";
      g.push(row);
    }
  }
  g[0]![0] = "S";
  g[size - 1]![size - 1] = "E";
  return g.map((row) => row.join(""));
}

function enclosedExit(size: number): string[] {
  const g: string[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => "."));
  const mid = Math.floor(size / 2);
  for (let d = -1; d <= 1; d++) {
    for (let e = -1; e <= 1; e++) {
      if (d !== 0 || e !== 0) g[mid + d]![mid + e] = "#";
    }
  }
  g[0]![0] = "S";
  g[mid]![mid] = "E";
  return g.map((row) => row.join(""));
}

export const GRID_SHORTEST_PATH: CodingTask = {
  kind: "CODING",
  key: "coding-grid-shortest-path",
  version: 1,
  difficulty: "HARD",
  title: "Shortest path in a grid",
  instructions: [
    "The first line contains R and C. The next R lines each contain C characters: S (start, exactly one), E (exit, exactly one), # (wall) or . (open).",
    "You can move one cell up, down, left or right per step, never into a wall or outside the grid.",
    "Print the minimum number of steps from S to E, or -1 if E cannot be reached.",
  ].join("\n\n"),
  constraints: ["1 ≤ R, C ≤ 200", "Grids up to 40,000 cells — an O(R·C) solution is expected."],
  languages: ["python", "javascript"],
  starterCode: STARTER,
  visibleTests: [
    gridCase("v1", "Around a wall", ["S.#", ".#.", "..E"]),
    gridCase("v2", "Blocked", ["S#", "#E"]),
    gridCase("v3", "Straight corridor", ["S...E"]),
  ],
  hiddenTests: [
    gridCase("h1", "Adjacent exit", ["SE"]),
    gridCase("h2", "Large random walls", randomGrid(0x5eed, 200, 200, 0.25)),
    gridCase("h3", "Large open grid", randomGrid(0x0, 200, 200, 0)),
    gridCase("h4", "Serpentine maze", serpentine(151)),
    gridCase("h5", "Walled-in exit", enclosedExit(101)),
  ],
  limits: STANDARD_LIMITS,
  timeLimitMinutes: 60,
};

export const CODING_TASKS: readonly CodingTask[] = [BALANCED_BRACKETS, MERGE_INTERVALS, GRID_SHORTEST_PATH];
