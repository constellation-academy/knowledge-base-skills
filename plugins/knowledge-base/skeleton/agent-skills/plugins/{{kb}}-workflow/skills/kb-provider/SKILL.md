---
name: kb-provider
description: "Use when a skill needs named resources or documents from the {{team}} Knowledge Base, or ranked {{team}} Knowledge Base material for a question without an answer. Provider: the {{team}} Knowledge Base's read route, reached through knowledge-base:access-orchestrator, which routes every {{team}} KB read here; reads through knowledge-base:content-provider, no judgment. Signature: `fetch: kb <resource names or document paths>` or `explore: kb <question>`. Also called directly by any caller that can satisfy it."
compatibility: Requires the knowledge-base plugin (install with `/plugin marketplace add constellation-academy/knowledge-base-skills`), set up for the {{team}} Knowledge Base with knowledge-base:setup-operator.
metadata:
  author: {{owner}}
  version: "1.0"
---

# {{team}} Knowledge Base Loader

## Signature

`fetch: kb <resource names or document paths>` | `explore: kb <question>`

`fetch` takes a comma-separated list of resource names from the {{team}} Knowledge Base's `kb-manifest.json` or KB document paths. `explore` takes one question and returns ranked KB material, never an answer. Reached through `knowledge-base:access-orchestrator`, or called directly by any caller that can satisfy this signature.

Reading the KB is `knowledge-base:content-provider`'s job (contract: `contracts/knowledge-base.v1.md` of the `knowledge-base` plugin). The {{team}} Knowledge Base has no aliases and no source outside the KB, so this skill adds nothing to the read.

## Steps

1. Invoke `Skill(skill: "knowledge-base:content-provider")` with the request exactly as received.
2. Return its output unchanged, including a stop message such as `This project has no knowledge base …`. Never route the request to `knowledge-base:access-orchestrator`: it routes {{team}} reads here.
