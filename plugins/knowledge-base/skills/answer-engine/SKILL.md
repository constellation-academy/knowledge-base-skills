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

1. **Material.** Invoke `knowledge-base:content-provider` (Skill tool) with `explore: kb <question>`; it searches with the question's subject words.
   - It returns one of the "Locate the KB" stop messages (`This project has no knowledge base …`, `KB_PATH …`): return that message and stop.
   - It returns a line starting with `needs the KB index`: answer exactly `This answer needs the KB index (<reason>).`, with the reason from that line, and stop.
2. **Read.** No hits: nothing is fetched; go to step 3. Otherwise take the top 3 hits by score (all of them when there are fewer), and add up to 2 further hits whose title or excerpt mentions the question's subject. The top hits are read whatever their excerpts say: an excerpt shows only a document's first 200 characters, and the subject often comes later. Fetch them in one call: `fetch: kb <path>, <path>, …`. Then, when a fetched text depends on a document its hit links to (`links out`, `superseded by`), fetch those in one more call, at most 3. Never read KB files any other way.
3. **Judge.** From the fetched texts only:
   - A document with a `superseded by` link is outdated: answer from its newest successor and mention the old one only as replaced.
   - Documents that contradict each other: state both, with their paths, and say they conflict.
   - No fetched text says anything about the question's subject, and this is the first pass: run steps 1 to 3 once more with `explore: kb <the question's subject words and their other word forms>` (`cache caching cached`), fetching only documents not fetched yet. Still nothing: the KB is silent. Never call it silent from titles and excerpts alone.
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
| Picking hits by their excerpts alone, or reporting a silent KB because no excerpt mentions the subject | Always fetch the top 3 hits by score, judge their texts, and search once more with other word forms before calling the KB silent |
| Reading the clone's files, the index or the MCP server directly | Go through `knowledge-base:content-provider` |
| Treating "needs the KB index" as an error or guessing an answer from the files | Return the one-line notice |
| Recording a new fact or fixing a document | Writes go through `knowledge-base:access-orchestrator`'s write route |
