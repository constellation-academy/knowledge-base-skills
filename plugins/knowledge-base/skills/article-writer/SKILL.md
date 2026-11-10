---
name: article-writer
description: Use when a document in the project's knowledge base (KB) must be created or changed and land as a pull request on the KB's repository, for any article type the KB's manifest lists. Writer: changes the KB repository through a branch and pull request, never its default branch. Reached through knowledge-base:access-orchestrator or a KB's team writer, or called directly by any caller that supplies its inputs.
---

# Write a KB article

Creates or updates one document in a fresh worktree from the read-only clone and opens a pull request against `<default>`. The clone's own checkout is never touched, and nothing is merged.

Mechanics (locating the KB, shell rules, the names `<kb>`, `<default>`, `<clone>`, `<kb folder>`) are in `../update-operator/runtime.md`, relative to this skill's directory. Follow them exactly. The manifest fields and placeholder rules are in the contract, `contracts/knowledge-base.v1.md` at the plugin root, section "Manifest".

## Inputs

The contract's section "Routes" lists the same inputs for team writers.

- `type`: a key of the manifest's `article_types`
- `mode`: `create` or `update`
- `title`: for `update`, absent means the document's current frontmatter `title`, read from the clone
- `content`: the document's text, or for `update` the change to make, as the requester stated it
- `path`: `update` only, the document's path relative to the KB root; absent means the one document in the type's `folder` whose frontmatter `title` matches the request, found in the clone
- `ticket`: when a pattern contains `{ticket}`
- values for required frontmatter keys, where the requester gave them
- Optional, mostly from team writers:
  - `frontmatter`: an object holding the document's complete frontmatter, composed by the caller. It is written as given, keys in the given order; it must hold every key of `required_frontmatter`.
  - `number`: `create` only, the `{number}` value, digits only; absent means derived per the contract.
  - `slug`: `create` only, the `{slug}` value, matching `^[a-z0-9]+(-[a-z0-9]+)*$`; absent means derived from `title` per the contract.
  - `companion_changes`: a list of `{path, content}`: further files written in the same worktree and committed with the document, such as an index entry. `path` is relative to the KB root and `content` is the file's complete new text.
  - `commit_body`: one to three lines, appended to the commit message after a blank line.
  - `pr_body`: the complete pull request description; it replaces the template and the default description.

**A missing input** is asked for once, before anything is written. When you cannot ask (you run as a seat), return `needs: <input names>` and stop. Ask for `ticket` when `pr.branch_pattern`, the `pr.commit_pattern` entry this change uses, or `pr.title_pattern` contains `{ticket}`.

**An invalid input** stops the run before anything is written, with `invalid <input>: <reason>`:
- `frontmatter` lacks a key of `required_frontmatter`, or is not an object.
- `number` or `slug` does not match its form, or is given for `update`.
- A `companion_changes` path is absolute, contains a `..` segment or a backslash, or resolves to the document's own path; or a path appears twice.
- `commit_body` has more than three lines.

## Steps

### 1. Prepare

1. Follow "Locate the KB" in `runtime.md`; if it stops, return its message.
2. Invoke `knowledge-base:update-operator` (Skill tool), so `origin/<default>` is current. Its `index` line does not matter here.
3. Look up `type` in `article_types`: `folder`, `template`, `required_frontmatter`, `file_name` (absent: `{slug}.md`). An unknown type: return `not an article type of KB <kb>: <type>; types: <keys>` and stop.
4. Render the placeholders per the contract: `{slug}` from the `slug` input or else from `title`, `{summary}` as one short line describing the change, `{ticket}` from the input.
   - Branch: `pr.branch_pattern`. It must match `^[A-Za-z0-9._/-]+$` and pass `git -C "<clone>" check-ref-format --branch "<branch>"`; otherwise ask for a ticket id or title that gives a valid branch name.
   - Commit subject: `pr.commit_pattern`, or its `add` entry for `create` and `update` entry for `update`. The commit message is the subject, followed by a blank line and `commit_body` when given.
   - Pull request title: `pr.title_pattern`, or the commit subject when absent.
5. Settle the frontmatter now, from the clone (read only):
   - `frontmatter` given: it is the frontmatter, as given.
   - Otherwise, for `create`, read the `template` file at `<KB root>/<template>` and give every key of `required_frontmatter` a value: `type` is the article type, `title` the title, a key the requester gave a value for takes that value, and a key that only describes the document's own content (such as a description or tags) is derived from `content`. Any other key without a value is a missing input. For `update`, the same holds for a required key the document lacks.
6. Validate the inputs (see "An invalid input"). The document's own path is known here for `update`; for `create` it is checked again in step 3.
7. `git -C "<clone>" ls-remote --heads origin "<branch>"` prints a line: the branch already exists on the remote. Return `branch <branch> already exists on origin` and stop; never reuse or overwrite it.
8. `git -C "<clone>" rev-parse --verify --quiet "refs/heads/<branch>"` succeeds, or `<worktree>` (step 2) exists: an earlier run left this branch or worktree behind after a failed push. Return `an earlier run left <branch> in <worktree>; push it or remove it, then run again` and stop; never delete it unasked.

### 2. Worktree

`<name>` is the branch with every `/` replaced by `-`. `<worktree>` is `<kb folder>/worktrees/<name>`; the writer's own message files go next to it, as `<kb folder>/worktrees/<name>.<file>`, never inside it.

```
git -C "<clone>" worktree add -b "<branch>" "<worktree>" origin/<default>
```

From here on, the KB root is `<worktree>/<kb_root>` (the manifest's `kb_root`; `.` is `<worktree>` itself). Every file is read and written there, never in `<clone>`.

### 3. Write the files

**create**
1. `{number}`, when `file_name` has it: the `number` input, else per the contract from the existing file names in `folder` of the worktree (Glob tool).
2. The target is `<KB root>/<folder><rendered file_name>`. It exists already: return `<path> already exists; use mode update` and stop (after step 5's cleanup). A `companion_changes` path equal to it: `invalid companion_changes: <path> is the document itself`, stop (after step 5's cleanup).
3. Start from the worktree's `template` file and write the frontmatter settled in step 1.
4. Fill the template's body from `content`, keeping its headings and order. Write the file with the file tools.

**update**
1. The target is `<KB root>/<path>`. It does not exist: return `not found: <path>` and stop (after step 5's cleanup).
2. Read it and apply the change. With a `frontmatter` input, write that frontmatter; otherwise keep every frontmatter key it has and add any required key settled in step 1. Write it back.

**companion_changes**: write each `content` to `<KB root>/<path>` with the file tools, creating or replacing the file.

### 4. Check, commit, push, pull request

1. The manifest has `pr.pre_commit`: run it in the worktree root as `cd "<worktree>"; <pre_commit>`, allowing up to 10 minutes. It exits non-zero: return `pre_commit failed: <pre_commit>` followed by its output, run step 5's cleanup, and stop. Files it changes are not committed unless they are the document or a `companion_changes` path.
2. Write the commit message to `<kb folder>/worktrees/<name>.commit-message` with the file tools, then:

   ```
   git -C "<worktree>" add -- "<document path relative to <worktree>>" "<each companion path relative to <worktree>>"
   git -C "<worktree>" commit --quiet --file "<kb folder>/worktrees/<name>.commit-message"
   git -C "<worktree>" push --quiet -u origin "<branch>"
   ```

3. The pull request description: `pr_body` when given; else the manifest's `pr.template` (relative to the KB root) filled in for this change; else `Adds <path>: <summary>` or `Updates <path>: <summary>`. It carries no AI attribution.
4. Read the remote with `git -C "<clone>" remote get-url origin`, and open the pull request by `pr.host`:

**github**: `<host>`, `<owner>` and `<repo>` come from the remote URL (`https://<host>/<owner>/<repo>.git` or `git@<host>:<owner>/<repo>.git`). Write `<kb folder>/worktrees/<name>.pull-request.json` as `{"title": …, "head": "<branch>", "base": "<default>", "body": …}`, then:

```
gh api --hostname <host> --method POST repos/<owner>/<repo>/pulls --input "<kb folder>/worktrees/<name>.pull-request.json" --jq .html_url
```

**azure-devops**: `<org>`, `<project>` and `<repo>` come from the remote URL (`https://dev.azure.com/<org>/<project>/_git/<repo>`, `https://<org>@dev.azure.com/<org>/<project>/_git/<repo>`, `git@ssh.dev.azure.com:v3/<org>/<project>/<repo>` or `https://<org>.visualstudio.com/<project>/_git/<repo>`), URL-decoded for the command; the links below use them URL-encoded. A `<project>` or `<repo>` containing `'` skips `az` and goes to the fallback. Write the title to `<kb folder>/worktrees/<name>.pr-title` and the description to `<kb folder>/worktrees/<name>.pr-description`, then:

```
az repos pr create --org https://dev.azure.com/<org> --project '<project>' --repository '<repo>' --source-branch '<branch>' --target-branch '<default>' --title '@<kb folder>/worktrees/<name>.pr-title' --description '@<kb folder>/worktrees/<name>.pr-description' --query pullRequestId --output tsv
```

The link is `https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequest/<id>`.

**Fallback**: `gh` or `az` is missing (`gh --version` or `az --version` fails), or its call fails: the branch is pushed, so return the link that creates the pull request in the browser:
- github: `https://<host>/<owner>/<repo>/compare/<default>...<branch>?expand=1`
- azure-devops: `https://dev.azure.com/<org>/<project>/_git/<repo>/pullrequestcreate?sourceRef=<branch>&targetRef=<default>`

### 5. Clean up

After the push, or when the run stops after step 2:

```
git -C "<clone>" worktree remove --force "<worktree>"
git -C "<clone>" branch -D "<branch>"
```

The message files next to the worktree stay; the next run with the same branch overwrites them. A push that failed keeps the worktree: report its path instead of removing it.

### 6. Report

First line: the pull request link, or `create the pull request: <link>` for the fallback. Then the document path and the branch.

## Common mistakes

| Mistake | Instead |
|---|---|
| Editing, checking out or committing in `<clone>` | Everything happens in `<worktree>` |
| Branching from local `HEAD` or `<default>` | Branch from `origin/<default>` after update-operator fetched it |
| Putting the commit subject, title or description on the command line | Write them to files and pass the files |
| Inventing a ticket id or a decision value | Ask, or return `needs:` |
| Pushing to `<default>`, merging, or adding reviewers | Push the branch, open the pull request, stop |
| Adding a `Co-Authored-By` trailer or a "Generated with" line | No AI attribution anywhere |
