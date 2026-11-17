import { describe, expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(120_000);

type Lock = { stale: boolean; owners: Record<string, boolean> };
type Fs = { lock: Lock | null; tmp: string[] };

type Rules = {
  ownerlessBreak: boolean;
  multiBreak: boolean;
  checkAfterTake: boolean;
  ownerFailRemovesLock: boolean;
  checkBeforeExport: boolean;
  exactOwnership: boolean;
};

const AT_C980C52: Rules = {
  ownerlessBreak: false,
  multiBreak: false,
  checkAfterTake: false,
  ownerFailRemovesLock: false,
  checkBeforeExport: false,
  exactOwnership: false,
};

const CURRENT: Rules = {
  ownerlessBreak: true,
  multiBreak: true,
  checkAfterTake: true,
  ownerFailRemovesLock: true,
  checkBeforeExport: true,
  exactOwnership: true,
};

type Pc =
  | "take" | "takeOwner" | "list" | "ageOwner" | "ageLock" | "breakOwner" | "breakEach" | "breakLock"
  | "retake" | "retakeOwner" | "dropLock" | "checkTake" | "dropOwner"
  | "status" | "check1" | "export" | "check2" | "move" | "check3" | "load"
  | "release" | "releaseLock" | "busy" | "uncleared" | "done";

type Run = { id: string; pc: Pc; old: string[]; at: number; holding: boolean; crashed: boolean; reached: boolean };
type State = { fs: Fs; runs: Run[] };

const SECTION: Pc[] = ["status", "check1", "export", "check2", "move", "check3", "load"];
const ENDED: Pc[] = ["busy", "uncleared", "done"];

const cloneFs = (fs: Fs): Fs => ({
  lock: fs.lock ? { stale: fs.lock.stale, owners: { ...fs.lock.owners } } : null,
  tmp: [...fs.tmp],
});
const clone = (s: State): State => ({ fs: cloneFs(s.fs), runs: s.runs.map((r) => ({ ...r })) });
const fsKey = (fs: Fs) =>
  JSON.stringify([fs.lock ? [fs.lock.stale, Object.entries(fs.lock.owners).sort()] : null, [...fs.tmp].sort()]);
const key = (s: State) =>
  fsKey(s.fs) + JSON.stringify(s.runs.map((r) => (live(r) ? [r.pc, r.old, r.at, r.holding] : 0)));

const mkdirLock = (fs: Fs) => {
  if (fs.lock) return "exists";
  fs.lock = { stale: false, owners: {} };
  return "ok";
};
const mkdirOwner = (fs: Fs, id: string) => {
  if (!fs.lock) return "missing";
  if (id in fs.lock.owners) return "exists";
  fs.lock.owners[id] = false;
  fs.lock.stale = false;
  return "ok";
};
const listLock = (fs: Fs) => (fs.lock ? Object.keys(fs.lock.owners).sort() : null);
const rmdirOwner = (fs: Fs, id: string) => {
  if (!fs.lock || !(id in fs.lock.owners)) return "missing";
  delete fs.lock.owners[id];
  fs.lock.stale = false;
  return "ok";
};
const rmdirLock = (fs: Fs) => {
  if (!fs.lock) return "missing";
  if (Object.keys(fs.lock.owners).length) return "not empty";
  fs.lock = null;
  return "ok";
};

class Violation extends Error {}

const owns = (fs: Fs, r: Run, rules: Rules) => {
  const names = listLock(fs);
  if (!names) return false;
  return rules.exactOwnership ? names.length === 1 && names[0] === r.id : names.includes(r.id);
};

const step = (s: State, i: number, rules: Rules): void => {
  const r = s.runs[i];
  const fs = s.fs;
  const removeForeign = (name: string) => {
    if (name !== r.id && fs.lock && name in fs.lock.owners && !fs.lock.owners[name])
      throw new Violation(`${r.id} removed the fresh owner folder ${name}`);
    return rmdirOwner(fs, name);
  };
  switch (r.pc) {
    case "take":
    case "retake": {
      const again = r.pc === "retake";
      const res = mkdirLock(fs);
      if (res === "ok") {
        r.holding = true;
        r.pc = again ? "retakeOwner" : "takeOwner";
      } else r.pc = again ? "busy" : "list";
      return;
    }
    case "takeOwner":
    case "retakeOwner": {
      if (mkdirOwner(fs, r.id) === "ok") r.pc = rules.checkAfterTake ? "checkTake" : "status";
      else r.pc = rules.ownerFailRemovesLock ? "dropLock" : "busy";
      return;
    }
    case "dropLock":
      rmdirLock(fs);
      r.pc = "busy";
      return;
    case "checkTake":
      r.pc = owns(fs, r, rules) ? "status" : "dropOwner";
      return;
    case "dropOwner":
      rmdirOwner(fs, r.id);
      r.pc = "busy";
      return;
    case "list": {
      const names = listLock(fs);
      if (!names) r.pc = "retake";
      else if (names.length === 1) {
        r.old = names;
        r.pc = "ageOwner";
      } else if (names.length === 0) r.pc = rules.ownerlessBreak ? "ageLock" : "busy";
      else {
        r.old = names;
        r.pc = rules.multiBreak ? "ageLock" : "busy";
      }
      return;
    }
    case "ageOwner": {
      const o = fs.lock?.owners[r.old[0]];
      r.pc = o === undefined ? "retake" : o ? "breakOwner" : "busy";
      return;
    }
    case "ageLock": {
      if (!fs.lock) r.pc = "retake";
      else if (!fs.lock.stale) r.pc = "busy";
      else if (r.old.length) {
        r.at = 0;
        r.pc = "breakEach";
      } else r.pc = "breakLock";
      return;
    }
    case "breakOwner":
      r.pc = removeForeign(r.old[0]) === "ok" ? "breakLock" : "busy";
      return;
    case "breakEach":
      removeForeign(r.old[r.at]);
      r.at += 1;
      if (r.at >= r.old.length) r.pc = "breakLock";
      return;
    case "breakLock": {
      const res = rmdirLock(fs);
      r.pc = res === "ok" ? "retake" : res === "missing" ? "busy" : "uncleared";
      return;
    }
    case "status":
      r.reached = true;
      r.pc = rules.checkBeforeExport ? "check1" : "export";
      return;
    case "check1":
      r.pc = owns(fs, r, rules) ? "export" : "release";
      return;
    case "export":
      fs.tmp = [...fs.tmp.filter((t) => t !== r.id), r.id];
      r.pc = "check2";
      return;
    case "check2":
      r.pc = owns(fs, r, rules) ? "move" : "release";
      return;
    case "move":
      fs.tmp = fs.tmp.filter((t) => t !== r.id);
      r.pc = "check3";
      return;
    case "check3":
      r.pc = owns(fs, r, rules) ? "load" : "release";
      return;
    case "load":
      r.pc = "release";
      return;
    case "release":
      r.pc = rmdirOwner(fs, r.id) === "ok" ? "releaseLock" : "done";
      return;
    case "releaseLock":
      rmdirLock(fs);
      r.pc = "done";
      return;
    default:
      return;
  }
};

const live = (r: Run) => !r.crashed && !ENDED.includes(r.pc);

const checkSafety = (s: State, overrun: boolean) => {
  const inSection = s.runs.filter((r) => live(r) && SECTION.includes(r.pc));
  const counted = overrun ? inSection.filter((r) => s.fs.lock && r.id in s.fs.lock.owners) : inSection;
  if (counted.length > 1) throw new Violation(`${counted.map((r) => r.id).join(" and ")} reload at once`);
};

const solo = (fs: Fs, rules: Rules): { reached: boolean; end: Pc } => {
  const s: State = { fs: cloneFs(fs), runs: [newRun("z")] };
  for (let n = 0; n < 100 && !ENDED.includes(s.runs[0].pc); n++) step(s, 0, rules);
  return { reached: s.runs[0].reached, end: s.runs[0].pc };
};

const age = (fs: Fs) => {
  if (!fs.lock) return;
  fs.lock.stale = true;
  for (const o of Object.keys(fs.lock.owners)) fs.lock.owners[o] = true;
};

const newRun = (id: string): Run => ({ id, pc: "take", old: [], at: 0, holding: false, crashed: false, reached: false });

type Result = { states: number; violation?: string };

// overrun = false: time passes beyond the stale limit only while no live run holds a lock it took.
// overrun = true: time passes at any point, so a live holder can outlive the stale limit.
const explore = (rules: Rules, runs: number, start: Fs, overrun: boolean): Result => {
  const init: State = { fs: cloneFs(start), runs: Array.from({ length: runs }, (_, i) => newRun(`r${i}`)) };
  const seen = new Set<string>([key(init)]);
  const queue: State[] = [init];
  const takeable = new Map<string, string>();
  try {
    for (let head = 0; head < queue.length; head++) {
      const s = queue[head];
      const next: State[] = [];
      s.runs.forEach((r, i) => {
        if (!live(r)) return;
        const a = clone(s);
        step(a, i, rules);
        checkSafety(a, overrun);
        next.push(a);
        const c = clone(s);
        c.runs[i].crashed = true;
        next.push(c);
      });
      if (overrun || !s.runs.some((r) => live(r) && r.holding)) {
        const t = clone(s);
        age(t.fs);
        next.push(t);
      }
      if (!overrun) {
        const after = cloneFs(s.fs);
        age(after);
        const k = fsKey(after);
        if (!takeable.has(k)) {
          const z = solo(after, rules);
          takeable.set(k, z.reached ? "" : z.end);
        }
        if (takeable.get(k)) throw new Violation(`no run can take the lock after every run stopped: ${key(s)} ends ${takeable.get(k)}`);
      }
      for (const n of next) {
        const k = key(n);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(n);
      }
    }
  } catch (e) {
    if (e instanceof Violation) return { states: seen.size, violation: e.message };
    throw e;
  }
  return { states: seen.size };
};

const STARTS: Record<string, Fs> = {
  "no lock": { lock: null, tmp: [] },
  "a stale lock with one owner": { lock: { stale: true, owners: { c0: true } }, tmp: [] },
  "a stale lock without owner": { lock: { stale: true, owners: {} }, tmp: [] },
  "a stale lock with two owners": { lock: { stale: true, owners: { c0: true, c1: true } }, tmp: [] },
};

describe("reload lock model, rules of update-operator step 6", () => {
  for (const runs of [2, 3]) {
    for (const [name, start] of Object.entries(STARTS)) {
      test(`${runs} runs from ${name}: one reload at a time, no fresh owner removed, the lock always takeable again`, () => {
        const r = explore(CURRENT, runs, start, false);
        expect(r.violation).toBeUndefined();
        expect(r.states).toBeGreaterThan(10);
      });
      test(`${runs} runs from ${name}, a holder outliving the stale limit: at most one holder reloads with its owner folder in place`, () => {
        expect(explore(CURRENT, runs, start, true).violation).toBeUndefined();
      });
    }
  }
});

describe("the model finds the defects it guards against", () => {
  test("rules at c980c52: a run stopped between its two mkdir leaves a lock no later run can take", () => {
    expect(explore(AT_C980C52, 2, STARTS["no lock"], false).violation).toContain("no run can take the lock");
  });

  test("without the check after the take, two runs that break the same ownerless lock reload at once", () => {
    const r = explore({ ...CURRENT, checkAfterTake: false }, 2, STARTS["a stale lock without owner"], false);
    expect(r.violation).toContain("reload at once");
  });

  test("without breaking a lock with more than one owner, two stopped runs leave a lock no later run can take", () => {
    const r = explore({ ...CURRENT, multiBreak: false }, 2, STARTS["a stale lock with two owners"], false);
    expect(r.violation).toContain("no run can take the lock");
  });
});
