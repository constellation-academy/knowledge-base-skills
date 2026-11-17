import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "../plugins/knowledge-base");
const runtime = await Bun.file(join(PLUGIN, "skills/update-operator/runtime.md")).text();
const updater = await Bun.file(join(PLUGIN, "skills/update-operator/SKILL.md")).text();
const setup = await Bun.file(join(PLUGIN, "skills/setup-operator/SKILL.md")).text();
const PWSH = Bun.which("pwsh");
setDefaultTimeout(60_000);

const reloadSection = (): string => {
  const start = runtime.indexOf("\n## Reload\n");
  if (start < 0) return "";
  const rest = runtime.slice(start + 1);
  const next = rest.indexOf("\n## ", 3);
  return next < 0 ? rest : rest.slice(0, next);
};

const blocks = (text: string) => [...text.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1].trim());

const idCommands = () => {
  const b = blocks(reloadSection());
  const pick = (exact: string) => b.find((x) => x === exact) ?? "";
  return {
    idSh: pick('mktemp -u "<import>/kb-export.XXXXXXXXXXXX"'),
    idPs: pick("[guid]::NewGuid().ToString('N').Substring(0,12)"),
  };
};

const reloadStep = updater.slice(updater.indexOf("\n### 6. Reload the index"), updater.indexOf("\n### 7. Report"));
const runFileCommands = () => {
  const b = blocks(reloadStep);
  const rm = reloadStep.match(/`(rm "[^`]+")`/);
  return { chmod: b.find((x) => x.startsWith("chmod ")) ?? "", rm: rm ? rm[1] : "" };
};

const sweepCommands = () => blocks(setup.slice(setup.indexOf("1. **Load.**"), setup.indexOf("2. **Full-text index"))).filter((c) => c.startsWith("find "));

let IMPORT = "";

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
  IMPORT = mkdtempSync(join(tmpdir(), "kb-reload-"));
});

afterEach(() => {
  chmodSync(IMPORT, 0o755);
  rmSync(IMPORT, { recursive: true, force: true });
});

if (!PWSH) console.warn("PowerShell reload runs skipped: pwsh is not on PATH");

describe("runtime.md and update-operator name the reload commands", () => {
  test("one run id command per shell", () => {
    expect(idCommands()).toEqual({
      idSh: 'mktemp -u "<import>/kb-export.XXXXXXXXXXXX"',
      idPs: "[guid]::NewGuid().ToString('N').Substring(0,12)",
    });
  });

  test("the chmod matches run files by a ? pattern, the rm names only the run's own file", () => {
    expect(runFileCommands()).toEqual({
      chmod: 'chmod 644 "<import>"/kb-export.????????????.json',
      rm: 'rm "<import>/kb-export.<run id>.json"',
    });
  });

  test("setup-operator pre-allows the run id and the chmod exactly, and never the rm", () => {
    const c = idCommands();
    expect(setup).toContain(`Bash(${c.idSh})`);
    expect(setup).toContain(`Bash(${runFileCommands().chmod})`);
    expect(setup).toContain(`PowerShell(${c.idPs})`);
    expect(setup).not.toContain(`Bash(${runFileCommands().rm})`);
  });
});

for (const shell of ["bash", "zsh", "pwsh"] as const) {
  const skip = shell === "pwsh" && !PWSH;
  describe(`run id in ${shell}`, () => {
    test.skipIf(skip)("prints 12 letters or digits, a new one each time, and leaves nothing behind, also in a read-only folder", () => {
      const c = idCommands();
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

describe("the chmod is skipped in PowerShell", () => {
  const SCOPE =
    'The `chmod` runs only in bash and zsh on macOS and Linux: skip it in PowerShell on every OS, where `"<import>"/kb-export.????????????.json` splits into two arguments and `chmod` then changes the import folder itself, and skip it on Windows in every shell, Git Bash included.';

  test("runtime.md and update-operator state the same scope", () => {
    expect(runtime).toContain(SCOPE);
    expect(reloadStep).toContain(SCOPE);
  });

  test.skipIf(!PWSH)("in pwsh the pattern splits into two arguments and the chmod changes the import folder itself", () => {
    const f = join(IMPORT, "kb-export.aaaaaaaaaaaa.json");
    writeFileSync(f, "{}", { mode: 0o600 });
    chmodSync(IMPORT, 0o700);
    const r = run("pwsh", runFileCommands().chmod);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("/kb-export.????????????.json");
    expect(statSync(IMPORT).mode & 0o777).toBe(0o644);
    chmodSync(IMPORT, 0o755);
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });
});

describe("setup-operator's sweep in bash", () => {
  test("removes run exports, 1.2.4 temp exports and the 1.2.4 shared export older than 30 minutes, and nothing younger or else", () => {
    const old = ["kb-export.aaaaaaaaaaaa.json", "kb-export.json.tmp", "kb-export.json", "other.json"];
    for (const n of old) {
      writeFileSync(join(IMPORT, n), "{}");
      age(join(IMPORT, n), 31 * 60);
    }
    writeFileSync(join(IMPORT, "kb-export.bbbbbbbbbbbb.json"), "{}");
    const cmds = sweepCommands();
    expect(cmds).toContain('find "<import>" -maxdepth 1 -name "kb-export.json" -mmin +30 -delete');
    for (const c of cmds) expect(run("bash", c).code).toBe(0);
    expect(readdirSync(IMPORT).sort()).toEqual(["kb-export.bbbbbbbbbbbb.json", "other.json"]);
  });

  test("keeps a 1.2.4 shared export younger than 30 minutes", () => {
    writeFileSync(join(IMPORT, "kb-export.json"), "{}");
    age(join(IMPORT, "kb-export.json"), 29 * 60);
    for (const c of sweepCommands()) run("bash", c);
    expect(readdirSync(IMPORT)).toEqual(["kb-export.json"]);
  });
});
