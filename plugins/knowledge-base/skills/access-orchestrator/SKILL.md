---
name: access-orchestrator
description: Use when a person or a skill reads from, writes to or asks a question of the project's knowledge base (KB) — "what does X mean", "what did we decide on X", "check the glossary", "show the KB catalog", "look it up in the knowledge base", "fetch: kb <resources>", "explore: kb <question>", "record this term", "record this decision", "add or update a KB article". Orchestrator: the entry point for every KB access; routes each request to the KB's team skill or the plugin's generic read, write or answer skill, never to another project's KB.
---

# KB access

Routes one request to exactly one of three routes, read, write or answer, and returns that route's result unchanged. Contributes no work product of its own: it reads only the manifest and never reads documents, the index or the MCP server.

## 1. Find the KB

1. Follow "Locate the KB" in `../update-operator/runtime.md`, relative to this skill's directory. It reads `KB_PATH` and the manifest from the read-only clone.
   - It stops because `KB_PATH` is unset, or because `KB_PATH` or its `kb-manifest.json` does not exist: the project has **no KB**. Skip steps 2 and 3, pick the route (section 2), and continue at "No KB" in section 3.
   - It stops for any other reason: reply with its message and stop.
2. The manifest's `contract` is not `"1"`: reply `The knowledge base <kb> follows contract <contract>; this knowledge-base plugin implements contract 1. Install a plugin version for contract <contract>.` and stop. Route nothing.
3. The request names a KB other than the manifest's `kb` (by id, project or repository): reply `This project can only reach the knowledge base <kb>.` and stop.

## 2. Pick the route

| Route | The request | Examples |
|---|---|---|
| read | wants KB content itself: named resources or documents, or material for a question | `fetch: kb glossary`, `explore: kb <question>`, "show the catalog", "open the decision on caching", "list our guides" |
| answer | asks a question to be answered | "what does X mean", "what did we decide on X", "why do we do X", "is there a rule for X" |
| write | explicitly asks to create or change a document | "record this term", "record this decision", "add an article on X", "update the guide on X", "fix the typo in X" |

- A request that starts with `fetch: kb` or `explore: kb` is read, always.
- A question is never a write. A write needs an explicit ask to record, add, change or fix.
- Fits more than one route, or none: ask exactly one question, phrased as the requester's goal (e.g. "Do you want the answer to what X means, or the full glossary?"), and route by the reply. Never ask which route or skill to use.

## 3. Pick the skill

**No KB**: the read route goes to the one skill in the session's skill list named `<plugin>:kb-provider` (any plugin): a team read skill may serve resources from other sources. None, or the request comes from that `kb-provider` itself: reply `This project has no knowledge base. Run knowledge-base:setup-operator.` and stop; a read is never routed back to the skill that sent it, and never to this skill. Several: ask one question naming them. Write and answer: reply `Writing to and answering from the knowledge base need the KB in this project. Run knowledge-base:setup-operator.` and stop.

**With a KB**, look up the route in the manifest's `skills`:

| Route | Manifest entry | Without the entry |
|---|---|---|
| read | `skills.read` | `knowledge-base:content-provider` |
| answer | `skills.answer` | `knowledge-base:answer-engine` |
| write | `skills.write`: one skill, or a map keyed by article type | `knowledge-base:article-writer` |

- A `write` map: determine the article type (a key of `article_types`) from the request; the type's key in the map, else `*`, else the generic writer. The type is unclear and the map has a key other than `*`: ask one question naming the types.
- The named skill is not in the session's skill list: reply `The knowledge base <kb> routes <route> to <skill>, which is not installed. Install the plugin <plugin part of the name>.` and stop. Never swap in the generic skill for a team skill the manifest names.

## 4. Run the route

| Route | Seat | Input to the skill |
|---|---|---|
| read | inline: invoke the skill with the Skill tool | `fetch: kb <resource names or paths>` for named content, else `explore: kb <the request>` |
| answer | one agent | the question, in the requester's words |
| write | one agent | `type`, `mode` (`create` or `update`), `title`, the content as the requester stated it, `path` for an update, `ticket` when given |

A read passes resource names through unchanged, also a name the manifest's `resources` does not list: the read skill owns aliases and sources outside the KB, and reports a name it does not know. The write input lists what a requester gives; team writers add the generic writer's further inputs (the contract's section "Routes").

**One agent** means one Agent-tool call, in the foreground, whose prompt holds only: the skill to invoke, its input from the table, and "return the skill's result unchanged". When the Agent tool is not available because this run is itself a seat, invoke the skill inline instead: the current agent is the seat.

A write seat that returns `needs: <inputs>`: ask the requester for them in one question, then dispatch a fresh seat with the same input plus the answers.

Return the skill's result unchanged: the content, the answer, or the pull request link.

## Common mistakes

| Mistake | Instead |
|---|---|
| Answering or writing in this context | Answer and write each run in one agent |
| Reading KB files, the index or the MCP server to help | Read only the manifest; the route's skill does the rest |
| Routing a question to write, or writing without an explicit ask | A question is an answer or a read |
| Falling back to the generic skill when the manifest's team skill is missing | Say which plugin to install and stop |
| Serving a KB other than the one `KB_PATH` points to | Refuse; one project, one KB |
| Routing a manifest of another contract major | Refuse before routing |
