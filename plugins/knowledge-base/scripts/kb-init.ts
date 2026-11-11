#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

export const ALL_SECTIONS = ["process", "reference", "primer", "pdr"] as const;
export type Section = (typeof ALL_SECTIONS)[number];
export type InitOptions = { kb: string; team: string; owner: string; decider: string; sections: Section[] };

const SKELETON = join(import.meta.dir, "..", "skeleton");
const SECTION_PATHS: Record<Section, string[]> = {
  process: ["process/"],
  reference: ["reference/"],
  primer: ["primer/"],
  pdr: ["pdr/", "templates/pdr-template.md"],
};
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .&'-]*$/u;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const BASE = ["type", "title", "description", "tags"];
const DECISION = [...BASE, "status", "date"];

export function validateOptions(o: InitOptions): string[] {
  const errors: string[] = [];
  if (!/^[a-z]{3}$/.test(o.kb)) errors.push(`kb: "${o.kb}" must be exactly 3 lower-case letters (^[a-z]{3}$)`);
  for (const field of ["team", "decider"] as const) {
    if (!NAME.test(o[field])) {
      errors.push(`${field}: "${o[field]}" may only use letters, digits, spaces and . - & '`);
    }
  }
  if (!OWNER.test(o.owner)) errors.push(`owner: "${o.owner}" is not a GitHub organisation or account name`);
  for (const s of o.sections) {
    if (!(ALL_SECTIONS as readonly string[]).includes(s)) {
      errors.push(`sections: unknown section "${s}"; allowed: ${ALL_SECTIONS.join(", ")}`);
    }
  }
  return errors;
}

export function buildManifest(o: InitOptions): object {
  const has = (s: Section) => o.sections.includes(s);
  const resources: Record<string, object> = {
    glossary: { file: "glossary.md" },
    decisions: { type: has("pdr") ? ["adr", "pdr"] : ["adr"] },
    catalog: { file: "index.md" },
    "kb-readme": { file: "README.md" },
    adr: { folder: "adr/" },
    "adr-template": { file: "templates/adr-template.md" },
    "article-template": { file: "templates/kb-entry-template.md" },
  };
  const articleTypes: Record<string, object> = {
    adr: { folder: "adr/", template: "templates/adr-template.md", required_frontmatter: DECISION, file_name: "ADR-{number}-{slug}.md" },
  };
  for (const s of ALL_SECTIONS) {
    if (!has(s)) continue;
    resources[s] = { folder: `${s}/` };
    articleTypes[s] =
      s === "pdr"
        ? { folder: "pdr/", template: "templates/pdr-template.md", required_frontmatter: DECISION, file_name: "PDR-{number}-{slug}.md" }
        : { folder: `${s}/`, template: "templates/kb-entry-template.md", required_frontmatter: BASE };
  }
  if (has("pdr")) resources["pdr-template"] = { file: "templates/pdr-template.md" };
  articleTypes.template = { folder: "templates/", template: "templates/kb-entry-template.md", required_frontmatter: BASE };
  articleTypes.glossary = { folder: "./", template: "glossary.md", required_frontmatter: BASE, file_name: "glossary.md" };
  return {
    kb: o.kb,
    contract: "1",
    default_branch: "main",
    kb_root: ".",
    export: { cmd: "bun scripts/kb-export.ts --ref {ref} --out {out}", placeholders: ["{ref}", "{out}"] },
    fulltext_analyzer: "english",
    resources,
    article_types: articleTypes,
    skills: {
      read: `${o.kb}-workflow:kb-provider`,
      write: `${o.kb}-workflow:kb-article-writer`,
      answer: `${o.kb}-workflow:kb-answer-engine`,
    },
    pr: { host: "github", branch_pattern: "docs/{slug}", commit_pattern: "docs(kb): {summary}", pre_commit: "bun scripts/kb-pre-commit.ts" },
  };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function applySections(text: string, sections: Section[]): string {
  let out = text;
  for (const s of ALL_SECTIONS) {
    const n = escape(s);
    const open = `(?:<!-- section:${n} -->|// section:${n})`;
    const close = `(?:<!-- /section:${n} -->|// /section:${n})`;
    if (sections.includes(s)) {
      out = out.replace(new RegExp(`^[ \\t]*(?:${open}|${close})[ \\t]*\\n`, "gm"), "");
      out = out.replace(new RegExp(`${open}|${close}`, "g"), "");
    } else {
      out = out.replace(new RegExp(`^[ \\t]*${open}[ \\t]*\\n[\\s\\S]*?^[ \\t]*${close}[ \\t]*\\n`, "gm"), "");
      out = out.replace(new RegExp(`${open}[\\s\\S]*?${close}`, "g"), "");
    }
  }
  return out;
}

export function applyTokens(text: string, o: InitOptions): string {
  const values: Record<string, string> = { kb: o.kb, KB: o.kb.toUpperCase(), team: o.team, owner: o.owner, decider: o.decider };
  return text.replace(/\{\{(kb|KB|team|owner|decider)\}\}/g, (_, k: string) => values[k]);
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

function assertWritable(o: InitOptions, outDir: string): void {
  const errors = validateOptions(o);
  if (errors.length) throw new Error(errors.join("\n"));
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new Error(`${outDir} is not empty`);
}

function renderTree(tree: string, o: InitOptions, outDir: string, keep: (rel: string) => boolean): void {
  const src = join(SKELETON, tree);
  for (const file of walk(src)) {
    const rel = relative(src, file).split("\\").join("/");
    if (!keep(rel)) continue;
    const target = join(outDir, applyTokens(rel, o));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, applyTokens(applySections(readFileSync(file, "utf8"), o.sections), o));
  }
}

export function renderKb(o: InitOptions, outDir: string): void {
  assertWritable(o, outDir);
  const dropped = ALL_SECTIONS.filter((s) => !o.sections.includes(s)).flatMap((s) => SECTION_PATHS[s]);
  renderTree("kb", o, outDir, (rel) => !dropped.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p)));
  for (const d of ["adr", "templates", ...o.sections]) mkdirSync(join(outDir, d), { recursive: true });
  writeFileSync(join(outDir, "kb-manifest.json"), `${JSON.stringify(buildManifest(o), null, 2)}\n`);
  const gen = spawnSync(process.execPath, ["scripts/generate-indexes.ts"], { cwd: outDir, encoding: "utf8" });
  if (gen.status !== 0) throw new Error(`generate-indexes failed: ${gen.stderr || gen.stdout}`);
}

export function renderSkills(o: InitOptions, outDir: string): void {
  assertWritable(o, outDir);
  renderTree("agent-skills", o, outDir, () => true);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const o: InitOptions = {
    kb: option(args, "--kb") ?? "",
    team: option(args, "--team") ?? "",
    owner: option(args, "--owner") ?? "",
    decider: option(args, "--decider") ?? "",
    sections: (option(args, "--sections") ?? "").split(",").map((s) => s.trim()).filter(Boolean) as Section[],
  };
  const kbOut = option(args, "--kb-out");
  const skillsOut = option(args, "--skills-out");
  const errors = validateOptions(o);
  if (!kbOut) errors.push("--kb-out: missing");
  if (!skillsOut) errors.push("--skills-out: missing");
  for (const dir of [kbOut, skillsOut]) {
    if (dir && existsSync(dir) && readdirSync(dir).length > 0) errors.push(`${dir} is not empty`);
  }
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(2);
  }
  renderKb(o, kbOut!);
  renderSkills(o, skillsOut!);
  console.log(`kb: ${kbOut}\nskills: ${skillsOut}`);
}
