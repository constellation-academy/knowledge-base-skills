import { writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { posix, resolve as resolvePath } from "path";
import { EXCLUDED, parseFrontmatter } from "./kb";

export type ExportDoc = {
  path: string;
  type: string | null;
  title: string;
  description: string | null;
  status: string | null;
  tags: string[];
  refs: string[];
  supersedes: string[];
  parts: string[];
  extra: Record<string, string>;
  body: string;
};

export type KbExport = { kb: string; sha: string; docs: ExportDoc[] };

export type Source = { files: string[]; read(path: string): string };

export function listed(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((s) => s.startsWith("."))) return false;
  if (segments.slice(0, -1).some((s) => EXCLUDED.has(s))) return false;
  return path.endsWith(".md") && segments[segments.length - 1] !== "index.md";
}

const git = (repo: string, args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

export function resolveCommit(repo: string, ref: string): string {
  return git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

export function manifestKb(repo: string, commit: string): string {
  return JSON.parse(git(repo, ["show", `${commit}:kb-manifest.json`])).kb;
}

export function gitSource(repo: string, commit: string): Source {
  const files = git(repo, ["ls-tree", "-r", "-z", "--name-only", commit])
    .split("\0")
    .filter((p) => p && listed(p));
  return { files, read: (p) => git(repo, ["show", `${commit}:${p}`]) };
}

export function bodyOf(text: string): string {
  const end = text.indexOf("\n---", 4);
  return text.slice(end + 4).replace(/^\n+/, "");
}

export function unquote(value: string): string {
  const m = value.match(/^(["'])(.*)\1$/);
  return m ? m[2] : value;
}

export function tagsOf(value: string | undefined): string[] {
  const m = value?.match(/^\[(.*)\]$/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((t) => unquote(t.trim()))
    .filter(Boolean);
}

export function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

export function linkedPaths(fromDir: string, body: string, indexed: Set<string>): string[] {
  const out: string[] = [];
  for (const m of stripCode(body).matchAll(/\]\(([^)\s#]+?\.md)(?:#[^)]*)?\)/g)) {
    if (/^(?:[a-z]+:|\/)/i.test(m[1])) continue;
    const resolved = posix.normalize(posix.join(fromDir, decodeURIComponent(m[1])));
    if (indexed.has(resolved) && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

const CORE = new Set(["type", "title", "description", "tags", "status"]);

export function buildExport(src: Source, kb: string, sha: string): KbExport {
  const docs: ExportDoc[] = [];
  for (const path of [...src.files].sort()) {
    const text = src.read(path);
    const fm = parseFrontmatter(text);
    if (!fm?.type) continue;
    const extra = Object.fromEntries(Object.entries(fm).filter(([k]) => !CORE.has(k)).map(([k, v]) => [k, unquote(v)]));
    const type = unquote(fm.type);
    const isDecision = type === "adr" || type === "pdr";
    if (!isDecision && fm.status) extra.status = unquote(fm.status);
    docs.push({
      path,
      type,
      title: unquote(fm.title ?? ""),
      description: fm.description ? unquote(fm.description) : null,
      status: isDecision && fm.status ? unquote(fm.status) : null,
      tags: tagsOf(fm.tags),
      refs: [],
      supersedes: [],
      parts: [],
      extra,
      body: bodyOf(text),
    });
  }
  const indexed = new Set(docs.map((d) => d.path));
  for (const d of docs) {
    d.refs = linkedPaths(posix.dirname(d.path), d.body, indexed).filter((p) => p !== d.path);
  }
  return { kb, sha, docs };
}

function optionValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const repo = resolvePath(import.meta.dir, "..");
  const ref = optionValue(args, "--ref");
  const out = optionValue(args, "--out");
  if (!ref || !out) throw new Error("usage: bun scripts/kb-export.ts --ref <rev> --out <file>");
  const sha = resolveCommit(repo, ref);
  const json = JSON.stringify(buildExport(gitSource(repo, sha), manifestKb(repo, sha), sha), null, 2);
  writeFileSync(resolvePath(out), json);
}
