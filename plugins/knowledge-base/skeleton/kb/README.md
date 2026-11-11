---
type: reference
title: {{team}} Knowledge Base
description: How this repository works — ground rules, layout, frontmatter contract, generated indexes, lint gate.
tags: [meta]
---

# {{team}} Knowledge Base

Git-backed **source of truth** for the knowledge of {{team}}: how we work, what we decided, and the words we use. This repository is private and authoritative. Article bodies, frontmatter and commit messages are in English.

## Ground rules

- **One fact, one place.** Every fact lives in exactly one article; other articles link to it. Before writing a sentence, check whether another article already states it, and link instead.
- **Plain, testable language.** State rules directly, as lists, with checks a reader can apply. A vague word such as "important" or "soon" carries the check that decides it, or it is cut.
- **Every change is a pull request.** Nobody pushes to `main`; see [Branches and commits](#branches-and-commits).

## Decisions

{{decider}} accepts decisions (ADRs<!-- section:pdr --> and PDRs<!-- /section:pdr -->), approves glossary changes and merges pull requests into this repository.

## Layout

| Path | Contents |
|------|----------|
| `index.md` | Root catalog. **Generated, never hand-edited** |
| `glossary.md` | Glossary: the team's shared terms, one file |
| `adr/` | Architecture Decision Records; how they work: [About ADRs](adr/about.md) |
<!-- section:pdr -->
| `pdr/` | Product Decision Records; how they work: [About PDRs](pdr/about.md) |
<!-- /section:pdr -->
<!-- section:process -->
| `process/` | How the team works: rules, checklists, procedures |
<!-- /section:process -->
<!-- section:reference -->
| `reference/` | Lookup and how-to pages |
<!-- /section:reference -->
<!-- section:primer -->
| `primer/` | The starting point for a new team member or agent |
<!-- /section:primer -->
| `templates/` | Templates for new articles and decisions |
| `scripts/` | Index generator, lint gate and export; tooling, not content |
| `kb-manifest.json` | Manifest for the `knowledge-base` plugin: export command, named resources, article types, pull request conventions |

Every section folder carries a generated `index.md`.

## Frontmatter contract

Every `.md` file except `index.md` starts with:

- `type`: one of `adr | pdr | process | reference | primer | template | glossary`
- `title`: human title
- `description`: one to two sentences, used verbatim in the catalogs
- `tags`: an inline array of lower-case words, e.g. `[onboarding, billing]`; reuse tags that already exist

ADRs<!-- section:pdr --> and PDRs<!-- /section:pdr --> additionally require `status` (`Proposed | Accepted | Superseded | Postponed`) and `date` (`YYYY-MM-DD`).

## Generated indexes

`index.md` at the root and in every section folder is derived from the articles' own frontmatter. After adding, removing or renaming an article, or changing its title or description, run:

```bash
bun scripts/generate-indexes.ts
```

## Branches and commits

A change lands through a pull request against `main`. Branch `docs/<short-description>`, commit subject and pull request title `docs(kb): <summary>`.

## Lint gate

```bash
bun scripts/lint-kb.ts
bun test scripts/
```

`lint-kb.ts` checks required fields, allowed `type` and `status` values, the `tags` shape, dead relative links, that no `index.md` carries frontmatter, and that every index matches a fresh generation. It must exit 0 before a pull request merges; the `Lint KB` workflow (`.github/workflows/lint-kb.yml`) runs it on every pull request and push to `main`.

`bun scripts/kb-pre-commit.ts` regenerates the indexes and then runs the lint gate; `kb-manifest.json` names it as the `pre_commit` command of a pull request written through the `knowledge-base` plugin.

## Local index

The `knowledge-base` plugin keeps a read-only clone of this repository and a local Neo4j index built from its export; run `knowledge-base:setup-operator` once per project to set it up. The Markdown files stay the only source of truth. The export reads every article from git at a commit, never from the working tree:

```bash
bun scripts/kb-export.ts --ref <rev> --out <file>
```
