# {{team}} Agent Skills

Agent skills for {{team}}, as a private Claude Code plugin marketplace. It holds the team skills of the {{team}} Knowledge Base (`{{owner}}/{{kb}}-knowledge-base`).

## Plugins

| Plugin | Skills | Use |
|--------|--------|-----|
| **{{kb}}-workflow** | `kb-provider`, `kb-article-writer`, `kb-answer-engine` | The {{team}} Knowledge Base's read, write and answer routes |

The three `kb-*` skills are the {{team}} layer over the `knowledge-base` plugin. The Knowledge Base's manifest routes each request to them, so people and skills reach them through `knowledge-base:access-orchestrator`:

| Skill | Role | Wraps |
|-------|------|-------|
| `kb-provider` | read: `fetch: kb …` and `explore: kb …` | `knowledge-base:content-provider` |
| `kb-article-writer` | write: one article as a pull request on `{{kb}}-knowledge-base` | `knowledge-base:article-writer` |
| `kb-answer-engine` | answer: a question with cited KB documents | `knowledge-base:answer-engine` |

## Install — Claude Code

Both repositories are private: you need read access to them on GitHub, and `gh auth login` done once on your machine. In Claude Code, in the project that should use the Knowledge Base:

```bash
/plugin marketplace add constellation-academy/knowledge-base-skills
/plugin marketplace add {{owner}}/{{kb}}-agent-skills
/plugin install knowledge-base@knowledge-base-skills --scope project
/plugin install {{kb}}-workflow@{{kb}}-agent-skills --scope project
```

Run `/reload-plugins`, then run `knowledge-base:setup-operator` once in that project. Give it the URL of `{{owner}}/{{kb}}-knowledge-base`: it clones the Knowledge Base read-only, starts its local index and connects the project.

A private marketplace does not update by itself: `/plugin` → **Marketplaces** → `{{kb}}-agent-skills` → **Enable auto-update**.

## Maintenance

Edit `plugins/{{kb}}-workflow/skills/<name>/SKILL.md`. Every change lands through a pull request against `main` and raises the version in `plugins/{{kb}}-workflow/.claude-plugin/plugin.json`; only that version makes installed copies update. Validate before pushing:

```bash
claude plugin validate plugins/{{kb}}-workflow
claude plugin validate .
```
