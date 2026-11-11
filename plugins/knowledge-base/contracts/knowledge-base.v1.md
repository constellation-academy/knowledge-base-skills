# Knowledge-base contract, version 1

This contract binds every knowledge base (KB) that uses the `knowledge-base` plugin, the plugin's skills, and every team skill that wraps them. Team skills cite this file; they never copy it. The plugin knows no KB: everything KB-specific lives in that KB's manifest and its team skills.

## Principles

- The git repository that holds the KB is the only truth. The graph is derived, local, per developer and disposable.
- Reads use a read-only clone of that repository, never a working checkout. Nothing is ever edited in the clone.
- Writes happen in a fresh worktree created from the clone, on a fresh branch off `origin/<default_branch>`, and land as a pull request.
- Neo4j is the only supported store. Any other store is a developer's own setup outside this contract.
- KBs never mix: one Neo4j instance per KB, and every load and query is bound to the KB id.

## Local layout

| Thing | Value |
|---|---|
| KB folder | `~/.kb/<kb id>/` |
| Read-only clone | `~/.kb/<kb id>/repo`, cloned with `--filter=blob:none` and `core.autocrlf=false` |
| Neo4j data | `~/.kb/<kb id>/data` |
| Import folder | `~/.kb/<kb id>/import`, mounted at `/import` in the container |
| Query files | `~/.kb/<kb id>/import/queries/<name>.cypher` |
| Export file | `~/.kb/<kb id>/import/kb-export.json` |
| Neo4j settings | `~/.kb/<kb id>/neo4j.env`: APOC, file import, the import folder and the procedure allowlist, passed with `--env-file`; no credentials |
| Writer worktrees | `~/.kb/<kb id>/worktrees/<name>`, with the writer's message files next to them as `<name>.<file>` |
| Setup staging | `~/.kb/.incoming` (a clone before its KB id is known) and `~/.kb/setup-fragment.json` (settings to merge); both are removed by the setup |
| Neo4j container | `neo4j-<kb id>` |
| Docker network | `kb-<kb id>` |
| MCP server | `kb-<kb id>` |

- Every path is written as an absolute native path of the host OS (Windows, macOS or Linux).
- File permissions are set where the OS supports them. The import folder and the query files in it must be readable by the Neo4j container user, or Neo4j does not start; `setup-operator` makes them so.

## Project configuration

All values live in the project's `.claude/settings.local.json` under `env`. Nothing is global, and there is no `.env` file.

| Key | Value |
|---|---|
| `KB_PATH` | absolute path of the KB root inside the read-only clone: the clone itself, or the `kb_root` folder in it |
| `NEO4J_SHELL` | the full command that reaches `cypher-shell`: `docker exec -i -e NEO4J_USERNAME -e NEO4J_PASSWORD neo4j-<kb id> cypher-shell` (Docker) or `cypher-shell -a <bolt address>` (local Neo4j) |
| `NEO4J_USERNAME` | Neo4j user |
| `NEO4J_PASSWORD` | Neo4j password |
| `NEO4J_DATABASE` | Neo4j database name |

- One project has one `KB_PATH`, so one project uses one KB.
- A skill finds the KB only through `KB_PATH`. With `KB_PATH` unset the project has no KB, and the skill says so.
- Credentials exist only in this `env` block. They reach `cypher-shell` and Docker as bare `-e NAME` flags that copy the value from the environment; they never appear on a command line or in any output.
- A caller reads the value of `NEO4J_SHELL` and runs that text literally, never `$NEO4J_SHELL`: a permission rule matches the literal command only, so a variable would prompt on every call.
- `docker exec` carries `-i`.

## Manifest

Every KB ships `kb-manifest.json` at its KB root. It is read from the read-only clone. Its JSON Schema is [`kb-manifest.schema.json`](kb-manifest.schema.json), which decides validity; the list below explains the fields.

- `kb` (required): the KB id, lower-case letters, digits and hyphens. It names the container, network, MCP server and local folder.
- `contract` (required): the contract major version the manifest follows, `"1"` for this file.
- `default_branch` (required): the branch every read and every write starts from, e.g. `main`.
- `kb_root` (required): the KB root's path relative to the repository root, `.` when the KB is the whole repository. A leading `./` and a trailing `/` are ignored: `knowledge`, `./knowledge` and `knowledge/` name the same folder. The manifest sits in that folder, and every other path in the manifest is relative to it.
- `export` (required): the team's export command.
  - `cmd`: the command line; it contains both placeholders.
  - `placeholders`: exactly `["{ref}", "{out}"]`.
  - `{ref}` becomes the full commit SHA of `origin/<default_branch>` in the clone; `{out}` becomes the absolute path of a temporary file next to the export file; only after the command exits 0 is it renamed to the export file, so a load never reads a partial export. Each value is substituted in double quotes.
  - The command runs in the clone's repository root, in the team's own runtime.
- `fulltext_analyzer` (optional): the Neo4j full-text analyzer for `kb_fulltext`, e.g. `german`. Absent means `standard-no-stop-words`.
- `resources` (required): resource name → exactly one of
  - `{"file": "<path>"}`: one file;
  - `{"type": ["<doc type>", …]}`: every document of these types;
  - `{"folder": "<path>/"}`: either an assembled multi-part document, its parts in order, or a plain folder of documents. A folder the index holds as a document with `parts` is read as those parts; any other folder, and every folder without an index, is its Markdown files except `index.md`, in file-name order, read from the clone.
  - Common names, used where a KB has them: `glossary`, `decisions`, `catalog`.
- `article_types` (required): document type → how a new document of that type is written.
  - `folder`: the folder new documents of this type go into.
  - `template`: the file the new document is built from.
  - `required_frontmatter`: the frontmatter keys every document of this type carries.
  - `file_name` (optional): the new document's file name in `folder`, with the placeholders `{number}` and `{slug}`. Absent means `{slug}.md`.
- `skills` (optional): the team skill per route, always plugin-qualified (`<plugin>:<skill>`).
  - `read`: one skill.
  - `write`: one skill, or a map article type → skill where the key `*` matches every other type.
  - `answer`: one skill.
- `pr` (required): how the writer names and opens a change.
  - `host`: `github` or `azure-devops`.
  - `branch_pattern`: the branch name. When the rendered name already exists on the remote, the writer appends `-2`, `-3`, … and takes the first free name, so repeated changes to one document each get their own branch.
  - `commit_pattern`: the commit subject, or `{"add": …, "update": …}` for separate patterns for a new and a changed document.
  - `title_pattern` (optional): the pull request title. Absent means the subject of the commit the writer made, rendered from the `commit_pattern` entry it used (`add` or `update` in the object form).
  - `template` (optional): the pull request description template.
  - `pre_commit` (optional): a command the writer runs in the worktree root after all files are written and before the commit, e.g. the KB's lint. A non-zero exit stops the write: nothing is committed or pushed, the worktree and branch are removed, and the command's output is reported. After a zero exit, every change under the KB root, including files the command generated or changed, is committed with the document, and the writer's result lists the committed paths; a change outside the KB root stops the write the same way. It follows the same shell rules as every other command: no redirection and no environment-variable expansion on the line. The team guarantees that it never executes Markdown content as code (for example no doctest-style runs of `.md` files and no YAML loader that runs tags): `knowledge-base:setup-operator` lets sessions write `.md` files in the writer's worktrees without a prompt.
  - Placeholders in `branch_pattern`, `commit_pattern` and `title_pattern`: `{ticket}` the ticket id, `{slug}`, `{summary}` a short summary of the change. Any other text is literal. A writer that needs `{ticket}` and has none asks for it.
- Placeholder values:
  - `{slug}`: the document's title in lower case and ASCII: `ä`, `ö`, `ü`, `ß` become `ae`, `oe`, `ue`, `ss`, other letters lose their diacritics, each run of remaining characters other than `a-z` and `0-9` becomes one hyphen, and no hyphen leads or trails.
  - `{number}`: the highest number that existing file names of that type in `folder` carry at the `{number}` position, plus one, zero-padded to 4 digits; `0001` when there is none.

## Export format

The export command writes one JSON object to `{out}`:

```json
{ "kb": "<kb id>", "sha": "<commit>", "docs": [
  { "path": "<path>", "type": "<doc type>", "title": "…", "description": "…", "status": null,
    "tags": [], "refs": [], "supersedes": [], "parts": [], "extra": {}, "body": "…" } ] }
```

- The export reads the repository at `{ref}` and stamps that commit as `sha`; it never reads a working tree.
- `kb` equals the manifest's `kb`.
- `path`, `refs`, `supersedes` and `parts` are relative to the KB root. An assembled document's `path` is its folder and ends in `/`.
- `type`, `description` and `status` are a string or `null`. `status` is the decision status where the KB has one.
- `tags` and `parts` are lists of strings; `parts` lists an assembled document's part paths in order and is empty otherwise.
- `refs`: documents this one links to. `supersedes`: documents this one replaces.
- `extra`: an object of other KB-specific frontmatter, stored and returned unchanged.
- `body`: the document's text without frontmatter; for an assembled document, its parts' texts in order.

## Graph schema

- `(:Doc {kb, path, type, title, description, status, tags, parts, extra, body})`
  - `kb`, `path`, `title`, `body`: string.
  - `type`, `description`, `status`: string, absent when `null`.
  - `tags`, `parts`: list of strings.
  - `extra`: a JSON string of the export's `extra` object.
- `(:Doc)-[:REFERENCES]->(:Doc)`: one per entry in `refs`.
- `(:Doc)-[:SUPERSEDES]->(:Doc)`: from the newer document to the one it replaces, one per entry in `supersedes`.
- `refs` and `supersedes` exist only as relationships; an entry whose target is not a document of the export yields no relationship.
- `(:KBIndex {kb, sha, docs})`: `kb` the loaded KB id (string), `sha` the commit it was exported at (string), `docs` the number of documents (integer).
- Full-text index `kb_fulltext` on `Doc.title` and `Doc.body`, with the manifest's analyzer.
- Uniqueness: one `Doc` per `kb` and `path`, one `KBIndex` per `kb`, enforced by constraints, so two loads at once cannot duplicate the graph.

## Loading

- The plugin's load script reads the export file through APOC (`apoc.load.json`) and runs entirely in `cypher-shell`.
- The full-text index and the uniqueness constraints are created first, in their own step (`IF NOT EXISTS`), never inside the load transaction.
- One transaction wipes the KB's graph, loads the export, creates the relationships and stamps `KBIndex`. A failed load keeps the old graph.
- The load refuses, and changes nothing, when the store holds another KB, when it holds documents without a `KBIndex` stamp or without `kb`, when the export names another KB, or when the export has no documents.

## Queries

- Fixed queries live as `.cypher` files in the plugin. `update-operator` copies them to the query folder, so no command names the plugin's versioned install path.
- A query runs as `<NEO4J_SHELL> -d <NEO4J_DATABASE> --format plain -f <query file> -P "<name> => <literal>"`, the `-P` argument in double quotes. The query file is `/import/queries/<name>.cypher` with Docker and the host's query-file path with a local Neo4j. No shell redirection: PowerShell has no `<`.
- Values reach Cypher only as `-P` parameters, never spliced into query text.
- A `-P` literal is a single-quoted Cypher string: `\`, `"`, `'`, `$`, the backtick and every character outside printable ASCII become `\uXXXX`; a character above U+FFFF becomes its two UTF-16 surrogate escapes. No character in the argument is then special inside double quotes in bash, zsh or PowerShell, and it holds no double quote for Windows PowerShell 5.1 to drop when it passes the argument to a native program. `null` and numbers are bare.
- `search` takes plain text and escapes it itself for the full-text parser; callers never escape Lucene syntax.
- Every query filters by and checks the KB id.
- Every query returns one column `json`, one JSON object per row (`apoc.convert.toJson`).
- No fixed query returns a document's `body`; document text always comes from the clone's files. `search` returns only a short excerpt of at most 200 characters of the body next to path, title and score.
- Fixed queries: `fulltext`, `load`, `status`, `doc`, `list`, `related`, `supersede-chain`, `search`.
- Ad-hoc exploration uses the MCP server `kb-<kb id>` (`mcp/neo4j-cypher`, read-only). Without it, exploration uses the fixed queries `search` and `related`.

## Resolution

Every read resolves an item (a resource name from the manifest's `resources`, or a document path) to an ordered list of documents. Paths are relative to the KB root.

| Item | Index available | Index unavailable |
|---|---|---|
| `{"file": p}` resource | the file `p` | the file `p` |
| `{"type": [t, …]}` resource | query `list` once per type `t`, take each row's `path` | every Markdown file under `<KB root>` whose frontmatter `type` is one of the types, except the `template` files named in `article_types` (Grep tool) |
| `{"folder": f}` resource | query `doc` with `path` = `f`: a row with non-empty `parts` is an assembled document, read its `parts` in order; no row, a null row, or no `parts` means a plain folder, resolved as in the next column | the folder's Markdown files except `index.md`, in file-name order, read from the clone |
| document path ending in `/` | as a folder resource | as a folder resource |
| other document path | that file | that file |

- A `type` resource lists its documents sorted by path, whichever source found them.
- A frontmatter `type` counts only inside the leading `---` block of a file, not in its body.
- A `list` or `doc` query fails, or `doc` returns no row, a null row, or a row without `parts` or with empty `parts`: a reader that can fall back resolves that item as in the "Index unavailable" column. This is the normal case for a KB whose folder resources are plain folders of documents, not a failure, so it adds no note.
- An unknown resource name: `not a resource of KB <kb>: <name>; resources: <names in the manifest>`. A missing file: `not found: <path>`. Either affects only that item.
- Index-only rules, for a reader that has no fallback (section "Machine reads"):
  - A plain folder through the index is query `list` with `type` null, keeping the rows whose path is a direct child `.md` document of the folder (one more `/`-segment, no deeper) except `index.md`, in path order.
  - A `file` resource or a document path must have a `doc` row in the index; otherwise it is unresolved.

Worked example. The fixture KB `fx` (checked in as `test/fixtures/kb-fetch/`; its index holds the documents listed in `index.json` there) has this manifest, shortened to the fields that matter here (`resolution-manifest`):

```json
{
  "kb": "fx",
  "kb_root": ".",
  "resources": {
    "glossary": { "file": "glossary.md" },
    "decisions": { "type": ["adr"] },
    "guide": { "folder": "guide/" },
    "notes": { "folder": "notes/" }
  }
}
```

Through the index, each item resolves to these documents, in this order (`resolution-expected`):

```json
{
  "glossary": ["glossary.md"],
  "decisions": ["decisions/0001-first.md", "decisions/0002-second.md"],
  "guide": ["guide/01-intro.md", "guide/02-usage.md"],
  "notes": ["notes/a.md", "notes/b.md"],
  "guide/": ["guide/01-intro.md", "guide/02-usage.md"],
  "notes/a.md": ["notes/a.md"]
}
```

`guide` is an assembled document: `doc` returns a row for `guide/` with `parts`. `notes` has no `doc` row, so `list` without a type runs, and `notes/index.md` and the deeper `notes/deep/c.md` are dropped.

## Machine reads

A machine reader (a script, not a skill) reads KB text through the index without the plugin's skills. The plugin ships one: `kb-fetch`.

- Invocation: `bun <plugin dir>/scripts/kb-fetch.ts <item> [<item> ...]`, each item a resource name or a document path, as in `content-provider`'s `fetch`.
- Configuration comes only from the environment: `KB_PATH`, `NEO4J_SHELL` and `NEO4J_DATABASE`. `NEO4J_USERNAME` and `NEO4J_PASSWORD` pass through the environment by name to `cypher-shell`; the reader never reads or prints them.
- Resolution: the index column of section "Resolution", no fallback: no file-system listing, no git, no staleness logic. `status` must return a non-empty `KBIndex` row for the manifest's `kb`. Queries run as section "Queries" prescribes.
- Document text is the clone file `<KB root>/<path>`, full text with frontmatter.
- Output on success (stdout, exit 0): `{"kb": "<kb id>", "sha": "<KBIndex.sha>", "items": [{"item": "<as given>", "documents": [{"path": "<path>", "text": "<file text>"}]}]}`, items in the order given, documents in resolution order.
- Failure: no stdout, one JSON object on stderr `{"error": "<code>", "detail": "<text>", "item": "<item or null>"}`, and an exit status:

  | Code | Exit | Meaning |
  |---|---|---|
  | `config` | 2 | `KB_PATH`, `NEO4J_SHELL` or `NEO4J_DATABASE` unset, no manifest, another contract major, or no items given (`no items`) |
  | `index` | 3 | a query fails, Neo4j is unreachable, or `status` returns no `KBIndex` row |
  | `unresolved` | 4 | unknown resource name, a path not in the index, a resolved file missing, unreadable or outside the KB root, or a resource resolving to zero documents |
  | `internal` | 1 | an unexpected error in the reader itself; `detail` is its first line, `item` is null |

- Freshness is the caller's job: it runs `knowledge-base:update-operator` before `kb-fetch` and reads that skill's report (section "Freshness"). `update-operator` may return one of the "Locate the KB" stop messages instead of the report block; a reply without the report's `commit:` and `index:` lines means "not updated", and the caller does not run `kb-fetch`.

## Freshness

- `update-operator` runs before every read: `git fetch` in the clone, then a fast-forward to `origin/<default_branch>`.
- It compares `KBIndex.sha` with the clone's commit. On a mismatch or an empty store it creates the full-text index if missing, runs the export into the export file, and runs the load.
- Offline, it continues on the clone's current commit and says how old that commit is.
- The plugin's skills call `update-operator`, and so does a machine reader that follows the section "Machine reads", before it runs `kb-fetch`. `update-operator` may return one of the "Locate the KB" stop messages instead of the report block below; a machine reader treats any reply without the report's `commit:` and `index:` lines as "not updated" and does not run `kb-fetch`.
- Its report is part of this contract; callers parse it, so its four lines never change within a major. `update-operator` returns exactly:

```
kb: <kb>
commit: <commit>[, offline: last fetched commit is <age> old]
index: current | loaded | unavailable — <reason>
docs: <docs, or "-" when the index is unavailable>
```

## Routes

`knowledge-base:access-orchestrator` is the entry for every KB access, by people and by skills. It reads the manifest, picks exactly one route per request, and asks exactly one question when the request is ambiguous. Users never pick a route.

| Route | Team skill | Generic skill | Runs |
|---|---|---|---|
| read: fetch named resources, explore material for a question | `skills.read` | `knowledge-base:content-provider` | inline |
| write: create or update a document as a pull request | `skills.write` | `knowledge-base:article-writer` | one agent |
| answer: answer a question with sources | `skills.answer` | `knowledge-base:answer-engine` | one agent |

- A route the manifest's `skills` omits goes to the generic skill.
- For `write` as a map, the article type selects the skill; a type without a key goes to `*`, and without `*` to the generic skill.
- A read passes resource names through unchanged: a name the manifest's `resources` does not list still goes to the read skill, since a team skill may own aliases and sources outside the KB.
- A read in a project without a KB (`KB_PATH` unset, or no manifest at `KB_PATH`) goes to the one installed skill named `<plugin>:kb-provider`; with none it reports that the project has no KB, and with several it asks which one. Write and answer need the KB and report that `knowledge-base:setup-operator` sets it up.
- A team skill calls its generic skill and may add its own logic around it.
- `content-provider` fetches resources and returns ranked material for a question; it never answers. `answer-engine` answers from that material, cites document paths, and says so when the KB is silent. `article-writer` writes from the type's template with its required frontmatter and opens the pull request: via `gh` on GitHub, via `az` on Azure DevOps when installed, otherwise it pushes the branch and returns the link to create the pull request.
- `article-writer` inputs: `type`, `mode` (`create` or `update`), `title`, `content` (a complete body is written as given; otherwise it fills the type's template), `path` (update), `ticket` (when a pattern needs it), values for required frontmatter keys, and these optional inputs for team writers:
  - `frontmatter`: the document's complete frontmatter as an object, written as given; it must hold every key of `required_frontmatter`, and a `type` or `title` key in it must equal the `type` and `title` inputs.
  - `folder` (create only): a folder relative to the KB root that replaces the type's `folder` for this document; a leading `./` is stripped and a missing trailing `/` is added before it is checked or used, as for `kb_root`; never absolute, never with a `..` segment or a backslash, and it must exist in the clone. An `update` without `path` looks for the document of that type and title in the type's `folder` first, then anywhere under the KB root.
  - `number`, `slug` (create only): explicit `{number}` (digits) and `{slug}` (`^[a-z0-9]+(-[a-z0-9]+)*$`) values instead of derived ones; `number` only for a type whose `file_name` has `{number}`.
  - `companion_changes`: a list of `{path, content}`: further files under the KB root, written in the same worktree and committed with the document. A path is relative to the KB root, never absolute, never with a `..` segment or a backslash, never the document itself, and appears at most once.
  - `commit_body`: one to three lines, appended to the commit message after a blank line.
  - `pr_body`: the complete pull request description, replacing `pr.template` and the default.
  - An input that breaks one of these rules stops the write before anything is written, with `invalid <input>: <reason>`.
- `article-writer` writes every frontmatter it writes or rewrites deterministically, since team lint checks compare raw text: plain inline YAML between `---` lines, one `key: value` line per key in the given order; scalars unquoted unless YAML requires quotes; lists inline as `[a, b]`; objects inline as `{ k: v }`; never block lists or block objects.
- `knowledge-base:update-operator` (fetch and index) is called by the plugin's skills and by a machine reader (section "Freshness"). `knowledge-base:setup-operator` sets up a KB once per project.
- A request for a KB other than the project's is refused.

## Without an index

Reads work from the read-only clone and the manifest alone when Docker, Neo4j or the index is missing or unreachable.

- Items resolve as in the "Index unavailable" column of section "Resolution".
- Relationship queries (`related`, `supersede-chain`) and exploration are unavailable.
- The reader says once that the index is missing; it never fails its caller for that reason.
- `answer-engine` reports that it needs the KB index and names `knowledge-base:setup-operator`.

## Isolation

- One Neo4j instance, network, MCP server and local folder per KB, all named by the KB id.
- The Neo4j container publishes no host port and sits on the internal Docker network `kb-<kb id>`, which has no route outside Docker; `cypher-shell` reaches it through `docker exec`, the MCP server through that network. APOC is limited to the procedures the plugin uses, and file loads to the import folder. A local Neo4j outside Docker meets the same: Bolt on `127.0.0.1` only, no outbound network access for the Neo4j process, the same procedure allowlist (`dbms.security.procedures.allowlist`), and file loads confined to the import folder.
- The load refuses a store holding another KB; every query is bound to the KB id.
- The orchestrator serves only the KB of the project's `KB_PATH`.

## Versioning

- This file is contract major version 1. A breaking change to the manifest, the export format, the graph schema or the queries' output is a new major version with a new contract file.
- A manifest declares the major it follows in `contract`. `access-orchestrator` refuses a manifest of another major.
- Within a major, changes only add optional fields. A manifest that uses a field added later needs a plugin version that knows it, since the schema rejects unknown fields.
- The plugin's own version follows semantic versioning and is independent of the contract version.
