#!/usr/bin/env bun
// kb-fetch: machine read of the KB through the Neo4j index (contract: "Machine reads").
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";

export type Cfg = { kbPath: string; kb: string; shell: string[]; docker: boolean; db: string; queryDir: string; env?: Record<string, string | undefined> };

export class FetchError extends Error {
  exit: 2 | 3 | 4;
  constructor(public code: "config" | "index" | "unresolved", public detail: string, public item: string | null = null) {
    super(detail);
    this.exit = code === "config" ? 2 : code === "index" ? 3 : 4;
  }
}

export function escapeLiteral(v: string | null | number): string {
  if (v === null) return "null";
  if (typeof v === "number") return String(v);
  let out = "'";
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e && !"\\\"'$`".includes(v[i])) out += v[i];
    else out += "\\u" + c.toString(16).padStart(4, "0"); // UTF-16 units: astral becomes a surrogate pair
  }
  return out + "'";
}

export function splitShell(cmd: string): string[] {
  return cmd.split(/\s+/).filter(Boolean);
}

export function loadConfig(env: Record<string, string | undefined>): Cfg {
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new FetchError("config", `${k} is unset`);
    return v;
  };
  const kbPath = resolvePath(need("KB_PATH"));
  const shellText = need("NEO4J_SHELL");
  const db = need("NEO4J_DATABASE");
  let m: any;
  try {
    m = JSON.parse(readFileSync(join(kbPath, "kb-manifest.json"), "utf8"));
  } catch {
    throw new FetchError("config", `KB_PATH (${kbPath}) holds no valid kb-manifest.json`);
  }
  if (!m || typeof m.kb !== "string" || !m.kb) throw new FetchError("config", "manifest has no kb");
  if (String(m.contract) !== "1") throw new FetchError("config", `unsupported contract major: ${m.contract}`);
  const root = String(m.kb_root ?? ".").replace(/^\.\//, "").replace(/\/+$/, "") || ".";
  let clone = kbPath;
  if (root !== ".") {
    const suffix = "/" + root;
    if (!kbPath.endsWith(suffix)) throw new FetchError("config", `KB_PATH is not the KB root ${root} of its clone`);
    clone = kbPath.slice(0, -suffix.length);
  }
  if (basename(clone) !== "repo" || basename(dirname(clone)) !== m.kb)
    throw new FetchError("config", `KB_PATH is not inside a read-only clone at a folder ${m.kb}/repo`);
  const shell = splitShell(shellText);
  const docker = shell[0] === "docker" && shell[1] === "exec";
  const queryDir = docker ? "/import/queries" : join(dirname(clone), "import", "queries");
  return { kbPath, kb: m.kb, shell, docker, db, queryDir, env };
}

export function runQuery(name: string, params: Record<string, string | number | null>, cfg: Cfg): object[] {
  const file = cfg.docker ? `/import/queries/${name}.cypher` : join(cfg.queryDir, `${name}.cypher`);
  const argv = [...cfg.shell, "-d", cfg.db, "--format", "plain", "-f", file];
  for (const [k, v] of Object.entries(params)) argv.push("-P", `${k} => ${escapeLiteral(v)}`);
  let r;
  try {
    r = Bun.spawnSync(argv, { env: (cfg.env ?? process.env) as Record<string, string>, stdout: "pipe", stderr: "pipe" });
  } catch (e) {
    throw new FetchError("index", `query ${name} cannot start: ${(e as Error).message.split("\n")[0]}`);
  }
  const first = (s: Uint8Array) => new TextDecoder().decode(s).split("\n").find((l) => l.trim()) ?? "";
  if (r.exitCode !== 0) throw new FetchError("index", `query ${name} failed: ${first(r.stderr) || `exit ${r.exitCode}`}`);
  return parseRows(name, new TextDecoder().decode(r.stdout));
}

export function parseRows(name: string, out: string): object[] {
  const lines = out.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  if (lines[0].trim() !== "json") throw new FetchError("index", `query ${name}: unexpected output header`);
  return lines.slice(1).map((l) => {
    let t = l.trim();
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1);
    try {
      return JSON.parse(t.replace(/\\"/g, '"'));
    } catch {
      throw new FetchError("index", `query ${name}: unparseable row`);
    }
  });
}

export function status(cfg: Cfg): { kb: string; sha: string; docs: unknown } {
  const rows = runQuery("status", { kb: cfg.kb }, cfg) as any[];
  const row = rows[0];
  if (!row) throw new FetchError("index", `status returned no KBIndex row for ${cfg.kb}`);
  if (row.empty || !row.sha) throw new FetchError("index", `the index of KB ${cfg.kb} is empty`);
  return row;
}

export type Manifest = { kb: string; resources?: Record<string, { file?: string; type?: string[]; folder?: string }> };

function loadManifest(cfg: Cfg): Manifest {
  return JSON.parse(readFileSync(join(cfg.kbPath, "kb-manifest.json"), "utf8"));
}

const asStrings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function resolveFile(item: string, path: string, cfg: Cfg): string[] {
  const rows = runQuery("doc", { kb: cfg.kb, path }, cfg) as any[];
  if (!rows[0]) throw new FetchError("unresolved", `not in the index of KB ${cfg.kb}: ${path}`, item);
  return [path];
}

function resolveFolder(item: string, folder: string, cfg: Cfg): string[] {
  const f = folder.endsWith("/") ? folder : folder + "/";
  const row = (runQuery("doc", { kb: cfg.kb, path: f }, cfg) as any[])[0];
  const parts = asStrings(row?.parts);
  if (parts.length > 0) return parts;
  const rows = runQuery("list", { kb: cfg.kb, type: null }, cfg) as any[];
  return rows
    .map((r) => String(r.path))
    .filter((p) => p.startsWith(f) && p.endsWith(".md") && !p.slice(f.length).includes("/") && p.slice(f.length) !== "index.md")
    .sort();
}

function resolveType(types: string[], cfg: Cfg): string[] {
  const all = new Set<string>();
  for (const t of types) for (const r of runQuery("list", { kb: cfg.kb, type: t }, cfg) as any[]) all.add(String(r.path));
  return [...all].sort();
}

export function resolve(item: string, cfg: Cfg, manifest: Manifest): string[] {
  let docs: string[];
  if (!item.includes("/") && !item.includes(".")) {
    const res = Object.hasOwn(manifest.resources ?? {}, item) ? manifest.resources![item] : undefined;
    if (!res)
      throw new FetchError("unresolved", `not a resource of KB ${cfg.kb}: ${item}; resources: ${Object.keys(manifest.resources ?? {}).join(", ")}`, item);
    if (typeof res.file === "string") docs = resolveFile(item, res.file, cfg);
    else if (Array.isArray(res.type)) docs = resolveType(asStrings(res.type), cfg);
    else if (typeof res.folder === "string") docs = resolveFolder(item, res.folder, cfg);
    else throw new FetchError("unresolved", `resource ${item} has no file, type or folder`, item);
  } else docs = item.endsWith("/") ? resolveFolder(item, item, cfg) : resolveFile(item, item, cfg);
  if (docs.length === 0) throw new FetchError("unresolved", `resolves to no documents: ${item}`, item);
  return docs;
}

function readDoc(item: string, path: string, cfg: Cfg): { path: string; text: string } {
  const inside = (base: string, p: string) => {
    const rel = relative(base, p);
    return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
  };
  const outside = () => new FetchError("unresolved", `path is outside the KB root: ${path}`, item);
  let file: string;
  try {
    const base = realpathSync(cfg.kbPath);
    const target = resolvePath(base, path);
    if (!inside(base, target)) throw outside();
    file = realpathSync(target);
    if (!inside(base, file)) throw outside();
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError("unresolved", `not found: ${path}`, item);
  }
  try {
    return { path, text: readFileSync(file, "utf8") };
  } catch {
    throw new FetchError("unresolved", `not found: ${path}`, item);
  }
}

export function main(argv: string[], env: Record<string, string | undefined>): { code: number; stdout: string; stderr: string } {
  try {
    if (argv.length === 0) throw new FetchError("config", "no items");
    const cfg = loadConfig(env);
    const st = status(cfg);
    const manifest = loadManifest(cfg);
    const items = argv.map((item) => ({ item, documents: resolve(item, cfg, manifest).map((p) => readDoc(item, p, cfg)) }));
    return { code: 0, stdout: JSON.stringify({ kb: cfg.kb, sha: st.sha, items }) + "\n", stderr: "" };
  } catch (e) {
    if (e instanceof FetchError)
      return { code: e.exit, stdout: "", stderr: JSON.stringify({ error: e.code, detail: e.detail, item: e.item }) + "\n" };
    const detail = String((e as Error)?.message ?? e).split("\n")[0];
    return { code: 1, stdout: "", stderr: JSON.stringify({ error: "internal", detail, item: null }) + "\n" };
  }
}

if (import.meta.main) {
  const r = main(process.argv.slice(2), process.env);
  // Let stdout drain (large output into a pipe): set exitCode instead of exiting.
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.code;
}
