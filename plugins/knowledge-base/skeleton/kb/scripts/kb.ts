import { readdirSync, readFileSync } from "fs";
import { join } from "path";

export type Section = { dir: string; heading: string };

export const SECTIONS: Section[] = [
// section:process
  { dir: "process", heading: "Process" },
// /section:process
// section:reference
  { dir: "reference", heading: "Reference" },
// /section:reference
// section:primer
  { dir: "primer", heading: "Primer" },
// /section:primer
  { dir: "adr", heading: "Architecture Decision Records" },
// section:pdr
  { dir: "pdr", heading: "Product Decision Records" },
// /section:pdr
  { dir: "templates", heading: "Templates" },
];

export const ROOT_FILES = ["README.md", "glossary.md"];

export const DECISION_TYPES = new Set(["adr", "pdr"]);
export const TYPES = new Set(["adr", "pdr", "process", "reference", "primer", "template", "glossary"]);
export const REQUIRED = ["type", "title", "description", "tags"];
export const DECISION_REQUIRED = ["status", "date"];
export const DECISION_STATUSES = ["Proposed", "Accepted", "Superseded", "Postponed"];

export const EXCLUDED = new Set([".git", ".github", "scripts", "node_modules", "assets"]);

export type Frontmatter = Record<string, string>;

export function parseFrontmatter(text: string): Frontmatter | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const fm: Frontmatter = {};
  for (const line of text.slice(4, end).split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

export function extractLinks(text: string): string[] {
  const stripped = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const out: string[] = [];
  for (const m of stripped.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = target.split("#")[0];
    if (path) out.push(decodeURIComponent(path));
  }
  return out;
}

export function walkMarkdown(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(e.name) || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

export function sectionFiles(root: string, dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(join(root, dir));
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .sort((a, b) => {
      if (a === "about.md") return -1;
      if (b === "about.md") return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });
}

export function readFrontmatter(root: string, relPath: string): Frontmatter {
  return parseFrontmatter(readFileSync(join(root, relPath), "utf8")) ?? {};
}
