import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../plugins/knowledge-base/skills/setup-operator/scripts/merge-settings.py");
const hasPython = Bun.spawnSync(["python3", "--version"]).exitCode === 0;

let dir = "";
const settings = () => join(dir, "settings.local.json");
const fragment = () => join(dir, "kb-setup.fragment.json");

const merge = (frag: unknown) => {
  writeFileSync(fragment(), JSON.stringify(frag));
  const r = Bun.spawnSync(["python3", "-I", SCRIPT, fragment(), settings()]);
  return { code: r.exitCode, out: r.stdout.toString() };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kb-merge-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.if(hasPython)("merge-settings.py", () => {
  test("creates the file with mode 600 and removes the fragment", () => {
    const r = merge({ permissions: { deny: ["Read(/.claude/settings.local.json)"] } });
    expect(r.code).toBe(0);
    expect(r.out).toBe("added deny Read(/.claude/settings.local.json)\npassword: absent\n");
    expect(statSync(settings()).mode & 0o777).toBe(0o600);
    expect(existsSync(fragment())).toBe(false);
  });

  test("keeps other keys, adds missing entries once, never changes a differing value", () => {
    writeFileSync(settings(), JSON.stringify({ model: "x", env: { KB_PATH: "/old", OTHER: "1" }, permissions: { allow: ["Bash(ls)"] } }));
    const r = merge({ env: { KB_PATH: "/new", NEO4J_DATABASE: "neo4j" }, permissions: { allow: ["Bash(ls)", "mcp__kb-x__*"] } });
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      "conflict env KB_PATH: current /old, wanted /new\nadded env NEO4J_DATABASE\nkept allow Bash(ls)\nadded allow mcp__kb-x__*\npassword: absent\n",
    );
    const d = JSON.parse(readFileSync(settings(), "utf8"));
    expect(d).toEqual({
      model: "x",
      env: { KB_PATH: "/old", OTHER: "1", NEO4J_DATABASE: "neo4j" },
      permissions: { allow: ["Bash(ls)", "mcp__kb-x__*"] },
    });
  });

  test("replaces a listed non-secret key only, and says so", () => {
    writeFileSync(settings(), JSON.stringify({ env: { NEO4J_SHELL: "cypher-shell -a x", NEO4J_PASSWORD: "keep-me" } }));
    const r = merge({ env: { NEO4J_SHELL: "docker exec y", NEO4J_PASSWORD: "__KB_PASSWORD__" }, replace_env: ["NEO4J_SHELL", "NEO4J_PASSWORD"] });
    expect(r.out).toBe("replaced env NEO4J_SHELL: was cypher-shell -a x, now docker exec y\nconflict env NEO4J_PASSWORD\npassword: present\n");
    expect(JSON.parse(readFileSync(settings(), "utf8")).env).toEqual({ NEO4J_SHELL: "docker exec y", NEO4J_PASSWORD: "keep-me" });
  });

  test("never prints a password value", () => {
    writeFileSync(settings(), JSON.stringify({ env: { NEO4J_PASSWORD: "s3cret-value" } }));
    const r = merge({ env: { NEO4J_PASSWORD: "__KB_PASSWORD__" } });
    expect(r.code).toBe(0);
    expect(r.out).toBe("conflict env NEO4J_PASSWORD\npassword: present\n");
    expect(r.out).not.toContain("s3cret");
  });

  test("reports a placeholder password", () => {
    expect(merge({ env: { NEO4J_PASSWORD: "__KB_PASSWORD__" } }).out).toBe("added env NEO4J_PASSWORD\npassword: placeholder\n");
  });

  test("refuses an env or permission list of the wrong type before writing anything", () => {
    for (const bad of [{ env: "x" }, { permissions: [] }, { permissions: { deny: "Read(x)" } }]) {
      writeFileSync(settings(), JSON.stringify(bad));
      const r = merge({ permissions: { deny: ["Read(/.claude/settings.local.json)"] } });
      expect(r.code).toBe(2);
      expect(r.out).toStartWith("error: ");
      expect(r.out).toEndWith("; nothing changed\n");
      expect(JSON.parse(readFileSync(settings(), "utf8"))).toEqual(bad);
      expect(existsSync(fragment())).toBe(true);
    }
  });

  test("refuses invalid JSON and changes nothing", () => {
    writeFileSync(settings(), "{ not json");
    const r = merge({ env: { KB_PATH: "/x" } });
    expect(r.code).toBe(2);
    expect(r.out).toBe("error: the settings file is not valid JSON; nothing changed\n");
    expect(readFileSync(settings(), "utf8")).toBe("{ not json");
  });
});
