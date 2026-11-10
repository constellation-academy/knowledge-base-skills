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

Without Docker or Neo4j, reads work from the read-only clone; exploring and answering need the KB index.

## Install

In Claude Code:

```
/plugin marketplace add constellation-academy/knowledge-base-skills
/plugin install knowledge-base@knowledge-base-skills
```

Install it next to your team's plugin. Then run `knowledge-base:setup-operator` once in the project that uses the KB.

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
