---
name: answer-engine
description: Use when a skill or seat already holds a question and needs it answered from the project's knowledge base (KB), with the KB documents the answer rests on cited by path. Engine: judges the KB's material and answers; changes nothing. Reached through knowledge-base:access-orchestrator or a KB's team answer skill, or called directly by any caller that supplies a question.
---

# Answer from the KB

Answers one question from the KB's documents and cites each document it uses. The KB is the only source: an answer never fills a gap from general knowledge, and a KB that says nothing on the question is reported as silent. Writes nothing.

## Direct invocation

Requires from the caller:
- the question, in the requester's words
- a project whose `KB_PATH` is set (`knowledge-base:setup-operator` sets it)

If you cannot supply these, use `knowledge-base:access-orchestrator`: it takes the request as stated.

## Steps

1. **Material.** Invoke `knowledge-base:content-provider` (Skill tool) with `explore: kb <question>`.
   - It returns one of the "Locate the KB" stop messages (`This project has no knowledge base …`, `KB_PATH …`): return that message and stop.
   - It returns `needs the KB index: run knowledge-base:setup-operator`: answer exactly `This answer needs the KB index: run knowledge-base:setup-operator.` and stop.
2. **Read.** Pick the hits whose title or excerpt bears on the question, at most 5, and fetch them in one call: `fetch: kb <path>, <path>, …`. Add a document a hit's links point to (`links out`, `superseded by`) when the hit's text depends on it. Never read KB files any other way.
3. **Judge.** From the fetched texts only:
   - A document with a `superseded by` link is outdated: answer from its newest successor and mention the old one only as replaced.
   - Documents that contradict each other: state both, with their paths, and say they conflict.
   - Nothing in the texts answers the question: the KB is silent.
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
| Reading the clone's files, the index or the MCP server directly | Go through `knowledge-base:content-provider` |
| Treating "needs the KB index" as an error or guessing an answer from the files | Return the one-line notice |
| Recording a new fact or fixing a document | Writes go through `knowledge-base:access-orchestrator`'s write route |
