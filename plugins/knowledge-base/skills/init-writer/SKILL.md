---
name: init-writer
description: Use when a team wants to start its own knowledge base (KB) from nothing — "create a new knowledge base", "start a KB for our team", "our team has no KB yet", "fill our new KB repositories", "init the knowledge base" — including people who are not developers. Writer: fills two empty private GitHub repositories, the KB and the team's skills, with a skeleton and pushes one initial commit to each; never creates repositories. Connecting a project to a KB that already exists is knowledge-base:setup-operator.
---

# Start a new team knowledge base

Guides one person, often not a developer, from two empty GitHub repositories to a working KB skeleton:

- `<id>-knowledge-base`: README with the rules, glossary, decision records, templates, the KB's export, index and lint scripts, `kb-manifest.json`, and the `Lint KB` GitHub workflow.
- `<id>-agent-skills`: a private plugin marketplace with the plugin `<id>-workflow` and its three team skills `kb-provider`, `kb-article-writer`, `kb-answer-engine`, which the manifest routes to.

The skeletons and the render script are part of this plugin: `<plugin dir>/skeleton/` and `<plugin dir>/scripts/kb-init.ts`, where `<plugin dir>` is two folders above this skill's directory. The manifest format is the contract, `<plugin dir>/contracts/knowledge-base.v1.md`, section "Manifest".

## Rules

- **Talk plainly.** Every question says in one sentence why it is asked. Every technical word gets a one-line explanation the first time it appears. One question per message.
- **Ask, never assume.** Team name, the person who accepts decisions and the sections come from the user. The KB id and the GitHub owner come from the repository URLs, confirmed by the user. A value you did not get from the user or the URLs is not filled in: ask.
- **Both repositories are private.** A knowledge base holds internal knowledge. Nothing is pushed to a repository that is not private, whatever the user says; the person who created it makes it private.
- **The skill never creates, renames, deletes or changes the settings of a repository.** It only pushes the initial commit to two empty ones.
- **One push per repository, to `main`, only after every check in step 3 and step 6 passed.** A failed check stops the run before anything is pushed.

## 1. Prerequisites

Check each; for a missing one tell the user the one line in the table, wait until they say it is done, and check again.

| Check | Command | When it fails, tell the user |
|---|---|---|
| git | `git --version` | "Install git from https://git-scm.com/downloads, then tell me." |
| bun | `bun --version` | "Install bun from https://bun.sh, then tell me." |
| GitHub CLI | `gh --version` | "Install the GitHub command-line tool from https://cli.github.com, then tell me." |
| GitHub login | `gh auth status` | "Run `! gh auth login` here and follow the steps in the browser, then tell me." |
| git identity | `git config user.name` and `git config user.email` print values | Ask for their name and work e-mail, then `git config --global user.name "<name>"` and `git config --global user.email "<email>"` |

## 2. The two repositories

Ask: `Do you have two empty private GitHub repositories for this, named <something>-knowledge-base and <something>-agent-skills? I fill them; I never create repositories myself.`

- **No:** tell the user, then stop:

  ```
  Please ask a person with permission to create repositories in your GitHub organisation for two new, empty and PRIVATE repositories:
  - <id>-knowledge-base
  - <id>-agent-skills
  <id> is a 3-letter short name for your team, e.g. tka. They must be private because the knowledge base holds internal knowledge. Once both exist, run me again.
  ```

- **Yes:** ask for both URLs (the address shown on the repository's GitHub page). From them take `<owner>` (the organisation or account), `<id>` and the repository names. Stop with a message naming the problem when:
  - the two URLs have different owners;
  - the names are not `<id>-knowledge-base` and `<id>-agent-skills` with the same `<id>`;
  - `<id>` is not exactly 3 lower-case letters (`^[a-z]{3}$`): `The short name before -knowledge-base must be 3 lower-case letters, e.g. tka. Ask the person who created the repositories to rename them, then run me again.`

  Confirm with the user: `Your team's short name is <id> and both repositories belong to <owner>. Correct?`

## 3. Check the repositories

For each repository, before asking anything else:

| Check | Command | Must print |
|---|---|---|
| private | `gh repo view <owner>/<repo> --json visibility --jq .visibility` | `PRIVATE` |
| writable | `gh repo view <owner>/<repo> --json viewerPermission --jq .viewerPermission` | `ADMIN`, `MAINTAIN` or `WRITE` |
| empty | `git ls-remote <url>` | nothing |

Run all three checks on both repositories, then report every failure at once with the matching message and stop; nothing has been written:

- not private: `<repo> is not private. A knowledge base holds internal knowledge, so I only fill private repositories. Ask the person who created it to make it private (GitHub → Settings → Danger Zone → Change visibility), then run me again.`
- not writable, or `gh repo view` fails: `You cannot write to <repo> with your GitHub account. Ask the person who created it to give you write access, then run me again.`
- not empty: `<repo> already has content. I only fill empty repositories, so nothing is overwritten. Ask the person who created it for an empty one, or remove the content, then run me again.`

## 4. Interview

One question per message, each with the recommended answer:

1. **Team name**, as it should appear in titles, e.g. "Team Alpha". Why: it names the knowledge base and its skills. Allowed: letters, digits, spaces and `. - & '`. Check the answer when it comes; any other character: ask for a version without it before the next question.
2. **Who accepts decisions**: the person who approves architecture and product decisions and merges changes into the knowledge base, as a name or a role. Why: the README and the decision pages name them, so everyone knows who decides. Same allowed characters.
3. **Starting sections**, multiple choice; recommend `process` and `reference`:
   - `process`: how the team works (rules, checklists, procedures)
   - `reference`: lookup and how-to pages
   - `primer`: the starting point for a new team member or agent
   - `pdr`: product decision records, next to the architecture decision records (`adr`), which are always included along with the glossary and the templates

Repeat all answers back and ask for a yes before writing anything.

## 5. Render

`<home>` is the user's home folder. `<work>` is `<home>/.kb/.init`. Remove `<work>/<id>-knowledge-base` and `<work>/<id>-agent-skills` if they exist from an earlier, unfinished run, then:

```
bun "<plugin dir>/scripts/kb-init.ts" --kb <id> --team "<team>" --owner <owner> --decider "<decider>" --sections <comma-separated sections, empty for none> --kb-out "<work>/<id>-knowledge-base" --skills-out "<work>/<id>-agent-skills"
```

Exit 2: the error lines name the invalid value; ask the user for that value again and rerun. Any other failure: report the output and stop.

## 6. Check the result

In `<work>/<id>-knowledge-base`:

1. `git init -q -b main`, `git add -A`, `git commit -q -m "docs(kb): initial knowledge base skeleton"`
2. `bun scripts/lint-kb.ts` exits 0 and prints nothing.
3. `bun test scripts/` exits 0.
4. `bun scripts/kb-export.ts --ref HEAD --out "<work>/<id>-export.json"` exits 0, and the file's `kb` is `<id>` and its `docs` has at least 3 entries. Delete the file afterwards.

In `<work>/<id>-agent-skills`:

5. `git init -q -b main`, `git add -A`, `git commit -q -m "feat: initial team skills for the <team> knowledge base"`
6. `claude plugin validate plugins/<id>-workflow` and `claude plugin validate .` both exit 0. A missing-license or missing-icon note is expected for a private team marketplace and is not a failure.

Any failure: report the command and its output, push nothing, and stop. A failure here is a defect in this plugin, not the user's doing; say so.

## 7. Push

Run step 3's three checks again for both repositories; they must still pass. Then in each folder:

```
git remote add origin <url>
git push -u origin main
```

A push fails: report the output and stop; the other repository is not pushed if it was not yet. After both pushes succeed, remove both folders under `<work>`.

## 8. Report

Tell the user, in plain words:

```
Your knowledge base is set up:
- Knowledge base: <KB URL> — the rules (README), glossary, decision records, templates and an automatic check that runs on every change.
- Team skills: <skills URL> — lets Claude read, write and answer from your knowledge base.

From now on every change goes through a pull request; <decider> merges them.

Next, in Claude Code, in the project that should use the knowledge base:
1. /plugin marketplace add <owner>/<id>-agent-skills
2. /plugin install <id>-workflow@<id>-agent-skills --scope project
3. /plugin install knowledge-base@knowledge-base-skills --scope project (skip if installed)
4. /reload-plugins
5. Ask me to "set up the knowledge base" and give me <KB URL>. That step needs Docker running.
```

## Common mistakes

| Mistake | Instead |
|---|---|
| Assuming the GitHub owner, the decider or the sections | Owner from the URLs, confirmed; decider and sections asked |
| "The user said it is private" | Only `gh repo view … visibility` printing `PRIVATE` counts |
| Creating a missing repository with `gh repo create` | Stop and tell the user who creates it |
| Pushing one repository when the other failed a check | All checks for both first, then push |
| Writing files by hand instead of running `kb-init.ts` | The script renders both trees and the manifest consistently |
| Opening a pull request for the first commit | An empty repository has no base; the initial commit goes to `main` |
