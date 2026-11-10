---
name: update-operator
description: Use when a knowledge-base plugin skill is about to read or write the project's knowledge base (KB) and needs the read-only KB clone fast-forwarded and its local Neo4j index current. Operator: updates the clone and reloads the index; called by knowledge-base:content-provider and knowledge-base:article-writer before their work.
---

# Update the KB clone and index

Brings the read-only clone to `origin/<default>` and the local Neo4j index to the clone's commit, then reports the state. It never fails its caller: anything that blocks the index ends as `index: unavailable` with a reason, and the caller reads the clone's files instead. It never edits a file in the clone.

Mechanics shared with the other skills (locating the KB, shell rules, running a query, reading its output) are in `runtime.md` next to this file. Follow them exactly.

## Steps

### 1. Locate the KB

Follow "Locate the KB" in `runtime.md`. If it stops, return its message as the report and stop.

### 2. Fast-forward the clone

1. `git -C "<clone>" rev-parse HEAD` is `<commit>` for now.
2. `git -C "<clone>" symbolic-ref --short HEAD` must print `<default>`. It prints another branch, or fails because HEAD is detached: `index: unavailable — the read-only clone is not on <default> (<branch, or "detached HEAD">), so its files may not match origin/<default>; run knowledge-base:setup-operator`, and go to step 6.
3. `git -C "<clone>" fetch --quiet origin`. If it fails, the machine is offline or the remote unreachable: continue on the clone's current commit, and get its age with `git -C "<clone>" log -1 --format=%cr HEAD` for the report.
4. `git -C "<clone>" merge --ff-only --quiet origin/<default>`. If it fails: `index: unavailable — the read-only clone cannot fast-forward to origin/<default>, so its files may not match it: <first error line>; run knowledge-base:setup-operator`, and go to step 6.
5. `git -C "<clone>" rev-parse HEAD` is `<commit>`.

### 3. Refresh the query files

The plugin's query files are in the `cypher` folder at the plugin root, two folders above this skill's directory (the base directory shown when the skill loads). `<plugin cypher>` is that folder's absolute path.

1. `git diff --no-index --quiet "<plugin cypher>" "<queries>"`. Exit code 0: the copies are current, go to step 4.
2. Any other exit code: copy every `.cypher` file of `<plugin cypher>` to `<queries>` under the same name, with the file tools (read each file, write it unchanged). Never edit a query file.
3. Verify each copy: `git diff --no-index --quiet "<plugin cypher>/<name>.cypher" "<queries>/<name>.cypher"` for every file copied. Any exit code other than 0: `index: unavailable — the query file <name>.cypher could not be copied to <queries>`, and go to step 6 without running a query.

### 4. Compare the index

1. Read `NEO4J_SHELL` and `NEO4J_DATABASE`. Either unset: `index: unavailable — no KB index is configured; run knowledge-base:setup-operator`, and go to step 6.
2. Run the query `status` with `kb`. It fails: `index: unavailable — <reason>` (for a connection error add "Neo4j is not reachable"), and go to step 6.
3. Exactly one row, and its `sha` equals `<commit>`: `index: current`, `docs` from the row; go to step 6.
4. More than one row, a row with `empty: true`, or another `sha`: go to step 5.

### 5. Reload the index

1. Run the query `fulltext` with `analyzer` = the manifest's `fulltext_analyzer`, or `standard-no-stop-words` when the manifest has none. It fails: `index: unavailable — <reason>`, go to step 6.
2. Build the export command from the manifest's `export.cmd`: replace `{ref}` with `"<commit>"` and `{out}` with `"<import>/kb-export.json.tmp"`, each in double quotes. Run it in the clone root as `cd "<clone>"; <export command>`, allowing up to 10 minutes. It exits non-zero: `index: unavailable — the export failed: <first error line>; the previous index is kept`, go to step 6. The load never reads a file the export is still writing: only a finished export becomes `kb-export.json`.
3. Only after the export exited 0, replace the export file with it, in one line that runs unchanged in bash, zsh and PowerShell:

   ```
   rm "<import>/kb-export.json"; mv "<import>/kb-export.json.tmp" "<import>/kb-export.json"
   ```

   The `rm` reports an error when no previous export exists; ignore it. The file tools still find `<import>/kb-export.json.tmp` afterwards: `index: unavailable — the export could not be moved into place; the previous index is kept`, go to step 6.
4. Run the query `load` with `kb`. It fails: `index: unavailable — the load was refused: <reason>; the previous index is kept`, go to step 6.
5. The row's `sha` must equal `<commit>`; otherwise `index: unavailable — the export stamped <sha>, not <commit>`. When it matches: `index: loaded`, `docs` from the row.

### 6. Report

Return exactly this block to the caller:

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
| Loading when `status` already reports `<commit>` | Load only on a different `sha` or an empty store |
| Running the export against the working tree or a branch name | `{ref}` is the full commit SHA `<commit>` |
| Stopping the caller because Neo4j is down | Report `index: unavailable` with the reason; the caller reads the files |
| Retrying a refused load or clearing the store to make it pass | Report the refusal; the store and the previous index stay as they are |
