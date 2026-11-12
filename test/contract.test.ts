import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN = join(import.meta.dir, "../plugins/knowledge-base");
const contract = readFileSync(join(PLUGIN, "contracts/knowledge-base.v1.md"), "utf8");
const provider = readFileSync(join(PLUGIN, "skills/content-provider/SKILL.md"), "utf8");
const updater = readFileSync(join(PLUGIN, "skills/update-operator/SKILL.md"), "utf8");

const section = (text: string, heading: string): string => {
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) return "";
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
};

const REPORT = [
  "kb: <kb>",
  "commit: <commit>[, offline: last fetched commit is <age> old]",
  "index: current | loaded | unavailable — <reason>",
  'docs: <docs, or "-" when the index is unavailable>',
];

describe("contract", () => {
  test("contract has Resolution and Machine reads sections", () => {
    const q = contract.indexOf("\n## Queries\n");
    const r = contract.indexOf("\n## Resolution\n");
    const m = contract.indexOf("\n## Machine reads\n");
    expect(q).toBeGreaterThan(-1);
    expect(r).toBeGreaterThan(q);
    expect(m).toBeGreaterThan(r);
  });

  test("resolution table has index and no-index columns for file, type, folder, path/, path", () => {
    const s = section(contract, "## Resolution");
    expect(s).toContain("| Item | Index available | Index unavailable |");
    for (const key of ['`{"file": p}` resource', '`{"type": [t, …]}` resource', '`{"folder": f}` resource', "document path ending in `/`", "other document path"]) {
      expect(s).toContain(`| ${key} |`);
    }
  });

  test("content-provider cites the contract table", () => {
    const s = section(provider, "## 2. fetch");
    expect(s).toContain('section "Resolution"');
    expect(s).not.toContain("| Item | Index available | Index unavailable |");
  });

  test("contract freezes the update-operator report", () => {
    const block = REPORT.join("\n");
    expect(contract).toContain(block);
    expect(updater).toContain(block);
  });

  test("contract allows an external machine reader to call update-operator", () => {
    const s = section(contract, "## Freshness");
    expect(s).not.toMatch(/Only the plugin's skills call `update-operator`\.\s*$/m);
    expect(s).toContain('a machine reader that follows the section "Machine reads"');
    expect(contract).not.toContain("(fetch and index) is internal");
  });
});

describe("update-operator publish step", () => {
  const setup = readFileSync(join(PLUGIN, "skills/setup-operator/SKILL.md"), "utf8");
  const start = updater.indexOf("\n3. Only after the export exited 0");
  const step = updater.slice(start, updater.indexOf("\n4. Run the query `load`", start));
  const commands = [...step.matchAll(/```\n([\s\S]*?)```/g)].flatMap((m) => m[1].trim().split(/;\s*/));

  test("makes the export readable for the container's neo4j user before moving it into place", () => {
    expect(commands).toEqual([
      'chmod 644 "<import>/kb-export.json.tmp"',
      'rm "<import>/kb-export.json"',
      'mv "<import>/kb-export.json.tmp" "<import>/kb-export.json"',
    ]);
  });

  test("setup-operator pre-allows every publish command, so a headless session is not stopped", () => {
    for (const c of commands) expect(setup).toContain(`Bash(${c})`);
  });
});
