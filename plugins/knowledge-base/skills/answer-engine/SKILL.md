---
name: answer-engine
description: Use when a skill or seat already holds a question and needs it answered from the project's knowledge base (KB), with the KB documents the answer rests on cited by path. Engine: judges the KB's material and answers; changes nothing. Reached through knowledge-base:access-orchestrator or a KB's team answer skill, or called directly by any caller that supplies a question.
---

# Answer from the KB

Answers one question from the KB's documents and cites each document it uses. When a command is denied or fails, follow "Denied or failed commands" in `../update-operator/runtime.md`, relative to this skill's directory. The KB is the only source: an answer never fills a gap from general knowledge, and a KB that says nothing on the question is reported as silent. Writes nothing.

## Direct invocation

Requires from the caller:
- the question, in the requester's words
- a project whose `KB_PATH` is set (`knowledge-base:setup-operator` sets it)

If you cannot supply these, use `knowledge-base:access-orchestrator`: it takes the request as stated.

## Steps

1. **Material.** `<terms>` are the question's subject words: drop question words, words about asking or about the KB itself (`what`, `does`, `say`, `tell`, `KB`, `knowledge base`, `documents`), articles and punctuation. "What does the KB say about caching?" gives `caching`. Invoke `knowledge-base:content-provider` (Skill tool) with `explore: kb <terms>`: the full-text search ranks by every word it gets, so the other words would push the documents on the subject down.
   - It returns one of the "Locate the KB" stop messages (`This project has no knowledge base …`, `KB_PATH …`): return that message and stop.
   - It returns a line starting with `needs the KB index`: answer exactly `This answer needs the KB index (<reason>).`, with the reason from that line, and stop.
2. **Read.** Pick the hits whose title or excerpt bears on the question, at most 5. None does: take the top 3 hits by score, since an excerpt shows only a document's first 200 characters and the subject often comes later. Fetch them in one call: `fetch: kb <path>, <path>, …`. Add a document a hit's links point to (`links out`, `superseded by`) when the hit's text depends on it. Never read KB files any other way.
3. **Judge.** From the fetched texts only:
   - A document with a `superseded by` link is outdated: answer from its newest successor and mention the old one only as replaced.
   - Documents that contradict each other: state both, with their paths, and say they conflict.
   - Nothing in the fetched texts answers the question: the KB is silent. Never call it silent from titles and excerpts alone.
4. **Answer** in this shape:

```
<the answer, one to a few sentences>

Sources:
- <path> — <title>
```

Silent KB:

```
The knowledge base says nothing on <the question's subject>.

Closest documents:
- <path> — <title>
```

Leave out "Closest documents" when explore found no hits. Every path is relative to the KB root, as content-provider returned it.

## Common mistakes

| Mistake | Instead |
|---|---|
| Answering from general knowledge when the KB is silent | Say the KB is silent and list the closest documents |
| Citing a document that was not fetched in this run | Cite only fetched texts |
| Exploring with the whole question | Explore with `<terms>`, the subject words |
| Reporting a silent KB because no excerpt mentions the subject | Fetch the top hits and judge their texts |
| Reading the clone's files, the index or the MCP server directly | Go through `knowledge-base:content-provider` |
| Treating "needs the KB index" as an error or guessing an answer from the files | Return the one-line notice |
| Recording a new fact or fixing a document | Writes go through `knowledge-base:access-orchestrator`'s write route |
