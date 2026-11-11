import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TITLE, renderIndexes } from "./generate-indexes";
import { SECTIONS } from "./kb";

const doc = (type: string, title: string, description: string, extra = "") =>
  `---\ntype: ${type}\ntitle: ${title}\ndescription: ${description}\ntags: [a]\n${extra}---\n\n# ${title}\n`;

let root: string;
const write = (rel: string, text: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kb-indexes-"));
  for (const s of SECTIONS) mkdirSync(join(root, s.dir));
  write("README.md", doc("reference", "Readme", "Fixture readme."));
  write("glossary.md", doc("glossary", "Glossary", "Fixture glossary."));
  write("adr/about.md", doc("reference", "About ADRs", "How ADRs work."));
  write("adr/ADR-0010-tenth.md", doc("adr", "Tenth", "The tenth.", "status: Proposed\ndate: 2026-01-01\n"));
  write("adr/ADR-0002-second.md", doc("adr", "Second", "The second.", "status: Accepted\ndate: 2026-01-01\n"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("root index lists root files then every non-empty section", () => {
  expect(renderIndexes(root).get("index.md")).toBe(
    [
      `# ${TITLE}`,
      "",
      "* [Readme](README.md) - Fixture readme.",
      "* [Glossary](glossary.md) - Fixture glossary.",
      "",
      "## Architecture Decision Records",
      "",
      "* [About ADRs](adr/about.md) - How ADRs work.",
      "* [ADR-0002: Second](adr/ADR-0002-second.md) - The second. (Accepted)",
      "* [ADR-0010: Tenth](adr/ADR-0010-tenth.md) - The tenth. (Proposed)",
      "",
    ].join("\n"),
  );
});

test("a section index links relative to its own directory", () => {
  expect(renderIndexes(root).get("adr/index.md")).toContain("* [ADR-0002: Second](ADR-0002-second.md)");
});

test("an empty section still gets an index and is skipped in the root catalog", () => {
  const out = renderIndexes(root);
  expect(out.get("templates/index.md")).toBe(["# Templates", "", "_No articles yet._", ""].join("\n"));
  expect(out.get("index.md")).not.toContain("## Templates");
});

test("every section gets an index", () => {
  const out = renderIndexes(root);
  for (const s of SECTIONS) expect(out.has(`${s.dir}/index.md`)).toBe(true);
});

test("generation is deterministic", () => {
  expect([...renderIndexes(root)]).toEqual([...renderIndexes(root)]);
});
