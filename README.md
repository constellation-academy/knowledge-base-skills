# knowledge-base-skills

Claude Code marketplace with one plugin, `knowledge-base`: agent skills that read, write and answer from a git-backed team knowledge base (KB), indexed in a local Neo4j per KB.

- Every KB access goes through `knowledge-base:access-orchestrator`, which routes a request to read, write or answer.
- Each KB describes itself in a `kb-manifest.json` at its KB root; team skills named there wrap the plugin's generic skills.
- The contract every KB and skill follows: [`plugins/knowledge-base/contracts/knowledge-base.v1.md`](plugins/knowledge-base/contracts/knowledge-base.v1.md), with the manifest's JSON Schema [`kb-manifest.schema.json`](plugins/knowledge-base/contracts/kb-manifest.schema.json).

## Skills

| Skill | Role |
|---|---|
| `access-orchestrator` | entry point: routes a request to read, write or answer, to the KB's team skill or the generic one |
| `content-provider` | read: `fetch: kb <resources or paths>`, `explore: kb <question>` |
| `article-writer` | write: creates or updates a document as a pull request from a worktree |
| `answer-engine` | answer: answers a question from the KB with document paths as sources |
| `update-operator` | internal: fast-forwards the read-only clone and reloads the index before a read or write |
| `setup-operator` | one-time setup per project: read-only clone, Neo4j and MCP server in Docker, project settings |
| `start-operator` | after a reboot: starts Docker Desktop and the KB's existing Neo4j container, then names the MCP reconnect; setup-operator uses the same start steps. Needed when Docker Desktop did not start at sign-in, or the container stayed stopped after Docker came back |

Without Docker or Neo4j, reads work from the read-only clone; exploring and answering need the KB index.

**Machine reads: `kb-fetch`.** A deterministic, index-only read for machine callers such as CRAFT, with no skill and no judgment. Run `bun <plugin dir>/scripts/kb-fetch.ts <item> [<item> ...]`, where each item is a resource name or a document path. It prints JSON on stdout and exits 0; on failure it prints one JSON error on stderr and exits 2 (config), 3 (index) or 4 (unresolved), or 1 (internal, an unexpected reader error). The caller runs `update-operator` first. See the contract section [Machine reads](plugins/knowledge-base/contracts/knowledge-base.v1.md#machine-reads).

## Install

In Claude Code:

```
/plugin marketplace add constellation-academy/knowledge-base-skills
/plugin install knowledge-base@knowledge-base-skills
```

Install it next to your team's plugin. Then run `knowledge-base:setup-operator` once in the project that uses the KB.

## Setup

`knowledge-base:setup-operator` asks for the URL of the repository that contains the KB and sets up, for that KB id:

- a read-only clone at `~/.kb/<kb id>/repo`, with the Neo4j data and import folders next to it;
- the Docker network `kb-<kb id>`, created with `--internal` (no route outside Docker), and the container `neo4j-<kb id>` (`neo4j:2026.06.0` with APOC limited to the procedures the plugin uses, file loads confined to the import folder, no published host ports, `--restart unless-stopped`); `cypher-shell` reaches it through `docker exec`;
- the MCP server `kb-<kb id>` in the project's local scope: `mcp/neo4j-cypher@sha256:b252997d16d37633a5a1b30e21ac0bf368b1c64e5895e4005313c84d77a05310` with `--read-only` and `--schema-sample-size 1000`, on the network `kb-<kb id>`;
- the project's `.claude/settings.local.json`: the env keys of the contract, a generated Neo4j password, a deny rule on that file, which stops the Read tool and plain `cat` but not every shell form (a compound command can still get past it), and allow rules for the commands the skills run to read, query and index the KB. The setup never reads the file itself: a script in a throwaway container merges its changes and prints no secret.

It ends by loading the index in a fresh session and checking it: the index holds the clone's commit with at least one document, the full-text index `kb_fulltext` is online, and an explore through the MCP server returns hits. The report says `index: ready`, or `not ready` with the check that failed and what to do; running the setup again repeats only what is missing and the checks.

It needs git, the Claude Code CLI and Docker: Docker Desktop on macOS and Windows (per-user or per-machine install), Docker Engine on Linux; other runtimes such as Colima, OrbStack, Rancher Desktop or Docker Engine inside WSL are not supported. A Docker Desktop that is installed but not running is started. Without Docker it sets up the clone only and lists the settings to add by hand: reads work from the files, exploring and answering need the index. An existing container or setting is reused; a container that lacks APOC, the import folder, the procedure allowlist or the internal network, or that publishes ports, is recreated on the same data only after you confirm; the question names the image change, the network change, the ports no longer published, the mounts kept, and the env keys carried over or dropped. An MCP registration `kb-<kb id>` that differs from the one the setup writes is replaced only after you confirm; the question shows both. Creating the project's `.claude` folder, when it is missing, always prompts: Claude Code protects that path. Run the setup in manual permission mode: auto mode denies the settings merge, because it writes permission rules into the project's own settings, and the setup then stops and asks you to switch.

Not pre-allowed, so they prompt unless your own permission mode, rules or hooks allow them: the KB's export command (once per reindex), `pr.pre_commit`, the writer's git commands (`remote get-url`, `ls-remote`, `check-ref-format`, `rev-parse --verify`, `worktree add` and `remove`, `status`, `add`, `diff --cached`, `commit`, `push`, `branch -D`), the pull request call (`gh --version`, `gh api …`, `az --version`, `az repos pr create …`), and a companion change that is not Markdown. Each of them could be widened into a prompt-free file read, file write or program run. The KB folder `~/.kb/<kb id>/` is readable but not an additional working directory, so no permission mode edits it beyond the setup's narrow rules: `.cypher` query files, Markdown documents in the writer's worktrees, and the writer's message files.

Accepted risk: the allow rules let a session write a `.cypher` file into `~/.kb/<kb id>/import/queries/` and run it with `cypher-shell`, so any Cypher can run against the KB's own local store without a prompt; that store holds only the rebuildable index. Nothing leaves the machine that way: the store has no network route outside Docker, so `LOAD CSV` and APOC loads from a URL fail, APOC procedures outside the allowlist are not loaded, file loads stay in the import folder, and an inserted `-a <host>` reaches only containers on `kb-<kb id>`.

## Local Neo4j without Docker

The setup supports Neo4j in Docker. For a Neo4j you run yourself, one instance per KB, configure:

- Neo4j `2026.06.0` with the APOC plugin installed; `CALL apoc.version()` returns a version.
- `apoc.import.file.enabled=true` in `apoc.conf`.
- The import directory (`server.directories.import`) set to the KB's import folder `~/.kb/<kb id>/import`, as an absolute path.
- The Bolt connector listening on `127.0.0.1` only, and no outbound network access for the Neo4j process (a firewall rule, or a network without a default route).
- `dbms.security.procedures.allowlist` set to the list in `plugins/knowledge-base/skills/setup-operator/scripts/neo4j.env`.
- The full-text index `kb_fulltext`: created by the plugin before the first load; `SHOW FULLTEXT INDEXES` lists it afterwards. The analyzer named in the KB's manifest must be available (`CALL db.index.fulltext.listAvailableAnalyzers()`).
- In the project's `.claude/settings.local.json` `env`:
  - `KB_PATH`: absolute path of the KB root in the read-only clone `~/.kb/<kb id>/repo`
  - `NEO4J_SHELL`: `cypher-shell -a <bolt address>`
  - `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`
- In the same file's `permissions`: the deny rule `Read(/.claude/settings.local.json)`, and allow rules for the commands the skills run (the list in the setup skill, "Allow rules", with your `NEO4J_SHELL`); without them every query prompts.

## Development

```
bun install
bun test
claude plugin validate plugins/knowledge-base
```
