import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SECTIONS } from "./kb";
import { STEPS, runSteps } from "./kb-pre-commit";

describe("runSteps", () => {
  test("runs every step in order and returns 0", () => {
    const seen: string[] = [];
    expect(runSteps((s) => (seen.push(s), 0))).toBe(0);
    expect(seen).toEqual(STEPS);
  });

  test("stops at the first failing step and returns its status", () => {
    const seen: string[] = [];
    expect(runSteps((s) => (seen.push(s), s === "generate-indexes.ts" ? 3 : 0))).toBe(3);
    expect(seen).toEqual(["generate-indexes.ts"]);
  });
});

describe("kb-pre-commit.ts", () => {
  let root: string;
  const article = (title: string) => `---\ntype: template\ntitle: ${title}\ndescription: D.\ntags: [a]\n---\n\n# ${title}\n`;
  const run = () => spawnSync(process.execPath, ["scripts/kb-pre-commit.ts"], { cwd: root, encoding: "utf8" });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "kb-pre-commit-"));
    mkdirSync(join(root, "scripts"));
    for (const f of ["kb.ts", "generate-indexes.ts", "lint-kb.ts", "kb-pre-commit.ts"]) {
      copyFileSync(join(import.meta.dir, f), join(root, "scripts", f));
    }
    for (const s of SECTIONS) mkdirSync(join(root, s.dir));
    writeFileSync(join(root, "templates", "a.md"), article("Alpha"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test("regenerates a missing index and exits 0", () => {
    expect(existsSync(join(root, "index.md"))).toBe(false);
    expect(run().status).toBe(0);
    expect(readFileSync(join(root, "templates", "index.md"), "utf8")).toContain("[Alpha](a.md)");
    expect(readFileSync(join(root, "index.md"), "utf8")).toContain("[Alpha](templates/a.md)");
  });

  test("fails on a lint error", () => {
    writeFileSync(join(root, "templates", "b.md"), "---\ntype: template\ntitle: Beta\n---\n\nBody\n");
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing required field 'description'");
  });
});
