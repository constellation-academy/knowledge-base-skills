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
  const readme = readFileSync(join(PLUGIN, "../../README.md"), "utf8");
  const start = updater.indexOf("\n3. Only after the export exited 0");
  const step = updater.slice(start, updater.indexOf("\n4. ", start));
  const load = updater.slice(updater.indexOf("\n4. ", start), updater.indexOf("\n5. The row's `sha`"));
  const blocks = (s: string) => [...s.matchAll(/```\n([\s\S]*?)```/g)].flatMap((m) => m[1].trim().split(/;\s*/));
  const CHMOD = 'chmod 644 "<import>/kb-export.json"';
  const MV = 'mv "<import>/kb-export.<run id>.json.tmp" "<import>/kb-export.json"';

  test("moves the run's own export into place, then makes the export file readable before the load", () => {
    expect(blocks(step)).toEqual(['rm "<import>/kb-export.json"', MV]);
    expect(blocks(load)).toEqual([CHMOD]);
    const own = load.indexOf("ownership check");
    expect(own).toBeGreaterThan(-1);
    expect(load.indexOf(CHMOD)).toBeGreaterThan(own);
    expect(load.indexOf("run the query `load`")).toBeGreaterThan(load.indexOf(CHMOD));
  });

  test("a denied or failed chmod is not fatal: the load decides", () => {
    const outcome = load.slice(load.indexOf(CHMOD), load.indexOf("run the query `load`"));
    expect(outcome).toMatch(/denies it or it fails: continue with the load/i);
    expect(outcome).not.toMatch(/It fails: `index: unavailable/);
  });

  test("a load that cannot open the export after a skipped chmod names the cause and the one-time setup migration", () => {
    expect(load).toContain("Cannot open file");
    expect(load).toContain("run knowledge-base:setup-operator once");
  });

  test("setup-operator allows the chmod exactly and has no wildcard chmod, mv or find rule", () => {
    const from = setup.indexOf("### Allow rules");
    const rules = setup.slice(from, setup.indexOf("\n## 5.", from));
    expect(rules).toContain(`Bash(${CHMOD})`);
    expect(rules).toContain('Bash(rm "<import>/kb-export.json")');
    expect(rules).not.toMatch(/Bash\(chmod [^)]*\*/);
    expect(rules).not.toContain("Bash(mv ");
    expect(rules).not.toContain("Bash(find ");
  });

  test("the move and the temp removal are granted only to setup's one load session, next to the export", () => {
    const grant = setup.slice(setup.indexOf("1. **Load.**"), setup.indexOf("2. **Full-text index"));
    expect(grant).toContain("'Bash(mv \"<import>/kb-export.*.json.tmp\" \"<import>/kb-export.json\")'");
    expect(grant).toContain("'Bash(rm \"<import>/kb-export.*.json.tmp\")'");
    expect(grant).toContain("'Bash(<export command>)'");
  });

  test("README's accepted risk lists exactly the rules wider than literal that remain", () => {
    const risk = readme.slice(readme.indexOf("Accepted risk"), readme.indexOf("\n## Local Neo4j"));
    expect(risk).toContain('mkdir "<import>/reload.lock/*"');
    expect(risk).toContain('rmdir "<import>/reload.lock/*"');
    expect(risk).toContain("cypher-shell");
    for (const gone of ["chmod", "find", "Bash(mv"]) expect(risk).not.toContain(gone);
  });

  test("leftover temp exports are cleared by setup-operator only while no reload lock exists", () => {
    expect(setup).toContain('"<import>/kb-export.<id>.json.tmp"');
    expect(setup).toContain('only when `ls "<import>/reload.lock"` says the path does not exist');
    expect(readme).toMatch(/leftover temp export/i);
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

  test("every command of steps 6.1 to 6.4 names its denial and routes it through step 6.6", () => {
    expect(beforeFirst).toContain('a denial or a failure the step does not name, after the take, goes through step 6.6 before "Denied or failed commands" applies');
    for (const n of [1, 2, 3, 4, 5]) expect(stepOf(n)).not.toContain("go to step 7");
    for (const n of [1, 2, 3, 4]) {
      const s = stepOf(n);
      const denials = [...s.matchAll(/[^.:]*\bis denied\b[^\n]*/g)].map((m) => m[0]);
      expect(denials.length).toBeGreaterThan(0);
      for (const d of denials) expect(d).toMatch(/step 6\.6|continue with the load/);
    }
    expect(stepOf(2)).toContain("`index: unavailable — the export was not allowed: denied; the previous index is kept`");
    expect(stepOf(2)).toContain("times out");
    expect(stepOf(3)).toContain("`index: unavailable — the export could not be moved into place: denied; the previous index is kept`");
    expect(stepOf(3)).toMatch(/listing of `<import>` is denied/);
    expect(stepOf(4)).toContain("ownership check");
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
    expect(beforeFirst).toContain(`${HINT}; the previous index is kept`);
  });

  test("a denied lock command never reloads, and no run reloads without the lock", () => {
    expect(beforeFirst).not.toContain("without the lock: skip");
    expect(beforeFirst).not.toContain("1.2.4");
    expect(beforeFirst).not.toContain(`the previous index is kept; ${HINT}`);
    expect(beforeFirst).toContain("- Not allowed: `index: unavailable — the reload lock command <command> was not allowed: denied; " + HINT + "; the previous index is kept`");
    expect(updater).toContain("only after one setup-operator run");
    expect(section(contract, "## Freshness")).toContain("only after one setup-operator run");
    expect(readFileSync(join(PLUGIN, "../../README.md"), "utf8")).toContain("only after one setup-operator run");
  });

  test("the ownership check also ages this run's own owner folder; stale means taken over", () => {
    const own = beforeFirst.slice(beforeFirst.indexOf("**The ownership check**"));
    expect(own).toContain("owner age check of `<run id>`");
    expect(own).toMatch(/Stale[^\n]*the reload lock was taken over/);
  });

  test("a lost race at the lock's removal lists once more instead of reporting it uncleared", () => {
    const remove = beforeFirst.slice(beforeFirst.indexOf("**Remove the lock.**"), beforeFirst.indexOf("**Take once more.**"));
    expect(remove).toMatch(/not empty/);
    expect(remove).toContain("list it once more");
    expect(remove).toMatch(/names? [^\n]*Busy/);
    expect(remove).toMatch(/no name[^\n]*Uncleared/);
  });

  test("a run sent away by the check after the take also tries to remove the lock, so it leaves no fresh ownerless lock", () => {
    const check = beforeFirst.slice(beforeFirst.indexOf("**Check the take.**"), beforeFirst.indexOf("**Inspect the lock.**"));
    const own = check.indexOf('`rmdir "<import>/reload.lock/<run id>"`');
    expect(own).toBeGreaterThan(-1);
    expect(check.indexOf('`rmdir "<import>/reload.lock"`')).toBeGreaterThan(own);
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
    expect(freshness).toContain(HINT);
    expect(freshness).not.toContain("without the lock only when no lock exists");
    expect(freshness).not.toMatch(/Only one run per KB reloads at a time:/);
  });
});
