---
name: kb-answer-engine
description: "Use when a skill or seat already holds a question and needs it answered from the {{team}} Knowledge Base, citing the KB documents the answer rests on and saying so when the Knowledge Base is silent. Engine: the {{team}} Knowledge Base's answer route, reached through knowledge-base:access-orchestrator, which routes every {{team}} KB question here; answers through knowledge-base:answer-engine and changes nothing."
compatibility: Requires the knowledge-base plugin (install with `/plugin marketplace add constellation-academy/knowledge-base-skills`), set up for the {{team}} Knowledge Base with knowledge-base:setup-operator.
metadata:
  author: {{owner}}
  version: "1.0"
---

# {{team}} Knowledge Base Answers

Answers one question from the {{team}} Knowledge Base. Answering is `knowledge-base:answer-engine`'s job (contract: `contracts/knowledge-base.v1.md` of the `knowledge-base` plugin); this skill is the {{team}} layer around it and adds no rule of its own.

## Direct invocation

Requires from the caller:
- the question, in the requester's words

If you cannot supply it, use `knowledge-base:access-orchestrator`: it takes the request as stated.

## Steps

1. Invoke `Skill(skill: "knowledge-base:answer-engine")` with the question.
2. Return its result unchanged: the answer with its sources, the notice that the Knowledge Base is silent, or the notice that the answer needs the KB index.
