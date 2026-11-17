# KB runtime mechanics

How the `knowledge-base` skills locate the project's KB and run the plugin's queries. The rules behind these mechanics are in the contract, `contracts/knowledge-base.v1.md` at the plugin root (two folders above this file's folder); this file holds only the steps.

## Shell rules

Every command below runs unchanged in bash, zsh and PowerShell, except the run id command and the age check in "Reload lock", and the `chmod` of update-operator step 6.5, which runs only in bash and zsh.

- An environment value is read first, with its own command, and then written into the next command as literal text: `printenv <KEY>` in bash or zsh, `[Environment]::GetEnvironmentVariable('<KEY>')` in PowerShell. Empty output means unset. A command line never contains `$<KEY>`, `$env:<KEY>` or `%<KEY>%`.
- Read only `KB_PATH`, `NEO4J_SHELL` and `NEO4J_DATABASE`. `NEO4J_USERNAME` and `NEO4J_PASSWORD` are never read, printed or written into a command; `NEO4J_SHELL` passes them on by name.
- Never open, `cat` or search the project's `.claude/settings.local.json` or `.claude/settings.json` to find a value: they hold the Neo4j password. Values come only from the environment, as above.
- No `<` or `>` redirection, no pipes, no `&&`. Two steps in one line are separated by `;`.
- Paths are absolute and in double quotes.
- A folder's entries are listed with `ls "<folder>"`, which runs in bash, zsh and PowerShell; never with the Glob tool, which some sessions do not have. `ls` fails with an error that says the path does not exist, in whatever language (in English `No such file or directory` or `Cannot find path`): the folder is missing and has no entries. Any other failure (permission denied, blocked) follows "Denied or failed commands"; it never means an empty folder.
- Free text (commit messages, titles, pull request bodies) never goes on a command line: write it to a file with the file tools and pass the file. The one exception is a query parameter, which goes on the line only as a `-P` literal (section "Run a query").

## Denied or failed commands

When the permission system denies a command, or a command fails where a skill names no outcome for that failure, stop and report the exact command and the reason (the denial, or the first error line). Once update-operator holds the reload lock, its step 6.8 runs before the stop: it removes the run's export file and releases the lock. Never change its flags, drop a step, split or merge commands, or substitute another command to get past it. A skill step that names what happens on a failure, such as `index: unavailable` and reading the clone's files, is that step's outcome, not a workaround.

## Locate the KB

1. Read `KB_PATH`: run `printenv KB_PATH` (PowerShell: `[Environment]::GetEnvironmentVariable('KB_PATH')`) as a command of its own, combined with nothing. Never look for it in the project's settings files. Unset: the project has no KB. Reply `This project has no knowledge base: KB_PATH is unset. Run knowledge-base:setup-operator.` and stop.
2. Read `<KB_PATH>/kb-manifest.json` with the file tools. Missing or not valid JSON: reply `KB_PATH (<KB_PATH>) holds no valid kb-manifest.json. Run knowledge-base:setup-operator.` and stop.
3. Run `git -C "<KB_PATH>" rev-parse --show-toplevel`. Its output is `<clone>`, the read-only clone's root. Its parent folder is `<kb folder>`. It fails: reply `KB_PATH (<KB_PATH>) is not inside a git repository. Run knowledge-base:setup-operator.` and stop.
4. `<clone>` must be a folder named `repo` inside a folder named after the manifest's `kb`, as the contract's local layout fixes. Otherwise reply `KB_PATH is not inside a read-only clone at a folder <kb>/repo. Run knowledge-base:setup-operator.` and stop: a working checkout is never read or written.
5. `git -C "<KB_PATH>" rev-parse --show-prefix` must print `<kb_root>` followed by `/`, or nothing when `<kb_root>` is `.`. Otherwise reply `KB_PATH is not the KB root <kb_root> of the clone <clone>. Run knowledge-base:setup-operator.` and stop.

Names used by the skills:

| Name | Value |
|---|---|
| `<kb>` | the manifest's `kb` |
| `<default>` | the manifest's `default_branch` |
| `<kb_root>` | the manifest's `kb_root` without a leading `./` and without a trailing `/`, so `knowledge`, `./knowledge` and `knowledge/` are all `knowledge`; `.` and `./` are `.` |
| `<KB root>` | `KB_PATH`; every path in the manifest, the graph and a query row is relative to it |
| `<clone>` | the read-only clone's root |
| `<import>` | `<kb folder>/import` |
| `<queries>` | `<kb folder>/import/queries` |

## Run a query

Read `NEO4J_SHELL` and `NEO4J_DATABASE`. `<shell>` below is the value of `NEO4J_SHELL`, written out literally; `<database>` is the value of `NEO4J_DATABASE`.

```
<shell> -d <database> --format plain -f <query file> -P "<name> => <literal>" …
```

- `<query file>`: `/import/queries/<name>.cypher` when `<shell>` starts with `docker exec`; otherwise the host path `<queries>/<name>.cypher`.
- One `-P` flag per parameter of the table below.
- Each `<literal>` follows the contract's `-P` literal rule (section "Queries"): a single-quoted Cypher string with `\`, `"`, `'`, `$`, the backtick and every character outside printable ASCII written as `\uXXXX`, inside a double-quoted argument. Never put a raw `"` inside the argument: Windows PowerShell 5.1 drops it when it calls `docker`, and cypher-shell then reads the value as a variable name. Examples:

| Value | Flag |
|---|---|
| `kb` = `example-github` | `-P "kb => 'example-github'"` |
| `path` = `guides/Café "fast".md` | `-P "path => 'guides/Caf\u00e9 \u0022fast\u0022.md'"` |
| `path` = `notes/it's.md` | `-P "path => 'notes/it\u0027s.md'"` |
| `query` = `C:\temp` | `-P "query => 'C:\u005ctemp'"` |
| `query` = `$HOME` | `-P "query => '\u0024HOME'"` |
| `type` for all documents | `-P "type => null"` |
| `limit` = 10 | `-P "limit => 10"` |

Parameters per query:

| Query | Parameters | Rows |
|---|---|---|
| `fulltext` | `analyzer` | none |
| `load` | `kb`, `file` | `{kb, sha, docs}`; `file` is the export file's name in `<import>`, `kb-export.<run id>.json` |
| `status` | `kb` | `{kb, sha, docs}` or `{kb, empty: true}` |
| `doc` | `kb`, `path` | `{path, type, title, description, status, tags, refs, supersedes, parts, extra}`, or no row |
| `list` | `kb`, `type` | one row per document, shape as `doc`, ordered by path |
| `related` | `kb`, `path` | `{path, type, title, status, direction}`, `direction` `out` or `in` |
| `supersede-chain` | `kb`, `path` | `{path, type, title, status, distance}`; negative = newer, `0` = the document, positive = older |
| `search` | `kb`, `query`, `limit` | `{path, title, score, excerpt}`, best first; `query` is plain text |

### Read the output

- Empty output means no rows.
- Otherwise the first line is the header `json`, and each further line is one row: remove the outer double quotes, replace every `\"` with `"`, and parse the result as JSON.

### Failures

A query fails when it cannot start or exits non-zero. Its reason is the first line of its error output. A reason that starts with `refusing` comes from the store guard: the store holds another KB or an unstamped graph.

## Reload lock

Each reload run exports to its own file, `<import>/kb-export.<run id>.json`, and loads it by name, so runs share no file. The lock is the folder `<import>/reload.lock`: it exists while a run reloads, and it only keeps a second run from repeating that work. It is always empty; nothing is ever written into it, so its modification time is the time it was taken. Stale means it was taken more than 30 minutes ago: above the export's 10-minute time limit plus the load.

The lock is best effort. Two runs that both find the same stale lock can both remove it and take it again: the second `rmdir` removes the lock the first has just taken, and both reload. A run's release can likewise remove a lock another run took after breaking this run's stale one. Both reload then, which is safe: each loads only its own file, the load is one transaction, and a load that overlaps another load of the same commit either commits the same graph or is refused by a uniqueness constraint, which update-operator reports as `current` once `status` shows the commit. The lock never blocks for good: every lock goes stale after 30 minutes, and an empty stale lock is removed by the next run.

`<run id>`: the run id command's output, drawn once per run. Never choose, type or change an id yourself: two runs that make one up can make up the same one.

Draw the run id. In bash and zsh it prints the path `<import>/kb-export.` followed by 12 random letters and digits, `<run id>`; the file name it draws needs no writable working folder, and nothing stays behind (macOS `mktemp` creates the file and removes it again before it exits, GNU `mktemp` creates nothing):

```
mktemp -u "<import>/kb-export.XXXXXXXXXXXX"
```

In PowerShell it prints 12 random hexadecimal characters, `<run id>`:

```
[guid]::NewGuid().ToString('N').Substring(0,12)
```

Take the lock:

```
mkdir "<import>/reload.lock"
```

`mkdir` succeeds only when the folder did not exist. When it exists, `mkdir` fails with an error that says it exists, in whatever language (in English `File exists` or `already exists`). Any other error, such as `No such file or directory` for a missing `<import>` or `Permission denied`, means the folder could not be created. In bash, zsh, and PowerShell on macOS and Linux (where `mkdir` is the system's own command), creating the folder is atomic. In PowerShell on Windows, `mkdir` is `New-Item -ItemType Directory`, which checks for the folder and then creates it, so two runs that take the lock in the same instant can both succeed and both reload, which is safe as above (unverified on Windows).

Check the lock's age. In bash and zsh:

```
find "<import>/reload.lock" -maxdepth 0 -mmin +30
```

It prints the lock's path: stale. It prints nothing: fresh. In PowerShell:

```
(Get-Item "<import>/reload.lock").LastWriteTime.AddMinutes(30) -lt (Get-Date)
```

It prints `True`: stale. `False`: fresh. In every shell, an error that says the path does not exist, in whatever language, means the lock was released in the meantime. `find` counts whole minutes: on macOS it calls a lock stale after more than 30 minutes, GNU `find` (Linux, Git Bash) from 31 minutes on. PowerShell compares to the second.

The age check reads `<import>` outside the project's working folders. setup-operator's rule `Read(//<kb folder>/**)` allows that read, and with it `find` and `ls` there, without a prompt; the denial of a session without that rule says the command may only search the allowed working directories, and one setup-operator run adds the rule. With `permissions.blockReadsOutsideWorkingDirectories` set, no allow rule lets the read through: the denial says reads outside the working directories are blocked, and the remedy is to add `<kb folder>` as a working directory (`/add-dir`, or `permissions.additionalDirectories`) or to unset that setting (both seen in Claude Code 2.1.326).

Remove the lock, to break a stale one and to release this run's:

```
rmdir "<import>/reload.lock"
```

`rmdir` removes only an empty folder. An error that says the folder does not exist means another run removed it first. A folder that is not empty, such as one holding the `.DS_Store` file macOS Finder writes, makes it fail with an error that says the folder is not empty, in whatever language (in English `Directory not empty`; PowerShell on macOS and Linux runs the system's `rmdir` and prints the same). In PowerShell on Windows, `rmdir` is `Remove-Item`: on a folder that is not empty it fails in a non-interactive session with an error that it cannot prompt, and asks for confirmation in an interactive one, where confirming removes the folder with its contents (seen in pwsh on macOS, unverified on Windows). Take either error as not empty, and never confirm that question.

`mkdir` and `rmdir` of the lock change a folder outside the project's working folders: a non-prompting session runs them only with both setup-operator's `Bash(…)` rule for the exact command and its `Edit(~/.kb/<kb>/import/reload.lock)` rule; with the `Bash(…)` rule alone Claude Code 2.1.326 denied them as outside the working directories.
