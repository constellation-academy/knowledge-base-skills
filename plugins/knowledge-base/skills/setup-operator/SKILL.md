---
name: setup-operator
description: Use when a developer wants the project's knowledge base (KB) set up, checked or repaired on this machine — "set up the KB", "set up the knowledge base", "connect this project to our KB", "run setup-operator" — or when a knowledge-base skill reported that knowledge-base:setup-operator is needed. Operator: clones the KB repository read-only, starts or reuses the KB's Neo4j and its MCP server in Docker, and writes the project's local KB settings; never changes the KB repository, another project or another KB's container.
---

# Set up the KB for this project

Sets up one KB for the current project, once per project and machine: the read-only clone, the KB's Neo4j in Docker, the read-only Neo4j MCP server, and the project's local settings. Then a first read in a fresh session loads the index.

The layout, the env keys and the isolation rules are in the contract, `contracts/knowledge-base.v1.md` at the plugin root (two folders above this skill's directory), sections "Local layout", "Project configuration" and "Isolation". The shell rules in `../update-operator/runtime.md` (section "Shell rules") apply to every command here, with two exceptions: the few lines in "Commands per OS" below, and the text inside single quotes that the host shell does not run: Docker `--format` and `--filter` literals (`{{…}}`, `^…$`) and the script passed to `bash -c` inside a container.

## Rules

- **Reuse, never overwrite.** An existing clone, container, data folder, MCP registration or settings value is checked and reused. Nothing is replaced, removed or recreated without the developer's explicit yes to that exact action, named with its image change, data folder, ports, mounts, env keys and password source.
- **The password is never seen.** The scripts in `<scripts>` generate it inside a throwaway container and put it straight into `<settings>` and the Neo4j data. Inside that container it travels only through files and shell variables. It never appears on a command line or process argument list, in a tool result or in a reply.
- **`<settings>` is never read in this session.** No file tool, `cat` or Grep opens it. Claude Code would show its content, and it reports later changes to any file a file tool touched, with the new content. Every change goes through `<scripts>/merge-settings.py` in a throwaway container. The script prints only key names, rule texts and non-secret values, never a password.
- **The deny rule comes first.** Step 1.5 writes `Read(/.claude/settings.local.json)` into `<settings>` before any other step touches the file. It keeps the file tools and `cat` in later sessions from showing the password, whether this setup generated it or the developer added it by hand.
- Never touch a container, network, MCP server or folder named for another KB id.
- Every path is the host's absolute native path: `/Users/ana/.kb/example/repo` on macOS, `/home/ana/.kb/example/repo` on Linux, `C:\Users\ana\.kb\example\repo` on Windows. In JSON, a backslash is written `\\` and a double quote `\"`.

## Names

| Name | Value |
|---|---|
| `<project>` | the session's primary working directory: the project root |
| `<settings>` | `<project>/.claude/settings.local.json` |
| `<fragment>` | `<project>/.claude/kb-setup.fragment.json`: what to merge into `<settings>`; the merge script deletes it |
| `<scripts>` | the `scripts` folder in this skill's directory, as an absolute path |
| `<home>` | the home folder (see "Commands per OS") |
| `<kb>` | the manifest's `kb` |
| `<kb folder>` | `<home>/.kb/<kb>` |
| `<clone>` | `<kb folder>/repo` |
| `<data>` | `<kb folder>/data`, or for a reused container the source of its `/data` mount |
| `<import>`, `<queries>` | `<kb folder>/import`, `<kb folder>/import/queries` |
| `<kb_root>`, `<default>` | as in `runtime.md`, from the manifest |
| `<KB_PATH>` | `<clone>` when `<kb_root>` is `.`, else `<clone>/<kb_root>` |
| `<NEO4J_SHELL>` | `docker exec -i -e NEO4J_USERNAME -e NEO4J_PASSWORD neo4j-<kb> cypher-shell` |
| `<image>` | `neo4j:2026.06.0` |
| `<mcp image>` | `mcp/neo4j-cypher@sha256:b252997d16d37633a5a1b30e21ac0bf368b1c64e5895e4005313c84d77a05310` (resolved from `latest` on 2026-11-10; the plugin owns this pin); it also runs the merge script, since it ships Python |
| `<password state>` | the last line of a merge: `password: absent`, `password: placeholder` or `password: present` |

## Merge into the settings

Write `<fragment>` with the file tools: a JSON object with the `env` keys and the `permissions` lists (`allow`, `deny`, `additionalDirectories`) to add. Then run, unchanged:

```
docker run --rm -v "<scripts>:/s:ro" -v "<project>/.claude:/w" --entrypoint python <mcp image> /s/merge-settings.py /w/kb-setup.fragment.json /w/settings.local.json
```

- A missing `<settings>` is created with mode 600 and the owner of `<project>/.claude`. An existing one keeps its owner and other keys and gets mode 600.
- A missing key or entry is added (`added …`); one with the same value stays (`kept …`). A key with another value is never changed: `conflict env <key>`, with the current and wanted value for `KB_PATH`, `NEO4J_SHELL`, `NEO4J_USERNAME` and `NEO4J_DATABASE` only. Every conflict goes into the report.
- `error: … nothing changed` (for example, `<settings>` is not valid JSON): reply that line and stop.

## Commands per OS

These few steps have no command that runs unchanged in bash, zsh and PowerShell. Use the column of the session's OS.

| Step | macOS, Linux (bash, zsh) | Windows (PowerShell) |
|---|---|---|
| home folder | `printenv HOME` | `[Environment]::GetFolderPath('UserProfile')` |
| create folders | `mkdir -p "<a>" "<b>"` | `New-Item -ItemType Directory -Force -Path "<a>", "<b>"` |
| remove a folder this run created | `rm -rf "<path>"` | `Remove-Item -Recurse -Force "<path>"` |
| is a port in use | `lsof -nP -iTCP:<port> -sTCP:LISTEN`: output means in use | `Get-NetTCPConnection -State Listen -LocalPort <port>`: output means in use |
| folder permissions | `chmod 755 "<kb folder>" "<import>" "<queries>"` | none: Windows has no mode bits; Docker Desktop shares the folders with the container user, and `<settings>` stays protected by the user profile's ACL |

## 1. Check the project

1. Get `<home>`. Run `git --version` and `claude --version`; either fails: reply `setup-operator needs git and the claude CLI on PATH.` and stop.
2. `docker version --format '{{.Server.Version}}'` fails: Docker is missing or not running. This setup then writes nothing to `<settings>` and skips steps 1.4, 1.5, 3, 4.2, 5, 6 and the index part of step 7. The report says `reads work from the clone; the index needs Docker: start Docker and run setup-operator again`, and lists, under "to add by hand", `KB_PATH` = `<KB_PATH>`, the deny rule `Read(/.claude/settings.local.json)` and the allow rules for the commands that run without Docker (the `printenv`, `git` and `Read` rules of "Allow rules").
3. `git -C "<project>" ls-files --error-unmatch ".claude/settings.local.json"` exits 0: the file is tracked, and a password in it would be committed. Reply `<settings> is tracked by git; untrack it (git rm --cached) and add it to .gitignore, then run setup-operator again.` and stop. Any other exit code (untracked, or no git repository): continue. In a git repository, `git -C "<project>" check-ignore -q ".claude/settings.local.json"` exits 1: the file is not ignored and could still be committed; the report says `add .claude/settings.local.json to .gitignore`.
4. `docker pull <mcp image>`.
5. Protect the settings: merge (section "Merge into the settings") a fragment with `permissions.deny` = `["Read(/.claude/settings.local.json)"]` and `permissions.allow` = `["Read(//<plugins folder>/**)"]` (see "Allow rules"). Its `<password state>` is the state for the steps below.
6. Read `KB_PATH` (`printenv KB_PATH`, or `[Environment]::GetEnvironmentVariable('KB_PATH')`). Set: the project already has a KB. Follow "Locate the KB" in `runtime.md`; it passes: `<kb>`, `<clone>` and `<KB_PATH>` are known, skip step 2. It stops: reply its message plus `KB_PATH points to <value>; fix or remove it in <settings>, then run setup-operator again.` and stop; never replace a `KB_PATH` yourself.

## 2. Clone the KB

1. Ask the developer once: `What is the URL of the git repository that contains the knowledge base?`
2. Reuse: for every folder matching `<home>/.kb/*/repo` (Glob tool), `git -C "<that folder>" remote get-url origin`. One prints the URL: it is `<clone>`; read its manifest (step 2.4) and continue at step 2.6.
3. Clone into a staging folder `<home>/.kb/.incoming`. It exists from an earlier run: remove it first (Commands per OS). Then:

   ```
   git clone --filter=blob:none -c core.autocrlf=false "<url>" "<home>/.kb/.incoming"
   ```

   It fails: reply `git clone failed: <first error line>` and stop.
4. Find the manifest with the Glob tool: `**/kb-manifest.json` in the clone, ignoring `.worktrees`. Not exactly one, or its `kb` does not match `^[a-z0-9][a-z0-9-]*$`, or its `contract` is not `"1"`, or its folder relative to the repository root is not `<kb_root>`: remove the staging folder, reply what is wrong, and stop.
5. `<home>/.kb/<kb>/repo` exists (it holds another URL, since step 2.2 found none): remove the staging folder, reply `<home>/.kb/<kb>/repo already holds a clone of <its origin URL>; one machine keeps one clone per KB id.` and stop. Otherwise create `<kb folder>` (Commands per OS) and move the clone into place with `mv "<home>/.kb/.incoming" "<clone>"` (bash, zsh and PowerShell alike).
6. `git -C "<clone>" symbolic-ref --short HEAD` must print `<default>`. It prints another branch: `git -C "<clone>" switch --quiet <default>`. The clone holds no local changes, so this changes no content.

## 3. Docker and the Neo4j container

1. Network: `docker network inspect --format '{{.Name}}' kb-<kb>` fails: `docker network create kb-<kb>`.
2. `docker ps -a --filter 'name=^neo4j-<kb>$' --format '{{.Names}}'` prints `neo4j-<kb>`: step 3a. Prints nothing: step 3b.

### 3a. Reuse the container

1. Inspect it. Never print `.Config.Env` or any env value except as step 3a.7 allows: it can hold the password.

   ```
   docker inspect --format '{{.State.Status}} {{.Config.Image}} {{.HostConfig.RestartPolicy.Name}} {{json .HostConfig.PortBindings}} {{range .Mounts}}{{.Source}}={{.Destination}} {{end}}' neo4j-<kb>
   ```

   `<old image>` is `.Config.Image`; `<bolt>` and `<http>` are the host ports bound to `7687/tcp` and `7474/tcp`; `<data>` is the source mounted at `/data`.

   The names of its env keys, never their values, and those its image sets itself, and whether authentication is off (prints `auth-none` or nothing):

   ```
   docker inspect --format '{{range .Config.Env}}{{index (split . `=`) 0}} {{end}}' neo4j-<kb>
   docker image inspect --format '{{range .Config.Env}}{{index (split . `=`) 0}} {{end}}' <old image>
   docker inspect --format '{{range .Config.Env}}{{if eq . `NEO4J_AUTH=none`}}auth-none{{end}}{{end}}' neo4j-<kb>
   ```

   `<own keys>` are the container's keys that its image does not set.
2. Not `running`: `docker start neo4j-<kb>`.
3. `docker exec neo4j-<kb> printenv NEO4J_PLUGINS NEO4J_apoc_import_file_enabled NEO4J_server_directories_import`.
4. Collect what needs a new container: `NEO4J_PLUGINS` without `apoc`; `NEO4J_apoc_import_file_enabled` not `true`; `NEO4J_server_directories_import` not `/import`; no mount of `<import>` at `/import`; a port bound to an address other than `127.0.0.1` (an empty `HostIp`, `0.0.0.0` and `::` all count as other).
5. Nothing collected: fix in place what can be. Restart policy not `unless-stopped`: `docker update --restart unless-stopped neo4j-<kb>`. `docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' kb-<kb>` lacks `neo4j-<kb>`: `docker network connect kb-<kb> neo4j-<kb>`. Continue at step 3a.8.
6. Something collected and no `/data` mount: the data sits inside the container and a new container would lose it. Reply `neo4j-<kb> lacks <list> and keeps its data inside the container; recreating it would lose the data. Export what you need, remove it yourself, and run setup-operator again.` and stop.
7. Something collected: sort the `<own keys>` into three groups.
   - Set by the new container itself: `NEO4J_PLUGINS`, `NEO4J_apoc_import_file_enabled`, `NEO4J_server_directories_import` (from `neo4j.env`).
   - Not carried over: `NEO4J_AUTH`, and every key whose name contains, ignoring case, one of `AUTH`, `PASS`, `PWD`, `SECRET`, `TOKEN`, `KEY`, `CRED`, `URL`, `URI`. Their values may be credentials, and carrying a value means reading it. They are never read.
   - Carried over: every other key. Read each value on its own, `docker inspect --format '{{range .Config.Env}}{{if eq (index (split . `=`) 0) `<key>`}}{{.}}{{end}}{{end}}' neo4j-<kb>`, and add the printed `<key>=<value>` line to `neo4j.env` (step 4.1).

   `<auth note>`:
   - Authentication on (step 3a.1 printed nothing): `the same password, which stays in <data>`.
   - Authentication off (`auth-none`): `authentication, now off (NEO4J_AUTH=none), turned on with a newly generated password; answer "keep auth off" to keep it off instead`.

   Then ask exactly this, and accept only an explicit yes (or, with authentication off, `keep auth off`) to it:

   `neo4j-<kb> lacks <list>. Recreate it? I would stop and remove the container neo4j-<kb> and start a new one as setup-operator does: image <old image> → neo4j:2026.06.0<image note>; the same data folder <data>; the same ports 127.0.0.1:<bolt> and 127.0.0.1:<http>; the mounts <other mounts> unchanged; the env keys <carried keys> carried over; the env keys <keys not carried> not carried over, because their values may be credentials, which this setup never reads (set them again yourself if they are needed); <auth note>.`

   `<image note>`: empty when `<old image>` is `neo4j:2026.06.0`; otherwise `, which upgrades the store on first start: the old image cannot open it afterwards, and a newer old image's store does not open at all`. An empty list is written `none`.

   No, or anything else: skip steps 5 and 6 and the index part of step 7; the report names `<list>`. Otherwise:
   1. `docker stop neo4j-<kb>`, then `docker rm neo4j-<kb>`.
   2. `keep auth off`: add `NEO4J_AUTH=none` to `neo4j.env` (step 4.1) and leave `NEO4J_PASSWORD` out of the fragment (step 4.2).
   3. Authentication was off and the answer was yes: step 4 with the placeholder in the fragment, then step 5.1b; otherwise step 4.
   4. Step 5.2 to 5.5 with these `<data>`, `<bolt>`, `<http>`; each further mount is passed again as `-v "<source>:<destination>"`.
8. Authentication on and `<password state>` is `absent`: the container's password is not in this project. Never reset it, and never ask for it during this run: the report says, under "to add by hand", `NEO4J_USERNAME and NEO4J_PASSWORD of neo4j-<kb>, into the env of <settings>, after this setup finishes`.

### 3b. A new container

1. `<data>` holds any entry (Glob tool, `<data>/**`): data without a container.
   - `<password state>` is `present`: an earlier run of this setup set the password in `<data>` and `<settings>`, and its container did not start. Continue at step 3b.3 and skip step 5.1; if the first read then fails to log in, the report says `remove <data> and the NEO4J_PASSWORD key of <settings>, then run setup-operator again`.
   - Otherwise reply `<data> holds Neo4j data but no container neo4j-<kb> exists; a new container with a new password cannot open it. Remove <data> if the data is not needed, or tell me how to continue.` and stop.
2. `<password state>` is `present` and `<data>` is empty: `<settings>` holds a password for a container and data that are gone. Reply `<settings> holds a NEO4J_PASSWORD, but neo4j-<kb> and its data no longer exist. Remove the NEO4J_PASSWORD key from <settings> yourself, then run setup-operator again.` and stop.
3. Ports: list every container's bindings, stopped ones included: `docker ps -aq`; when it prints ids, `docker inspect --format '{{.Name}} {{json .HostConfig.PortBindings}}' <ids>`. `<bolt>` = `7687+n`, `<http>` = `7474+n` for the smallest `n` = 0, 1, … where neither port is bound by a container nor in use (Commands per OS).
4. Create `<data>` and `<queries>` (Commands per OS); on macOS and Linux run the `chmod 755` line.

## 4. Write the project settings

1. Write `<kb folder>/neo4j.env` with the file tools, exactly these lines, followed by the lines a recreate adds (step 3a.7):

   ```
   NEO4J_PLUGINS=["apoc"]
   NEO4J_apoc_import_file_enabled=true
   NEO4J_server_directories_import=/import
   ```

2. Merge (section "Merge into the settings") a fragment with:
   - `env`: `KB_PATH` = `<KB_PATH>`, `NEO4J_SHELL` = `<NEO4J_SHELL>`, `NEO4J_USERNAME` = `neo4j`, `NEO4J_DATABASE` = `neo4j`; for a new container, or a recreate that turns authentication on, also `NEO4J_PASSWORD` = `__KB_PASSWORD__`, a placeholder that step 5.1 replaces.
   - `permissions.additionalDirectories`: `<kb folder>`.
   - `permissions.allow`: the rules of "Allow rules" below.
   - `permissions.deny`: `Read(/.claude/settings.local.json)`.

   Its `<password state>` is the state from here on.

### Allow rules

Each rule is written with the paths exactly as the skills write them in commands. On Windows, add every `Bash(…)` rule once more as `PowerShell(…)` with the same text, and replace the three `printenv` rules by `PowerShell([Environment]::GetEnvironmentVariable('KB_PATH'))` and the same for `NEO4J_SHELL` and `NEO4J_DATABASE`.

```
Bash(printenv KB_PATH)
Bash(printenv NEO4J_SHELL)
Bash(printenv NEO4J_DATABASE)
Bash(git -C "<KB_PATH>" rev-parse --show-toplevel)
Bash(git -C "<KB_PATH>" rev-parse --show-prefix)
Bash(git -C "<clone>" rev-parse HEAD)
Bash(git -C "<clone>" symbolic-ref --short HEAD)
Bash(git -C "<clone>" fetch --quiet origin)
Bash(git -C "<clone>" merge --ff-only --quiet origin/<default>)
Bash(git -C "<clone>" log -1 --format=%cr HEAD)
Bash(<NEO4J_SHELL> -d neo4j --format plain -f /import/queries/*)
Bash(rm "<import>/kb-export.json")
Bash(mv "<import>/kb-export.json.tmp" "<import>/kb-export.json")
Read(//<plugins folder>/**)
Edit(~/.kb/<kb>/import/queries/*.cypher)
Edit(~/.kb/<kb>/worktrees/**)
mcp__kb-<kb>__*
```

- `<plugins folder>`: the parent folder of the plugin root (the plugin root is two folders above this skill's directory), as an absolute path without its leading `/`; on Windows in the form `c/Users/…` with forward slashes. The skills read their shared files there (`runtime.md`, the contract, the query files), and the rule covers every installed plugin version.
- Every `Bash` rule but one is an exact command. The `Edit` rule on the query folder admits only `.cypher` files, so no script or program can be placed there. Nothing that runs from `<kb folder>/worktrees` is pre-allowed.
- Accepted risk, the one wildcard rule: the trailing `*` of the `<NEO4J_SHELL>` rule admits any further `cypher-shell` arguments. Together with the `Edit` rule on the query folder, a session can write and run any Cypher, APOC calls included, against this KB's own store, which holds only the rebuildable index. An inserted `-a <host>` would also send this store's Neo4j user and password to that host. The store itself listens on `127.0.0.1` only.
- Not pre-allowed, so these prompt, unless the developer's own permission mode, rules or hooks allow them:
  - the export command, once per reindex;
  - `pr.pre_commit`;
  - the writer's git work (worktree and branch, remote branch check, staging, commit, push);
  - the pull request call (`gh api …`, `az repos pr create …`).

  Each could be widened into a prompt-free file read, file write or program run: a `*` there matches any text, inserted flags included, and the export and `pre_commit` commands run code from their working directory.

## 5. Password and start

A new or recreated container only. A reused container (step 3a.5) skips to step 6.

1. New container only, with `<password state>` `placeholder`: one throwaway container generates the password, sets it as Neo4j's initial password in `<data>`, and replaces the placeholder in `<settings>`:

   ```
   docker run --rm -v "<data>:/data" -v "<project>/.claude:/w" -v "<scripts>:/s:ro" --entrypoint sh <image> /s/new-password.sh
   ```

   1b. A recreate that turns authentication on, with `<password state>` `placeholder`: instead, the throwaway container starts Neo4j on `<data>` with authentication off, sets a newly generated password with `ALTER USER`, replaces the placeholder in `<settings>`, and stops:

   ```
   docker run --rm -e NEO4J_AUTH=none -v "<data>:/data" -v "<project>/.claude:/w" -v "<scripts>:/s:ro" --entrypoint bash <image> /s/reset-password.sh
   ```

   Both pass the password to `neo4j-admin` (`@/tmp/pw`, an argument file), `cypher-shell` (`-f`) and `sed` (`-f`) only through files in the container's own `/tmp`, which goes away with the container.

   Exit code 3: no placeholder in `<settings>`; the developer's own `NEO4J_PASSWORD` is there. Reply `<settings> already holds a NEO4J_PASSWORD; remove it, or answer "keep auth off", then run setup-operator again.` and stop. Any other non-zero exit code: reply `the password step failed with exit code <code>; nothing was started` and stop. `<settings>` is unchanged, since the scripts write it only as their last step. For a new container, also remove `<data>`, which this run created (Commands per OS), so the next run starts clean.
2. Start Neo4j:

   ```
   docker run -d --name neo4j-<kb> --restart unless-stopped --network kb-<kb> -p 127.0.0.1:<bolt>:7687 -p 127.0.0.1:<http>:7474 -v "<data>:/data" -v "<import>:/import" --env-file "<kb folder>/neo4j.env" <image>
   ```

3. Wait until Bolt answers, up to three minutes (the first start installs APOC):

   ```
   docker exec neo4j-<kb> bash -c 'for i in $(seq 90); do (echo > /dev/tcp/127.0.0.1/7687) 2>/dev/null && exit 0; sleep 2; done; exit 1'
   ```

   It exits non-zero: reply the last 20 lines of `docker logs --tail 20 neo4j-<kb>` and stop.
4. The container user can write the data and read the import folder: `docker exec -u neo4j neo4j-<kb> test -w /data/databases` and `docker exec -u neo4j neo4j-<kb> ls /import`. Either fails: reply `the Neo4j container user cannot use <data> or <import>; on Linux make <data> writable and <import> readable for uid 7474 (or run Docker rootless), then run setup-operator again.` and stop.
5. APOC is installed: `docker exec neo4j-<kb> ls /var/lib/neo4j/plugins` lists a file starting with `apoc`. Otherwise reply the listing and stop.

## 6. Register the MCP server

1. In `<project>`: `claude mcp get kb-<kb>`. It exists: its command and arguments must be exactly those of step 6.2; equal: keep it. Different: never change it; name the difference in the report.
2. It does not exist, in `<project>`:

   ```
   claude mcp add -s local kb-<kb> -- docker run -i --rm --network kb-<kb> -e NEO4J_URI=bolt://neo4j-<kb>:7687 -e NEO4J_USERNAME -e NEO4J_PASSWORD -e NEO4J_DATABASE <mcp image> mcp-neo4j-cypher --read-only
   ```

   The bare `-e` flags copy the values from the Claude Code session's environment, which the `env` of `<settings>` supplies; the password never appears in the registration. `--read-only` removes the write tool, so the server offers `mcp__kb-<kb>__get_neo4j_schema` and `mcp__kb-<kb>__read_neo4j_cypher`.

## 7. First read

The new `env` and the MCP server reach only new sessions, so the check runs in fresh sessions started in `<project>`:

1. `claude -p "Use the knowledge-base:access-orchestrator skill: fetch: kb <first resource name of the manifest>"`, allowing up to 10 minutes. The read finds an empty index and loads it.
2. With the MCP server registered: `claude -p "Use the knowledge-base:access-orchestrator skill: explore: kb <title of any document of the fetched resource>"`. Its reply must contain `explore via MCP kb-<kb>`; `explore via fixed queries` means the session did not reach the MCP server.

Relay both replies verbatim in the report: a permission denial or a provider message there is the only reason shown when the index stays empty.

## 8. Report

```
KB <kb> for <project>
clone: <clone> (<new | reused>) at <first 7 characters of HEAD>
KB_PATH: <KB_PATH>
neo4j: neo4j-<kb> (<new | reused | recreated | not set up: reason>), 127.0.0.1:<bolt> bolt, 127.0.0.1:<http> http, data <data>
mcp: kb-<kb> (<registered | kept | not set up: reason>)
settings: <settings> (<added entries, or "unchanged">)
conflicts: <each conflict line of the merges, or "none">
to add by hand: <each missing key or rule, or "nothing">
first read: <reply of 7.1, verbatim>
explore: <reply of 7.2, verbatim>
```

On Windows add: `permissions: not enforced on Windows (no chmod); <settings> is protected only by the user profile.`

## Common mistakes

| Mistake | Instead |
|---|---|
| Reading `<settings>` with the file tools, `cat` or Grep, or printing `docker inspect` `.Config.Env` | Change it only through the merge script; inspect only the fields of step 3a.1 |
| Putting the password or `NEO4J_AUTH=…` on a command line, or asking for a password during the run | The scripts of step 5.1 generate it in place; a password the developer adds goes under "to add by hand" |
| Recreating a container, or replacing a `KB_PATH`, `env` value or MCP registration, because it differs | Name the difference; recreate only on the explicit yes of step 3a.7 |
| Starting a new container on a data folder that already holds data | Stop and ask (step 3b.1) |
| Running the export or the load yourself | The first read in a fresh session loads the index |
| Checking the index or the MCP server in this session | This session has neither the new `env` nor the server; use fresh sessions |
| Writing into the clone or the KB repository | The clone is read-only; writes go through `knowledge-base:article-writer` |
