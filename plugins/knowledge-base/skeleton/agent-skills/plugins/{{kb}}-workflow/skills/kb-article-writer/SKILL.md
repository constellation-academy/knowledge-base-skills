---
name: kb-article-writer
description: "Use when a document in the {{team}} Knowledge Base must be created or changed for an article type of its manifest, landing as a pull request on {{kb}}-knowledge-base. Writer: the {{team}} Knowledge Base's write route, reached through knowledge-base:access-orchestrator, which routes every {{team}} KB write here; composes the {{team}} frontmatter and body and hands the branch, commit and pull request to knowledge-base:article-writer. Also called directly by any caller that supplies its inputs."
compatibility: Requires the knowledge-base plugin 1.0.1 or later (install with `/plugin marketplace add constellation-academy/knowledge-base-skills`), set up for the {{team}} Knowledge Base with knowledge-base:setup-operator, and gh CLI authenticated.
metadata:
  author: {{owner}}
  version: "1.0"
---

# {{team}} Write KB Article

Creates or updates one document in the {{team}} Knowledge Base through a pull request. This skill composes the inputs: the frontmatter, the body and, for a decision record (ADR or PDR), its number. The worktree, branch, commit, the manifest's `pr.pre_commit` command and the pull request are `knowledge-base:article-writer`'s mechanics (contract: `contracts/knowledge-base.v1.md` of the `knowledge-base` plugin, section "Routes"). It never interviews.

## Every run starts by fetching the KB rules

Invoke `Skill(skill: "knowledge-base:access-orchestrator")` with `fetch: kb README.md, kb-manifest.json`. They own every rule this skill applies:

- `README.md`: its intro (the language of article bodies), **Frontmatter contract**, **Generated indexes**, **Lint gate**.
- `kb-manifest.json`: `article_types`, each with its `folder`, `template`, `required_frontmatter` and `file_name`.

The fetch fails or returns a stop message: return it and stop. Never write from memory. Every other KB file this skill reads comes through the same orchestrator with `fetch: kb <path>`.

## Inputs

As `knowledge-base:access-orchestrator` passes them, or from a caller:

- `type`: a key of the manifest's `article_types`
- `mode`: `create` or `update`
- `title`: human title; for `update`, absent keeps the current one
- `content`: the content as the requester stated it; for `create` the article's substance, for `update` the change to apply
- `path`: `update` only, the document's path relative to the KB root
- `folder`: `create` only, the folder relative to the KB root, ending in `/`, that the new document goes into
- `ticket`: when given
- `description`, `tags`: optional, as the **Frontmatter contract** defines them; derived from the content when absent
- `status`, `date`: ADR and PDR only, as the **Frontmatter contract** defines them; never inferred

A missing input is asked for once before anything is written; when this run is a seat and cannot ask, return `needs: <input names>` and stop. That holds for `path` on `update`, for `status` and `date` on an ADR or PDR `create`, and for `folder` when step 1 finds more than one fitting folder.

## Steps

### 1. Guards

- `type` is not a key of `article_types`: return `not an article type of the {{team}} Knowledge Base: <type>; types: <keys>` and stop.
- `type` is not one of the `type` values of the **Frontmatter contract**: return `article type <type> has no frontmatter type in the README; fix kb-manifest.json` and stop.
- `glossary` with `mode: create`: the glossary is one document; run it as `mode: update` of the type's document (its `folder` and `file_name` in the manifest), with the term as `content`.
- `mode: update`: fetch the document (`fetch: kb <path>`). `not found` → return it and stop.
- `mode: create`: settle the target folder. `folder` given: it is the target folder. Absent: take the folders of the README **Layout** table whose contents fit the article's subject; exactly one fits: it is the target folder, passed as `folder`; more than one: ask once which, or return `needs: folder` as a seat; none: the type's `folder` from the manifest, and `folder` stays unset.

### 2. Frontmatter

Compose the frontmatter as an object, keys in the order the **Frontmatter contract** lists them, holding every key of the type's `required_frontmatter`:

- `create`: `type` is the article type, `title` the title. `description` and `tags` take the given values, or are derived from the content as the contract defines them, with tags reused from existing articles of the target folder (its `index.md` names them; fetch it and the articles that fit) wherever one fits. ADRs and PDRs add `status` and `date` from the inputs.
- `update`: start from the document's current frontmatter, keep every key it has in its order, including keys this skill never writes, and change only the fields passed.

### 3. Body

- `create`: fetch the type's `template` (`fetch: kb <template>`) and compose the complete body from `content` under the template's headings, in their order and in the language the README's intro sets for article bodies. ADR or PDR `create`: fetch the `index.md` of the target folder, derive `{number}` from its file names as the contract's placeholder rules define it; this is `number`, and the body's first heading carries it as the template's heading form does.
- `update`: apply `content` to the fetched body and keep every other part of it; for `glossary`, merge the term at its place and leave every other term untouched. The result is the complete body.

Indexes are generated (**Generated indexes**): never compose an `index.md` and never pass one as a companion change. The manifest's `pr.pre_commit` regenerates and lints them.

### 4. Write through the generic writer

Invoke `Skill(skill: "knowledge-base:article-writer")` once with:

```
type: <type>
mode: <mode>
title: <title>     # when given
content: <the complete body from step 3>
frontmatter: <the object from step 2>
number: <number>   # ADR or PDR create only
folder: <folder>   # create only, when set in step 1
path: <path>       # update only
ticket: <ticket>   # when given
```

- It returns `needs: <inputs>`: return the same and stop.
- It returns `pre_commit failed` with **Lint gate** output naming the composed document (a missing field, a dead link, the tags shape): fix that in the frontmatter or body and invoke it once more. Output naming a `stale` index, or the same failure again: return the failure unchanged and stop.

### 5. Report

Return `knowledge-base:article-writer`'s report unchanged.

## Boundaries

- Never push to the default branch; every change is a pull request through `knowledge-base:article-writer`.
- Never edit a generated `index.md`.
- Never infer an ADR's or PDR's `status` or `date`.
