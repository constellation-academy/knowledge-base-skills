import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "../plugins/knowledge-base");
const runtime = await Bun.file(join(PLUGIN, "skills/update-operator/runtime.md")).text();
const updater = await Bun.file(join(PLUGIN, "skills/update-operator/SKILL.md")).text();
const PWSH = Bun.which("pwsh");
setDefaultTimeout(60_000);

const lockSection = (): string => {
  const start = runtime.indexOf("\n## Reload lock\n");
  if (start < 0) return "";
  const rest = runtime.slice(start + 1);
  const next = rest.indexOf("\n## ", 3);
  return next < 0 ? rest : rest.slice(0, next);
};

const blocks = (text: string) => [...text.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trim());

const lockCommands = () => {
  const b = blocks(lockSection());
  const pick = (exact: string) => b.find((x) => x === exact) ?? "";
  const pickPrefix = (prefix: string) => b.find((x) => x.startsWith(prefix)) ?? "";
  return {
    idSh: pick('mktemp -u "<import>/kb-export.XXXXXXXXXXXX"'),
    idPs: pick("[guid]::NewGuid().ToString('N').Substring(0,12)"),
    take: pick('mkdir "<import>/reload.lock"'),
    ageSh: pickPrefix('find "<import>/reload.lock" '),
    agePs: pickPrefix('(Get-Item "<import>/reload.lock")'),
    remove: pick('rmdir "<import>/reload.lock"'),
  };
};

const reloadStep = updater.slice(updater.indexOf("\n### 6. Reload the index"), updater.indexOf("\n### 7. Report"));
const runFileCommands = () => {
  const b = blocks(reloadStep);
  const rm = reloadStep.match(/`(rm "[^`]+")`/);
  return { chmod: b.find((x) => x.startsWith("chmod ")) ?? "", rm: rm ? rm[1] : "" };
};

let IMPORT = "";
const LOCK = () => join(IMPORT, "reload.lock");

const render = (cmd: string, runId = "<run id>") => cmd.replaceAll("<import>", IMPORT).replaceAll("<run id>", runId);

const run = (shell: string, cmd: string, opts: { runId?: string; cwd?: string; umask?: string } = {}) => {
  const line = render(cmd, opts.runId);
  const argv =
    shell === "pwsh"
      ? [PWSH!, "-NoProfile", "-NonInteractive", "-Command", line]
      : [shell, "-c", opts.umask ? `umask ${opts.umask}; ${line}` : line];
  const r = Bun.spawnSync(argv, { cwd: opts.cwd });
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() };
};

const age = (path: string, seconds: number) => {
  const t = Date.now() / 1000 - seconds;
  utimesSync(path, t, t);
};

beforeEach(() => {
  IMPORT = mkdtempSync(join(tmpdir(), "kb-lock-"));
});

afterEach(() => {
  rmSync(IMPORT, { recursive: true, force: true });
});

const PWSH_NOTE = "PowerShell on macOS; Windows cmdlet behaviour unverified";
if (!PWSH) console.warn(`PowerShell reload-lock runs (${PWSH_NOTE}) skipped: pwsh is not on PATH`);

describe("runtime.md and update-operator name the reload commands", () => {
  test("run id per shell, take, age check per shell, remove", () => {
    expect(lockCommands()).toEqual({
      idSh: 'mktemp -u "<import>/kb-export.XXXXXXXXXXXX"',
      idPs: "[guid]::NewGuid().ToString('N').Substring(0,12)",
      take: 'mkdir "<import>/reload.lock"',
      ageSh: 'find "<import>/reload.lock" -maxdepth 0 -mmin +30',
      agePs: '(Get-Item "<import>/reload.lock").LastWriteTime.AddMinutes(30) -lt (Get-Date)',
      remove: 'rmdir "<import>/reload.lock"',
    });
  });

  test("the chmod matches run files by a ? pattern, the rm names only the run's own file", () => {
    expect(runFileCommands()).toEqual({
      chmod: 'chmod 644 "<import>"/kb-export.????????????.json',
      rm: 'rm "<import>/kb-export.<run id>.json"',
    });
  });

  test("stale means more than 30 minutes", () => {
    expect(lockSection()).toContain("more than 30 minutes");
  });

  test("setup-operator pre-allows every reload command it can allow exactly, and never the rm", async () => {
    const setup = await Bun.file(join(PLUGIN, "skills/setup-operator/SKILL.md")).text();
    const c = lockCommands();
    for (const cmd of [c.idSh, c.take, c.remove, runFileCommands().chmod]) expect(setup).toContain(`Bash(${cmd})`);
    expect(setup).toContain(`PowerShell(${c.idPs})`);
    expect(setup).toContain(`PowerShell(${c.agePs})`);
    expect(setup).not.toContain(`Bash(${runFileCommands().rm})`);
  });
});

for (const shell of ["bash", "zsh", "pwsh"] as const) {
  const skip = shell === "pwsh" && !PWSH;
  describe(`reload lock in ${shell}${shell === "pwsh" ? ` (${PWSH_NOTE})` : ""}`, () => {
    const c = lockCommands();
    const ageCmd = shell === "pwsh" ? c.agePs : c.ageSh;
    const isStale = (out: string) => (shell === "pwsh" ? out === "True" : out !== "");
    const isFresh = (out: string) => (shell === "pwsh" ? out === "False" : out === "");
    const missing = (err: string) => /No such file or directory|Cannot find path|does not exist|nicht gefunden|nicht vorhanden/i.test(err);

    test.skipIf(skip)("the take succeeds once and fails with an error that says the lock exists", () => {
      expect(run(shell, c.take).code).toBe(0);
      const again = run(shell, c.take);
      expect(again.code).not.toBe(0);
      expect(again.err).toMatch(/File exists|already exists/i);
    });

    test.skipIf(skip)("a missing import folder gives another error than exists", () => {
      rmSync(IMPORT, { recursive: true, force: true });
      const r = run(shell, c.take);
      expect(r.code).not.toBe(0);
      expect(r.err).not.toMatch(/File exists|already exists/i);
    });

    test.skipIf(skip)("the lock is fresh when just taken or 29 minutes old, stale at 32 minutes", () => {
      run(shell, c.take);
      expect(isFresh(run(shell, ageCmd).out)).toBe(true);
      age(LOCK(), 29 * 60);
      expect(isFresh(run(shell, ageCmd).out)).toBe(true);
      age(LOCK(), 32 * 60);
      expect(isStale(run(shell, ageCmd).out)).toBe(true);
    });

    test.skipIf(skip)("the age check of a missing lock fails with an error that says it does not exist", () => {
      const r = run(shell, ageCmd);
      expect(missing(r.err)).toBe(true);
    });

    test.skipIf(skip)("rmdir removes the empty lock, and the take succeeds again", () => {
      run(shell, c.take);
      expect(run(shell, c.remove).code).toBe(0);
      expect(existsSync(LOCK())).toBe(false);
      expect(run(shell, c.take).code).toBe(0);
    });

    test.skipIf(skip)("a lost race on the stale break: the second rmdir removes the first run's fresh lock, and both take it", () => {
      run(shell, c.take);
      age(LOCK(), 32 * 60);
      expect(isStale(run(shell, ageCmd).out)).toBe(true);
      expect(run(shell, c.remove).code).toBe(0);
      expect(run(shell, c.take).code).toBe(0);
      expect(run(shell, c.remove).code).toBe(0);
      expect(run(shell, c.take).code).toBe(0);
      expect(readdirSync(LOCK())).toEqual([]);
    });

    test.skipIf(skip)("a hidden entry keeps rmdir from removing the lock", () => {
      run(shell, c.take);
      writeFileSync(join(LOCK(), ".DS_Store"), "");
      const r = run(shell, c.remove);
      expect(r.code).not.toBe(0);
      expect(existsSync(LOCK())).toBe(true);
    });

    test.skipIf(skip)("the run id command prints 12 letters or digits, a new one each time, and leaves nothing behind, also in a read-only folder", () => {
      const cmd = shell === "pwsh" ? c.idPs : c.idSh;
      const ro = mkdtempSync(join(tmpdir(), "kb-ro-"));
      chmodSync(ro, 0o555);
      try {
        const ids = new Set<string>();
        for (let i = 0; i < 5; i++) {
          const r = run(shell, cmd, { cwd: ro });
          expect(r.code, r.err).toBe(0);
          const id = shell === "pwsh" ? r.out : r.out.slice(r.out.lastIndexOf("kb-export.") + "kb-export.".length);
          if (shell !== "pwsh") expect(r.out).toBe(join(IMPORT, `kb-export.${id}`));
          expect(id).toMatch(/^[A-Za-z0-9]{12}$/);
          ids.add(id);
        }
        expect(ids.size).toBe(5);
        expect(readdirSync(IMPORT)).toEqual([]);
        expect(readdirSync(ro)).toEqual([]);
      } finally {
        chmodSync(ro, 0o755);
        rmSync(ro, { recursive: true, force: true });
      }
    });
  });
}

for (const shell of ["bash", "zsh"] as const) {
  describe(`run file commands in ${shell}`, () => {
    const { chmod, rm } = runFileCommands();
    const file = (id: string) => join(IMPORT, `kb-export.${id}.json`);

    test("the chmod makes every run file readable under umask 077 and touches no other name", () => {
      for (const id of ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]) writeFileSync(file(id), "{}", { mode: 0o600 });
      for (const other of ["kb-export.json", "kb-export.short.json", "kb-export.aaaaaaaaaaaa.json.tmp"]) writeFileSync(join(IMPORT, other), "{}", { mode: 0o600 });
      const r = run(shell, chmod, { umask: "077" });
      expect(r.code, r.err).toBe(0);
      for (const id of ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]) expect(statSync(file(id)).mode & 0o777).toBe(0o644);
      for (const other of ["kb-export.json", "kb-export.short.json", "kb-export.aaaaaaaaaaaa.json.tmp"]) expect(statSync(join(IMPORT, other)).mode & 0o777).toBe(0o600);
    });

    test("the chmod works in an import path with spaces", () => {
      const spaced = join(IMPORT, "with space");
      mkdirSync(spaced);
      writeFileSync(join(spaced, "kb-export.aaaaaaaaaaaa.json"), "{}", { mode: 0o600 });
      const r = Bun.spawnSync([shell, "-c", chmod.replaceAll("<import>", spaced)]);
      expect(r.exitCode).toBe(0);
      expect(statSync(join(spaced, "kb-export.aaaaaaaaaaaa.json")).mode & 0o777).toBe(0o644);
    });

    test("the rm removes only the run's own file", () => {
      for (const id of ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]) writeFileSync(file(id), "{}");
      expect(run(shell, rm, { runId: "aaaaaaaaaaaa" }).code).toBe(0);
      expect(readdirSync(IMPORT).sort()).toEqual(["kb-export.bbbbbbbbbbbb.json"]);
    });
  });
}
