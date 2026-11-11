import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderIndexes } from "./generate-indexes";
import { SECTIONS } from "./kb";
import { lintBundle } from "./lint-kb";

let root: string;
const write = (rel: string, text: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const generate = () => {
  for (const [rel, text] of renderIndexes(root)) write(rel, text);
};
const errorsFor = (needle: string) => lintBundle(root).filter((e) => e.includes(needle));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kb-lint-"));
  for (const s of SECTIONS) mkdirSync(join(root, s.dir));
  write("glossary.md", "---\ntype: glossary\ntitle: G\ndescription: D.\ntags: [a]\n---\n\nSee [ADRs](adr/index.md).\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a bundle whose indexes were just generated is clean", () => {
  generate();
  expect(lintBundle(root)).toEqual([]);
});

test("a missing required field is reported by name", () => {
  write("templates/a.md", "---\ntype: template\ntitle: A\ntags: [a]\n---\n");
  generate();
  expect(errorsFor("missing required field 'description'")).toHaveLength(1);
});

test("a type outside the allowed set is reported", () => {
  write("templates/a.md", "---\ntype: memo\ntitle: A\ndescription: D.\ntags: [a]\n---\n");
  generate();
  expect(errorsFor("unknown type 'memo'")).toHaveLength(1);
});

test("tags that are not an inline array are reported", () => {
  write("templates/a.md", "---\ntype: template\ntitle: A\ndescription: D.\ntags: a\n---\n");
  generate();
  expect(errorsFor("tags must be an inline array")).toHaveLength(1);
});

test("a file without a frontmatter block is reported", () => {
  write("templates/a.md", "# no frontmatter\n");
  generate();
  expect(errorsFor("missing or unclosed frontmatter block")).toHaveLength(1);
});

test("an ADR without status and date is reported for both", () => {
  write("adr/ADR-0001-x.md", "---\ntype: adr\ntitle: X\ndescription: D.\ntags: [a]\n---\n");
  generate();
  expect(errorsFor("ADR-0001-x.md: missing required field 'status'")).toHaveLength(1);
  expect(errorsFor("ADR-0001-x.md: missing required field 'date'")).toHaveLength(1);
});

test("an ADR status outside the lifecycle is reported", () => {
  write("adr/ADR-0001-x.md", "---\ntype: adr\ntitle: X\ndescription: D.\ntags: [a]\nstatus: Done\ndate: 2026-01-01\n---\n");
  generate();
  expect(errorsFor("status must be one of")).toHaveLength(1);
});

test("a dead relative link is reported", () => {
  write("templates/a.md", "---\ntype: template\ntitle: A\ndescription: D.\ntags: [a]\n---\n\n[x](missing.md)\n");
  generate();
  expect(errorsFor("dead link missing.md")).toHaveLength(1);
});

test("frontmatter on an index.md is reported", () => {
  generate();
  write("adr/index.md", "---\ntype: reference\n---\n");
  expect(errorsFor("index.md must not have frontmatter")).toHaveLength(1);
});

test("a stale index is reported", () => {
  generate();
  write("templates/a.md", "---\ntype: template\ntitle: A\ndescription: D.\ntags: [a]\n---\n");
  expect(errorsFor("stale")).not.toHaveLength(0);
});
