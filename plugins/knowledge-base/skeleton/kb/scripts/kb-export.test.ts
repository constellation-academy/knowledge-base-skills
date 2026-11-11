import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildExport, gitSource, listed, linkedPaths, manifestKb, resolveCommit, tagsOf, type Source } from "./kb-export";

const FM = (fields: string, body = "Body.") => `---\n${fields}\n---\n\n${body}\n`;
const ADR = (fields = "", body = "Body.") =>
  FM(`type: adr\ntitle: T\ndescription: D.\ntags: [a, b]\nstatus: Accepted\ndate: 2026-01-01${fields}`, body);

const memory = (files: Record<string, string>): Source => ({
  files: Object.keys(files).filter(listed),
  read: (p) => files[p],
});

describe("listed", () => {
  test("keeps articles, drops index.md, tooling, dotfiles and non-markdown", () => {
    expect(listed("process/a.md")).toBe(true);
    expect(listed("README.md")).toBe(true);
    expect(listed("index.md")).toBe(false);
    expect(listed("adr/index.md")).toBe(false);
    expect(listed("scripts/fixtures/gen/glossary.md")).toBe(false);
    expect(listed(".github/x.md")).toBe(false);
    expect(listed("config/x.yml")).toBe(false);
    expect(listed("process/assets/x.md")).toBe(false);
  });
});

describe("tagsOf", () => {
  test("splits an inline array", () => {
    expect(tagsOf("[a, b-c, 'd']")).toEqual(["a", "b-c", "d"]);
    expect(tagsOf("[]")).toEqual([]);
    expect(tagsOf(undefined)).toEqual([]);
  });
});

describe("linkedPaths", () => {
  test("resolves relative links to indexed docs and ignores code, urls and unknown targets", () => {
    const indexed = new Set(["glossary.md", "adr/ADR-0001-x.md"]);
    const body = "[g](../glossary.md#x) [a](ADR-0001-x.md) [u](https://x/y.md) [n](none.md) `[c](../glossary.md)`";
    expect(linkedPaths("adr", body, indexed)).toEqual(["glossary.md", "adr/ADR-0001-x.md"]);
  });
});

describe("buildExport", () => {
  test("carries kb and sha", () => {
    expect(buildExport(memory({ "glossary.md": FM("type: glossary\ntitle: G\ndescription: D.") }), "tst", "abc")).toMatchObject({
      kb: "tst",
      sha: "abc",
    });
  });

  test("maps an ADR with status from frontmatter status, refs and extra", () => {
    const out = buildExport(
      memory({
        "adr/ADR-0001-x.md": ADR("\nowner: x-1", "See [G](../glossary.md)."),
        "glossary.md": FM("type: glossary\ntitle: G\ndescription: D."),
      }),
      "tst",
      "abc",
    );
    expect(out.docs.find((d) => d.path === "adr/ADR-0001-x.md")).toEqual({
      path: "adr/ADR-0001-x.md",
      type: "adr",
      title: "T",
      description: "D.",
      status: "Accepted",
      tags: ["a", "b"],
      refs: ["glossary.md"],
      supersedes: [],
      parts: [],
      extra: { date: "2026-01-01", owner: "x-1" },
      body: "See [G](../glossary.md).\n",
    });
  });

  test("a quoted adr type still maps status", () => {
    const [doc] = buildExport(memory({ "a.md": FM('type: "adr"\ntitle: A\nstatus: Accepted') }), "tst", "abc").docs;
    expect(doc).toMatchObject({ type: "adr", status: "Accepted" });
  });

  test("a PDR maps status like an ADR", () => {
    const [doc] = buildExport(memory({ "pdr/PDR-0001-x.md": FM("type: pdr\ntitle: P\nstatus: Accepted") }), "tst", "abc").docs;
    expect(doc).toMatchObject({ type: "pdr", status: "Accepted" });
  });

  test("a non-ADR status goes to extra and status stays null", () => {
    const [doc] = buildExport(memory({ "a.md": FM("type: process\ntitle: A\ndescription: D.\nstatus: Draft") }), "tst", "abc").docs;
    expect(doc).toMatchObject({ status: null, extra: { status: "Draft" } });
  });

  test("skips files without frontmatter or type and never lists index.md", () => {
    const out = buildExport(
      memory({ "a.md": "no frontmatter", "b.md": FM("title: B"), "index.md": "# i", "c.md": FM("type: process\ntitle: C") }),
      "tst",
      "abc",
    );
    expect(out.docs.map((d) => d.path)).toEqual(["c.md"]);
    expect(out.docs[0].description).toBeNull();
  });

  test("docs are sorted by path", () => {
    const out = buildExport(
      memory({ "b.md": FM("type: process\ntitle: B"), "a.md": FM("type: process\ntitle: A") }),
      "tst",
      "abc",
    );
    expect(out.docs.map((d) => d.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("git export", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  const write = (rel: string, content: string) => {
    mkdirSync(join(repo, rel, ".."), { recursive: true });
    writeFileSync(join(repo, rel), content);
  };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kb-export-git-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    git("config", "commit.gpgsign", "false");
    write("kb-manifest.json", JSON.stringify({ kb: "tst" }));
    write("glossary.md", FM("type: glossary\ntitle: Committed\ndescription: D."));
    write("scripts/fx.md", FM("type: process\ntitle: Fixture"));
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test("stamps the full sha and reads the commit, never the working tree", () => {
    const sha = git("rev-parse", "HEAD");
    write("glossary.md", FM("type: glossary\ntitle: Edited in working tree\ndescription: D."));
    write("untracked.md", FM("type: process\ntitle: Untracked"));
    git("add", "untracked.md");

    const resolved = resolveCommit(repo, "HEAD");
    expect(resolved).toMatch(/^[0-9a-f]{40}$/);
    expect(resolved).toBe(sha);

    const out = buildExport(gitSource(repo, resolved), manifestKb(repo, resolved), resolved);
    expect(out.sha).toBe(sha);
    expect(out.kb).toBe("tst");
    expect(out.docs.map((d) => [d.path, d.title])).toEqual([["glossary.md", "Committed"]]);
  });

  test("the CLI exports the committed tree of the given ref to the out file", () => {
    mkdirSync(join(repo, "scripts"), { recursive: true });
    for (const f of ["kb-export.ts", "kb.ts"]) copyFileSync(join(import.meta.dir, f), join(repo, "scripts", f));
    git("add", "-A");
    git("commit", "-q", "-m", "tooling");
    const head = git("rev-parse", "HEAD");
    write("glossary.md", FM("type: glossary\ntitle: Dirty\ndescription: D."));
    const out = join(repo, "out.json");
    execFileSync(process.execPath, [join(repo, "scripts", "kb-export.ts"), "--ref", "HEAD", "--out", out]);
    const parsed = JSON.parse(readFileSync(out, "utf8"));
    expect(parsed.sha).toBe(head);
    expect(parsed.docs.map((d: { title: string }) => d.title)).toEqual(["Committed"]);
  });
});
