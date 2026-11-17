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
  const step = updater.slice(start, updater.indexOf("\n4. ", start));
  const commands = [...step.matchAll(/```\n([\s\S]*?)```/g)].flatMap((m) => m[1].trim().split(/;\s*/));
  const wild = (c: string) => c.replaceAll("<run id>", "*");

  test("makes the run's own export readable for the container's neo4j user before moving it into place", () => {
    expect(commands).toEqual([
      'chmod 644 "<import>/kb-export.<run id>.json.tmp"',
      'rm "<import>/kb-export.json"',
      'mv "<import>/kb-export.<run id>.json.tmp" "<import>/kb-export.json"',
    ]);
  });

  test("a denied or failed chmod is not fatal: an install upgraded without re-running setup keeps the 1.1.5 path", () => {
    const after = step.slice(step.indexOf('chmod 644 "<import>/kb-export.<run id>.json.tmp"'));
    const outcome = after.slice(0, after.indexOf("rm \"<import>/kb-export.json\""));
    expect(outcome).toMatch(/denies it or it fails: continue with the move/i);
    expect(outcome).not.toMatch(/It fails: `index: unavailable/);
  });

  test("a load that cannot open the export after a skipped chmod names the cause and the one-time setup migration", () => {
    const load = updater.slice(updater.indexOf("\n4. ", start), updater.indexOf("\n5. The row's `sha`"));
    expect(load).toContain("Cannot open file");
    expect(load).toContain("run knowledge-base:setup-operator once");
  });

  test("setup-operator pre-allows every publish command, the run id as a wildcard, so a headless session is not stopped", () => {
    for (const c of commands) expect(setup).toContain(`Bash(${wild(c)})`);
  });

  test("no skill or contract names the shared temp file any more", () => {
    const contractText = readFileSync(join(PLUGIN, "contracts/knowledge-base.v1.md"), "utf8");
    for (const t of [updater, setup, contractText]) expect(t).not.toContain("kb-export.json.tmp");
    expect(setup).toContain('`{out}` by `"<import>/kb-export.*.json.tmp"`');
  });
});

describe("update-operator reload lock", () => {
  const reload = updater.slice(updater.indexOf("\n### 6. Reload the index"), updater.indexOf("\n### 7. Report"));
  const firstStep = "\n1. Run the query `status` again";
  const beforeFirst = reload.slice(0, reload.indexOf(firstStep));
  const stepOf = (n: number) => {
    const from = reload.indexOf(n === 1 ? firstStep : `\n${n}. `, reload.indexOf(firstStep));
    return reload.slice(from, n === 6 ? undefined : reload.indexOf(`\n${n + 1}. `, from + 1));
  };
  const HINT = "run knowledge-base:setup-operator once to allow the reload lock";

  test("takes the lock before step 6.1, with the commands of runtime.md", () => {
    expect(reload.indexOf(firstStep)).toBeGreaterThan(0);
    expect(beforeFirst).toContain('section "Reload lock"');
    expect(beforeFirst).toContain("`index: unavailable — another run is reloading the index; the previous index is kept`");
  });

  test("the run id comes from the run id command, never from the model", () => {
    expect(beforeFirst).toContain("run id command");
    expect(beforeFirst).toMatch(/never choose/i);
    expect(beforeFirst).toContain("draw a new `<run id>`");
  });

  test("every outcome of steps 6.1 to 6.5 releases the lock before the report", () => {
    const steps = reload.slice(reload.indexOf(firstStep), reload.indexOf("\n6. ", reload.indexOf(firstStep)));
    expect(steps).not.toContain("go to step 7");
    expect(reload).toMatch(/\n6\. [^\n]*release/i);
  });

  test("a lock without owner, or with more than one, is aged by the lock folder and broken when stale", () => {
    expect(beforeFirst).toContain("lock age check");
    expect(beforeFirst).toMatch(/no name, or more than one name/i);
    expect(beforeFirst).toContain('`rmdir "<import>/reload.lock/<name>"`');
  });

  test("a second mkdir that fails removes the run's own ownerless lock", () => {
    const second = beforeFirst.slice(beforeFirst.indexOf('`mkdir "<import>/reload.lock/<run id>"`'));
    expect(second.slice(0, 600)).toContain('`rmdir "<import>/reload.lock"`');
  });

  test("after every successful take the lock must list exactly this run's id", () => {
    expect(beforeFirst).toContain("exactly `<run id>`");
  });

  test("a lock that cannot be cleared or created, and a denied lock, have their own reasons", () => {
    expect(beforeFirst).toContain("cannot be cleared");
    expect(beforeFirst).toContain("remove that folder by hand");
    expect(beforeFirst).toContain("`index: unavailable — the reload lock could not be created: <first error line>; the previous index is kept`");
    expect(beforeFirst).toContain(HINT);
  });

  test("a denied first mkdir lists the lock and reloads without it only when no lock exists", () => {
    const denied = beforeFirst.slice(beforeFirst.indexOf("**Not allowed.**"), beforeFirst.indexOf("**The ownership check**"));
    expect(denied).toContain('`ls "<import>/reload.lock"`');
    expect(denied).toContain("does not exist: no run holds the lock. Continue with step 6.1 without the lock");
    expect(denied).toContain(`another run is reloading the index; the previous index is kept; ${HINT}`);
  });

  test("a temp export gone at the move has its own outcome", () => {
    expect(reload).toContain("`index: unavailable — the export file disappeared before the move; the previous index is kept`");
  });

  test("the listing after the move names the run's own temp file", () => {
    const move = stepOf(3);
    expect(move).toContain("`kb-export.<run id>.json.tmp` is listed");
    expect(move).toContain("`kb-export.json` is listed and `kb-export.<run id>.json.tmp` is not");
  });

  test("step 6.1 re-runs status and stops with current when another run loaded the commit", () => {
    const first = stepOf(1);
    expect(first).toContain("`index: current`");
    expect(first).toContain("go to step 6.6");
  });

  test("the run checks it still owns the lock before the export, the move and the load", () => {
    const exportStep = stepOf(2);
    const move = reload.slice(reload.indexOf("\n3. ", reload.indexOf(firstStep)), reload.indexOf('rm "<import>/kb-export.json"; mv'));
    for (const s of [exportStep, move, stepOf(4)]) expect(s).toContain("ownership check");
    expect(exportStep).toContain('`{out}` with `"<import>/kb-export.<run id>.json.tmp"`');
    expect(reload).toContain("`index: unavailable — the reload lock was taken over; the previous index is kept`");
  });

  test("a failed run removes its own temp file, and the release touches nothing else when its owner folder is gone", () => {
    const release = stepOf(6);
    expect(release).toContain('`rm "<import>/kb-export.<run id>.json.tmp"`');
    expect(release).toContain('`rmdir "<import>/reload.lock/<run id>"`');
    expect(release).toContain("touch nothing else");
  });

  test("a stale lock with one owner is broken by removing its owner folder, so only one run can break it", () => {
    expect(beforeFirst).toContain('`rmdir "<import>/reload.lock/<old>"`');
    expect(beforeFirst).toContain("`ls \"<import>/reload.lock\"`");
  });

  test("the contract names the lock, its owner folder and the run's temp file in the local layout", () => {
    const layout = section(contract, "## Local layout");
    expect(layout).toContain("`~/.kb/<kb id>/import/reload.lock`");
    expect(layout).toContain("`<run id>`");
    expect(layout).toContain("`~/.kb/<kb id>/import/kb-export.<run id>.json.tmp`");
  });

  test("the contract's Freshness names every lock outcome the skill defines", () => {
    const freshness = section(contract, "## Freshness");
    expect(freshness).toContain("more than 30 minutes");
    expect(freshness).toContain("taken over");
    expect(freshness).toContain("more than one owner folder");
    expect(freshness).toContain("cannot be cleared");
    expect(freshness).toContain("could not be created");
    expect(freshness).toContain("does not allow the lock commands");
    expect(freshness).toContain(HINT);
    expect(freshness).not.toMatch(/Only one run per KB reloads at a time:/);
  });
});
