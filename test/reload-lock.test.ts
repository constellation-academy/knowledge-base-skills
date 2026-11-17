import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "../plugins/knowledge-base");
const runtime = await Bun.file(join(PLUGIN, "skills/update-operator/runtime.md")).text();
const PWSH = Bun.which("pwsh");
setDefaultTimeout(60_000);

const lockSection = (): string => {
  const start = runtime.indexOf("\n## Reload lock\n");
  if (start < 0) return "";
  const rest = runtime.slice(start + 1);
  const next = rest.indexOf("\n## ", 3);
  return next < 0 ? rest : rest.slice(0, next);
};

const lockCommands = () => {
  const blocks = [...lockSection().matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  const pick = (exact: string) => blocks.find((b) => b === exact) ?? "";
  const pickPrefix = (prefix: string) => blocks.find((b) => b.startsWith(prefix)) ?? "";
  return {
    idSh: pick("mktemp -u XXXXXXXXXXXX"),
    idPs: pick("[guid]::NewGuid().ToString('N').Substring(0,12)"),
    take: pick('mkdir "<import>/reload.lock"'),
    takeOwner: pick('mkdir "<import>/reload.lock/<run id>"'),
    list: pick('ls "<import>/reload.lock"'),
    ageSh: pickPrefix('find "<import>/reload.lock/<old>"'),
    agePs: pickPrefix('(Get-Item "<import>/reload.lock/<old>")'),
    ageLockSh: pickPrefix('find "<import>/reload.lock" '),
    ageLockPs: pickPrefix('(Get-Item "<import>/reload.lock")'),
    breakOwner: pick('rmdir "<import>/reload.lock/<old>"'),
    releaseOwner: pick('rmdir "<import>/reload.lock/<run id>"'),
    removeLock: pick('rmdir "<import>/reload.lock"'),
  };
};

let IMPORT = "";
const LOCK = () => join(IMPORT, "reload.lock");
const owners = () => (existsSync(LOCK()) ? readdirSync(LOCK()) : null);

const render = (cmd: string, vars: { runId?: string; old?: string } = {}) =>
  cmd
    .replaceAll("<import>", IMPORT)
    .replaceAll("<run id>", vars.runId ?? "<run id>")
    .replaceAll("<old>", vars.old ?? "<old>");

const run = (shell: string, cmd: string, vars: { runId?: string; old?: string } = {}) => {
  const line = render(cmd, vars);
  const argv = shell === "pwsh" ? [PWSH!, "-NoProfile", "-NonInteractive", "-Command", line] : [shell, "-c", line];
  const r = Bun.spawnSync(argv);
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() };
};

const ageOwner = (name: string, seconds: number) => {
  const t = Date.now() / 1000 - seconds;
  utimesSync(join(LOCK(), name), t, t);
};

const holdAs = (name: string, ageSeconds = 0) => {
  mkdirSync(join(LOCK(), name), { recursive: true });
  if (ageSeconds) ageOwner(name, ageSeconds);
};

beforeEach(() => {
  IMPORT = mkdtempSync(join(tmpdir(), "kb-lock-"));
});

afterEach(() => {
  rmSync(IMPORT, { recursive: true, force: true });
});

const PWSH_NOTE = "PowerShell on macOS; Windows cmdlet behaviour unverified";
if (!PWSH) console.warn(`PowerShell reload-lock runs (${PWSH_NOTE}) skipped: pwsh is not on PATH`);

describe("runtime.md names the reload lock commands", () => {
  test("run id, take, list, age checks per shell, break and release", () => {
    expect(lockCommands()).toEqual({
      idSh: "mktemp -u XXXXXXXXXXXX",
      idPs: "[guid]::NewGuid().ToString('N').Substring(0,12)",
      take: 'mkdir "<import>/reload.lock"',
      takeOwner: 'mkdir "<import>/reload.lock/<run id>"',
      list: 'ls "<import>/reload.lock"',
      ageSh: 'find "<import>/reload.lock/<old>" -maxdepth 0 -mmin +30',
      agePs: '(Get-Item "<import>/reload.lock/<old>").LastWriteTime.AddMinutes(30) -lt (Get-Date)',
      ageLockSh: 'find "<import>/reload.lock" -maxdepth 0 -mmin +30',
      ageLockPs: '(Get-Item "<import>/reload.lock").LastWriteTime.AddMinutes(30) -lt (Get-Date)',
      breakOwner: 'rmdir "<import>/reload.lock/<old>"',
      releaseOwner: 'rmdir "<import>/reload.lock/<run id>"',
      removeLock: 'rmdir "<import>/reload.lock"',
    });
  });

  test("stale means more than 30 minutes, not 10", () => {
    const section = lockSection();
    expect(section).toContain("more than 30 minutes");
    expect(section).not.toContain("more than 10 minutes");
    expect(section).not.toContain("+10");
    expect(section).not.toContain("AddMinutes(10)");
  });

  test("setup-operator pre-allows them, except find and ls, which are built-in read-only commands", async () => {
    const setup = await Bun.file(join(PLUGIN, "skills/setup-operator/SKILL.md")).text();
    const { idSh, idPs, take, takeOwner, agePs, ageLockPs, breakOwner, removeLock } = lockCommands();
    const wild = (c: string) => c.replace("<run id>", "*").replace("<old>", "*");
    for (const c of [idSh, take, takeOwner, breakOwner, removeLock]) expect(setup).toContain(`Bash(${wild(c)})`);
    for (const c of [idPs, agePs, ageLockPs]) expect(setup).toContain(`PowerShell(${wild(c)})`);
    expect(setup).not.toContain("Bash(find ");
    expect(setup).toContain("https://code.claude.com/docs/en/permissions#read-only-commands");
  });

  test("records the PowerShell observations as seen on macOS and unverified on Windows", () => {
    const section = lockSection();
    expect(section).toContain("New-Item -ItemType Directory");
    expect(section).toMatch(/creates missing parent/);
    expect(section).toMatch(/stdin closed[^.]*printed the confirmation[^.]*removed nothing/);
    expect(section.match(/seen in pwsh on macOS, unverified on Windows/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

for (const shell of ["bash", "zsh", ...(PWSH ? ["pwsh"] : [])]) {
  describe(`reload lock in ${shell}${shell === "pwsh" ? ` (${PWSH_NOTE})` : ""}`, () => {
    const c = lockCommands();
    const ageCmd = shell === "pwsh" ? c.agePs : c.ageSh;
    const ageLockCmd = shell === "pwsh" ? c.ageLockPs : c.ageLockSh;
    const idCmd = shell === "pwsh" ? c.idPs : c.idSh;
    const stale = (out: string, old: string) => (shell === "pwsh" ? out === "True" : out === join(LOCK(), old));
    const lockStale = (out: string) => (shell === "pwsh" ? out === "True" : out === LOCK());
    const ageLock = (seconds: number) => {
      const t = Date.now() / 1000 - seconds;
      utimesSync(LOCK(), t, t);
    };
    const fresh = (out: string) => (shell === "pwsh" ? out === "False" : out === "");
    const listed = (out: string, name: string) => out.split(/\s+/).includes(name);

    const take = (runId: string) => {
      if (run(shell, c.take).code !== 0) return false;
      return run(shell, c.takeOwner, { runId }).code === 0;
    };

    const missing = (err: string) => /No such file or directory|Cannot find path|does not exist/i.test(err);

    const release = (runId: string) => {
      const r = run(shell, c.releaseOwner, { runId });
      if (r.code !== 0) {
        if (missing(r.err)) return "taken over";
        throw new Error(`release failed otherwise: ${r.err}`);
      }
      run(shell, c.removeLock);
      return "released";
    };

    test("the take succeeds once and fails while the lock exists", () => {
      expect(take("aaaaaaaaaaaa")).toBe(true);
      expect(owners()).toEqual(["aaaaaaaaaaaa"]);
      const second = run(shell, c.take);
      expect(second.code).not.toBe(0);
      expect(second.err.length).toBeGreaterThan(0);
    });

    test("the listing names the owner, prints nothing for an ownerless lock, and fails for a missing lock", () => {
      mkdirSync(LOCK());
      let r = run(shell, c.list);
      expect(r.code).toBe(0);
      expect(r.out).toBe("");
      mkdirSync(join(LOCK(), "aaaaaaaaaaaa"));
      r = run(shell, c.list);
      expect(r.code).toBe(0);
      expect(listed(r.out, "aaaaaaaaaaaa")).toBe(true);
      rmSync(LOCK(), { recursive: true });
      r = run(shell, c.list);
      expect(r.err.length).toBeGreaterThan(0);
      if (shell !== "pwsh") expect(r.code).not.toBe(0);
    });

    test("the release removes the owner folder and the lock, and the take succeeds again", () => {
      expect(take("aaaaaaaaaaaa")).toBe(true);
      expect(release("aaaaaaaaaaaa")).toBe("released");
      expect(existsSync(LOCK())).toBe(false);
      expect(take("bbbbbbbbbbbb")).toBe(true);
    });

    test("an owner just created, or 29 minutes old, is fresh", () => {
      holdAs("aaaaaaaaaaaa");
      let r = run(shell, ageCmd, { old: "aaaaaaaaaaaa" });
      expect(r.code).toBe(0);
      expect(fresh(r.out)).toBe(true);
      ageOwner("aaaaaaaaaaaa", 29 * 60);
      r = run(shell, ageCmd, { old: "aaaaaaaaaaaa" });
      expect(r.code).toBe(0);
      expect(fresh(r.out)).toBe(true);
    });

    test("an owner 32 minutes old is stale", () => {
      holdAs("aaaaaaaaaaaa", 32 * 60);
      const r = run(shell, ageCmd, { old: "aaaaaaaaaaaa" });
      expect(r.code).toBe(0);
      expect(stale(r.out, "aaaaaaaaaaaa")).toBe(true);
    });

    test("the age check of a missing owner fails with an error, never prints stale or fresh", () => {
      mkdirSync(LOCK());
      const r = run(shell, ageCmd, { old: "aaaaaaaaaaaa" });
      expect(r.err.length).toBeGreaterThan(0);
      expect(stale(r.out, "aaaaaaaaaaaa")).toBe(false);
      if (shell !== "pwsh") expect(r.code).not.toBe(0);
    });

    test("two runs break the same stale lock: only the first break succeeds, and the second leaves the new holder alone", () => {
      holdAs("000000000000", 32 * 60);
      expect(stale(run(shell, ageCmd, { old: "000000000000" }).out, "000000000000")).toBe(true);
      expect(stale(run(shell, ageCmd, { old: "000000000000" }).out, "000000000000")).toBe(true);

      expect(run(shell, c.breakOwner, { old: "000000000000" }).code).toBe(0);
      expect(run(shell, c.removeLock).code).toBe(0);
      expect(take("aaaaaaaaaaaa")).toBe(true);

      const b = run(shell, c.breakOwner, { old: "000000000000" });
      expect(b.code).not.toBe(0);
      expect(b.err.length).toBeGreaterThan(0);
      expect(owners()).toEqual(["aaaaaaaaaaaa"]);
      expect(take("bbbbbbbbbbbb")).toBe(false);
      expect(owners()).toEqual(["aaaaaaaaaaaa"]);
    });

    test("the second break also fails between the first run's break and its new take", () => {
      holdAs("000000000000", 32 * 60);
      expect(run(shell, c.breakOwner, { old: "000000000000" }).code).toBe(0);
      expect(run(shell, c.breakOwner, { old: "000000000000" }).code).not.toBe(0);
      expect(run(shell, c.removeLock).code).toBe(0);
      expect(take("aaaaaaaaaaaa")).toBe(true);
      expect(owners()).toEqual(["aaaaaaaaaaaa"]);
    });

    test("a run whose lock was taken over sees it in the listing and its release leaves the new holder's lock", () => {
      expect(take("aaaaaaaaaaaa")).toBe(true);
      ageOwner("aaaaaaaaaaaa", 32 * 60);

      expect(stale(run(shell, ageCmd, { old: "aaaaaaaaaaaa" }).out, "aaaaaaaaaaaa")).toBe(true);
      expect(run(shell, c.breakOwner, { old: "aaaaaaaaaaaa" }).code).toBe(0);
      expect(run(shell, c.removeLock).code).toBe(0);
      expect(take("bbbbbbbbbbbb")).toBe(true);

      const check = run(shell, c.list);
      expect(check.code).toBe(0);
      expect(listed(check.out, "aaaaaaaaaaaa")).toBe(false);

      expect(release("aaaaaaaaaaaa")).toBe("taken over");
      expect(owners()).toEqual(["bbbbbbbbbbbb"]);
    });

    test("the run id command prints 12 letters or digits, a new one each time, and creates nothing", () => {
      const a = run(shell, idCmd);
      const b = run(shell, idCmd);
      expect(a.code).toBe(0);
      expect(a.out).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(b.out).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(a.out).not.toBe(b.out);
      expect(readdirSync(IMPORT)).toEqual([]);
    });

    test("the take's error says the lock exists; a missing import folder gives another error", () => {
      mkdirSync(LOCK());
      const exists = run(shell, c.take);
      expect(exists.code).not.toBe(0);
      expect(exists.err).toMatch(/exists/i);
      rmSync(IMPORT, { recursive: true, force: true });
      const noImport = run(shell, c.take);
      expect(noImport.code).not.toBe(0);
      expect(noImport.err).not.toMatch(/exists/i);
      mkdirSync(IMPORT);
    });

    test("an ownerless lock is aged by the lock folder, and creating or removing an owner folder makes it fresh", () => {
      mkdirSync(LOCK());
      let r = run(shell, ageLockCmd);
      expect(r.code).toBe(0);
      expect(lockStale(r.out)).toBe(false);
      ageLock(32 * 60);
      expect(lockStale(run(shell, ageLockCmd).out)).toBe(true);
      expect(run(shell, c.takeOwner, { runId: "aaaaaaaaaaaa" }).code).toBe(0);
      expect(lockStale(run(shell, ageLockCmd).out)).toBe(false);
      ageLock(32 * 60);
      expect(release("aaaaaaaaaaaa")).toBe("released");
      mkdirSync(LOCK());
      mkdirSync(join(LOCK(), "bbbbbbbbbbbb"));
      ageLock(32 * 60);
      expect(run(shell, c.releaseOwner, { runId: "bbbbbbbbbbbb" }).code).toBe(0);
      expect(lockStale(run(shell, ageLockCmd).out)).toBe(false);
    });

    test("a release whose owner folder is gone reports it as missing, not as another failure", () => {
      mkdirSync(LOCK());
      expect(release("aaaaaaaaaaaa")).toBe("taken over");
    });

    test("a hidden entry is not listed but keeps the lock from being removed", () => {
      mkdirSync(LOCK());
      writeFileSync(join(LOCK(), ".DS_Store"), "");
      const l = run(shell, c.list);
      expect(l.code).toBe(0);
      expect(l.out).toBe("");
      const r = run(shell, c.removeLock);
      expect(r.code).not.toBe(0);
      expect(missing(r.err)).toBe(false);
      expect(r.err).toMatch(/not empty/i);
      expect(existsSync(LOCK())).toBe(true);
    });
  });
}
