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
    expect(escapeLiteral("C:\\temp")).toBe("'C:\\u005ctemp'");
    expect(escapeLiteral("it's")).toBe("'it\\u0027s'");
    expect(escapeLiteral('Café "fast"')).toBe("'Caf\\u00e9 \\u0022fast\\u0022'");
    expect(escapeLiteral("$HOME `x`")).toBe("'\\u0024HOME \\u0060x\\u0060'");
    expect(escapeLiteral("😀")).toBe("'\\ud83d\\ude00'");
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

describe("resolution and output", () => {
  const ok = (args: string[], e = env()) => {
    const r = main(args, e);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    return JSON.parse(r.stdout);
  };
  const paths = (o: any, i = 0) => o.items[i].documents.map((d: any) => d.path);
  test("file resource: full text incl. frontmatter", () => {
    const o = ok(["glossary"]);
    expect(o.items[0].item).toBe("glossary");
    expect(o.items[0].documents).toEqual([{ path: "glossary.md", text: readFileSync(join(kbPath, "glossary.md"), "utf8") }]);
    expect(o.items[0].documents[0].text.startsWith("---\n")).toBe(true);
  });
  test("type resource: sorted, no duplicates", () => {
    expect(paths(ok(["decisions"]))).toEqual(["decisions/0001-first.md", "decisions/0002-second.md"]);
    const m = JSON.parse(readFileSync(join(kbPath, "kb-manifest.json"), "utf8"));
    const d = join(root, "dup", "fx", "repo");
    cpSync(kbPath, d, { recursive: true });
    m.resources.both = { type: ["adr", "adr", "glossary"] };
    writeFileSync(join(d, "kb-manifest.json"), JSON.stringify(m));
    expect(paths(ok(["both"], env({ KB_PATH: d })))).toEqual(["decisions/0001-first.md", "decisions/0002-second.md", "glossary.md"]);
  });
  test("assembled folder: parts in order", () => {
    expect(paths(ok(["guide"]))).toEqual(["guide/01-intro.md", "guide/02-usage.md"]);
  });
  test("plain folder: direct children, no index.md", () => {
    expect(paths(ok(["notes"]))).toEqual(["notes/a.md", "notes/b.md"]);
  });
  test("document path and folder path", () => {
    const o = ok(["notes/a.md", "guide/", "notes/"]);
    expect(paths(o, 0)).toEqual(["notes/a.md"]);
    expect(paths(o, 1)).toEqual(["guide/01-intro.md", "guide/02-usage.md"]);
    expect(paths(o, 2)).toEqual(["notes/a.md", "notes/b.md"]);
  });
  test("unknown resource -> 4 with item", () => {
    const r = main(["glossary", "nope"], env());
    expect(r.code).toBe(4);
    expect(r.stdout).toBe("");
    expect(err(r)).toMatchObject({ error: "unresolved", item: "nope" });
  });
  test("path not in index -> 4", () => {
    const r = main(["notes/zzz.md"], env());
    expect(r.code).toBe(4);
    expect(err(r).item).toBe("notes/zzz.md");
  });
  test("file missing on disk -> 4", () => {
    const d = join(root, "miss", "fx", "repo");
    cpSync(kbPath, d, { recursive: true });
    rmSync(join(d, "glossary.md"));
    const r = main(["glossary"], env({ KB_PATH: d }));
    expect(r.code).toBe(4);
    expect(r.stdout).toBe("");
    expect(err(r).detail).toContain("glossary.md");
  });
  test("resource with zero documents -> 4", () => {
    const d = join(root, "zero", "fx", "repo");
    cpSync(kbPath, d, { recursive: true });
    const m = JSON.parse(readFileSync(join(d, "kb-manifest.json"), "utf8"));
    m.resources.empty = { type: ["nothing"] };
    m.resources.emptydir = { folder: "nowhere/" };
    writeFileSync(join(d, "kb-manifest.json"), JSON.stringify(m));
    for (const n of ["empty", "emptydir"]) {
      const r = main([n], env({ KB_PATH: d }));
      expect(r.code).toBe(4);
      expect(err(r).item).toBe(n);
    }
  });
  test("query failure mid-resolution -> 3, no stdout", () => {
    const shell = join(root, "flaky.sh");
    writeFileSync(shell, `#!/bin/sh\ncase "$*" in *list.cypher*) echo ERR_LIST >&2; exit 1;; esac\nexec ${SHELL} "$@"\n`, { mode: 0o755 });
    const r = main(["glossary", "decisions"], env({ NEO4J_SHELL: shell }));
    expect(r.code).toBe(3);
    expect(r.stdout).toBe("");
    expect(err(r).error).toBe("index");
  });
  test("items keep given order, sha from status", () => {
    const o = ok(["notes", "glossary"]);
    expect(o.kb).toBe("fx");
    expect(o.sha).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(o.items.map((i: any) => i.item)).toEqual(["notes", "glossary"]);
  });
  test("table agreement with the contract's worked example", () => {
    const md = readFileSync(join(import.meta.dir, "../plugins/knowledge-base/contracts/knowledge-base.v1.md"), "utf8");
    const block = (marker: string) => JSON.parse(new RegExp("\\(`" + marker + "`\\):\\s*```json\\n([\\s\\S]*?)```").exec(md)![1]);
    block("resolution-manifest");
    const expected = block("resolution-expected") as Record<string, string[]>;
    const items = Object.keys(expected);
    expect(items.length).toBeGreaterThan(0);
    const o = ok(items);
    items.forEach((it, i) => expect(paths(o, i)).toEqual(expected[it]));
  });
  test("CLI: large output through a pipe is not truncated", async () => {
    const d = join(root, "big", "fx", "repo");
    cpSync(kbPath, d, { recursive: true });
    writeFileSync(join(d, "glossary.md"), "x".repeat(300_000));
    const p = Bun.spawn([BUN, join(import.meta.dir, "../plugins/knowledge-base/scripts/kb-fetch.ts"), "glossary"], { env: { ...process.env, ...env({ KB_PATH: d }) } as any, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    expect(JSON.parse(out).items[0].documents[0].text.length).toBe(300_000);
  });
});
