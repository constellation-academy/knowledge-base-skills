---
name: setup-operator
description: Use when a developer wants the project's knowledge base (KB) set up, checked or repaired on this machine — "set up the KB", "set up the knowledge base", "connect this project to our KB", "run setup-operator" — or when a knowledge-base skill reported that knowledge-base:setup-operator is needed. Operator: clones the KB repository read-only, starts or reuses the KB's Neo4j and its MCP server in Docker, and writes the project's local KB settings; never changes the KB repository, another project or another KB's container.
---

# Set up the KB for this project

Sets up one KB for the current project, once per project and machine: the read-only clone, the KB's Neo4j in Docker, the read-only Neo4j MCP server, and the project's local settings. Then a first read in a fresh session loads the index.

The layout, the env keys and the isolation rules are in the contract, `contracts/knowledge-base.v1.md` at the plugin root (two folders above this skill's directory), sections "Local layout", "Project configuration" and "Isolation". The shell rules in `../update-operator/runtime.md` (section "Shell rules") apply to every command here, except the few in "Commands per OS" below.

## Rules

- **Reuse, never overwrite.** An existing clone, container, data folder, MCP registration or settings value is checked and reused. Nothing is replaced, removed or recreated without the developer's explicit yes to that exact action, named with its data folder, ports and password source.
- **The password is never seen.** It is generated inside a throwaway container straight into `<settings>` and the Neo4j data folder. It never appears on a command line, in a tool result or in a reply.
- **`<settings>` never passes through the file tools** (Read, Write, Edit). Claude Code reports later changes to any file a file tool touched in the session, with its new content, so the password generated in step 5.1 would appear in the conversation. `<settings>` is read with `cat` and written from a staged file (steps 4 and 5.1).
- **Once `<settings>` holds a password, it is sealed.** Never print it again, not even with `cat`. Check it only with the Grep tool in `count` mode for one literal key or rule at a time. A missing key or rule then goes to the developer as text to add by hand (step 8). The setup also adds a deny rule that keeps every later session from reading the file.
- Never touch a container, network, MCP server or folder named for another KB id.
- Every path is the host's absolute native path: `/Users/ana/.kb/example/repo` on macOS, `/home/ana/.kb/example/repo` on Linux, `C:\Users\ana\.kb\example\repo` on Windows. In JSON, a backslash is written `\\` and a double quote `\"`.

## Names

| Name | Value |
|---|---|
| `<project>` | the session's primary working directory: the project root |
| `<settings>` | `<project>/.claude/settings.local.json` |
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
| `<mcp image>` | `mcp/neo4j-cypher@sha256:b252997d16d37633a5a1b30e21ac0bf368b1c64e5895e4005313c84d77a05310` (resolved from `latest` on 2026-11-10; the plugin owns this pin) |

## Commands per OS

These few steps have no command that runs unchanged in bash, zsh and PowerShell. Use the column of the session's OS.

| Step | macOS, Linux (bash, zsh) | Windows (PowerShell) |
|---|---|---|
| home folder | `printenv HOME` | `[Environment]::GetFolderPath('UserProfile')` |
| create folders | `mkdir -p "<a>" "<b>"` | `New-Item -ItemType Directory -Force -Path "<a>", "<b>"` |
| remove a folder this run created | `rm -rf "<path>"` | `Remove-Item -Recurse -Force "<path>"` |
| is a port in use | `lsof -nP -iTCP:<port> -sTCP:LISTEN`: output means in use | `Get-NetTCPConnection -State Listen -LocalPort <port>`: output means in use |
| permissions | `chmod 755 "<kb folder>" "<import>" "<queries>"`, and `chmod 600 "<settings>"` | none: Windows has no mode bits; Docker Desktop shares the folders with the container user, and `<settings>` stays protected by the user profile's ACL |

## 1. Check the project

1. Get `<home>`. Run `git --version` and `claude --version`; either fails: reply `setup-operator needs git and the claude CLI on PATH.` and stop.
2. `git -C "<project>" ls-files --error-unmatch ".claude/settings.local.json"` exits 0: the file is tracked, and a password in it would be committed. Reply `<settings> is tracked by git; untrack it (git rm --cached) and add it to .gitignore, then run setup-operator again.` and stop. Any other exit code (untracked, or no git repository): continue.
3. The settings state, with the Grep tool in `count` mode on `<settings>` (a missing file counts as 0):
   - `"NEO4J_PASSWORD"` counts 0: **open**.
   - `__KB_PASSWORD__` counts 1 or more: **open** (an earlier run stopped before the password step).
   - otherwise, or the Grep tool is refused by the deny rule of step 4.2: **sealed**.
4. Read `KB_PATH` (`printenv KB_PATH`, or `[Environment]::GetEnvironmentVariable('KB_PATH')`). Set: the project already has a KB. Follow "Locate the KB" in `runtime.md`; it passes: `<kb>`, `<clone>` and `<KB_PATH>` are known, skip step 2. It stops: reply its message plus `KB_PATH points to <value>; fix or remove it in <settings>, then run setup-operator again.` and stop; never replace a `KB_PATH` yourself.

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

1. `docker version --format '{{.Server.Version}}'` fails: Docker is missing or not running. Skip steps 3, 5, 6 and the index part of step 7; step 4 writes only `KB_PATH`. The report says `reads work from the clone; the index needs Docker: start Docker and run setup-operator again`.
2. Network: `docker network inspect --format '{{.Name}}' kb-<kb>` fails: `docker network create kb-<kb>`.
3. `docker ps -a --filter 'name=^neo4j-<kb>$' --format '{{.Names}}'` prints `neo4j-<kb>`: step 3a. Prints nothing: step 3b.

### 3a. Reuse the container

1. Inspect it. Never print `.Config.Env`: it can hold the password.

   ```
   docker inspect --format '{{.State.Status}} {{.Config.Image}} {{.HostConfig.RestartPolicy.Name}} {{json .HostConfig.PortBindings}} {{range .Mounts}}{{.Source}}={{.Destination}} {{end}}' neo4j-<kb>
   ```

   `<bolt>` and `<http>` are the host ports bound to `7687/tcp` and `7474/tcp`; `<data>` is the source mounted at `/data`.
2. Not `running`: `docker start neo4j-<kb>`.
3. `docker exec neo4j-<kb> printenv NEO4J_PLUGINS NEO4J_apoc_import_file_enabled NEO4J_server_directories_import`.
4. Collect what needs a new container: `NEO4J_PLUGINS` without `apoc`; `NEO4J_apoc_import_file_enabled` not `true`; `NEO4J_server_directories_import` not `/import`; no mount of `<import>` at `/import`; a port bound to an address other than `127.0.0.1`.
5. Nothing collected: fix in place what can be. Restart policy not `unless-stopped`: `docker update --restart unless-stopped neo4j-<kb>`. `docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' kb-<kb>` lacks `neo4j-<kb>`: `docker network connect kb-<kb> neo4j-<kb>`. Continue at step 4.
6. Something collected and no `/data` mount: the data sits inside the container and a new container would lose it. Reply `neo4j-<kb> lacks <list> and keeps its data inside the container; recreating it would lose the data. Export what you need, remove it yourself, and run setup-operator again.` and stop.
7. Something collected: ask exactly this, and accept only an explicit yes to it:

   `neo4j-<kb> lacks <list>. Recreate it? I would stop and remove the container neo4j-<kb>, then start it again as setup-operator does, with the same data folder <data>, the same ports 127.0.0.1:<bolt> and 127.0.0.1:<http>, its other mounts unchanged, and the same password, which stays in <data>. The data is not touched.`

   No, or anything else: skip steps 5 and 6 and the index part of step 7; the report names `<list>`. Yes: `docker stop neo4j-<kb>`, then `docker rm neo4j-<kb>`, then step 4 and step 5.2 to 5.5 with these `<data>`, `<bolt>`, `<http>`; each further mount is passed again as `-v "<source>:<destination>"`. No new password: it is in `<data>`.
8. The settings state is **open** with `"NEO4J_PASSWORD"` counting 0: the container's password is not in this project. Ask the developer to add `NEO4J_USERNAME` and `NEO4J_PASSWORD` to `<settings>` `env` themselves, and continue without step 5.1. Never reset a password.

### 3b. A new container

1. `<data>` holds any entry (Glob tool, `<data>/**`): data without a container. Reply `<data> holds Neo4j data but no container neo4j-<kb> exists; a new container with a new password cannot open it. Tell me how to continue.` and stop.
2. Ports: list every container's bindings, stopped ones included: `docker ps -aq`, then `docker inspect --format '{{.Name}} {{json .HostConfig.PortBindings}}' <ids>`. `<bolt>` = `7687+n`, `<http>` = `7474+n` for the smallest `n` = 0, 1, … where neither port is bound by a container nor in use (Commands per OS).
3. Create `<data>` and `<queries>` (Commands per OS); on macOS and Linux run the `chmod 755` line.

## 4. Write the project settings

1. Write `<kb folder>/neo4j.env` with the file tools (skipped without Docker), exactly:

   ```
   NEO4J_PLUGINS=["apoc"]
   NEO4J_apoc_import_file_enabled=true
   NEO4J_server_directories_import=/import
   ```

2. The values:
   - `env`: `KB_PATH` = `<KB_PATH>`; with Docker also `NEO4J_SHELL` = `<NEO4J_SHELL>`, `NEO4J_USERNAME` = `neo4j`, `NEO4J_DATABASE` = `neo4j`, and for a new container `NEO4J_PASSWORD` = `__KB_PASSWORD__`, a placeholder that step 5.1 replaces.
   - `permissions.additionalDirectories`: `<kb folder>`.
   - `permissions.allow`: the rules of "Allow rules" below.
   - for a new container also `permissions.deny`: `Read(/.claude/settings.local.json)`. It keeps the file tools and `cat` in every later session from showing the password.
3. **open**: `cat "<settings>"` (the same in bash, zsh and PowerShell; an error means no file, so the content is `{}`). Add every missing key, entry and rule. A key that exists with the same value stays. A key that exists with another value is never changed: name it, its current and its wanted value in the report. Other keys stay untouched. Write the result with the file tools to `<staged>` = `<kb folder>/settings.local.json.staged`, never to `<settings>`, and create `<project>/.claude` (Commands per OS).
   - New container: step 5.1 installs `<staged>` together with the password; nothing more here.
   - Otherwise install it now, in bash, zsh and PowerShell alike, then on macOS and Linux `chmod 600 "<settings>"`:

     ```
     cp "<staged>" "<settings>"; rm "<staged>"
     ```

4. **sealed**: change nothing. Check each value and rule with the Grep tool in `count` mode (the literal JSON text, e.g. `"KB_PATH": "<KB_PATH>"` with JSON escaping); collect the missing ones for the report. The Grep tool is refused by the deny rule: compare `KB_PATH`, `NEO4J_SHELL` and `NEO4J_DATABASE` from `printenv` (or `[Environment]::GetEnvironmentVariable`) instead, and report `allow rules not checked: <settings> is sealed`.

### Allow rules

Each rule is written with the paths exactly as the skills write them in commands. On Windows, add every `Bash(…)` rule once more as `PowerShell(…)` with the same text, and replace the three `printenv` rules by `PowerShell([Environment]::GetEnvironmentVariable('KB_PATH'))` and the same for `NEO4J_SHELL` and `NEO4J_DATABASE`.

```
Bash(printenv KB_PATH)
Bash(printenv NEO4J_SHELL)
Bash(printenv NEO4J_DATABASE)
Bash(git -C "<KB_PATH>" rev-parse *)
Bash(git -C "<clone>" rev-parse *)
Bash(git -C "<clone>" symbolic-ref --short HEAD)
Bash(git -C "<clone>" fetch --quiet origin)
Bash(git -C "<clone>" merge --ff-only --quiet origin/<default>)
Bash(git -C "<clone>" log -1 --format=%cr HEAD)
Bash(git -C "<clone>" remote get-url origin)
Bash(git -C "<clone>" ls-remote --heads origin *)
Bash(git -C "<clone>" check-ref-format --branch *)
Bash(git -C "<clone>" worktree add -b *)
Bash(git -C "<clone>" worktree remove --force *)
Bash(git -C "<clone>" branch -D *)
Bash(git diff --no-index --quiet *)
Bash(<NEO4J_SHELL> -d neo4j --format plain -f /import/queries/*)
Bash(<export prefix>*)
Bash(rm "<import>/kb-export.json")
Bash(mv "<import>/kb-export.json.tmp" "<import>/kb-export.json")
Edit(~/.kb/<kb>/import/queries/**)
Edit(~/.kb/<kb>/worktrees/**)
mcp__kb-<kb>__*
```

- Add `Read(//<plugins folder>/**)`, where `<plugins folder>` is the parent folder of the plugin root (the plugin root is two folders above this skill's directory), as an absolute path without its leading `/`; on Windows in the form `c/Users/…` with forward slashes. The skills read their shared files there (`runtime.md`, the contract, the query files), and the rule covers every installed plugin version.
- `<export prefix>`: the manifest's `export.cmd` up to its first placeholder, e.g. `bun tools/export.ts --ref ` for `bun tools/export.ts --ref {ref} --out {out}`.
- The manifest has `pr.pre_commit`: add `Bash(<pre_commit>)`.
- `pr.host` `github`: add `Bash(gh --version)` and `Bash(gh api --hostname <host> --method POST repos/<owner>/<repo>/pulls *)`, with `<host>`, `<owner>`, `<repo>` from `git -C "<clone>" remote get-url origin` as article-writer derives them. A remote in neither of article-writer's GitHub forms: leave the `gh api` rule out and say so in the report; never guess it.
- No rule covers the writer's commands in its worktree (`git -C "<kb folder>/worktrees/<name>" …`): the worktree name varies, and a `*` before the git subcommand would also approve an inserted `-c`, which runs any program. The developer confirms those commands, and with them the commit and the push, when a write runs.
- `pr.host` `azure-devops`: add `Bash(az --version)` and `Bash(az repos pr create --org https://dev.azure.com/<org> *)`.
- Without Docker, leave out the `<NEO4J_SHELL>` and `mcp__` rules.

## 5. Password and start

1. New container only: one throwaway container generates the password, sets it as Neo4j's initial password in `<data>`, and writes `<staged>` to `<settings>` with the password in place of the placeholder. It keeps the owner of `<project>/.claude` and sets mode 600 where the OS has modes. Run unchanged:

   ```
   docker run --rm -v "<data>:/data" -v "<kb folder>:/kb" -v "<project>/.claude:/w" --entrypoint sh <image> -c 'grep -q __KB_PASSWORD__ /kb/settings.local.json.staged || exit 3; p=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 32); neo4j-admin dbms set-initial-password $p >/dev/null || exit 4; sed s/__KB_PASSWORD__/$p/ /kb/settings.local.json.staged >/w/settings.local.json || exit 5; chown --reference=/w /w/settings.local.json; chmod 600 /w/settings.local.json; rm /kb/settings.local.json.staged'
   ```

   It exits non-zero: reply `the password step failed with exit code <code>; nothing was started` and stop. With exit code 4 or 5, `<data>` may hold a password that `<settings>` lacks: remove `<data>`, which this run created (Commands per OS), so the next run starts clean. After exit code 0, `<settings>` is **sealed**.
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

1. `docker pull <mcp image>`.
2. In `<project>`: `claude mcp get kb-<kb>`. It exists: its command and arguments must be exactly those of step 6.3; equal: keep it. Different: never change it; name the difference in the report.
3. It does not exist, in `<project>`:

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
settings: <settings> (<written | unchanged>)
to add by hand: <each missing key or rule, or "nothing">
first read: <reply of 7.1, verbatim>
explore: <reply of 7.2, verbatim>
```

On Windows add: `permissions: not enforced on Windows (no chmod); <settings> is protected only by the user profile.`

## Common mistakes

| Mistake | Instead |
|---|---|
| Reading or writing `<settings>` with the file tools, `cat` after the password step, or printing `docker inspect` `.Config.Env` | `cat` only while open, a staged file for the write, Grep in `count` mode once sealed; inspect only the fields of step 3a.1 |
| Putting the password or `NEO4J_AUTH=…` on a command line | The throwaway container of step 5.1 generates it in place |
| Recreating a container, or replacing a `KB_PATH`, `env` value or MCP registration, because it differs | Name the difference; recreate only on the explicit yes of step 3a.7 |
| Starting a new container on a data folder that already holds data | Stop and ask (step 3b.1) |
| Running the export or the load yourself | The first read in a fresh session loads the index |
| Checking the index or the MCP server in this session | This session has neither the new `env` nor the server; use fresh sessions |
| Writing into the clone or the KB repository | The clone is read-only; writes go through `knowledge-base:article-writer` |
