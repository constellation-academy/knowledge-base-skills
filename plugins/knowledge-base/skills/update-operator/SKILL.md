---
name: update-operator
description: Use when a knowledge-base plugin skill is about to read or write the project's knowledge base (KB) and needs the read-only KB clone fast-forwarded and its local Neo4j index current. Operator: updates the clone and reloads the index; called by knowledge-base:content-provider and knowledge-base:article-writer before their work.
---

# Update the KB clone and index

Brings the read-only clone to `origin/<default>` and the local Neo4j index to the clone's commit, then reports the state. It never fails its caller: anything that blocks the index ends as `index: unavailable` with a reason, and the caller reads the clone's files instead. It never edits a file in the clone.

Mechanics shared with the other skills (locating the KB, shell rules, running a query, reading its output) are in `runtime.md` next to this file. Follow them exactly. When a command is denied or fails, follow "Denied or failed commands" there.

## Steps

### 1. Locate the KB

Follow "Locate the KB" in `runtime.md`. If it stops, return its message as the report and stop.

### 2. Fast-forward the clone

1. `git -C "<clone>" rev-parse HEAD` is `<commit>` for now.
2. `git -C "<clone>" symbolic-ref --short HEAD` must print `<default>`. It prints another branch, or fails because HEAD is detached: `index: unavailable — the read-only clone is not on <default> (<branch, or "detached HEAD">), so its files may not match origin/<default>; run knowledge-base:setup-operator`, and go to step 7.
3. `git -C "<clone>" fetch --quiet origin`. If it fails, the machine is offline or the remote unreachable: continue on the clone's current commit, and get its age with `git -C "<clone>" log -1 --format=%cr HEAD` for the report.
4. `git -C "<clone>" merge --ff-only --quiet origin/<default>`. If it fails: `index: unavailable — the read-only clone cannot fast-forward to origin/<default>, so its files may not match it: <first error line>; run knowledge-base:setup-operator`, and go to step 7.
5. `git -C "<clone>" rev-parse HEAD` is `<commit>`.

### 3. Check the configuration

Read `NEO4J_SHELL` and `NEO4J_DATABASE`. Either unset: `index: unavailable — no KB index is configured; run knowledge-base:setup-operator`, and go to step 7.

### 4. Refresh the query files

The plugin's query files are in the `cypher` folder at the plugin root, two folders above this skill's directory (the base directory shown when the skill loads). `<plugin cypher>` is that folder's absolute path.

Compare with the file tools only; no shell command reads or compares these files. Only the listing runs in the shell.

1. List the `.cypher` files of `<plugin cypher>` (`ls`, section "Shell rules" in `runtime.md`). For each `<name>.cypher`, read it and `<queries>/<name>.cypher` (Read tool). Every copy exists and its text equals the plugin file's text: the copies are current, go to step 5.
2. Otherwise write each missing or different copy to `<queries>/<name>.cypher` with the file tools, exactly the plugin file's text. Never edit a query file any other way.
3. Verify each written copy: read it back and compare its text with the plugin file's. Any difference: `index: unavailable — the query file <name>.cypher could not be copied to <queries>`, and go to step 7 without running a query.

### 5. Compare the index

1. Run the query `status` with `kb`. It fails: `index: unavailable — <reason>` (when the error says the container is not running, the Docker daemon cannot be reached, or the connection is refused, add "Neo4j is not reachable; run knowledge-base:start-operator"; for `No such container` add "run knowledge-base:setup-operator"), and go to step 7.
2. Exactly one row, and its `sha` equals `<commit>`: `index: current`, `docs` from the row; go to step 7.
3. More than one row, a row with `empty: true`, or another `sha`: go to step 6.

### 6. Reload the index

Only one run at a time reloads the index: take the reload lock first, with the commands of section "Reload lock" in `runtime.md`, which also says how to recognise each of their errors. Run each lock command on its own and only after the one before it, never two in one line. Outcomes that recur below:

- Busy: `index: unavailable — another run is reloading the index; the previous index is kept`, and go to step 7. Never wait for the lock, never remove a fresh one, and release nothing.
- Uncleared: `index: unavailable — the reload lock <import>/reload.lock cannot be cleared: <first error line, or "denied">; if no run is reloading, remove that folder by hand; the previous index is kept`, and go to step 7.
- Unchecked: `index: unavailable — the reload lock <import>/reload.lock could not be checked: <first error line, or "denied">; the previous index is kept`, and go to step 7.

**Run id.** Before the first lock command, run the run id command of `runtime.md` for this shell. Its output is `<run id>` for every lock command and the temp file of this run; never choose, change or reuse an id yourself. The command is denied: `index: unavailable — the reload lock's run id could not be drawn: denied; run knowledge-base:setup-operator once to allow the reload lock; the previous index is kept`, and go to step 7. It fails: the same with its first error line in place of `denied` and without the setup-operator part.

**Take.** Run `mkdir "<import>/reload.lock"`.

- It succeeds: run `mkdir "<import>/reload.lock/<run id>"`.
  - It succeeds: check the take, below.
  - It is denied: run `rmdir "<import>/reload.lock"`, whatever its outcome, then continue with "Not allowed", below.
  - It fails: run `rmdir "<import>/reload.lock"`, whatever its outcome; then Busy.
- It fails with the error that the folder exists: inspect the lock, below.
- It is denied: continue with "Not allowed", below.
- It fails otherwise: `index: unavailable — the reload lock could not be created: <first error line>; the previous index is kept`, and go to step 7.

**Check the take.** List the lock, `ls "<import>/reload.lock"`. It lists exactly `<run id>` and no other name: this run holds the lock; go to step 6.1. Anything else (another name besides it, no name, or an error): run `rmdir "<import>/reload.lock/<run id>"`, whatever its outcome, and touch nothing else; then Busy.

**Inspect the lock.** List it, `ls "<import>/reload.lock"`.

- It fails with an error that says the path does not exist: the lock is gone; take once more.
- It is denied or fails otherwise: Unchecked.
- It prints one name, `<old>`: run the owner age check of `<old>`.
  - Fresh: Busy.
  - The error says the path does not exist: the owner folder is gone; take once more.
  - Stale: run `rmdir "<import>/reload.lock/<old>"`. It succeeds: remove the lock, below. It fails with an error that says the folder does not exist: another run broke the lock first; Busy. It is denied or fails otherwise: Uncleared.
  - It is denied or fails otherwise: Unchecked.
- It prints no name, or more than one name: run the lock age check, of `<import>/reload.lock` itself.
  - Fresh: Busy.
  - The error says the path does not exist: the lock is gone; take once more.
  - Stale: for each listed name `<name>`, one after the other, run `rmdir "<import>/reload.lock/<name>"`; an error that says the folder does not exist means another run removed it first, so go on with the next name; a denial or another error: Uncleared. Then remove the lock, below.
  - It is denied or fails otherwise: Unchecked.

**Remove the lock.** Run `rmdir "<import>/reload.lock"`. It succeeds: take once more. It fails with an error that says the folder does not exist: another run broke the lock first; Busy. It is denied or fails otherwise, `Directory not empty` included: Uncleared.

**Take once more.** Only once per run: when `<run id>` equals an `<old>` or `<name>` this run listed, first draw a new `<run id>` as above. Then run `mkdir "<import>/reload.lock"`. It fails or is denied: Busy; never inspect or break a second time. It succeeds: continue as the take does after its first `mkdir` succeeded.

**Not allowed.** The permission system denies a lock command when the project was set up before its rule existed (knowledge-base 1.2.4 or older) and setup-operator has not run since. List the lock, `ls "<import>/reload.lock"` (`ls` needs no rule).

- It fails with an error that says the path does not exist: no run holds the lock. Continue with step 6.1 without the lock: skip the ownership checks, and step 6.6 releases nothing. When the run ends with `index: unavailable`, its reason ends with `; run knowledge-base:setup-operator once to allow the reload lock`. A `loaded` or `current` report has no place for it.
- It succeeds, with or without names: `index: unavailable — another run is reloading the index; the previous index is kept; run knowledge-base:setup-operator once to allow the reload lock`, and go to step 7.
- It is denied or fails otherwise: `index: unavailable — the reload lock <import>/reload.lock could not be checked: <first error line, or "denied">; the previous index is kept; run knowledge-base:setup-operator once to allow the reload lock`, and go to step 7.

**The ownership check**, run only when this run holds the lock, immediately before the export of step 6.2, the move of step 6.3 and the load of step 6.4: list the lock, `ls "<import>/reload.lock"`.

- It lists exactly `<run id>` and no other name: this run still holds the lock; continue.
- Anything else, or an error that says the path does not exist: another run broke this run's lock as stale. `index: unavailable — the reload lock was taken over; the previous index is kept`, go to step 6.6. Never touch `kb-export.json` after that.
- It is denied or fails otherwise: `index: unavailable — the reload lock <import>/reload.lock could not be checked: <first error line, or "denied">; the previous index is kept`, go to step 6.6.

1. Run the query `status` again with `kb`: another run may have loaded the index while this one took the lock. Exactly one row, and its `sha` equals `<commit>`: `index: current`, `docs` from the row, go to step 6.6. It fails: `index: unavailable — <reason>`, go to step 6.6. Otherwise run the query `fulltext` with `analyzer` = the manifest's `fulltext_analyzer`, or `standard-no-stop-words` when the manifest has none. It fails: `index: unavailable — <reason>`, go to step 6.6.
2. When this run holds the lock, run the ownership check. Build the export command from the manifest's `export.cmd`: replace `{ref}` with `"<commit>"` and `{out}` with `"<import>/kb-export.<run id>.json.tmp"`, each in double quotes. Run it in the clone root as `cd "<clone>"; <export command>`, allowing up to 10 minutes. It exits non-zero: `index: unavailable — the export failed: <first error line>; the previous index is kept`, go to step 6.6. The load never reads a file an export is still writing: each run exports to its own temp file, and only a finished export becomes `kb-export.json`.
3. Only after the export exited 0, check with the file tools that `<import>/kb-export.<run id>.json.tmp` exists. It does not: `index: unavailable — the export wrote no file; the previous index is kept`, go to step 6.6. Otherwise, on macOS and Linux, first make it readable for Neo4j: the export honours the session's umask and may have written it for its owner only, and the container's `neo4j` user is neither the file's owner nor in its group:

   ```
   chmod 644 "<import>/kb-export.<run id>.json.tmp"
   ```

   The permission system denies it or it fails: continue with the move, and remember that the `chmod` was skipped. This is that command's outcome, not a workaround: a project set up before the rule existed does not allow it until setup-operator runs again, and the export may already be readable under the session's umask; step 4 tells. On Windows skip it: Windows has no mode bits, and Docker Desktop shares the folder with the container user. Then, when this run holds the lock, run the ownership check. Then replace the export file with it, in one line that runs unchanged in bash, zsh and PowerShell:

   ```
   rm "<import>/kb-export.json"; mv "<import>/kb-export.<run id>.json.tmp" "<import>/kb-export.json"
   ```

   The `rm` reports an error when no previous export exists; ignore it. Then list `<import>` (`ls`, section "Shell rules" in `runtime.md`). The listing also shows other entries, such as `queries` and `reload.lock`; only these two names count:
   - `kb-export.<run id>.json.tmp` is listed: `index: unavailable — the export could not be moved into place; the previous index is kept`, go to step 6.6.
   - Neither `kb-export.<run id>.json.tmp` nor `kb-export.json` is listed: the file was removed between the check above and the `mv`, which reports that it does not exist. `index: unavailable — the export file disappeared before the move; the previous index is kept`, go to step 6.6.
   - `kb-export.json` is listed and `kb-export.<run id>.json.tmp` is not: the move succeeded; go to step 6.4.
4. When this run holds the lock, run the ownership check. Then run the query `load` with `kb`. It fails: `index: unavailable — the load was refused: <reason>; the previous index is kept`, go to step 6.6. When step 3 skipped the `chmod` and the reason contains `Cannot open file`, the reason is instead `the export is not readable for Neo4j and chmod was not allowed; run knowledge-base:setup-operator once to add its permission`.
5. The row's `sha` must equal `<commit>`; otherwise `index: unavailable — the export stamped <sha>, not <commit>`. When it matches: `index: loaded`, `docs` from the row.
6. Clean up and release the lock, on every outcome of steps 6.1 to 6.5. First, when step 6.2 ran the export and step 6.3 did not move its file into place, remove this run's temp file, `rm "<import>/kb-export.<run id>.json.tmp"`; whatever its outcome, the report stays as it is (setup-operator does not pre-allow it, so it may prompt). Then, when this run holds the lock, also after the ownership check found it taken over, run `rmdir "<import>/reload.lock/<run id>"`:
   - It fails with an error that says the folder does not exist: another run took the lock over; touch nothing else. The report stays as it is.
   - It succeeds: run `rmdir "<import>/reload.lock"`. It fails or is denied: the report stays as it is; the lock stays without an owner folder, goes stale after 30 minutes, and a later run breaks it.
   - It is denied or fails otherwise: the report stays as it is; the owner folder goes stale after 30 minutes and a later run breaks the lock.

   Then go to step 7.

### 7. Report

Return exactly this block to the caller. The block is fixed by the contract's section "Freshness" (`../../contracts/knowledge-base.v1.md`): callers parse it, so its lines and their wording never change:

```
kb: <kb>
commit: <commit>[, offline: last fetched commit is <age> old]
index: current | loaded | unavailable — <reason>
docs: <docs, or "-" when the index is unavailable>
```

## Common mistakes

| Mistake | Instead |
|---|---|
| Running `git pull`, `checkout` or `reset` in the clone, or editing a file there | Only `fetch` and `merge --ff-only`; the clone is read-only |
| Writing `$NEO4J_SHELL` or `$env:NEO4J_SHELL` into a command | Read the value first, then write it out literally |
| Reading or printing `NEO4J_PASSWORD` | Never; `NEO4J_SHELL` passes the credentials on by name |
| Writing a parameter as `-P 'kb => "<kb>"'` | `-P "kb => '<kb>'"` with the escapes of `runtime.md`; Windows PowerShell 5.1 drops a `"` inside an argument, and the query then fails |
| Loading when `status` already reports `<commit>` | Load only on a different `sha` or an empty store |
| Running the export against the working tree or a branch name | `{ref}` is the full commit SHA `<commit>` |
| Loading an export the session's umask left unreadable to others (`Cannot open file /import/kb-export.json for reading`) | On macOS and Linux, `chmod 644` the finished temp file before moving it into place (step 6.3); never change the session's umask |
| Stopping, or trying another command, when the `chmod` of step 6.3 is denied | Continue with the move; the load decides, and its failure names the one-time setup-operator run |
| Stopping the caller because Neo4j is down | Report `index: unavailable` with the reason; the caller reads the files |
| Retrying a refused load or clearing the store to make it pass | Report the refusal; the store and the previous index stay as they are |
| Reloading without taking the reload lock, or removing a fresh lock | Take the lock before step 6.1; a fresh lock means another run reloads now: report `another run is reloading the index` |
| Making up `<run id>`, or reusing one seen in the lock | Draw it with the run id command of `runtime.md`; draw a new one before the take once more when it equals a listed name |
| Running two lock commands in one line with `;` | Run each lock command on its own, the next only after the one before it succeeded; otherwise a run creates its owner folder inside another run's lock, or removes another run's lock |
| Taking every failed first `mkdir` for a busy lock | Only the error that the folder exists leads to the listing; any other error is `the reload lock could not be created` |
| Leaving the lock behind when the second `mkdir` fails | Remove it with `rmdir "<import>/reload.lock"`: it is this run's own lock without an owner folder |
| Going to step 6.1 right after the two `mkdir` of the take | Check the take first: the lock must list exactly `<run id>`; otherwise remove only this run's owner folder and report `another run is reloading the index` |
| Treating a lock without an owner folder as busy forever | Run the lock age check of `<import>/reload.lock`; stale means it is broken like any stale lock |
| Breaking a stale lock with `rmdir "<import>/reload.lock"` first, or going on after an owner folder's `rmdir` failed otherwise | Remove the owner folders first; an error that says the folder does not exist means another run removed it; any other error is Uncleared |
| Reloading without the lock when the first `mkdir` is denied and a lock exists | List the lock; only when it does not exist, reload without it |
| Exporting, moving the export or loading without the ownership check | List the lock right before the export of step 6.2, the move of step 6.3 and the load of step 6.4; anything but exactly `<run id>` means the lock was taken over: go to step 6.6 without touching `kb-export.json` |
| Releasing with `rmdir "<import>/reload.lock"` alone, or going on after the `rmdir` of `<run id>` said the folder does not exist | Remove `<run id>` first; when it is gone, another run took the lock over: touch nothing else |
| Waiting or polling until another run releases the lock | Report `index: unavailable` at once; the caller reads the files, and the next run finds the index loaded |
| Going straight to step 7 from steps 6.1 to 6.5 | Every outcome goes through step 6.6, which removes this run's temp file and releases the lock this run holds |
| Writing a file into `<import>/reload.lock` or the owner folder | Keep both empty: their modification times are the lock's age, and `rmdir` removes only an empty folder |
| Exporting to a shared temp name, or moving another run's temp file | Each run exports to `kb-export.<run id>.json.tmp` and moves only that file |
| Taking a missing temp file after the move for a success, or matching the whole `<import>` listing | List `<import>` and look only for `kb-export.json` and this run's temp file: `kb-export.json` listed and the temp file not is a success; neither listed means the file disappeared before the move |
