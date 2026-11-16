import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "../plugins/knowledge-base");
const runtime = await Bun.file(join(PLUGIN, "skills/update-operator/runtime.md")).text();
const PWSH = Bun.which("pwsh");

const lockSection = (): string => {
  const start = runtime.indexOf("\n## Reload lock\n");
  if (start < 0) return "";
  const rest = runtime.slice(start + 1);
  const next = rest.indexOf("\n## ", 3);
  return next < 0 ? rest : rest.slice(0, next);
};

const lockCommands = () => {
  const blocks = [...lockSection().matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  const pick = (prefix: string) => blocks.find((b) => b.startsWith(prefix)) ?? "";
  return {
    take: pick("mkdir "),
    release: pick("rmdir "),
    ageSh: pick("find "),
    agePs: pick("(Get-Item "),
  };
};

let IMPORT = "";
const LOCK = () => join(IMPORT, "reload.lock");
const render = (cmd: string) => cmd.replaceAll("<import>", IMPORT);

const run = (shell: string, cmd: string) => {
  const argv = shell === "pwsh" ? [PWSH!, "-NoProfile", "-NonInteractive", "-Command", render(cmd)] : [shell, "-c", render(cmd)];
  const r = Bun.spawnSync(argv);
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() };
};

const age = (seconds: number) => {
  const t = Date.now() / 1000 - seconds;
  utimesSync(LOCK(), t, t);
};

beforeEach(() => {
  IMPORT = mkdtempSync(join(tmpdir(), "kb-lock-"));
});

afterEach(() => {
  rmSync(IMPORT, { recursive: true, force: true });
});

if (!PWSH) console.warn("PowerShell reload-lock runs skipped: pwsh is not on PATH");

describe("runtime.md names the reload lock commands", () => {
  test("take, release and the age check per shell", () => {
    expect(lockCommands()).toEqual({
      take: 'mkdir "<import>/reload.lock"',
      release: 'rmdir "<import>/reload.lock"',
      ageSh: 'find "<import>/reload.lock" -maxdepth 0 -mmin +10',
      agePs: '(Get-Item "<import>/reload.lock").LastWriteTime.AddMinutes(10) -lt (Get-Date)',
    });
  });

  test("setup-operator pre-allows them, so a headless session is not stopped", async () => {
    const setup = await Bun.file(join(PLUGIN, "skills/setup-operator/SKILL.md")).text();
    const { take, release, ageSh, agePs } = lockCommands();
    for (const c of [take, release, ageSh]) expect(setup).toContain(`Bash(${c})`);
    expect(setup).toContain(`PowerShell(${agePs})`);
  });
});

for (const shell of ["bash", "zsh", ...(PWSH ? ["pwsh"] : [])]) {
  describe(`reload lock in ${shell}`, () => {
    const { take, release, ageSh, agePs } = lockCommands();
    const ageCmd = shell === "pwsh" ? agePs : ageSh;
    const stale = (out: string) => (shell === "pwsh" ? out === "True" : out === LOCK());
    const fresh = (out: string) => (shell === "pwsh" ? out === "False" : out === "");

    test("the take succeeds once and fails while the lock exists", () => {
      expect(run(shell, take).code).toBe(0);
      expect(existsSync(LOCK())).toBe(true);
      const second = run(shell, take);
      expect(second.code).not.toBe(0);
      expect(second.err.length).toBeGreaterThan(0);
    });

    test("the release removes the lock, and the take succeeds again", () => {
      expect(run(shell, take).code).toBe(0);
      expect(run(shell, release).code).toBe(0);
      expect(existsSync(LOCK())).toBe(false);
      expect(run(shell, take).code).toBe(0);
    });

    test("a lock just taken, or 9 minutes old, is fresh", () => {
      expect(run(shell, take).code).toBe(0);
      let r = run(shell, ageCmd);
      expect(r.code).toBe(0);
      expect(fresh(r.out)).toBe(true);
      age(9 * 60);
      r = run(shell, ageCmd);
      expect(r.code).toBe(0);
      expect(fresh(r.out)).toBe(true);
    });

    test("a lock 12 minutes old is stale", () => {
      mkdirSync(LOCK());
      age(12 * 60);
      const r = run(shell, ageCmd);
      expect(r.code).toBe(0);
      expect(stale(r.out)).toBe(true);
    });

    test("the age check of a missing lock fails with an error, never prints stale or fresh", () => {
      const r = run(shell, ageCmd);
      expect(r.err.length).toBeGreaterThan(0);
      expect(stale(r.out)).toBe(false);
      if (shell !== "pwsh") expect(r.code).not.toBe(0);
    });
  });
}
