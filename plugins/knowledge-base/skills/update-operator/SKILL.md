---
name: update-operator
description: Use when a knowledge-base plugin skill is about to read or write the project's knowledge base (KB) and needs the read-only KB clone fast-forwarded and its local Neo4j index current. Operator: updates the clone and reloads the index; called by knowledge-base:content-provider and knowledge-base:article-writer before their work.
---

# Update the KB clone and index

Brings the read-only clone to `origin/<default>` and the local Neo4j index to the clone's commit, then reports the state. It never fails its caller: anything that blocks the index ends as `index: unavailable` with a reason, and the caller reads the clone's files instead. It never edits a file in the clone.

Mechanics shared with the other skills (locating the KB, shell rules, running a query, reading its output) are in `runtime.md` next to this file. Follow them exactly. When a command is denied or fails where a step names no outcome, follow "Denied or failed commands" there; once step 6.3's export has exited, step 6.7 runs first.

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

Each run exports to its own file, `<import>/kb-export.<run id>.json`, and loads that file, so no run reads or removes another run's export. Two runs at once may both export and load, which is safe (section "Reload" of `runtime.md`, which also holds the run id commands). A `<first error line>` is the command's whole first error line as printed.

1. Draw the run id. Run the run id command of `runtime.md` (section "Reload") for this shell; never choose, change or reuse an id yourself. `<run id>` is the 12 letters or digits it prints, in bash and zsh the ones after the last `kb-export.` of the path it prints. `<import>/kb-export.<run id>.json` is this run's export file. The command is denied: `index: unavailable — the run id command <command> was not allowed: denied; run knowledge-base:setup-operator once to allow it; the previous index is kept`, with `<command>` the command as run, and go to step 7. It fails: `index: unavailable — the run id could not be drawn: <first error line>; the previous index is kept`, and go to step 7.
2. Run the query `status` again with `kb`, right before the export: another run may have loaded the index in the meantime. Exactly one row, and its `sha` equals `<commit>`: `index: current`, `docs` from the row, go to step 7. It is denied: `index: unavailable — the query status was not allowed: denied; the previous index is kept`, go to step 7. It fails: `index: unavailable — <reason>; the previous index is kept`, go to step 7. Otherwise run the query `fulltext` with `analyzer` = the manifest's `fulltext_analyzer`, or `standard-no-stop-words` when the manifest has none. It is denied: `index: unavailable — the query fulltext was not allowed: denied; the previous index is kept`, go to step 7. It fails: `index: unavailable — <reason>; the previous index is kept`, go to step 7.
3. Build the export command from the manifest's `export.cmd`: replace `{ref}` with `"<commit>"` and `{out}` with `"<import>/kb-export.<run id>.json"`, each in double quotes. Run it in the clone root as `cd "<clone>"; <export command>`, allowing up to 10 minutes. The load never reads a file an export is still writing: it runs only after this run's own export exited.
   - It is denied: `index: unavailable — the export was not allowed: denied; the previous index is kept`, go to step 7.
   - It times out: `index: unavailable — the export did not finish within 10 minutes; the previous index is kept`, go to step 7. The harness moves a timed-out command to the background instead of stopping it, so the export may still write `<import>/kb-export.<run id>.json`: never remove that file; on macOS and Linux setup-operator's sweep clears it later, on Windows the developer removes it by hand.
   - It exits non-zero: `index: unavailable — the export failed: <first error line>; the previous index is kept`, go to step 6.7.

   From here on, every outcome goes through step 6.7 before step 7: a denial, and a failure the step names no outcome for, end as `index: unavailable — <command> was not allowed: denied; the previous index is kept` or `index: unavailable — <command> failed: <first error line>; the previous index is kept`, with `<command>` the command as run, then step 6.7. A step's own outcome for a denial or failure always comes first.
4. Only after the export exited 0, check with the file tools that `<import>/kb-export.<run id>.json` exists. It does not, or the check is refused: `index: unavailable — the export wrote no file; the previous index is kept`, go to step 6.7. Then make it readable for Neo4j: the export honours the session's umask and may have written it for its owner only, and the container's `neo4j` user is neither the file's owner nor in its group:

   ```
   chmod 644 "<import>"/kb-export.????????????.json
   ```

   The `chmod` runs only in bash and zsh on macOS and Linux: skip it in PowerShell on every OS, where `"<import>"/kb-export.????????????.json` splits into two arguments and `chmod` then changes the import folder itself, and skip it on Windows in every shell, Git Bash included. Windows has no mode bits, and Docker Desktop shares the folder with the container user. The `?` pattern matches every run's export file in `<import>`, this run's and any other run's: it changes only their mode to the one every run sets anyway, and it lets setup-operator allow the command exactly, since a permission rule treats `?` as text and only `*` as a wildcard. The permission system denies it: remember that the `chmod` was denied. It fails: remember that it failed, with its first error line. Either way continue with the load, which decides: the export may already be readable under the session's umask. This is that command's outcome, not a workaround.
5. Run the query `load` with `kb` and `file` = `kb-export.<run id>.json`. It succeeds: go to step 6.6 with its row. It is denied: `index: unavailable — the query load was not allowed: denied; the previous index is kept`, go to step 6.7. It fails: run the query `status` again with `kb`. Exactly one row, and its `sha` equals `<commit>`: another run loaded the same commit while this one loaded; `index: current`, `docs` from the row, go to step 6.7. Any other result, a denial or a failure included, ends as one of these lines, with `<reason>` the load's, then step 6.7:
   - `<reason>` contains `Cannot open file` and step 6.4's `chmod` was denied: `index: unavailable — the export is not readable for Neo4j and its chmod was not allowed: denied; run knowledge-base:setup-operator once to allow it; the previous index is kept`. setup-operator allows this exact `chmod`.
   - `<reason>` contains `Cannot open file` and step 6.4's `chmod` failed: `index: unavailable — the export is not readable for Neo4j and its chmod failed: <first error line of the chmod>; the previous index is kept`. No setup-operator run fixes a failure.
   - Otherwise: `index: unavailable — the load was refused: <reason>; the previous index is kept`.
6. The load's row's `sha` must equal `<commit>`; otherwise `index: unavailable — the export stamped <sha>, not <commit>`. When it matches: `index: loaded`, `docs` from the row. Go to step 6.7.
7. Clean up. Remove this run's export file, `rm "<import>/kb-export.<run id>.json"`. Cleanup is attempted, not guaranteed: setup-operator does not allow the `rm`, since a rule for it would admit removing any file, so it prompts, and a session that cannot prompt leaves the file behind; on macOS and Linux setup-operator's sweep removes it once it is older than 30 minutes, on Windows the developer removes it by hand. Whatever the outcome of the `rm`, a denial included, the report stays as it is and does not name it. Then go to step 7.

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
| Loading an export the session's umask left unreadable to others (`Cannot open file /import/kb-export.<run id>.json for reading`) | In bash and zsh on macOS and Linux, run the `chmod` of step 6.4 before the load; never change the session's umask |
| Stopping, or trying another command, when the `chmod` of step 6.4 is denied or fails | Continue with the load; the load decides |
| Running the `chmod` in PowerShell, or on Windows | Skip it there (step 6.4); in PowerShell it changes the import folder itself |
| Writing the `chmod` with `<run id>` or a `*` | Run it exactly as step 6.4 writes it: setup-operator allows only that text |
| Stopping the caller because Neo4j is down | Report `index: unavailable` with the reason; the caller reads the files |
| Retrying a refused load or clearing the store to make it pass | Re-run `status` once (step 6.5); otherwise report the refusal; the store and the previous index stay as they are |
| Making up `<run id>`, or exporting to, loading or removing a file other than `kb-export.<run id>.json` | Draw the id with the run id command; each run touches only its own export file |
| Removing the export file after the export timed out | Leave it: a background export may still write it; on macOS and Linux setup-operator's sweep clears it, on Windows the developer removes it by hand |
| Going straight to step 7 after the export exited, also on a denial | Every outcome after the export exited goes through step 6.7, which removes this run's export file |
