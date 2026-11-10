import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(120_000);

const CONTAINER = "neo4j-kbtest";
const PORT = "7699";
const PASS = "kbtest-pass-1";
const IMAGE = "neo4j:2026.06.0";
const CYPHER_DIR = join(import.meta.dir, "../plugins/knowledge-base/cypher");
const IMPORT = mkdtempSync(join(tmpdir(), "kbtest-import-"));
const REAL_REPO = process.env.KB_TEST_REAL_REPO;
const CLONE_DIR = mkdtempSync(join(tmpdir(), "kbtest-clone-"));
const MARKER_DIR = mkdtempSync(join(tmpdir(), "kbtest-marker-"));
const MARKER = join(MARKER_DIR, "kb-pwned");

type Doc = {
  path: string;
  type: string | null;
  title: string;
  description: string | null;
  status: string | null;
  tags: string[];
  refs: string[];
  supersedes: string[];
  parts: string[];
  extra: Record<string, unknown>;
  body?: string;
};
type ExportDoc = { kb: string; sha: string; docs: Doc[] };
type Run = { code: number; stdout: string; stderr: string };

const doc = (over: Partial<Doc> & { path: string }): Doc => ({
  type: "article",
  title: "T",
  description: "d",
  status: null,
  tags: [],
  refs: [],
  supersedes: [],
  parts: [],
  extra: {},
  body: "",
  ...over,
});

const sample = (): ExportDoc => ({
  kb: "t",
  sha: "abc123",
  docs: [
    doc({
      path: "adr/ADR-0001-x.md",
      type: "adr",
      title: "Use X",
      description: "why x",
      status: "Accepted",
      tags: ["a", "b"],
      refs: ["glossary.md", "adr/ADR-0002-y.md", "missing.md"],
      extra: { page_id: "99", nested: { k: [1, 2, null] } },
      body: "X is chosen because zebrafish migrate.",
    }),
    doc({ path: "adr/ADR-0002-y.md", type: "adr", title: "Use Y", status: "Superseded" }),
    doc({ path: "adr/ADR-0003-z.md", type: "adr", title: "Use Z", status: "Accepted", supersedes: ["adr/ADR-0002-y.md"] }),
    doc({ path: "glossary.md", type: "glossary", title: "Glossary", body: "Quokka means a small marsupial.\n\nSecond   paragraph." }),
    doc({ path: "guide/big/", type: "article", title: "Big", parts: ["guide/big/1.md", "guide/big/2.md"], body: "part one\npart two" }),
  ],
});

const lit = (v: string | number | null): string => {
  if (v === null) return "null";
  if (typeof v === "number") return String(v);
  const u = (n: number) => `\\u${n.toString(16).padStart(4, "0")}`;
  let out = "";
  for (const ch of v) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (c >= 0x20 && c <= 0x7e && ch !== "'" && ch !== '"') out += ch;
    else if (c > 0xffff) out += u(Math.floor((c - 0x10000) / 0x400) + 0xd800) + u(((c - 0x10000) % 0x400) + 0xdc00);
    else out += u(c);
  }
  return `"${out}"`;
};

async function spawn(cmd: string[], stdin = "", env: Record<string, string> = {}): Promise<Run> {
  const p = Bun.spawn(cmd, {
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NEO4J_USERNAME: "neo4j", NEO4J_PASSWORD: PASS, ...env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, stdout, stderr };
}

const SHELL = ["docker", "exec", "-i", "-e", "NEO4J_USERNAME", "-e", "NEO4J_PASSWORD", CONTAINER, "cypher-shell"];

const cypher = (q: string) => spawn([...SHELL, "--format", "plain"], q + "\n");

async function query(name: string, params: Record<string, string | number | null> = {}): Promise<Run> {
  const args = Object.entries(params).flatMap(([k, v]) => ["-P", `${k} => ${lit(v)}`]);
  return spawn([...SHELL, "-d", "neo4j", "--format", "plain", "-f", `/import/queries/${name}.cypher`, ...args]);
}

const QUERY_PREFIX = "docker exec -i -e NEO4J_USERNAME -e NEO4J_PASSWORD neo4j-kbtest cypher-shell -d neo4j --format plain -f";

const queryVia = (shell: string, name: string, params: Record<string, string | number | null>) => {
  const args = Object.entries(params).map(([k, v]) => `-P '${k} => ${lit(v)}'`);
  return spawn([shell, "-c", `${QUERY_PREFIX} /import/queries/${name}.cypher ${args.join(" ")}`]);
};

const rows = (r: Run): any[] => {
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  if (lines.length === 0) return [];
  expect(lines[0]).toBe("json");
  return lines.slice(1).map((l) => {
    expect(l.startsWith('"') && l.endsWith('"')).toBe(true);
    return JSON.parse(l.slice(1, -1).replace(/\\"/g, '"'));
  });
};

const plain = (r: Run): string[][] => {
  expect(r.code).toBe(0);
  return r.stdout
    .split("\n")
    .filter((l) => l !== "")
    .slice(1)
    .map((l) => l.split(", "));
};

const writeExport = (e: unknown) => writeFileSync(join(IMPORT, "kb-export.json"), typeof e === "string" ? e : JSON.stringify(e));

const load = async (e: unknown, kb = "t"): Promise<Run> => {
  writeExport(e);
  return query("load", { kb });
};

const fulltext = (analyzer = "standard-no-stop-words") => query("fulltext", { analyzer });

const asDoc = (d: Doc): Omit<Doc, "body"> => {
  const { body: _b, ...rest } = d;
  return rest;
};

async function startNeo4j() {
  Bun.spawnSync(["docker", "rm", "-f", CONTAINER]);
  chmodSync(IMPORT, 0o755);
  mkdirSync(join(IMPORT, "queries"), { recursive: true });
  cpSync(CYPHER_DIR, join(IMPORT, "queries"), { recursive: true });
  const up = Bun.spawnSync([
    "docker", "run", "-d", "--name", CONTAINER, "-p", `127.0.0.1:${PORT}:7687`,
    "-e", `NEO4J_AUTH=neo4j/${PASS}`,
    "-e", 'NEO4J_PLUGINS=["apoc"]',
    "-e", "NEO4J_apoc_import_file_enabled=true",
    "-e", "NEO4J_server_directories_import=/import",
    "-v", `${IMPORT}:/import`,
    IMAGE,
  ]);
  if (up.exitCode !== 0) throw new Error(up.stderr.toString());
  for (let i = 0; i < 90; i++) {
    const r = await cypher("RETURN apoc.version() AS v;");
    if (r.code === 0 && r.stdout.includes("v")) {
      const f = await fulltext();
      if (f.code !== 0) throw new Error(f.stderr);
      await cypher("CALL db.awaitIndexes(60);");
      return;
    }
    await Bun.sleep(2000);
  }
  throw new Error("test Neo4j did not become ready");
}

beforeAll(startNeo4j, 240_000);

afterAll(() => {
  Bun.spawnSync(["docker", "rm", "-f", CONTAINER]);
  rmSync(IMPORT, { recursive: true, force: true });
  rmSync(CLONE_DIR, { recursive: true, force: true });
  rmSync(MARKER_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await cypher("MATCH (n) DETACH DELETE n;");
});

describe("load and status", () => {
  test("load then status returns kb, sha and doc count", async () => {
    const r = await load(sample());
    expect(rows(r)).toEqual([{ kb: "t", sha: "abc123", docs: 5 }]);
    expect(rows(await query("status", { kb: "t" }))).toEqual([{ kb: "t", sha: "abc123", docs: 5 }]);
  });

  test("status on an empty store reports empty", async () => {
    expect(rows(await query("status", { kb: "t" }))).toEqual([{ kb: "t", empty: true }]);
  });

  test("round-trips a doc with type null", async () => {
    const d = { ...doc({ path: "assembled.md", title: "Assembled", parts: ["p/1.md"] }), type: null };
    rows(await load({ kb: "t", sha: "n", docs: [d, doc({ path: "b.md", type: "adr" })] }));
    expect(rows(await query("doc", { kb: "t", path: "assembled.md" }))).toEqual([asDoc(d)]);
  });

  test("reload replaces the previous load of the same KB", async () => {
    rows(await load(sample()));
    rows(await load({ kb: "t", sha: "def456", docs: [doc({ path: "only.md", title: "Only" })] }));
    expect(rows(await query("status", { kb: "t" }))).toEqual([{ kb: "t", sha: "def456", docs: 1 }]);
    expect(rows(await query("doc", { kb: "t", path: "glossary.md" }))).toEqual([]);
  });

  test("an empty store loads even with only a stale index stamp of the same KB", async () => {
    await cypher("CREATE (:KBIndex {kb: 't', sha: 'old', docs: 0});");
    rows(await load(sample()));
    expect(rows(await query("status", { kb: "t" }))).toEqual([{ kb: "t", sha: "abc123", docs: 5 }]);
  });
});

describe("doc, list, related, supersede-chain", () => {
  test("doc and list return the exact export fields without body", async () => {
    const e = sample();
    rows(await load(e));
    const [d] = rows(await query("doc", { kb: "t", path: "adr/ADR-0001-x.md" }));
    expect(d).toEqual({ ...asDoc(e.docs[0]), refs: ["adr/ADR-0002-y.md", "glossary.md"] });
    expect(Object.keys(d).sort()).toEqual(
      ["description", "extra", "parts", "path", "refs", "status", "supersedes", "tags", "title", "type"],
    );
    const [big] = rows(await query("doc", { kb: "t", path: "guide/big/" }));
    expect(big.parts).toEqual(["guide/big/1.md", "guide/big/2.md"]);

    const l = rows(await query("list", { kb: "t", type: "adr" }));
    expect(l.map((x) => x.path)).toEqual(["adr/ADR-0001-x.md", "adr/ADR-0002-y.md", "adr/ADR-0003-z.md"]);
    expect(l[2].supersedes).toEqual(["adr/ADR-0002-y.md"]);
    expect(rows(await query("list", { kb: "t", type: null })).length).toBe(5);
    expect(rows(await query("list", { kb: "t", type: "nope" }))).toEqual([]);
    expect(rows(await query("doc", { kb: "t", path: "nope.md" }))).toEqual([]);
  });

  test("builds REFERENCES and SUPERSEDES edges between existing docs only", async () => {
    rows(await load(sample()));
    const r = await cypher(
      "MATCH (a:Doc)-[r]->(b:Doc) RETURN type(r) AS t, a.path AS a, b.path AS b ORDER BY t, a, b;",
    );
    expect(plain(r)).toEqual([
      ["\"REFERENCES\"", "\"adr/ADR-0001-x.md\"", "\"adr/ADR-0002-y.md\""],
      ["\"REFERENCES\"", "\"adr/ADR-0001-x.md\"", "\"glossary.md\""],
      ["\"SUPERSEDES\"", "\"adr/ADR-0003-z.md\"", "\"adr/ADR-0002-y.md\""],
    ]);
  });

  test("related returns outgoing and incoming references", async () => {
    rows(await load(sample()));
    const out = rows(await query("related", { kb: "t", path: "adr/ADR-0001-x.md" }));
    expect(out.map((x) => [x.direction, x.path])).toEqual([
      ["out", "adr/ADR-0002-y.md"],
      ["out", "glossary.md"],
    ]);
    const inc = rows(await query("related", { kb: "t", path: "glossary.md" }));
    expect(inc.map((x) => [x.direction, x.path])).toEqual([["in", "adr/ADR-0001-x.md"]]);
    expect(rows(await query("related", { kb: "t", path: "adr/ADR-0003-z.md" }))).toEqual([]);
  });

  test("supersede-chain walks both directions, newest first", async () => {
    const e = sample();
    e.docs.push(doc({ path: "adr/ADR-0004-w.md", type: "adr", title: "Use W", supersedes: ["adr/ADR-0003-z.md"] }));
    rows(await load(e));
    const chain = rows(await query("supersede-chain", { kb: "t", path: "adr/ADR-0003-z.md" }));
    expect(chain.map((x) => [x.path, x.distance])).toEqual([
      ["adr/ADR-0004-w.md", -1],
      ["adr/ADR-0003-z.md", 0],
      ["adr/ADR-0002-y.md", 1],
    ]);
    const alone = rows(await query("supersede-chain", { kb: "t", path: "glossary.md" }));
    expect(alone.map((x) => [x.path, x.distance])).toEqual([["glossary.md", 0]]);
  });
});

describe("search", () => {
  test("hits by title and by body with path, title, score and excerpt", async () => {
    rows(await load(sample()));
    const byTitle = rows(await query("search", { kb: "t", query: "glossary", limit: 5 }));
    expect(byTitle[0].path).toBe("glossary.md");
    expect(byTitle[0].title).toBe("Glossary");
    expect(typeof byTitle[0].score).toBe("number");
    expect(byTitle[0].excerpt).toBe("Quokka means a small marsupial. Second paragraph.");
    const byBody = rows(await query("search", { kb: "t", query: "zebrafish", limit: 5 }));
    expect(byBody.map((x) => x.path)).toEqual(["adr/ADR-0001-x.md"]);
    expect(rows(await query("search", { kb: "t", query: "nonexistentterm", limit: 5 }))).toEqual([]);
  });

  test("takes plain text: Lucene special characters and operators never error", async () => {
    const e = sample();
    e.docs.push(doc({ path: "cpp.md", title: "C++ notes", body: "about a/b paths and (parentheses)" }));
    rows(await load(e));
    for (const q of ['C++', "(draft", 'say "hello', "a/b", "x: y", "foo AND", "NOT", "OR zebrafish", "!-~*?^[]{}|&\\", "   ", ""]) {
      const r = await query("search", { kb: "t", query: q, limit: 5 });
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
    }
    expect(rows(await query("search", { kb: "t", query: "C++ (draft", limit: 5 })).map((x) => x.path)).toEqual(["cpp.md"]);
    expect(rows(await query("search", { kb: "t", query: "a/b", limit: 5 })).map((x) => x.path)).toContain("cpp.md");
    expect(rows(await query("search", { kb: "t", query: "zebrafish OR", limit: 5 })).map((x) => x.path)).toEqual(["adr/ADR-0001-x.md"]);
    expect(rows(await query("search", { kb: "t", query: "", limit: 5 }))).toEqual([]);
    for (const q of ["zebrafish\u3000OR", "zebrafish\u00a0AND", "zebrafish\u2003NOT"]) {
      expect(rows(await query("search", { kb: "t", query: q, limit: 5 })).map((x) => x.path)).toContain("adr/ADR-0001-x.md");
    }
  });

  test("limits the number of hits and cuts the excerpt", async () => {
    const e: ExportDoc = {
      kb: "t",
      sha: "s",
      docs: Array.from({ length: 5 }, (_, i) => doc({ path: `d/${i}.md`, title: `Doc ${i}`, body: "needle " + "x".repeat(500) })),
    };
    rows(await load(e));
    const hits = rows(await query("search", { kb: "t", query: "needle", limit: 3 }));
    expect(hits.length).toBe(3);
    expect(hits[0].excerpt.length).toBe(200);
  });
});

describe("guards", () => {
  test("refuses foreign kb", async () => {
    await cypher("CREATE (:Doc {kb: 'other', path: 'x.md'}), (:KBIndex {kb: 'other', sha: 's', docs: 1});");
    const r = await load(sample());
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("other");
    expect(plain(await cypher("MATCH (n) RETURN count(n) AS c, count(n.kb) AS k;"))).toEqual([["2", "2"]]);
    for (const name of ["status", "doc", "list", "related", "supersede-chain", "search"]) {
      const q = await query(name, { kb: "t", path: "x.md", type: null, query: "x", limit: 1 });
      expect(q.code).not.toBe(0);
      expect(q.stderr).toContain("other");
    }
  });

  test("refuses unstamped legacy graph", async () => {
    await cypher(
      "CREATE (i:KBIndex {id: 'root', commit: 'old'}), (d:Doc {id: 'glossary', path: 'glossary.md'}), (i)-[:HAS]->(d);",
    );
    const r = await load(sample());
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/unstamped|legacy/i);
    expect(plain(await cypher("MATCH (n) RETURN count(n) AS c, count(n.kb) AS k, count(n.id) AS ids;"))).toEqual([["2", "0", "2"]]);
    expect((await query("status", { kb: "t" })).code).not.toBe(0);
  });

  test("refuses nodes of other labels even when stamped with the kb", async () => {
    await cypher("CREATE (:Other {kb: 't'});");
    const r = await load(sample());
    expect(r.code).not.toBe(0);
    expect(plain(await cypher("MATCH (n) RETURN count(n) AS c;"))).toEqual([["1"]]);
  });

  test("refuses documents without a KBIndex stamp", async () => {
    await cypher("CREATE (:Doc {kb: 't', path: 'x.md', title: 'X'});");
    const r = await load(sample());
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/without a KBIndex stamp/);
    expect(plain(await cypher("MATCH (n) RETURN count(n) AS c;"))).toEqual([["1"]]);
  });

  test("refuses fields of the wrong type", async () => {
    rows(await load(sample()));
    const bad: Record<string, unknown>[] = [
      { type: 3 },
      { status: ["x"] },
      { tags: "a" },
      { tags: ["a", 1] },
      { refs: [null] },
      { parts: {} },
      { extra: [1] },
      { extra: "x" },
      { body: 5 },
    ];
    for (const patch of bad) {
      const r = await load({ kb: "t", sha: "bad", docs: [{ ...doc({ path: "a.md" }), ...patch }] });
      expect(r.code).not.toBe(0);
      expect(r.stderr).toMatch(/must be/);
    }
    expect(rows(await query("status", { kb: "t" }))).toEqual([{ kb: "t", sha: "abc123", docs: 5 }]);
  });

  test("refuses empty export and keeps the old graph", async () => {
    rows(await load(sample()));
    const r = await load({ kb: "t", sha: "zzz", docs: [] });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/no docs/);
    expect(rows(await query("status", { kb: "t" }))).toEqual([{ kb: "t", sha: "abc123", docs: 5 }]);
    expect(rows(await query("doc", { kb: "t", path: "glossary.md" }))[0].title).toBe("Glossary");
  });

  test("refuses an export for another kb, malformed JSON and malformed docs", async () => {
    rows(await load(sample()));
    const other = await load({ ...sample(), kb: "x" });
    expect(other.code).not.toBe(0);
    expect(other.stderr).toContain("not t");
    expect((await load("{not json")).code).not.toBe(0);
    expect((await load({ kb: "t", sha: "s", docs: [{ path: "a.md" }] })).code).not.toBe(0);
    expect((await load({ kb: "t", sha: "s", docs: [doc({ path: "a.md" }), doc({ path: "a.md" })] })).stderr).toMatch(/twice/);
    expect((await load({ kb: "t", docs: [doc({ path: "a.md" })] })).stderr).toMatch(/sha/);
    rmSync(join(IMPORT, "kb-export.json"));
    const missing = await query("load", { kb: "t" });
    expect(missing.code).not.toBe(0);
    writeExport(sample());
    expect(rows(await query("status", { kb: "t" }))).toEqual([{ kb: "t", sha: "abc123", docs: 5 }]);
  });

  test("failed load keeps old graph", async () => {
    rows(await load(sample()));
    expect((await cypher("CREATE CONSTRAINT kbtest_title FOR (d:Doc) REQUIRE d.title IS UNIQUE;")).code).toBe(0);
    try {
      const dup: ExportDoc = {
        kb: "t",
        sha: "new",
        docs: [doc({ path: "a.md", title: "same" }), doc({ path: "b.md", title: "same" })],
      };
      const r = await load(dup);
      expect(r.code).not.toBe(0);
      expect(r.stderr).not.toBe("");
      expect(rows(await query("status", { kb: "t" }))).toEqual([{ kb: "t", sha: "abc123", docs: 5 }]);
      expect(rows(await query("doc", { kb: "t", path: "glossary.md" }))[0].title).toBe("Glossary");
      expect(rows(await query("doc", { kb: "t", path: "a.md" }))).toEqual([]);
    } finally {
      await cypher("DROP CONSTRAINT kbtest_title;");
    }
  });
});

describe("hostile strings", () => {
  test("round-trips through export, toJson and -P literals", async () => {
    const hostile = [
      `q"uote 'single' back\\slash trailing\\`,
      "line1\nline2\r\n\ttab, comma",
      "MATCH (n) DETACH DELETE n; RETURN 1 //",
      "$kb `tick` {braces} \\u0041 \\n literal",
      "Äpfel Öl Übung ß émoji 😀 \u0001 \u2028 end",
      '", NULL, "x',
      "CALL apoc.util.validate(true, 'x', []) :commit",
    ];
    const e: ExportDoc = {
      kb: "t",
      sha: 'sha"\'\\',
      docs: hostile.map((h, i) =>
        doc({
          path: `dir/${h}.md`,
          type: "adr",
          title: h,
          description: h,
          status: h,
          tags: [h, hostile[(i + 1) % hostile.length]],
          refs: [`dir/${hostile[(i + 1) % hostile.length]}.md`],
          extra: { [`k${i}`]: h, list: [h, { deep: h }] },
          body: h,
        }),
      ),
    };
    rows(await load(e));
    const got = rows(await query("list", { kb: "t", type: "adr" })) as Doc[];
    expect(got.length).toBe(hostile.length);
    const byPath = new Map(got.map((d) => [d.path, d]));
    for (const d of e.docs) expect(byPath.get(d.path)).toEqual(asDoc(d));
    for (const d of e.docs) {
      expect(rows(await query("doc", { kb: "t", path: d.path }))).toEqual([asDoc(d)]);
      const rel = rows(await query("related", { kb: "t", path: d.path }));
      expect(rel.filter((x) => x.direction === "out").map((x) => x.path)).toEqual(d.refs);
    }
    expect(rows(await query("status", { kb: "t" }))[0].sha).toBe('sha"\'\\');
    expect(rows(await query("list", { kb: "t", type: hostile[0] }))).toEqual([]);
    expect(plain(await cypher("MATCH (n) RETURN count(n) AS c;"))).toEqual([[String(hostile.length + 1)]]);
  });

  test("survives the contract's shell form in bash and zsh", async () => {
    const hostile = [
      `q"uote 'single' back\\slash trailing\\`,
      "line1\nline2\r\n\ttab, comma",
      `$(touch ${MARKER}) ; touch ${MARKER} && touch ${MARKER} # | \`touch ${MARKER}\``,
      "MATCH (n) DETACH DELETE n; RETURN 1 //",
      "Äpfel Öl Übung ß émoji 😀 \u2028 end",
      "1 + 1",
      "null",
      "toString(1)",
      "kb => 't'",
    ];
    const e: ExportDoc = {
      kb: "t",
      sha: "shell",
      docs: hostile.map((h) => doc({ path: `s/${h}.md`, type: "adr", title: h, body: h })),
    };
    rows(await load(e));
    expect(existsSync(MARKER)).toBe(false);
    for (const sh of ["bash", "zsh"]) {
      for (const d of e.docs) {
        const r = await queryVia(sh, "doc", { kb: "t", path: d.path });
        expect(rows(r)).toEqual([asDoc(d)]);
      }
      const l = await queryVia(sh, "list", { kb: "t", type: "adr" });
      expect(rows(l).length).toBe(hostile.length);
      const s = await queryVia(sh, "search", { kb: "t", query: "Äpfel", limit: 5 });
      expect(rows(s).map((x) => x.title)).toEqual([hostile[4]]);
    }
    expect(existsSync(MARKER)).toBe(false);
    expect(plain(await cypher("MATCH (n) RETURN count(n) AS c;"))).toEqual([[String(hostile.length + 1)]]);
  });
});

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString();
};

describe("real KB", () => {
  if (!REAL_REPO) console.warn("real KB test skipped: set KB_TEST_REAL_REPO to the git URL of a KB repository");
  const repo = join(CLONE_DIR, "repo");

  test.skipIf(!REAL_REPO)("loads the export and answers status, list, doc and search", async () => {
    const clone = Bun.spawnSync(["git", "clone", "--filter=blob:none", "-c", "core.autocrlf=false", REAL_REPO!, repo]);
    if (clone.exitCode !== 0) throw new Error(`git clone failed: ${clone.stderr.toString()}`);
    if (!existsSync(join(repo, "scripts/kb-export.ts"))) throw new Error("no scripts/kb-export.ts in the clone");
    const out = Bun.spawnSync(["bun", "scripts/kb-export.ts"], { cwd: repo });
    if (out.exitCode !== 0) throw new Error(`export failed: ${out.stderr.toString()}`);
    const exp: ExportDoc = JSON.parse(out.stdout.toString());
    const text = (p: string) => git(repo, "show", `HEAD:${p}`);
    for (const d of exp.docs) d.body = d.path.endsWith("/") ? d.parts.map(text).join("\n\n") : text(d.path);

    rows(await load(exp, exp.kb));
    expect(rows(await query("status", { kb: exp.kb }))).toEqual([{ kb: exp.kb, sha: exp.sha, docs: exp.docs.length }]);

    const adrs = exp.docs.filter((d) => d.type === "adr").map((d) => d.path).sort();
    expect(adrs.length).toBeGreaterThan(0);
    expect(rows(await query("list", { kb: exp.kb, type: "adr" })).map((d) => d.path)).toEqual(adrs);

    const assembled = exp.docs.find((d) => d.path.endsWith("/") && d.parts.length > 1)!;
    const [a] = rows(await query("doc", { kb: exp.kb, path: assembled.path }));
    expect(a.parts).toEqual(assembled.parts);

    const glossary = exp.docs.find((d) => d.type === "glossary")!;
    const term = glossary.body!.match(/[A-Za-z]{8,}/)![0];
    const hits = rows(await query("search", { kb: exp.kb, query: term, limit: 50 }));
    expect(hits.map((h) => h.path)).toContain(glossary.path);
  }, 180_000);
});
