---
name: content-provider
description: Use when a skill needs named resources or documents from the project's knowledge base (KB), or ranked KB material (hits, excerpts, links) for a question without an answer. Provider: reads the KB's read-only clone and local Neo4j index, no judgment. Signature `fetch: kb <resource names or document paths>` or `explore: kb <question>`. Reached through knowledge-base:access-orchestrator or a KB's team read skill, or called directly by any caller that can satisfy it.
---

# Read the KB

## Signature

`fetch: kb <resource names or document paths>` | `explore: kb <question>`

- `fetch` takes a comma-separated list. An item without `/` and `.` is a resource name from the manifest's `resources`; any other item is a document path relative to the KB root (an assembled document's path ends in `/`).
- `explore` takes one question in plain text.

Returns the KB's content, never an answer. Answering is `knowledge-base:answer-engine`'s job.

Mechanics (locating the KB, names such as `<KB root>` and `<queries>`, running a query, reading its output) are in `../update-operator/runtime.md`, relative to this skill's directory. Follow them exactly. When a command is denied or fails, follow "Denied or failed commands" there.

## 1. Update first

Invoke `knowledge-base:update-operator` (Skill tool). Its report says `index: current`, `loaded` or `unavailable — <reason>`.

- It returned one of the "Locate the KB" stop messages (`This project has no knowledge base …`, `KB_PATH …`) instead of a report: return that message and stop.
- `current` or `loaded`: the index is available.
- `unavailable`: the index is unavailable. Start the output with one line, `Note: KB index unavailable (<reason>); read from the clone's files.`, and never fail the caller for it.

Then read the manifest at `<KB root>/kb-manifest.json`.

## 2. fetch

Resolve each item to an ordered list of documents. Paths are relative to `<KB root>`; read each document's file with the file tools and return its full text, frontmatter included.

Resolution is fixed by the contract's section "Resolution" (`../../contracts/knowledge-base.v1.md`, relative to this skill's directory): its table, its rules and its error messages. Follow its "Index available" column when the index is available and its "Index unavailable" column otherwise.

Output:

```
KB <kb> at <first 7 characters of commit>

## <item>
### <path>
<file text>
### <path>
<file text>
```

## 3. explore

Index unavailable: return `explore: <question>` and the line `needs the KB index: run knowledge-base:setup-operator`, and stop. Exploration has no file fallback.

Index available:

1. **Hits.** Up to 10 documents for the question.
   - If the session has tools of the MCP server `kb-<kb>` (`mcp__kb-<kb>__…`): read `<queries>/search.cypher` and run its text with the server's read-Cypher tool, parameters `kb` = `<kb>`, `query` = the question, `limit` = 10. Values go only in the parameters, never into the query text.
   - Otherwise, or if that call fails: run the query `search` with the same parameters.
   - No hits: run it once more with only the question's content words (no question words, articles or punctuation). Still none: the material is empty.
2. **Links.** For the top 5 hits:
   - With the MCP server: one read query through it (the store guard already ran in the search step, which every hit comes from), parameters `kb` and `paths` (the hit paths):

     ```
     MATCH (d:Doc {kb: $kb}) WHERE d.path IN $paths
     RETURN d.path AS path, d.type AS type, d.status AS status, d.tags AS tags,
       [(d)-[:REFERENCES]->(o:Doc {kb: $kb}) | o.path] AS links_out,
       [(d)<-[:REFERENCES]-(o:Doc {kb: $kb}) | o.path] AS links_in,
       [(d)-[:SUPERSEDES]->(o:Doc {kb: $kb}) | o.path] AS supersedes,
       [(d)<-[:SUPERSEDES]-(o:Doc {kb: $kb}) | o.path] AS superseded_by
     ```

     Further read queries the question needs (by type, status or tag) are allowed; each matches only `Doc {kb: $kb}` and never returns more than a 200-character excerpt of `body`.
   - Without it: the queries `related` and `supersede-chain` with `path` per hit. `related` rows give links out (`direction` `out`) and links in (`in`). `supersede-chain` gives the hit's own type and status (its row with `distance` 0), what it supersedes (positive `distance`) and what supersedes it (negative `distance`).
3. Return the material in score order, without judging it. The first line is the header below, written exactly, with `MCP kb-<kb>` when the hits came through the MCP server and `fixed queries` otherwise: callers check it to see which source answered.

```
KB <kb> at <first 7 characters of commit>; explore via <MCP kb-<kb> | fixed queries>

## explore: <question>
1. <path> — <title>[ (<type>, <status>)], score <score>
   excerpt: <excerpt>
   links out: <paths>; links in: <paths>
   supersedes: <paths>; superseded by: <paths>
2. …
```

Type and status come from the links step, so only the top 5 hits carry them. Leave out a line whose lists are all empty. Empty material: `No documents match.` under the heading. The caller fetches full texts with `fetch: kb <paths>`.

## Common mistakes

| Mistake | Instead |
|---|---|
| Reading a working checkout or the project's own files | Only `<KB root>` in the read-only clone |
| Taking a document's text from the index | Text comes from the clone's files; the index gives paths, order and links |
| Answering the question or dropping hits as irrelevant | Return all hits in score order; `answer-engine` judges |
| Failing or retrying because the index is unavailable | Say so once and read the files; explore reports that it needs the KB index |
| Writing through the MCP server or querying without `kb` | Read queries only, each bound to `Doc {kb: $kb}` |
