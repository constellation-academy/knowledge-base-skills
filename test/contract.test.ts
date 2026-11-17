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
  const stepOf = (n: number) => {
    const from = reload.indexOf(`\n${n}. `, reload.indexOf(firstStep));
    const next = reload.indexOf(`\n${n + 1}. `, from + 1);
    return reload.slice(from, next < 0 ? undefined : next);
  };
  const rules = setup.slice(setup.indexOf("### Allow rules"), setup.indexOf("\n## 5.", setup.indexOf("### Allow rules")));
  const ruleBlock = rules.slice(rules.indexOf("```\n") + 4, rules.indexOf("```", rules.indexOf("```\n") + 4));
  const CHMOD = 'chmod 644 "<import>"/kb-export.????????????.json';
  const RM = 'rm "<import>/kb-export.<run id>.json"';
  const TIMEOUT = "`index: unavailable — the export did not finish within 10 minutes; the previous index is kept`";
  const SETUP_HINT = "run knowledge-base:setup-operator";
  const LOCK = /reload\.lock|reload lock|\bBusy\b|\block(s|ed)?\b/i;

  test("load.cypher loads the file named by the parameter $file, never a fixed export file", () => {
    expect(loadCypher).toContain("CALL apoc.load.json($file) YIELD value");
    expect(loadCypher).not.toContain("kb-export.json");
    expect(section(runtime, "## Run a query")).toMatch(/\| `load` \| `kb`, `file` \|/);
  });

  test("no skill, runtime, contract or README names a reload lock", () => {
    for (const [name, t] of [["update-operator", updater], ["runtime.md", runtime], ["contract", contract], ["README", readme]] as const) expect(t, name).not.toMatch(LOCK);
    expect(ruleBlock).not.toMatch(LOCK);
    expect(setup).not.toMatch(/once to allow the reload lock|age check/);
  });

  test("no skill, runtime or contract names a temp file or a move", () => {
    for (const t of [updater, runtime, contract]) {
      expect(t).not.toContain(".json.tmp");
      expect(t).not.toMatch(/`mv /i);
    }
  });

  test("step 6 lists its steps in order: run id, status, export, chmod, load, sha, clean up", () => {
    const heads = ["\n1. Draw the run id.", "\n2. Run the query `status` again", "\n3. Build the export command", "\n4. Only after the export exited 0", "\n5. Run the query `load`", "\n6. The load's row's `sha`", "\n7. Clean up."];
    let at = -1;
    for (const h of heads) {
      const i = reload.indexOf(h);
      expect(i, h).toBeGreaterThan(at);
      at = i;
    }
    expect(reload).not.toContain("\n8. ");
  });

  test("two runs at once may both export and load, and that is safe", () => {
    const r = section(runtime, "## Reload");
    expect(r).toMatch(/both export and load/);
    expect(r).toMatch(/one transaction/);
    expect(r).toMatch(/serialise/);
    expect(r).toMatch(/uniqueness constraint/);
    expect(section(contract, "## Freshness")).toMatch(/both export and load/);
  });

  test("the run id comes from its command and names the run's own export file", () => {
    expect(stepOf(1)).toContain('section "Reload"');
    expect(stepOf(1)).toMatch(/never choose/i);
    expect(stepOf(1)).toContain("`<import>/kb-export.<run id>.json`");
    expect(stepOf(3)).toContain('`{out}` with `"<import>/kb-export.<run id>.json"`');
  });

  test("status is checked right before the export and ends current when the commit is loaded", () => {
    expect(stepOf(2)).toMatch(/right before the export/);
    expect(stepOf(2)).toMatch(/`sha` equals `<commit>`: `index: current`/);
  });

  test("a timed-out export is named, keeps its file for setup's sweep, and skips the clean up", () => {
    const s = stepOf(3);
    const t = s.slice(s.indexOf("It times out"));
    const line = t.slice(0, t.indexOf("\n   - "));
    expect(line).toContain(TIMEOUT);
    expect(line).toMatch(/background/);
    expect(line).toMatch(/never remove/i);
    expect(line).toMatch(/sweep/);
    expect(line).toContain("go to step 7");
    expect(line).not.toContain("step 6.7");
  });

  test("after the export exited, every outcome goes through step 6.7", () => {
    expect(stepOf(3)).toMatch(/From here on, every outcome[^\n]*step 6\.7/);
    for (const n of [4, 5, 6]) expect(stepOf(n), `step 6.${n}`).not.toContain("go to step 7");
    expect(runtime).toContain("step 6.7");
    expect(runtime).not.toContain("step 6.8");
  });

  test("the chmod is the exact ? pattern; denied or failed, the load decides", () => {
    const s = stepOf(4);
    expect(s).toContain("```\n   " + CHMOD + "\n   ```");
    expect(s).toMatch(/continue with the load/i);
  });

  test("a load that cannot open the export names a denied chmod with the setup hint, a failed one with its error and no hint", () => {
    const s = stepOf(5);
    expect(s).toContain("`file` = `kb-export.<run id>.json`");
    const denied = s.match(/`index: unavailable — the export is not readable for Neo4j and its chmod was not allowed: denied;[^`]*`/);
    const failed = s.match(/`index: unavailable — the export is not readable for Neo4j and its chmod failed: <first error line of the chmod>;[^`]*`/);
    expect(denied?.[0]).toContain(SETUP_HINT);
    expect(failed?.[0]).toBeDefined();
    expect(failed![0]).not.toContain(SETUP_HINT);
    expect(setup).toContain(`Bash(${CHMOD})`);
  });

  test("a refused load re-runs status and is current when exactly the commit is loaded", () => {
    const s = stepOf(5);
    expect(s).toMatch(/run the query `status` again/i);
    expect(s).toMatch(/exactly one row[^\n]*`<commit>`[^\n]*`index: current`/i);
    expect(s).toContain("`index: unavailable — the load was refused: <reason>; the previous index is kept`");
  });

  test("clean up removes only the run's own file, attempted, not guaranteed", () => {
    const s = stepOf(7);
    expect(s).toContain("`" + RM + "`");
    expect(s).toMatch(/attempted, not guaranteed/);
    expect(s).toMatch(/sweep/);
  });

  test("setup allows the run id and chmod exactly, nothing wider, and removes the lock rules", () => {
    for (const r of [`Bash(${CHMOD})`, 'Bash(mktemp -u "<import>/kb-export.XXXXXXXXXXXX")']) expect(ruleBlock).toContain(r);
    for (const line of ruleBlock.split("\n").filter((l) => /kb-export|mktemp/.test(l))) expect(line).not.toContain("*");
    expect(ruleBlock).not.toMatch(/Bash\((rm|mv|find|mkdir|rmdir) /);
    const merge = setup.slice(setup.indexOf("\n2. Merge (section"), setup.indexOf("\n3. Merge a second fragment"));
    expect(merge).toContain("`remove.allow`");
    for (const r of [
      'Bash(mkdir "<import>/reload.lock")',
      'Bash(rmdir "<import>/reload.lock")',
      'PowerShell(mkdir "<import>/reload.lock")',
      'PowerShell(rmdir "<import>/reload.lock")',
      'PowerShell((Get-Item "<import>/reload.lock").LastWriteTime.AddMinutes(30) -lt (Get-Date))',
      "Edit(~/.kb/<kb>/import/reload.lock)",
    ]) expect(setup).toContain(r);
  });

  test("setup removes the 1.2.4 rules no 1.2.5 command uses, in their Bash and PowerShell forms", () => {
    const legacy = ['chmod 644 "<import>/kb-export.json.tmp"', 'rm "<import>/kb-export.json"', 'mv "<import>/kb-export.json.tmp" "<import>/kb-export.json"'];
    const list = setup.slice(setup.indexOf("- Earlier setups added rules"), setup.indexOf("- Accepted risk, the query wildcard"));
    for (const c of legacy) {
      expect(list).toContain(`Bash(${c})`);
      expect(list).toContain(`PowerShell(${c})`);
      expect(ruleBlock).not.toContain(c);
    }
    expect(setup).not.toMatch(/does not remove them|cannot remove them/);
    expect(readme).not.toMatch(/does not remove them|cannot remove them/);
    expect(readme).toMatch(/the setup removes them/);
  });

  test("setup removes every reload lock and export rule an earlier commit of this version wrote, Windows copies included", () => {
    const list = setup.slice(setup.indexOf("- Earlier setups added rules"), setup.indexOf("- Accepted risk, the query wildcard"));
    for (const r of [
      'Bash(mkdir "<import>/reload.lock/*")',
      'Bash(rmdir "<import>/reload.lock/*")',
      'Bash(find "<import>/reload.lock" -maxdepth 0 -mmin +10)',
      'Bash(find "<import>/reload.lock" -maxdepth 0 -mmin +30)',
      'Bash(find "<import>/reload.lock/*" -maxdepth 0 -mmin +30)',
      "Bash(mktemp -u XXXXXXXXXXXX)",
      'Bash(chmod 644 "<import>/kb-export.json")',
      'Bash(chmod 644 "<import>/kb-export.*.json.tmp")',
      'Bash(mv "<import>/kb-export.*.json.tmp" "<import>/kb-export.json")',
      'PowerShell(mkdir "<import>/reload.lock/*")',
      'PowerShell(rmdir "<import>/reload.lock/*")',
      'PowerShell(chmod 644 "<import>/kb-export.json")',
      'PowerShell(chmod 644 "<import>/kb-export.*.json.tmp")',
      'PowerShell(mv "<import>/kb-export.*.json.tmp" "<import>/kb-export.json")',
      'PowerShell((Get-Item "<import>/reload.lock").LastWriteTime.AddMinutes(10) -lt (Get-Date))',
      'PowerShell((Get-Item "<import>/reload.lock/*").LastWriteTime.AddMinutes(30) -lt (Get-Date))',
    ]) expect(list).toContain(r);
    const block = list.slice(list.indexOf("```\n") + 4, list.indexOf("```", list.indexOf("```\n") + 4));
    for (const line of block.split("\n").filter(Boolean)) expect(ruleBlock, line).not.toContain(line);
    expect(block).not.toContain("[guid]");
  });

  test("the sweep is named as macOS and Linux only, with the Windows case, wherever a leftover is said to be cleared", () => {
    const windows = /on Windows[^.]*by hand/;
    const layout = section(contract, "## Local layout");
    const row = layout.slice(layout.indexOf("| Export files |"), layout.indexOf("\n", layout.indexOf("| Export files |")));
    expect(row).toMatch(/on macOS and Linux/);
    expect(row).toMatch(windows);
    const timeout = stepOf(3).slice(stepOf(3).indexOf("It times out"));
    for (const t of [timeout.slice(0, timeout.indexOf("\n")), stepOf(7)]) {
      expect(t).toMatch(/on macOS and Linux/);
      expect(t).toMatch(windows);
    }
    expect(updater).toContain("| Removing the export file after the export timed out | Leave it: a background export may still write it; on macOS and Linux setup-operator's sweep clears it, on Windows the developer removes it by hand |");
    const grant = setup.slice(setup.indexOf("1. **Load.**"), setup.indexOf("2. **Full-text index"));
    expect(grant).toContain("on macOS and Linux the next setup-operator run removes it once it is older than 30 minutes, on Windows the developer removes it by hand");
    expect(rules).toContain("on macOS and Linux step 7.1 removes such files once they are older than 30 minutes, on Windows the developer removes them by hand");
  });

  test("setup grants its load session only the export, and the run's file removal prompts", () => {
    const grant = setup.slice(setup.indexOf("1. **Load.**"), setup.indexOf("2. **Full-text index"));
    expect(grant).toContain("'Bash(<export command>)'");
    expect(grant).not.toMatch(/'Bash\((mv|rm) /);
    expect(grant).toContain('`{out}` by `"<import>/kb-export.*.json"`');
    expect(grant).toContain("update-operator's step 6.3");
  });

  test("setup's sweep removes only leftovers older than 30 minutes, the 1.2.4 shared export included, and prompts", () => {
    const grant = setup.slice(setup.indexOf("1. **Load.**"), setup.indexOf("2. **Full-text index"));
    for (const c of [
      'find "<import>" -maxdepth 1 -name "kb-export.*.json" -mmin +30 -delete',
      'find "<import>" -maxdepth 1 -name "*.json.tmp" -mmin +30 -delete',
      'find "<import>" -maxdepth 1 -name "kb-export.json" -mmin +30 -delete',
    ]) expect(grant).toContain(c);
    expect(grant).toMatch(/Each command prompts/);
  });

  test("README lists the reload's rules, what prompts, the sweep and the rules an earlier setup left", () => {
    expect(readme).toContain(CHMOD);
    expect(readme).toContain(RM);
    expect(readme).toContain('Bash(mv "<import>/kb-export.json.tmp" "<import>/kb-export.json")');
    expect(readme).toMatch(/kb-export\.json/);
  });

  test("the contract names the per-run export file, attempted clean up and setup's sweep", () => {
    const layout = section(contract, "## Local layout");
    expect(layout).toContain("`~/.kb/<kb id>/import/kb-export.<run id>.json`");
    expect(layout).toMatch(/attempted, not guaranteed/);
    expect(layout).toMatch(/sweep/);
    expect(section(contract, "## Freshness")).toMatch(/own export file/);
  });
});
