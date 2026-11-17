---
name: update-operator
description: Use when a knowledge-base plugin skill is about to read or write the project's knowledge base (KB) and needs the read-only KB clone fast-forwarded and its local Neo4j index current. Operator: updates the clone and reloads the index; called by knowledge-base:content-provider and knowledge-base:article-writer before their work.
---

# Update the KB clone and index

Brings the read-only clone to `origin/<default>` and the local Neo4j index to the clone's commit, then reports the state. It never fails its caller: anything that blocks the index ends as `index: unavailable` with a reason, and the caller reads the clone's files instead. It never edits a file in the clone.

Mechanics shared with the other skills (locating the KB, shell rules, running a query, reading its output) are in `runtime.md` next to this file. Follow them exactly. When a command is denied or fails where a step names no outcome, follow "Denied or failed commands" there; once step 6 holds the reload lock, its step 6.8 runs first.

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

Each run exports to its own file, `<import>/kb-export.<run id>.json`, and loads that file, so no run reads, moves or removes another run's export. The reload lock keeps a second run from repeating a reload that is under way; it is best effort. Two runs that reload at once still leave a correct index: the load is one transaction, and a second load of the same commit either commits the same graph or is refused by a uniqueness constraint. The commands and how to read their errors are in section "Reload lock" of `runtime.md`. Run each lock command on its own, never two in one line. A `<first error line>` is the command's whole first error line as printed. Outcomes used below:

- Busy: `index: unavailable — another run is reloading the index; the previous index is kept`, and go to step 7. Never wait for the lock.
- Not allowed: `index: unavailable — the reload lock command <command> was not allowed: denied; run knowledge-base:setup-operator once to allow the reload lock; the previous index is kept`, with `<command>` the denied command as run, and go to step 7. setup-operator allows each command this outcome is used for.

1. Draw the run id. Run the run id command of `runtime.md` (section "Reload lock") for this shell; never choose, change or reuse an id yourself. `<run id>` is the 12 letters or digits it prints, in bash and zsh the ones after the last `kb-export.` of the path it prints. `<import>/kb-export.<run id>.json` is this run's export file. The command is denied: Not allowed. It fails: `index: unavailable — the run id could not be drawn: <first error line>; the previous index is kept`, and go to step 7.
2. Take the lock. Run `mkdir "<import>/reload.lock"`.
   - It succeeds: this run holds the lock; go to step 6.3.
   - It fails with the error that the folder exists: run the lock age check.
     - Fresh: Busy.
     - Stale: run `rmdir "<import>/reload.lock"`. It succeeds, or fails with an error that says the folder does not exist (another run removed it first): take once more. It fails with an error that says the folder is not empty: `index: unavailable — the reload lock <import>/reload.lock cannot be cleared: <first error line>; if no run is reloading, remove that folder by hand; the previous index is kept`, and go to step 7. It is denied: Not allowed. It fails otherwise: the same as not empty.
     - The age check fails with an error that says the path does not exist: the lock was released in the meantime; take once more.
     - It is denied, or fails otherwise: `index: unavailable — the reload lock <import>/reload.lock could not be checked: <first line of the denial or error>; <remedy>; the previous index is kept`, and go to step 7. `<remedy>` for a denial that says reads outside the working directories are blocked: `add <kb folder> as a working directory (/add-dir) or unset permissions.blockReadsOutsideWorkingDirectories`; for another denial: `run knowledge-base:setup-operator once to allow reading <kb folder>`; for a failure, leave `<remedy>` and its `; ` out (section "Reload lock" of `runtime.md`).
   - It is denied: Not allowed.
   - It fails otherwise: `index: unavailable — the reload lock could not be created: <first error line>; the previous index is kept`, and go to step 7.

   Take once more, only once per run: run `mkdir "<import>/reload.lock"`. It succeeds: this run holds the lock; go to step 6.3. It fails with the error that the folder exists: Busy; never check or break the lock a second time. It is denied: Not allowed. It fails otherwise: `the reload lock could not be created`, as above.

   From here on, every outcome goes through step 6.8 before step 7: a denial, and a failure the step names no outcome for, end as `index: unavailable — <command> was not allowed: denied; the previous index is kept` or `index: unavailable — <command> failed: <first error line>; the previous index is kept`, with `<command>` the command as run, then step 6.8. A step's own outcome for a denial or failure always comes first.
3. Run the query `status` again with `kb`: another run may have loaded the index while this one took the lock. Exactly one row, and its `sha` equals `<commit>`: `index: current`, `docs` from the row, go to step 6.8. It is denied: `index: unavailable — the query status was not allowed: denied; the previous index is kept`, go to step 6.8. It fails: `index: unavailable — <reason>; the previous index is kept`, go to step 6.8. Otherwise run the query `fulltext` with `analyzer` = the manifest's `fulltext_analyzer`, or `standard-no-stop-words` when the manifest has none. It is denied: `index: unavailable — the query fulltext was not allowed: denied; the previous index is kept`, go to step 6.8. It fails: `index: unavailable — <reason>; the previous index is kept`, go to step 6.8.
4. Build the export command from the manifest's `export.cmd`: replace `{ref}` with `"<commit>"` and `{out}` with `"<import>/kb-export.<run id>.json"`, each in double quotes. Run it in the clone root as `cd "<clone>"; <export command>`, allowing up to 10 minutes. The load never reads a file an export is still writing: it runs only after this run's own export exited.
   - It is denied: `index: unavailable — the export was not allowed: denied; the previous index is kept`, go to step 6.8.
   - It times out: `index: unavailable — the export did not finish within 10 minutes; the previous index is kept`, go to step 6.8.
   - It exits non-zero: `index: unavailable — the export failed: <first error line>; the previous index is kept`, go to step 6.8.
5. Only after the export exited 0, check with the file tools that `<import>/kb-export.<run id>.json` exists. It does not, or the check is refused: `index: unavailable — the export wrote no file; the previous index is kept`, go to step 6.8. Then, on macOS and Linux, make it readable for Neo4j: the export honours the session's umask and may have written it for its owner only, and the container's `neo4j` user is neither the file's owner nor in its group:

   ```
   chmod 644 "<import>"/kb-export.????????????.json
   ```

   The `?` pattern matches every run's export file in `<import>`, this run's and any other run's: it changes only their mode to the one every run sets anyway, and it lets setup-operator allow the command exactly, since a permission rule treats `?` as text and only `*` as a wildcard. The permission system denies it or it fails: continue with the load, and remember that the `chmod` was skipped (denied or failed alike). This is that command's outcome, not a workaround: a project set up before knowledge-base 1.2.5 does not allow it until setup-operator runs again, and the export may already be readable under the session's umask; the load tells. On Windows skip it: Windows has no mode bits, and Docker Desktop shares the folder with the container user. In PowerShell on macOS or Linux the pattern may not expand (unverified): the `chmod` then fails, and the load decides.
6. Run the query `load` with `kb` and `file` = `kb-export.<run id>.json`. It succeeds: go to step 6.7 with its row. It is denied: `index: unavailable — the query load was not allowed: denied; the previous index is kept`, go to step 6.8. It fails: run the query `status` again with `kb`. Exactly one row, and its `sha` equals `<commit>`: another run loaded the same commit while this one loaded; `index: current`, `docs` from the row, go to step 6.8. Any other result, a denial or a failure included: `index: unavailable — the load was refused: <reason>; the previous index is kept`, with `<reason>` the load's, go to step 6.8. When step 6.5 skipped the `chmod` and the load's reason contains `Cannot open file`, the whole line is instead `index: unavailable — the export is not readable for Neo4j and its chmod was skipped; run knowledge-base:setup-operator once to allow it; the previous index is kept`.
7. The load's row's `sha` must equal `<commit>`; otherwise `index: unavailable — the export stamped <sha>, not <commit>`. When it matches: `index: loaded`, `docs` from the row. Go to step 6.8.
8. Clean up and release the lock, on every outcome after step 6.2 took it, a denial included. When step 6.4 started the export, that is, it was not denied, whatever its outcome, remove this run's export file, `rm "<import>/kb-export.<run id>.json"`. setup-operator does not allow it, since a rule for it would admit removing any file: it prompts, and a session that cannot prompt leaves the file behind, which setup-operator's next run removes once it is older than 30 minutes. Then run `rmdir "<import>/reload.lock"`. Whatever the outcome of either command, a denial included, the report stays as it is and names neither command: a lock left behind goes stale after 30 minutes, and a later run breaks it. Then go to step 7.

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
| Loading an export the session's umask left unreadable to others (`Cannot open file /import/kb-export.<run id>.json for reading`) | On macOS and Linux, run the `chmod` of step 6.5 before the load; never change the session's umask |
| Stopping, or trying another command, when the `chmod` of step 6.5 is denied | Continue with the load; the load decides, and its failure names the one-time setup-operator run |
| Writing the `chmod` with `<run id>` or a `*` | Run it exactly as step 6.5 writes it: setup-operator allows only that text |
| Stopping the caller because Neo4j is down | Report `index: unavailable` with the reason; the caller reads the files |
| Retrying a refused load or clearing the store to make it pass | Re-run `status` once (step 6.6); otherwise report the refusal; the store and the previous index stay as they are |
| Making up `<run id>`, or exporting to, loading or removing a file other than `kb-export.<run id>.json` | Draw the id with the run id command; each run touches only its own export file |
| Removing a fresh lock, or waiting or polling until another run releases it | Report Busy at once; the caller reads the files, and the next run finds the index loaded |
| Checking or breaking the lock a second time after the take once more failed | Take once more only once per run; then Busy |
| Going straight to step 7 after the take, also on a denial | Every outcome after the take goes through step 6.8, which removes this run's export file and releases the lock |
| Writing a file into `<import>/reload.lock` | Keep it empty: its modification time is the lock's age, and `rmdir` removes only an empty folder |
