#!/usr/bin/env bun
// kb-fetch: machine read of the KB through the Neo4j index (contract: "Machine reads").
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type Cfg = { kbPath: string; kb: string; shell: string[]; db: string; queryDir: string; env?: Record<string, string | undefined> };

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
  let out = '"';
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (v[i] === "\\") out += "\\\\";
    else if (c >= 0x20 && c <= 0x7e && v[i] !== '"' && v[i] !== "'") out += v[i];
    else out += "\\u" + c.toString(16).padStart(4, "0"); // UTF-16 units: astral becomes a surrogate pair
  }
  return out + '"';
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
  const kbPath = resolve(need("KB_PATH"));
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
  const queryDir = shellText.startsWith("docker exec") ? "/import/queries" : join(dirname(clone), "import", "queries");
  return { kbPath, kb: m.kb, shell, db, queryDir, env };
}

export function runQuery(name: string, params: Record<string, string | number | null>, cfg: Cfg): object[] {
  const file = cfg.queryDir === "/import/queries" ? `/import/queries/${name}.cypher` : join(cfg.queryDir, `${name}.cypher`);
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

export function main(argv: string[], env: Record<string, string | undefined>): { code: number; stdout: string; stderr: string } {
  try {
    const cfg = loadConfig(env);
    status(cfg);
    // Task 3 adds resolution and output here.
    return { code: 0, stdout: "", stderr: "" };
  } catch (e) {
    if (e instanceof FetchError)
      return { code: e.exit, stdout: "", stderr: JSON.stringify({ error: e.code, detail: e.detail, item: e.item }) + "\n" };
    throw e;
  }
}

if (import.meta.main) {
  const r = main(process.argv.slice(2), process.env);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exit(r.code);
}
