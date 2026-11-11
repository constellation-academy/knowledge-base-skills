// Fake cypher-shell: answers status/doc/list from index.json next to this file.
// Env: FAKE_FAIL=ERR_x -> exit 1 with that first stderr line; FAKE_STATUS=empty|norow.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const fail = (msg: string): never => {
  process.stderr.write(msg + "\n");
  process.exit(1);
};
if (process.env.FAKE_FAIL) fail(process.env.FAKE_FAIL);

const args = process.argv.slice(2);
let db = "", file = "", format = "";
const params: Record<string, unknown> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-d") db = args[++i];
  else if (a === "--format") format = args[++i];
  else if (a === "-f") file = args[++i];
  else if (a === "-P") {
    const m = /^(\w+) => (.*)$/s.exec(args[++i] ?? "");
    if (!m) fail("ERR_BAD_PARAM");
    params[m![1]] = JSON.parse(m![2]); // literals are valid JSON strings/numbers/null
  } else fail(`ERR_BAD_FLAG ${a}`);
}
if (!db) fail("ERR_NO_DATABASE");
if (format !== "plain") fail("ERR_NOT_PLAIN");
if (!file.endsWith(".cypher")) fail("ERR_NO_QUERY_FILE");
const name = basename(file, ".cypher");

const index = JSON.parse(readFileSync(join(import.meta.dir, "index.json"), "utf8"));
const same = params.kb === index.kb;
const row = (d: any) => ({
  path: d.path, type: d.type, title: process.env.FAKE_TITLE ?? d.title ?? d.path, description: d.description ?? null,
  status: d.status ?? null, tags: d.tags ?? [], refs: d.refs ?? [], supersedes: d.supersedes ?? [],
  parts: d.parts, extra: d.extra ?? {},
});
let rows: unknown[] = [];
if (name === "status") {
  if (process.env.FAKE_STATUS === "norow") rows = [];
  else if (process.env.FAKE_STATUS === "empty" || !same) rows = [{ kb: params.kb, empty: true }];
  else rows = [{ kb: index.kb, sha: index.sha, docs: index.docs.length }];
} else if (name === "doc") {
  const d = same && index.docs.find((x: any) => x.path === params.path);
  rows = d ? [row(d)] : [];
} else if (name === "list") {
  rows = !same ? [] : index.docs.filter((d: any) => params.type == null || d.type === params.type)
    .sort((a: any, b: any) => (a.path < b.path ? -1 : 1)).map(row);
} else fail(`ERR_UNKNOWN_QUERY ${name}`);
if (rows.length) {
  const out = ["json", ...rows.map((r) => '"' + JSON.stringify(r).replace(/"/g, '\\"') + '"')];
  process.stdout.write(out.join("\n") + "\n");
}
