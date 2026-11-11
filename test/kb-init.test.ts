import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import schema from "../plugins/knowledge-base/contracts/kb-manifest.schema.json";
import {
  ALL_SECTIONS,
  buildManifest,
  renderKb,
  renderSkills,
  validateOptions,
  type InitOptions,
  type Section,
} from "../plugins/knowledge-base/scripts/kb-init";

const SCRIPT = join(import.meta.dir, "..", "plugins", "knowledge-base", "scripts", "kb-init.ts");
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const opts = (o: Partial<InitOptions> = {}): InitOptions => ({
  kb: "tka",
  team: "Team Alpha",
  owner: "acme",
  decider: "Jane Doe",
  sections: [],
  ...o,
});
const subsets = (xs: readonly Section[]): Section[][] =>
  xs.reduce<Section[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === ".git" ? [] : files(join(dir, e.name))) : [join(dir, e.name)],
  );

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "kb-init-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("validateOptions", () => {
  test.each(["TKA", "tk1", "tkab", "", "t-a"])("rejects KB id %p naming the allowed form", (kb) => {
    const errors = validateOptions(opts({ kb }));
    expect(errors.some((e) => e.includes("^[a-z]{3}$"))).toBe(true);
  });

  test("accepts a valid set", () => {
    expect(validateOptions(opts({ sections: ["process", "pdr"], team: "Team Ä & Co." }))).toEqual([]);
  });

  test("rejects an unknown section", () => {
    expect(validateOptions(opts({ sections: ["memo" as Section] })).some((e) => e.includes("memo"))).toBe(true);
  });

  test.each([
    ["team", 'Team "Ä"'],
    ["team", "Team: Alpha"],
    ["decider", "Jane {Doe}"],
    ["team", ""],
  ])("rejects %s %p naming the allowed characters", (field, value) => {
    const errors = validateOptions(opts({ [field]: value }));
    expect(errors.some((e) => e.startsWith(`${field}:`))).toBe(true);
  });

  test("rejects an owner that is not a GitHub name", () => {
    expect(validateOptions(opts({ owner: "acme/x" })).some((e) => e.startsWith("owner:"))).toBe(true);
  });
});

describe("buildManifest", () => {
  test.each(subsets(ALL_SECTIONS).map((s) => [s.join(",") || "(none)", s]))("sections %s validate against the schema", (_, sections) => {
    const m = buildManifest(opts({ sections: sections as Section[] }));
    validate(m);
    expect(validate.errors ?? []).toEqual([]);
  });

  test("names the KB, the team skills, the export and the PR conventions", () => {
    expect(buildManifest(opts())).toMatchObject({
      kb: "tka",
      contract: "1",
      default_branch: "main",
      kb_root: ".",
      fulltext_analyzer: "english",
      export: { cmd: "bun scripts/kb-export.ts --ref {ref} --out {out}", placeholders: ["{ref}", "{out}"] },
      skills: { read: "tka-workflow:kb-provider", write: "tka-workflow:kb-article-writer", answer: "tka-workflow:kb-answer-engine" },
      pr: { host: "github", branch_pattern: "docs/{slug}", commit_pattern: "docs(kb): {summary}", pre_commit: "bun scripts/kb-pre-commit.ts" },
    });
  });

  test("without optional sections: only the always-present resources and types", () => {
    const m = buildManifest(opts()) as any;
    expect(Object.keys(m.resources).sort()).toEqual(
      ["adr", "adr-template", "article-template", "catalog", "decisions", "glossary", "kb-readme"].sort(),
    );
    expect(m.resources.decisions).toEqual({ type: ["adr"] });
    expect(Object.keys(m.article_types).sort()).toEqual(["adr", "glossary", "template"]);
    expect(m.article_types.adr).toEqual({
      folder: "adr/",
      template: "templates/adr-template.md",
      required_frontmatter: ["type", "title", "description", "tags", "status", "date"],
      file_name: "ADR-{number}-{slug}.md",
    });
  });

  test("with every section: a folder resource and an article type per section, PDR in decisions", () => {
    const m = buildManifest(opts({ sections: ["process", "reference", "primer", "pdr"] })) as any;
    for (const s of ["process", "reference", "primer", "pdr"]) {
      expect(m.resources[s]).toEqual({ folder: `${s}/` });
      expect(m.article_types[s].folder).toBe(`${s}/`);
    }
    expect(m.resources.decisions).toEqual({ type: ["adr", "pdr"] });
    expect(m.resources["pdr-template"]).toEqual({ file: "templates/pdr-template.md" });
    expect(m.article_types.pdr.file_name).toBe("PDR-{number}-{slug}.md");
    expect(m.article_types.process.required_frontmatter).toEqual(["type", "title", "description", "tags"]);
  });
});

describe("renderKb", () => {
  test("without optional sections leaves no trace of them", () => {
    const out = join(tmp, "kb");
    renderKb(opts(), out);
    for (const d of ["process", "reference", "primer", "pdr"]) expect(existsSync(join(out, d))).toBe(false);
    expect(existsSync(join(out, "templates", "pdr-template.md"))).toBe(false);
    for (const f of files(out)) {
      const text = readFileSync(f, "utf8");
      expect({ f: relative(out, f), braces: text.includes("{{"), fence: /section:/.test(text) }).toEqual({
        f: relative(out, f),
        braces: false,
        fence: false,
      });
    }
    const readme = readFileSync(join(out, "README.md"), "utf8");
    expect(readme).not.toContain("PDR");
    expect(readme).not.toContain("`process/`");
    expect(readme).toContain("Jane Doe accepts decisions (ADRs)");
    expect(readFileSync(join(out, "scripts", "kb.ts"), "utf8")).not.toContain('dir: "process"');
    expect(JSON.parse(readFileSync(join(out, "kb-manifest.json"), "utf8"))).toEqual(buildManifest(opts()));
  });

  test("with every section creates the folders and their generated indexes", () => {
    const out = join(tmp, "kb");
    renderKb(opts({ sections: ["process", "reference", "primer", "pdr"] }), out);
    for (const d of ["process", "reference", "primer", "pdr", "adr", "templates"]) {
      expect(existsSync(join(out, d, "index.md"))).toBe(true);
    }
    expect(readFileSync(join(out, "index.md"), "utf8")).toStartWith("# Team Alpha Knowledge Base\n");
    expect(readFileSync(join(out, "README.md"), "utf8")).toContain("Jane Doe accepts decisions (ADRs and PDRs)");
  });

  test("refuses a non-empty output folder and writes nothing", () => {
    const out = join(tmp, "kb");
    renderKb(opts(), out);
    writeFileSync(join(tmp, "kb", "marker.txt"), "x");
    const before = files(out).length;
    expect(() => renderKb(opts(), out)).toThrow(/not empty/);
    expect(files(out).length).toBe(before);
  });

  test("refuses invalid options and writes nothing", () => {
    const out = join(tmp, "kb");
    expect(() => renderKb(opts({ kb: "TKA" }), out)).toThrow(/\^\[a-z\]\{3\}\$/);
    expect(existsSync(out)).toBe(false);
  });

  test("rendered KB passes its own lint, tests and export", () => {
    const out = join(tmp, "kb");
    renderKb(opts({ kb: "tst", sections: ["process", "reference", "primer", "pdr"] }), out);
    const git = (...a: string[]) => execFileSync("git", ["-C", out, ...a], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "add", "-A");
    git("-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
    const run = (...a: string[]) => spawnSync(process.execPath, a, { cwd: out, encoding: "utf8" });
    const lint = run("scripts/lint-kb.ts");
    expect(lint.stdout).toBe("");
    expect(lint.status).toBe(0);
    expect(run("test", "scripts/").status).toBe(0);
    const exp = run("scripts/kb-export.ts", "--ref", "HEAD", "--out", join(tmp, "x.json"));
    expect(exp.status).toBe(0);
    const parsed = JSON.parse(readFileSync(join(tmp, "x.json"), "utf8"));
    expect(parsed.kb).toBe("tst");
    expect(parsed.docs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("renderSkills", () => {
  test("renders the team plugin with exactly the three team skills", () => {
    const out = join(tmp, "skills");
    renderSkills(opts({ team: "Team Ä & Co." }), out);
    const skillsDir = join(out, "plugins", "tka-workflow", "skills");
    expect(readdirSync(skillsDir).sort()).toEqual(["kb-answer-engine", "kb-article-writer", "kb-provider"]);
    for (const name of readdirSync(skillsDir)) {
      const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
      const fm = Bun.YAML.parse(text.slice(4, text.indexOf("\n---", 4))) as Record<string, any>;
      expect(fm.name).toBe(name);
      expect(fm.description).toContain("Team Ä & Co. Knowledge Base");
    }
    const market = JSON.parse(readFileSync(join(out, ".claude-plugin", "marketplace.json"), "utf8"));
    expect(market.name).toBe("tka-agent-skills");
    expect(market.plugins[0].source).toBe("./plugins/tka-workflow");
    const plugin = JSON.parse(readFileSync(join(out, "plugins", "tka-workflow", ".claude-plugin", "plugin.json"), "utf8"));
    expect(plugin).toMatchObject({ name: "tka-workflow", version: "1.0.0" });
    expect(readFileSync(join(out, "README.md"), "utf8")).toContain("/plugin marketplace add acme/tka-agent-skills");
    for (const f of files(out)) {
      const text = readFileSync(f, "utf8");
      expect({ f: relative(out, f), leftover: /\{\{|\buep\b|clickup/i.test(text) }).toEqual({ f: relative(out, f), leftover: false });
    }
  });

  test("refuses a non-empty output folder", () => {
    const out = join(tmp, "skills");
    renderSkills(opts(), out);
    expect(() => renderSkills(opts(), out)).toThrow(/not empty/);
  });
});

describe("CLI", () => {
  test("renders both trees", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--kb", "tka", "--team", "Team Alpha", "--owner", "acme", "--decider", "Jane Doe", "--sections", "process,pdr", "--kb-out", join(tmp, "a"), "--skills-out", join(tmp, "b")], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(existsSync(join(tmp, "a", "pdr", "about.md"))).toBe(true);
    expect(existsSync(join(tmp, "b", "plugins", "tka-workflow", "skills", "kb-provider", "SKILL.md"))).toBe(true);
  });

  test("exits 2 with one stderr line per error", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--kb", "TKA", "--team", "T", "--owner", "acme", "--decider", "D", "--sections", "", "--kb-out", join(tmp, "a"), "--skills-out", join(tmp, "b")], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr.trim().split("\n").length).toBeGreaterThanOrEqual(1);
    expect(r.stderr).toContain("^[a-z]{3}$");
  });
});
