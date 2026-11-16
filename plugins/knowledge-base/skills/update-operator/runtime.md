# KB runtime mechanics

How the `knowledge-base` skills locate the project's KB and run the plugin's queries. The rules behind these mechanics are in the contract, `contracts/knowledge-base.v1.md` at the plugin root (two folders above this file's folder); this file holds only the steps.

## Shell rules

Every command below runs unchanged in bash, zsh and PowerShell, except the age check in "Reload lock".

- An environment value is read first, with its own command, and then written into the next command as literal text: `printenv <KEY>` in bash or zsh, `[Environment]::GetEnvironmentVariable('<KEY>')` in PowerShell. Empty output means unset. A command line never contains `$<KEY>`, `$env:<KEY>` or `%<KEY>%`.
- Read only `KB_PATH`, `NEO4J_SHELL` and `NEO4J_DATABASE`. `NEO4J_USERNAME` and `NEO4J_PASSWORD` are never read, printed or written into a command; `NEO4J_SHELL` passes them on by name.
- Never open, `cat` or search the project's `.claude/settings.local.json` or `.claude/settings.json` to find a value: they hold the Neo4j password. Values come only from the environment, as above.
- No `<` or `>` redirection, no pipes, no `&&`. Two steps in one line are separated by `;`.
- Paths are absolute and in double quotes.
- A folder's entries are listed with `ls "<folder>"`, which runs in bash, zsh and PowerShell; never with the Glob tool, which some sessions do not have. `ls` fails with an error that says the path does not exist, in whatever language (in English `No such file or directory` or `Cannot find path`): the folder is missing and has no entries. Any other failure (permission denied, blocked) follows "Denied or failed commands"; it never means an empty folder.
- Free text (commit messages, titles, pull request bodies) never goes on a command line: write it to a file with the file tools and pass the file. The one exception is a query parameter, which goes on the line only as a `-P` literal (section "Run a query").

## Denied or failed commands

When the permission system denies a command, or a command fails where a skill names no outcome for that failure, stop and report the exact command and the reason (the denial, or the first error line). Never change its flags, drop a step, split or merge commands, or substitute another command to get past it. A skill step that names what happens on a failure, such as `index: unavailable` and reading the clone's files, is that step's outcome, not a workaround.

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
| `load` | `kb` | `{kb, sha, docs}` |
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

Runs on one machine share `<import>` and the fixed names `kb-export.json.tmp` and `kb-export.json`, so only one run at a time may reload the index. The lock is the folder `<import>/reload.lock`. The run that holds it is named by the one folder inside it, its owner folder `<import>/reload.lock/<run id>`.

- `<run id>`: 12 random hexadecimal characters (`0` to `9`, `a` to `f`) that a run chooses once, before its first lock command, and uses for every lock command of that run.
- `<old>`: the name of an owner folder this run found in the lock, as the listing prints it.
- Nothing is ever written into either folder. The owner folder stays empty, so its modification time is the time its run took the lock: the lock's age is the owner folder's age.

Every lock command runs unchanged in bash, zsh and PowerShell, except the age check.

Take the lock with two commands. Run the second only after the first succeeded:

```
mkdir "<import>/reload.lock"
```

```
mkdir "<import>/reload.lock/<run id>"
```

`mkdir` succeeds only when the folder did not exist; when it exists, it fails with an error saying so. In bash, zsh, and PowerShell on macOS and Linux (where `mkdir` is the system's own command), creating the folder is atomic. In PowerShell on Windows, `mkdir` checks for the folder and then creates it, so two runs that take the lock in the same instant can both succeed; the lock does not guard against that.

List the lock's owner folder:

```
ls "<import>/reload.lock"
```

It prints nothing: the lock has no owner folder yet, because another run is between its two take commands. It prints one name: that is `<old>`, or this run's own `<run id>`. An error that says the path does not exist, in whatever language: the lock is gone.

Check the age of the owner folder `<old>`. This is the one lock command that differs per shell, an exception to "Shell rules". In bash and zsh:

```
find "<import>/reload.lock/<old>" -maxdepth 0 -mmin +30
```

It prints the owner folder's path: the lock is stale. It prints nothing: the lock is fresh. In PowerShell:

```
(Get-Item "<import>/reload.lock/<old>").LastWriteTime.AddMinutes(30) -lt (Get-Date)
```

It prints `True`: stale. `False`: fresh. In both shells, an error that says the path does not exist, in whatever language, means the owner folder is gone: its run released the lock, or another run broke it, in the meantime. Any other failure, or a denial, follows the skill step that runs the check.

Break a stale lock with two commands. Run the second only after the first succeeded:

```
rmdir "<import>/reload.lock/<old>"
```

```
rmdir "<import>/reload.lock"
```

Only one run can remove `<old>`: when two runs break the same stale lock, the later `rmdir` of `<old>` fails with an error that says the folder does not exist, and that run breaks nothing.

Release the lock with two commands. Run the second only after the first succeeded:

```
rmdir "<import>/reload.lock/<run id>"
```

```
rmdir "<import>/reload.lock"
```

The first fails with an error that says the folder does not exist when another run broke this run's lock and may hold its own: the run then touches nothing else. `rmdir` removes only an empty folder, the one form that runs unchanged in all three shells, so it never removes another run's owner folder with the lock.

Stale means the owner folder was created more than 30 minutes ago: above the export's 10-minute time limit plus the load. `find` counts whole minutes: on macOS it calls a lock stale after more than 30 minutes, GNU `find` (Linux, Git Bash) from 31 minutes on. PowerShell compares to the second.
