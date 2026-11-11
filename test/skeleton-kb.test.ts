import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

const SKELETON = join(import.meta.dir, "..", "plugins", "knowledge-base", "skeleton");

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );

describe("skeletons", () => {
  test("carry no trace of the KBs they were derived from", () => {
    const hits = files(SKELETON).flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .map((line, i) => ({ f, i, line }))
        .filter(({ line }) => /\bdxp\b|\buep\b|clickup|kb-sync|generate-conventions|sascha|scandri|vorbereitung/i.test(line))
        .map(({ f, i, line }) => `${relative(SKELETON, f)}:${i + 1}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  test("every section fence is closed", () => {
    for (const f of files(SKELETON)) {
      const text = readFileSync(f, "utf8");
      const opened = [...text.matchAll(/(?:<!--|\/\/) ?section:([a-z]+)/g)].map((m) => m[1]).sort();
      const closed = [...text.matchAll(/(?:<!--|\/\/) ?\/section:([a-z]+)/g)].map((m) => m[1]).sort();
      expect({ file: relative(SKELETON, f), names: opened }).toEqual({ file: relative(SKELETON, f), names: closed });
    }
  });
});
