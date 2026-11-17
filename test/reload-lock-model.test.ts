import { describe, expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(120_000);

// One atomic command per step of update-operator step 6 (6.1 to 6.8), with
// the outcomes the skill names. A run may stop after any command, and any
// command after the take may be denied. "Age" makes an existing lock stale,
// as 30 minutes passing would.

type Lock = { stale: boolean } | null;
type State = { lock: Lock; files: Record<string, string>; aged: boolean; runs: Run[] };
type Pc = "take" | "age" | "break" | "retake" | "status" | "export" | "chmod" | "load" | "rm" | "release" | "done" | "stopped";
type Run = { id: string; pc: Pc; holds: boolean; exported: boolean; retook: boolean; rmDenied: boolean };

type Variant = {
  sharedFile: boolean;
  breakStale: boolean;
  cleanupOnDenial: boolean;
};

const RULES: Variant = { sharedFile: false, breakStale: true, cleanupOnDenial: true };

type Violation = string;

const fileOf = (v: Variant, r: Run) => (v.sharedFile ? "kb-export.json" : `kb-export.${r.id}.json`);

const clone = (s: State): State => ({ lock: s.lock && { ...s.lock }, files: { ...s.files }, aged: s.aged, runs: s.runs.map((r) => ({ ...r })) });

// Returns the next states of run i taking its next command; "denied" takes the denial branch.
const step = (v: Variant, s0: State, i: number, denied: boolean, out: Violation[]): State => {
  const s = clone(s0);
  const r = s.runs[i];
  const f = fileOf(v, r);
  const touch = (name: string) => {
    const owner = s.files[name];
    if (owner !== undefined && owner !== r.id) out.push(`${r.id} touched ${name} of ${owner}`);
  };
  const cleanup = () => (r.pc = r.exported ? "rm" : "release");
  switch (r.pc) {
    case "take":
    case "retake":
      if (s.lock === null) {
        s.lock = { stale: false };
        r.holds = true;
        r.pc = "status";
      } else r.pc = r.pc === "take" ? "age" : "done";
      break;
    case "age":
      if (s.lock === null) r.pc = r.retook ? "done" : "retake";
      else if (s.lock.stale && v.breakStale) r.pc = "break";
      else r.pc = "done";
      if (r.pc === "retake") r.retook = true;
      break;
    case "break":
      s.lock = null;
      r.retook = true;
      r.pc = "retake";
      break;
    case "status":
      if (denied && !v.cleanupOnDenial) r.pc = "done";
      else r.pc = denied ? cleanup() : "export";
      break;
    case "export":
      if (denied) {
        r.pc = v.cleanupOnDenial ? cleanup() : "done";
        break;
      }
      touch(f);
      s.files[f] = r.id;
      r.exported = true;
      r.pc = "chmod";
      break;
    case "chmod":
      r.pc = "load";
      break;
    case "load":
      if (!denied) touch(f);
      r.pc = denied && !v.cleanupOnDenial ? "done" : "rm";
      break;
    case "rm":
      if (!denied) {
        touch(f);
        delete s.files[f];
      } else r.rmDenied = true;
      r.pc = "release";
      break;
    case "release":
      if (!denied) s.lock = null;
      r.holds = false;
      r.pc = "done";
      break;
  }
  return s;
};

const DENIABLE: Pc[] = ["status", "export", "load", "rm", "release"];

const key = (s: State) => JSON.stringify(s);

// After every run ended or stopped, time passes and one more run comes: an existing lock is then stale, and it is always empty.
const takeable = (v: Variant, s: State): boolean => s.lock === null || v.breakStale;

const explore = (v: Variant, runs: number, ageEvent: boolean) => {
  const start: State = {
    lock: null,
    files: {},
    aged: false,
    runs: Array.from({ length: runs }, (_, i) => ({ id: `r${i}`, pc: "take" as Pc, holds: false, exported: false, retook: false, rmDenied: false })),
  };
  const seen = new Set<string>();
  const violations = new Set<string>();
  const stack = [start];
  let terminals = 0;
  let overlapAfterStale = false;
  while (stack.length) {
    const s = stack.pop()!;
    const k = key(s);
    if (seen.has(k)) continue;
    seen.add(k);
    const holding = s.runs.filter((r) => r.holds && r.pc !== "stopped");
    if (!s.aged && holding.length > 1) violations.add(`two runs reload at once without the lock going stale: ${holding.map((r) => r.id)}`);
    if (s.aged && holding.length > 1) overlapAfterStale = true;
    const live = s.runs.map((r, i) => [r, i] as const).filter(([r]) => r.pc !== "done" && r.pc !== "stopped");
    if (live.length === 0) {
      terminals++;
      if (!takeable(v, s)) violations.add("the lock blocks every later run forever");
      for (const r of s.runs) {
        if (r.pc !== "done") continue;
        if (r.holds) violations.add(`${r.id} ended holding the lock`);
        if (!v.sharedFile && s.files[fileOf(v, r)] === r.id && !r.rmDenied) violations.add(`${r.id} ended leaving its own file`);
      }
      continue;
    }
    if (ageEvent && !s.aged && s.lock) {
      const t = clone(s);
      t.lock = { stale: true };
      t.aged = true;
      stack.push(t);
    }
    for (const [r, i] of live) {
      const out: Violation[] = [];
      stack.push(step(v, s, i, false, out));
      for (const o of out) violations.add(o);
      if (DENIABLE.includes(r.pc)) {
        const d: Violation[] = [];
        stack.push(step(v, s, i, true, d));
        for (const o of d) violations.add(o);
      }
      const stopped = clone(s);
      stopped.runs[i].pc = "stopped";
      stack.push(stopped);
    }
  }
  return { violations: [...violations], states: seen.size, terminals, overlapAfterStale };
};

describe("reload lock model, rules of update-operator step 6", () => {
  for (const runs of [2, 3]) {
    test(`${runs} runs, each stopping or denied after any command: no run touches another run's file, the lock never blocks for good`, () => {
      const r = explore(RULES, runs, true);
      expect(r.terminals).toBeGreaterThan(0);
      expect(r.violations).toEqual([]);
    });

    test(`${runs} runs, no lock going stale: only one run reloads at a time`, () => {
      expect(explore(RULES, runs, false).violations).toEqual([]);
    });
  }

  test("a lock going stale under a live holder lets a second run reload next to it, which the store tolerates", () => {
    expect(explore(RULES, 2, true).overlapAfterStale).toBe(true);
  });
});

describe("the model finds the defects it guards against", () => {
  test("a shared export file is touched by another run", () => {
    expect(explore({ ...RULES, sharedFile: true }, 2, true).violations.some((x) => x.includes("touched kb-export.json"))).toBe(true);
  });

  test("without breaking a stale lock, a stopped run's lock blocks every later run", () => {
    expect(explore({ ...RULES, breakStale: false }, 2, false).violations).toContain("the lock blocks every later run forever");
  });

  test("a denial that skips clean up and release ends holding the lock and leaves its file", () => {
    const v = explore({ ...RULES, cleanupOnDenial: false }, 1, false).violations;
    expect(v).toContain("r0 ended holding the lock");
    expect(v).toContain("r0 ended leaving its own file");
  });
});
