# KB runtime mechanics

How the `knowledge-base` skills locate the project's KB and run the plugin's queries. The rules behind these mechanics are in the contract, `contracts/knowledge-base.v1.md` at the plugin root (two folders above this file's folder); this file holds only the steps.

## Shell rules

Every command below runs unchanged in bash, zsh and PowerShell.

- An environment value is read first, with its own command, and then written into the next command as literal text: `printenv <KEY>` in bash or zsh, `[Environment]::GetEnvironmentVariable('<KEY>')` in PowerShell. Empty output means unset. A command line never contains `$<KEY>`, `$env:<KEY>` or `%<KEY>%`.
- Read only `KB_PATH`, `NEO4J_SHELL` and `NEO4J_DATABASE`. `NEO4J_USERNAME` and `NEO4J_PASSWORD` are never read, printed or written into a command; `NEO4J_SHELL` passes them on by name.
- No `<` or `>` redirection, no pipes, no `&&`. Two steps in one line are separated by `;`.
- Paths are absolute and in double quotes.
- Free text (commit messages, titles, pull request bodies) never goes on a command line: write it to a file with the file tools and pass the file. The one exception is a query parameter, which goes on the line only as a `-P` literal.

## Locate the KB

1. Read `KB_PATH`. Unset: the project has no KB. Reply `This project has no knowledge base: KB_PATH is unset. Run knowledge-base:setup-operator.` and stop.
2. Read `<KB_PATH>/kb-manifest.json` with the file tools. Missing or not valid JSON: reply `KB_PATH (<KB_PATH>) holds no valid kb-manifest.json. Run knowledge-base:setup-operator.` and stop.
3. Run `git -C "<KB_PATH>" rev-parse --show-toplevel`. Its output is `<clone>`, the read-only clone's root. Its parent folder is `<kb folder>`.
4. `<clone>` must be named `repo` and `<kb folder>` must be named after the manifest's `kb`, as the contract's local layout fixes. Otherwise reply `KB_PATH does not point into the read-only clone ~/.kb/<kb>/repo. Run knowledge-base:setup-operator.` and stop: a working checkout is never read or written.

Names used by the skills:

| Name | Value |
|---|---|
| `<kb>` | the manifest's `kb` |
| `<default>` | the manifest's `default_branch` |
| `<KB root>` | `KB_PATH`; every path in the manifest, the graph and a query row is relative to it |
| `<clone>` | the read-only clone's root |
| `<import>` | `<kb folder>/import` |
| `<queries>` | `<kb folder>/import/queries` |

## Run a query

Read `NEO4J_SHELL` and `NEO4J_DATABASE`. `<shell>` below is the value of `NEO4J_SHELL`, written out literally; `<database>` is the value of `NEO4J_DATABASE`.

```
<shell> -d <database> --format plain -f <query file> -P '<name> => <literal>' …
```

- `<query file>`: `/import/queries/<name>.cypher` when `<shell>` starts with `docker exec`; otherwise the host path `<queries>/<name>.cypher`.
- One `-P` flag per parameter of the table below.
- Each `<literal>` follows the contract's `-P` literal rule (section "Queries"). Examples:

| Value | Flag |
|---|---|
| `kb` = `example-github` | `-P 'kb => "example-github"'` |
| `path` = `guides/Café "fast".md` | `-P 'path => "guides/Caf\u00e9 \u0022fast\u0022.md"'` |
| `path` = `notes/it's.md` | `-P 'path => "notes/it\u0027s.md"'` |
| `query` = `C:\temp` | `-P 'query => "C:\\temp"'` |
| `type` for all documents | `-P 'type => null'` |
| `limit` = 10 | `-P 'limit => 10'` |

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
