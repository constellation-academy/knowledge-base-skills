import { describe, expect, test, beforeAll } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escapeLiteral, splitShell, main, loadConfig, parseRows, runQuery } from "../plugins/knowledge-base/scripts/kb-fetch";

const FIX = join(import.meta.dir, "fixtures/kb-fetch");
const BUN = process.execPath;
const SHELL = `${BUN} ${join(FIX, "fake-shell.ts")}`;
let root: string, kbPath: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "kbf-"));
  kbPath = join(root, "fx", "repo");
  mkdirSync(join(root, "fx"), { recursive: true });
  cpSync(join(FIX, "repo"), kbPath, { recursive: true });
});
const env = (o: Record<string, string | undefined> = {}) => ({ KB_PATH: kbPath, NEO4J_SHELL: SHELL, NEO4J_DATABASE: "neo4j", ...o });
const err = (r: { stderr: string }) => JSON.parse(r.stderr);

describe("escapeLiteral", () => {
  test("escapes per contract", () => {
    expect(escapeLiteral("C:\\temp")).toBe('"C:\\\\temp"');
    expect(escapeLiteral("it's")).toBe('"it\\u0027s"');
    expect(escapeLiteral('Café "fast"')).toBe('"Caf\\u00e9 \\u0022fast\\u0022"');
    expect(escapeLiteral("😀")).toBe('"\\ud83d\\ude00"');
    expect(escapeLiteral(null)).toBe("null");
    expect(escapeLiteral(10)).toBe("10");
  });
});

describe("shell forms", () => {
  test("docker form splits to 9 argv", () => {
    const argv = splitShell("docker exec  -i -e NEO4J_USERNAME -e NEO4J_PASSWORD  neo4j-fx cypher-shell");
    expect(argv).toHaveLength(9);
    expect(argv[0]).toBe("docker");
  });
  test("local form splits", () => {
    expect(splitShell("cypher-shell -a bolt://127.0.0.1:7687")).toEqual(["cypher-shell", "-a", "bolt://127.0.0.1:7687"]);
  });
  test("query dir: docker vs host", () => {
    const cfgOnly = loadConfig(env({ NEO4J_SHELL: "docker exec -i neo4j-fx cypher-shell" }));
    expect(cfgOnly.queryDir).toBe("/import/queries");
    const h = loadConfig(env({ NEO4J_SHELL: "cypher-shell -a bolt://127.0.0.1:7687" }));
    expect(h.queryDir).toBe(join(root, "fx", "import", "queries"));
  });
});

describe("config errors exit 2", () => {
  const cases: [string, () => Record<string, string | undefined>][] = [
    ["KB_PATH unset", () => ({ KB_PATH: undefined })],
    ["NEO4J_SHELL unset", () => ({ NEO4J_SHELL: undefined })],
    ["NEO4J_DATABASE unset", () => ({ NEO4J_DATABASE: undefined })],
    ["no manifest", () => ({ KB_PATH: join(root, "nomanifest") })],
  ];
  for (const [name, o] of cases)
    test(name, () => {
      mkdirSync(join(root, "nomanifest"), { recursive: true });
      const r = main(["glossary"], env(o()));
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(err(r).error).toBe("config");
    });
  test("contract 2", () => {
    const d = join(root, "c2", "fx", "repo");
    mkdirSync(d, { recursive: true });
    const m = JSON.parse(readFileSync(join(FIX, "repo/kb-manifest.json"), "utf8"));
    writeFileSync(join(d, "kb-manifest.json"), JSON.stringify({ ...m, contract: "2" }));
    const r = main(["glossary"], env({ KB_PATH: d }));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(err(r).error).toBe("config");
  });
  test("not in <kb>/repo", () => {
    const r = main(["glossary"], env({ KB_PATH: join(FIX, "repo") }));
    expect(r.code).toBe(2);
    expect(err(r).error).toBe("config");
  });
});

describe("status", () => {
  test("ok reaches resolution stub", () => {
    const r = main(["glossary"], env());
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
  });
  test("shell failure -> index with first stderr line", () => {
    const r = main(["glossary"], env({ FAKE_FAIL: "ERR_BOOM" }));
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
    expect(err(r)).toMatchObject({ error: "index", item: null });
    expect(err(r).detail).toContain("ERR_BOOM");
  });
  test("empty row -> 3", () => {
    const r = main(["glossary"], env({ FAKE_STATUS: "empty" }));
    expect(r.code).toBe(3);
    expect(err(r).error).toBe("index");
  });
  test("no row -> 3", () => {
    const r = main(["glossary"], env({ FAKE_STATUS: "norow" }));
    expect(r.code).toBe(3);
    expect(err(r).error).toBe("index");
  });
});

describe("plain-output row parsing", () => {
  test("live cypher-shell line: only quotes escaped, backslashes untouched", () => {
    const line = String.raw`"{\"a\":\"x\\y \\"q\\" b\\cé\"}"`;
    expect(parseRows("x", "json\n" + line + "\n")).toEqual([{ a: 'x\\y "q" b\\cé' }]);
  });
  test("runQuery round-trips backslash, quote and trailing backslash", () => {
    const title = 'a\\b "q" c\\';
    const cfg = loadConfig(env({ FAKE_TITLE: title }));
    const rows = runQuery("doc", { kb: "fx", path: "glossary.md" }, cfg) as any[];
    expect(rows[0].title).toBe(title);
  });
});
