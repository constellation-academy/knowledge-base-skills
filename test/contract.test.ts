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


describe("update-operator reload", () => {
  const setup = readFileSync(join(PLUGIN, "skills/setup-operator/SKILL.md"), "utf8");
  const runtime = readFileSync(join(PLUGIN, "skills/update-operator/runtime.md"), "utf8");
  const readme = readFileSync(join(PLUGIN, "../../README.md"), "utf8");
  const loadCypher = readFileSync(join(PLUGIN, "cypher/load.cypher"), "utf8");
  const reload = updater.slice(updater.indexOf("\n### 6. Reload the index"), updater.indexOf("\n### 7. Report"));
  const firstStep = "\n1. Draw the run id.";
  const intro = reload.slice(0, reload.indexOf(firstStep));
  const stepOf = (n: number) => {
    const from = reload.indexOf(`\n${n}. `, reload.indexOf(firstStep));
    const next = reload.indexOf(`\n${n + 1}. `, from + 1);
    return reload.slice(from, next < 0 ? undefined : next);
  };
  const rules = setup.slice(setup.indexOf("### Allow rules"), setup.indexOf("\n## 5.", setup.indexOf("### Allow rules")));
  const ruleBlock = rules.slice(rules.indexOf("```\n") + 4, rules.indexOf("```", rules.indexOf("```\n") + 4));
  const CHMOD = 'chmod 644 "<import>"/kb-export.????????????.json';
  const RM = 'rm "<import>/kb-export.<run id>.json"';
  const HINT = "run knowledge-base:setup-operator once to allow the reload lock";
  const BUSY = "`index: unavailable — another run is reloading the index; the previous index is kept`";

  test("load.cypher loads the file named by the parameter $file, never a fixed export file", () => {
    expect(loadCypher).toContain("CALL apoc.load.json($file) YIELD value");
    expect(loadCypher).not.toContain("kb-export.json");
    expect(section(runtime, "## Run a query")).toMatch(/\| `load` \| `kb`, `file` \|/);
  });

  test("no skill, runtime or contract names a shared export file, a temp file, a move or an owner folder", () => {
    for (const t of [updater, runtime, contract]) {
      expect(t).not.toContain("kb-export.json");
      expect(t).not.toContain(".json.tmp");
      expect(t).not.toMatch(/owner folder|ownership check|taken over|`mv /i);
    }
    expect(setup).not.toMatch(/owner folder|reload\.lock\/\*/);
  });

  test("step 6 lists its steps in order: run id, take, status, export, chmod, load, sha, clean up and release", () => {
    const heads = ["\n1. Draw the run id.", "\n2. Take the lock.", "\n3. Run the query `status` again", "\n4. Build the export command", "\n5. Only after the export exited 0", "\n6. Run the query `load`", "\n7. The load's row's `sha`", "\n8. Clean up and release"];
    let at = -1;
    for (const h of heads) {
      const i = reload.indexOf(h);
      expect(i, h).toBeGreaterThan(at);
      at = i;
    }
  });

  test("the run id comes from its command and names the run's own export file", () => {
    expect(stepOf(1)).toContain('section "Reload lock"');
    expect(stepOf(1)).toMatch(/never choose/i);
    expect(stepOf(1)).toContain("`<import>/kb-export.<run id>.json`");
    expect(stepOf(4)).toContain('`{out}` with `"<import>/kb-export.<run id>.json"`');
  });

  test("the lock is best effort: a fresh lock is busy, a stale one is removed and taken once more, a lost race is harmless", () => {
    expect(intro).toContain(`- Busy: ${BUSY}`);
    expect(intro).toContain(`- Not allowed: \`index: unavailable — the reload lock command <command> was not allowed: denied; ${HINT}; the previous index is kept\``);
    const take = stepOf(2);
    expect(take).toContain('`mkdir "<import>/reload.lock"`');
    expect(take).toContain("lock age check");
    expect(take).toContain('`rmdir "<import>/reload.lock"`');
    expect(take).toMatch(/take once more/i);
    expect(take).toMatch(/only once/i);
    expect(take).toMatch(/Fresh: Busy/);
    expect(take).toContain("cannot be cleared");
    expect(take).toContain("could not be created");
    expect(take).toContain("could not be checked");
    expect(section(runtime, "## Reload lock")).toMatch(/both reload[^\n]*safe|safe[^\n]*both reload/i);
  });

  test("after the take every outcome goes through step 6.8, never straight to step 7", () => {
    expect(stepOf(2)).toMatch(/From here on, every outcome[^\n]*step 6\.8/);
    for (const n of [3, 4, 5, 6, 7]) expect(stepOf(n), `step 6.${n}`).not.toContain("go to step 7");
    for (const n of [3, 4, 6]) {
      for (const d of [...stepOf(n).matchAll(/[^.:]*\bis denied\b[^\n]*/g)].map((m) => m[0])) expect(d).toMatch(/step 6\.8|continue/);
    }
    expect(runtime).toContain("step 6.8");
  });

  test("step 6.3 re-runs status after the take and ends current when another run loaded the commit", () => {
    expect(stepOf(3)).toContain("`index: current`");
    expect(stepOf(3)).toContain("go to step 6.8");
  });

  test("the chmod is the exact ? pattern, and its denial or failure lets the load decide", () => {
    const s = stepOf(5);
    expect(s).toContain("```\n   " + CHMOD + "\n   ```");
    expect(s).toMatch(/denies it or it fails: continue with the load/i);
  });

  test("the load reads the run's own file; a refused load re-runs status and is current when exactly the commit is loaded", () => {
    const s = stepOf(6);
    expect(s).toContain("`file` = `kb-export.<run id>.json`");
    expect(s).toContain("Cannot open file");
    expect(s).toMatch(/run the query `status` again/i);
    expect(s).toMatch(/exactly one row[^\n]*`<commit>`[^\n]*`index: current`/i);
    expect(s).toContain("`index: unavailable — the load was refused: <reason>; the previous index is kept`");
  });

  test("clean up removes only the run's own file, then releases the lock, whatever their outcomes", () => {
    const s = stepOf(8);
    expect(s).toContain("`" + RM + "`");
    expect(s.indexOf('`rmdir "<import>/reload.lock"`')).toBeGreaterThan(s.indexOf(RM));
    expect(s).toMatch(/whatever/i);
  });

  test("setup allows the lock exactly and nothing wider for the reload", () => {
    for (const r of [
      `Bash(${CHMOD})`,
      'Bash(mktemp -u "<import>/kb-export.XXXXXXXXXXXX")',
      'Bash(mkdir "<import>/reload.lock")',
      'Bash(rmdir "<import>/reload.lock")',
      "Edit(~/.kb/<kb>/import/reload.lock)",
    ]) expect(ruleBlock).toContain(r);
    for (const line of ruleBlock.split("\n").filter((l) => /kb-export|reload\.lock|mktemp/.test(l))) expect(line).not.toContain("*");
    expect(ruleBlock).not.toMatch(/Bash\((rm|mv|find) /);
  });

  test("setup grants its load session only the export, and the run's file removal prompts", () => {
    const grant = setup.slice(setup.indexOf("1. **Load.**"), setup.indexOf("2. **Full-text index"));
    expect(grant).toContain("'Bash(<export command>)'");
    expect(grant).not.toMatch(/'Bash\((mv|rm) /);
    expect(grant).toContain('`{out}` by `"<import>/kb-export.*.json"`');
  });

  test("setup removes only leftover exports older than the stale limit", () => {
    expect(setup).toContain('find "<import>" -maxdepth 1 -name "kb-export.*.json" -mmin +30 -delete');
    expect(setup).toContain('find "<import>" -maxdepth 1 -name "*.json.tmp" -mmin +30 -delete');
    expect(setup).not.toContain('`ls "<import>/reload.lock"`');
  });

  test("README lists the reload's rules, what prompts, the leftovers and the rules an earlier setup left", () => {
    expect(readme).toContain(CHMOD);
    expect(readme).toContain(RM);
    expect(readme).not.toContain("reload.lock/*");
    expect(readme).toMatch(/blockReadsOutsideWorkingDirectories/);
    expect(readme).toContain('Bash(mv "<import>/kb-export.json.tmp" "<import>/kb-export.json")');
  });

  test("the contract names the per-run export file and the lock in the local layout and in Freshness", () => {
    const layout = section(contract, "## Local layout");
    expect(layout).toContain("`~/.kb/<kb id>/import/kb-export.<run id>.json`");
    expect(layout).toContain("`~/.kb/<kb id>/import/reload.lock`");
    const freshness = section(contract, "## Freshness");
    expect(freshness).toContain("more than 30 minutes");
    expect(freshness).toContain(HINT);
    expect(freshness).toMatch(/own export file/);
  });

  test("a denied age check names the remedy that works, not setup-operator alone", () => {
    const lock = section(runtime, "## Reload lock");
    expect(lock).toContain("permissions.blockReadsOutsideWorkingDirectories");
    expect(lock).toContain("/add-dir");
  });
});
