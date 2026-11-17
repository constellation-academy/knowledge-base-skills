import { describe, expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(300_000);

type Owner = { stale: boolean; by: number };
type Lock = { stale: boolean; by: number; owners: Record<string, Owner> };
type Fs = { lock: Lock | null; tmp: Record<string, number> };

type Rules = {
  ownerlessBreak: boolean;
  multiBreak: boolean;
  checkAfterTake: boolean;
  ownerFailRemovesLock: boolean;
  checkBeforeExport: boolean;
  exactOwnership: boolean;
  ownAgeCheck: boolean;
  takeCheckRemovesLock: boolean;
  relistNotEmpty: boolean;
  redraw: boolean;
  denialReleases: boolean;
};

const AT_C980C52: Rules = {
  ownerlessBreak: false,
  multiBreak: false,
  checkAfterTake: false,
  ownerFailRemovesLock: false,
  checkBeforeExport: false,
  exactOwnership: false,
  ownAgeCheck: false,
  takeCheckRemovesLock: false,
  relistNotEmpty: false,
  redraw: false,
  denialReleases: true,
};

const CURRENT: Rules = {
  ownerlessBreak: true,
  multiBreak: true,
  checkAfterTake: true,
  ownerFailRemovesLock: true,
  checkBeforeExport: true,
  exactOwnership: true,
  ownAgeCheck: true,
  takeCheckRemovesLock: true,
  relistNotEmpty: true,
  redraw: true,
  denialReleases: true,
};

type Pc =
  | "take" | "takeOwner" | "list" | "ageOwner" | "ageLock" | "breakOwner" | "breakEach" | "breakLock" | "relist"
  | "retake" | "retakeOwner" | "dropLock" | "checkTake" | "dropOwner" | "dropOwnerLock"
  | "status" | "check1" | "export" | "check2" | "move" | "check3" | "chmod" | "load" | "loading"
  | "cleanup" | "release" | "releaseLock" | "busy" | "uncleared" | "notAllowed" | "done";

type Run = {
  id: string;
  pc: Pc;
  old: string[];
  at: number;
  holding: boolean;
  crashed: boolean;
  reached: boolean;
  lost: boolean;
  straddled: boolean;
};
type State = { fs: Fs; runs: Run[] };

const SECTION: Pc[] = ["status", "check1", "export", "check2", "move", "check3", "chmod", "load", "loading"];
const TOUCHES_EXPORT: Pc[] = ["move", "chmod", "load", "loading"];
const AFTER_CHECK: Pc[] = ["export", "move", "chmod", "load"];
const AFTER_TAKE: Pc[] = ["status", "check1", "export", "check2", "move", "check3", "chmod", "load"];
const BEFORE_TAKE: Pc[] = ["take", "retake", "list", "relist", "ageOwner", "ageLock", "breakOwner", "breakEach", "breakLock"];
const ENDED: Pc[] = ["busy", "uncleared", "notAllowed", "done"];

const cloneFs = (fs: Fs): Fs => ({
  lock: fs.lock
    ? { stale: fs.lock.stale, by: fs.lock.by, owners: Object.fromEntries(Object.entries(fs.lock.owners).map(([k, o]) => [k, { ...o }])) }
    : null,
  tmp: { ...fs.tmp },
});
const clone = (s: State): State => ({ fs: cloneFs(s.fs), runs: s.runs.map((r) => ({ ...r, old: [...r.old] })) });
const fsKey = (fs: Fs) =>
  JSON.stringify([
    fs.lock ? [fs.lock.stale, fs.lock.by, Object.entries(fs.lock.owners).sort(([a], [b]) => a.localeCompare(b))] : null,
    Object.entries(fs.tmp).sort(([a], [b]) => a.localeCompare(b)),
  ]);
const live = (r: Run) => !r.crashed && !ENDED.includes(r.pc);
const key = (s: State) =>
  fsKey(s.fs) +
  JSON.stringify(s.runs.map((r) => (live(r) ? [r.id, r.pc, r.old, r.at, r.holding, r.lost, r.straddled] : r.crashed ? 0 : 1)));

class Violation extends Error {}

const mkdirLock = (fs: Fs, by: number) => {
  if (fs.lock) return "exists";
  fs.lock = { stale: false, by, owners: {} };
  return "ok";
};
const mkdirOwner = (fs: Fs, id: string, by: number) => {
  if (!fs.lock) return "missing";
  if (id in fs.lock.owners) return "exists";
  fs.lock.owners[id] = { stale: false, by };
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

const owns = (fs: Fs, r: Run, rules: Rules, ageCheck: boolean) => {
  const names = listLock(fs);
  if (!names) return false;
  const listed = rules.exactOwnership ? names.length === 1 && names[0] === r.id : names.includes(r.id);
  if (!listed) return false;
  return !(ageCheck && rules.ownAgeCheck && fs.lock!.owners[r.id].stale);
};

const step = (s: State, i: number, rules: Rules): void => {
  const r = s.runs[i];
  const fs = s.fs;
  const removeForeign = (name: string) => {
    const o = fs.lock?.owners[name];
    if (o && o.by !== i && !o.stale) throw new Violation(`${r.id} removed the fresh owner folder ${name}`);
    return rmdirOwner(fs, name);
  };
  const ownTmp = () => {
    if (!(r.id in fs.tmp)) return false;
    if (fs.tmp[r.id] !== i) throw new Violation(`${r.id} (run ${i}) moved or removed the temp file of run ${fs.tmp[r.id]}`);
    return true;
  };
  if (TOUCHES_EXPORT.includes(r.pc) && r.lost) throw new Violation(`${r.id} touched kb-export.json after its ownership check failed`);
  const check = (next: Pc) => {
    if (owns(fs, r, rules, true)) r.pc = next;
    else {
      r.lost = true;
      r.pc = "cleanup";
    }
  };
  switch (r.pc) {
    case "take":
    case "retake": {
      const again = r.pc === "retake";
      if (again && rules.redraw && r.old.includes(r.id)) r.id = `${r.id}'`;
      if (mkdirLock(fs, i) === "ok") {
        r.holding = true;
        r.pc = again ? "retakeOwner" : "takeOwner";
      } else r.pc = again ? "busy" : "list";
      return;
    }
    case "takeOwner":
    case "retakeOwner":
      if (mkdirOwner(fs, r.id, i) === "ok") r.pc = rules.checkAfterTake ? "checkTake" : "status";
      else r.pc = rules.ownerFailRemovesLock ? "dropLock" : "busy";
      return;
    case "dropLock":
      rmdirLock(fs);
      r.pc = "busy";
      return;
    case "checkTake":
      r.pc = owns(fs, r, rules, false) ? "status" : "dropOwner";
      return;
    case "dropOwner":
      rmdirOwner(fs, r.id);
      r.pc = rules.takeCheckRemovesLock ? "dropOwnerLock" : "busy";
      return;
    case "dropOwnerLock":
      rmdirLock(fs);
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
      r.pc = o === undefined ? "retake" : o.stale ? "breakOwner" : "busy";
      return;
    }
    case "ageLock":
      if (!fs.lock) r.pc = "retake";
      else if (!fs.lock.stale) r.pc = "busy";
      else if (r.old.length) {
        r.at = 0;
        r.pc = "breakEach";
      } else r.pc = "breakLock";
      return;
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
      r.pc = res === "ok" ? "retake" : res === "missing" ? "busy" : rules.relistNotEmpty ? "relist" : "uncleared";
      return;
    }
    case "relist": {
      const names = listLock(fs);
      r.pc = names && names.length === 0 ? "uncleared" : "busy";
      return;
    }
    case "status":
      r.reached = true;
      r.pc = rules.checkBeforeExport ? "check1" : "export";
      return;
    case "check1":
      return check("export");
    case "export":
      fs.tmp[r.id] = i;
      r.pc = "check2";
      return;
    case "check2":
      return check("move");
    case "move":
      if (ownTmp()) delete fs.tmp[r.id];
      r.pc = "check3";
      return;
    case "check3":
      return check("chmod");
    case "chmod":
      r.pc = "load";
      return;
    case "load":
      r.pc = "loading";
      return;
    case "loading":
      r.pc = "cleanup";
      return;
    case "cleanup":
      if (ownTmp()) delete fs.tmp[r.id];
      r.pc = r.holding ? "release" : "done";
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

const deny = (s: State, i: number, rules: Rules): boolean => {
  const r = s.runs[i];
  if (AFTER_TAKE.includes(r.pc)) {
    r.pc = rules.denialReleases ? "cleanup" : "notAllowed";
    return true;
  }
  if (r.pc === "takeOwner" || r.pc === "retakeOwner") {
    r.pc = rules.ownerFailRemovesLock ? "dropLock" : "notAllowed";
    return true;
  }
  if (BEFORE_TAKE.includes(r.pc)) {
    r.pc = "notAllowed";
    return true;
  }
  return false;
};

const checkSafety = (s: State, overrun: boolean) => {
  const counted = overrun
    ? s.runs.filter((r) => live(r) && TOUCHES_EXPORT.includes(r.pc) && !r.straddled)
    : s.runs.filter((r) => live(r) && SECTION.includes(r.pc));
  if (counted.length > 1) throw new Violation(`${counted.map((r) => r.id).join(" and ")} reload at once`);
  s.runs.forEach((r, i) => {
    if (r.crashed || !ENDED.includes(r.pc)) return;
    const left = Object.entries(s.fs.lock?.owners ?? {}).find(([, o]) => o.by === i);
    if (left) throw new Violation(`${r.id} ended ${r.pc} and left its owner folder ${left[0]}`);
    const tmp = Object.entries(s.fs.tmp).find(([, by]) => by === i);
    if (tmp) throw new Violation(`${r.id} ended ${r.pc} and left its temp file ${tmp[0]}`);
  });
  const l = s.fs.lock;
  if (l && l.by >= 0 && !Object.keys(l.owners).length && s.runs.every((r) => !r.crashed && !live(r)) && s.runs[l.by].pc === "busy")
    throw new Violation(`every run ended and ${s.runs[l.by].id} left a fresh lock without owner`);
};

const newRun = (id: string): Run => ({
  id, pc: "take", old: [], at: 0, holding: false, crashed: false, reached: false, lost: false, straddled: false,
});

const solo = (fs: Fs, rules: Rules): { reached: boolean; end: Pc } => {
  const s: State = { fs: cloneFs(fs), runs: [newRun("z")] };
  for (let n = 0; n < 100 && !ENDED.includes(s.runs[0].pc); n++) step(s, 0, rules);
  return { reached: s.runs[0].reached, end: s.runs[0].pc };
};

const age = (fs: Fs) => {
  if (!fs.lock) return;
  fs.lock.stale = true;
  for (const o of Object.values(fs.lock.owners)) o.stale = true;
};

type Result = { states: number; violation?: string };

// overrun = false: time passes beyond the stale limit only while no live run holds a lock it took.
// overrun = true: time passes at any point except between an ownership check and the command right after it,
// which takes milliseconds; a load that is running when its owner folder turns stale is marked straddled.
const explore = (rules: Rules, ids: string[], start: Fs, overrun: boolean, denials = true): Result => {
  const init: State = { fs: cloneFs(start), runs: ids.map(newRun) };
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
        if (denials) {
          const d = clone(s);
          if (deny(d, i, rules)) {
            checkSafety(d, overrun);
            next.push(d);
          }
        }
      });
      const ageable = overrun
        ? !s.runs.some((r) => live(r) && AFTER_CHECK.includes(r.pc))
        : !s.runs.some((r) => live(r) && r.holding);
      if (ageable && s.fs.lock && !(s.fs.lock.stale && Object.values(s.fs.lock.owners).every((o) => o.stale))) {
        const t = clone(s);
        age(t.fs);
        for (const r of t.runs) if (live(r) && r.pc === "loading") r.straddled = true;
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

const own = (by = -1): Owner => ({ stale: true, by });
const STARTS: Record<string, Fs> = {
  "no lock": { lock: null, tmp: {} },
  "a stale lock with one owner": { lock: { stale: true, by: -1, owners: { c0: own() } }, tmp: {} },
  "a stale lock without owner": { lock: { stale: true, by: -1, owners: {} }, tmp: {} },
  "a stale lock with two owners": { lock: { stale: true, by: -1, owners: { c0: own(), c1: own() } }, tmp: {} },
};

const IDS = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

describe("reload lock model, rules of update-operator step 6", () => {
  for (const runs of [2, 3]) {
    for (const [name, start] of Object.entries(STARTS)) {
      test(`${runs} runs from ${name}: one reload at a time, no fresh owner removed, nothing left behind, the lock always takeable again`, () => {
        const r = explore(CURRENT, IDS(runs), start, false, runs === 2);
        expect(r.violation).toBeUndefined();
        expect(r.states).toBeGreaterThan(10);
      });
      test(`${runs} runs from ${name}, a holder outliving the stale limit: only a load that straddles the limit overlaps another run's move or load`, () => {
        expect(explore(CURRENT, IDS(runs), start, true, runs === 2).violation).toBeUndefined();
      });
    }
  }

  test("2 runs that drew the same id, a holder outliving the stale limit: the redraw keeps them apart", () => {
    expect(explore(CURRENT, ["x", "x"], STARTS["no lock"], true).violation).toBeUndefined();
  });
});

describe("the model finds the defects it guards against", () => {
  test("rules at c980c52: a run stopped between its two mkdir leaves a lock no later run can take", () => {
    expect(explore(AT_C980C52, IDS(2), STARTS["no lock"], false, false).violation).toContain("no run can take the lock");
  });

  test("without the check after the take, two runs that break the same ownerless lock reload at once", () => {
    const r = explore({ ...CURRENT, checkAfterTake: false }, IDS(2), STARTS["a stale lock without owner"], false);
    expect(r.violation).toContain("reload at once");
  });

  test("without breaking a lock with more than one owner, two stopped runs leave a lock no later run can take", () => {
    const r = explore({ ...CURRENT, multiBreak: false }, IDS(2), STARTS["a stale lock with two owners"], false);
    expect(r.violation).toContain("no run can take the lock");
  });

  test("without the age check of the run's own owner folder, a holder outliving the limit moves or loads next to the run that broke its lock", () => {
    const r = explore({ ...CURRENT, ownAgeCheck: false }, IDS(2), STARTS["no lock"], true);
    expect(r.violation).toContain("reload at once");
  });

  test("a denied command after the take that skips step 6.6 leaves the run's owner folder or temp file behind", () => {
    const r = explore({ ...CURRENT, denialReleases: false }, IDS(2), STARTS["no lock"], false);
    expect(r.violation).toMatch(/ended notAllowed and left its (owner folder|temp file)/);
  });

  test("without removing the lock after a failed check of the take, two runs sent away leave a fresh lock without owner", () => {
    const r = explore({ ...CURRENT, takeCheckRemovesLock: false }, IDS(2), STARTS["a stale lock without owner"], false, false);
    expect(r.violation).toContain("left a fresh lock without owner");
  });

  test("without the redraw, a run whose id equals the stale holder's takes the lock under that id and both reload", () => {
    const r = explore({ ...CURRENT, redraw: false }, ["x", "x"], STARTS["no lock"], true);
    expect(r.violation).toMatch(/reload at once|temp file of run/);
  });
});
