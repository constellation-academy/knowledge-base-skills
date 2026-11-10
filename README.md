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

Without Docker or Neo4j, reads work from the read-only clone; exploring and answering need the KB index.

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
- the Docker network `kb-<kb id>` and the container `neo4j-<kb id>` (`neo4j:2026.06.0` with APOC, ports on `127.0.0.1`, `--restart unless-stopped`);
- the MCP server `kb-<kb id>` in the project's local scope: `mcp/neo4j-cypher@sha256:b252997d16d37633a5a1b30e21ac0bf368b1c64e5895e4005313c84d77a05310` with `--read-only`, on the network `kb-<kb id>`;
- the project's `.claude/settings.local.json`: the env keys of the contract, a generated Neo4j password, a deny rule that keeps sessions from reading that file, and allow rules for the commands the skills run to read, query and index the KB. The setup never reads the file itself: a script in a throwaway container merges its changes and prints no secret.

It needs git, the Claude Code CLI and Docker. Without Docker it sets up the clone only and lists the settings to add by hand: reads work from the files, exploring and answering need the index. An existing container or setting is reused; a container that lacks APOC or the import folder is recreated on the same data only after you confirm; the question names the image change, the ports and mounts kept, and the env keys carried over or dropped.

Not pre-allowed, so they prompt unless your own permission mode, rules or hooks allow them: the KB's export command (once per reindex), `pr.pre_commit`, the writer's git commands (worktree, commit, push) and the pull request call (`gh api …`, `az repos pr create …`). Each of them could be widened into a prompt-free file read, file write or program run.

Accepted risk: the allow rules let a session write a `.cypher` file into `~/.kb/<kb id>/import/queries/` and run it with `cypher-shell`, so any Cypher, APOC calls included, can run against the KB's own local store without a prompt; that store holds only the rebuildable index. The same `cypher-shell` rule admits further arguments, so an inserted `-a <host>` would send that store's Neo4j user and password to another host. The store listens on `127.0.0.1` only.

## Local Neo4j without Docker

The setup supports Neo4j in Docker. For a Neo4j you run yourself, one instance per KB, configure:

- Neo4j `2026.06.0` with the APOC plugin installed; `CALL apoc.version()` returns a version.
- `apoc.import.file.enabled=true` in `apoc.conf`.
- The import directory (`server.directories.import`) set to the KB's import folder `~/.kb/<kb id>/import`, as an absolute path.
- The Bolt connector listening on `127.0.0.1` only.
- The full-text index `kb_fulltext`: created by the plugin before the first load; `SHOW FULLTEXT INDEXES` lists it afterwards. The analyzer named in the KB's manifest must be available (`CALL db.index.fulltext.listAvailableAnalyzers()`).
- In the project's `.claude/settings.local.json` `env`:
  - `KB_PATH`: absolute path of the KB root in the read-only clone `~/.kb/<kb id>/repo`
  - `NEO4J_SHELL`: `cypher-shell -a <bolt address>`
  - `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`

## Development

```
bun install
bun test
claude plugin validate plugins/knowledge-base
```
