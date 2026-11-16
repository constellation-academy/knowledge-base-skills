import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
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
    take: pick('mkdir "<import>/reload.lock"'),
    takeOwner: pick('mkdir "<import>/reload.lock/<run id>"'),
    list: pick('ls "<import>/reload.lock"'),
    ageSh: pickPrefix("find "),
    agePs: pickPrefix("(Get-Item "),
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

if (!PWSH) console.warn("PowerShell reload-lock runs skipped: pwsh is not on PATH");

describe("runtime.md names the reload lock commands", () => {
  test("take, list, age check per shell, break and release", () => {
    expect(lockCommands()).toEqual({
      take: 'mkdir "<import>/reload.lock"',
      takeOwner: 'mkdir "<import>/reload.lock/<run id>"',
      list: 'ls "<import>/reload.lock"',
      ageSh: 'find "<import>/reload.lock/<old>" -maxdepth 0 -mmin +30',
      agePs: '(Get-Item "<import>/reload.lock/<old>").LastWriteTime.AddMinutes(30) -lt (Get-Date)',
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

  test("setup-operator pre-allows them, so a headless session is not stopped", async () => {
    const setup = await Bun.file(join(PLUGIN, "skills/setup-operator/SKILL.md")).text();
    const { take, takeOwner, ageSh, agePs, breakOwner, removeLock } = lockCommands();
    const wild = (c: string) => c.replace("<run id>", "*").replace("<old>", "*");
    for (const c of [take, takeOwner, ageSh, breakOwner, removeLock]) expect(setup).toContain(`Bash(${wild(c)})`);
    expect(setup).toContain(`PowerShell(${wild(agePs)})`);
    expect(setup).not.toContain('Bash(find "<import>/reload.lock" -maxdepth 0');
    expect(setup).toContain("Read(//<kb folder>/**)");
  });
});

for (const shell of ["bash", "zsh", ...(PWSH ? ["pwsh"] : [])]) {
  describe(`reload lock in ${shell}`, () => {
    const c = lockCommands();
    const ageCmd = shell === "pwsh" ? c.agePs : c.ageSh;
    const stale = (out: string, old: string) => (shell === "pwsh" ? out === "True" : out === join(LOCK(), old));
    const fresh = (out: string) => (shell === "pwsh" ? out === "False" : out === "");
    const listed = (out: string, name: string) => out.split(/\s+/).includes(name);

    const take = (runId: string) => {
      if (run(shell, c.take).code !== 0) return false;
      return run(shell, c.takeOwner, { runId }).code === 0;
    };

    const release = (runId: string) => {
      if (run(shell, c.releaseOwner, { runId }).code !== 0) return "taken over";
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
  });
}
