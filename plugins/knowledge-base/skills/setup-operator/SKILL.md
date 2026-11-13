---
name: setup-operator
description: Use when a developer wants the project's knowledge base (KB) set up, checked or repaired on this machine — "set up the KB", "set up the knowledge base", "connect this project to our KB", "run setup-operator" — or when a knowledge-base skill reported that knowledge-base:setup-operator is needed. Operator: clones the KB repository read-only, starts or reuses the KB's Neo4j and its MCP server in Docker, writes the project's local KB settings, then loads the index and checks that it is searchable; never changes the KB repository, another project or another KB's container.
---

# Set up the KB for this project

Sets up one KB for the current project, once per project and machine: the read-only clone, the KB's Neo4j in Docker, the read-only Neo4j MCP server, and the project's local settings. Then fresh sessions load the index and check that it holds the clone's commit and answers a search through the MCP server; the setup is done only when those checks pass.

The layout, the env keys and the isolation rules are in the contract, `contracts/knowledge-base.v1.md` at the plugin root (two folders above this skill's directory), sections "Local layout", "Project configuration" and "Isolation". The shell rules in `../update-operator/runtime.md` (section "Shell rules") apply to every command here, with two exceptions: the few lines in "Commands per OS" below and in `start.md`, and the text inside single quotes that the host shell does not run: Docker `--format` and `--filter` literals (`{{…}}`, `^…$`) and the script passed to `bash -c` inside a container. Docker and an existing Neo4j container are started, and Bolt is awaited, only through the sections of `../start-operator/start.md`, which this skill follows; it runs no start or wait command of its own. When a command is denied or fails where this skill names no outcome, follow "Denied or failed commands" there: stop and report the command and the reason. The setup needs manual permission mode: auto mode denies the settings merge, which writes permission rules into this session's own project settings.

## Rules

- **Reuse, never overwrite.** An existing clone, container, data folder, MCP registration or settings value is checked and reused. Nothing is replaced, removed or recreated without the developer's explicit yes to that exact action, named with its image change, data folder, network, ports, mounts, env keys and password source.
- **The password is never seen.** The scripts in `<scripts>` generate it inside a throwaway container and put it straight into `<settings>` and the Neo4j data. Inside that container it travels only through files and shell variables. It never appears on a command line or process argument list, in a tool result or in a reply.
- **`<settings>` is never read in this session.** No file tool, `cat` or Grep opens it. Claude Code would show its content, and it reports later changes to any file a file tool touched, with the new content. Every change goes through `<scripts>/merge-settings.py` in a throwaway container. The script prints only key names, rule texts and non-secret values, never a password.
- **The deny rule comes first.** Step 1.5 writes `Read(/.claude/settings.local.json)` into `<settings>` before any other step touches the file. It keeps the Read tool and plain `cat` in later sessions from showing the password, whether this setup generated it or the developer added it by hand. It is best effort: some compound shell forms get past it.
- Never touch a container, network, MCP server or folder named for another KB id.
- **No way out of the store.** `neo4j-<kb>` publishes no host port and sits only on `kb-<kb>`, a Docker network created with `--internal`, which has no route outside Docker. `cypher-shell` reaches it through `docker exec`, and the MCP server joins the same network. `neo4j.env` limits APOC to the procedures and functions the plugin's queries and the MCP server use, and file loads to `/import`.
- Every path is the host's absolute native path: `/Users/ana/.kb/example/repo` on macOS, `/home/ana/.kb/example/repo` on Linux, `C:\Users\ana\.kb\example\repo` on Windows. In JSON, a backslash is written `\\` and a double quote `\"`.

## Names

| Name | Value |
|---|---|
| `<project>` | the session's primary working directory: the project root |
| `<settings>` | `<project>/.claude/settings.local.json` |
| `<fragment>` | `<home>/.kb/setup-fragment.json`: what to merge into `<settings>`; the merge script deletes it. It stays out of `<project>/.claude`, which Claude Code treats as a protected path: a file-tool write there always prompts and is refused in a headless session |
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

Write `<fragment>` with the file tools: a JSON object with the `env` keys and the `permissions` lists (`allow`, `deny`) to add. Create `<project>/.claude` if it is missing (Commands per OS), so Docker does not create it as another user; `.claude` is a protected path, so this one command always asks the developer, and a headless session cannot run it. Then run, unchanged:

```
docker run --rm --network none -v "<scripts>:/s:ro" -v "<home>/.kb:/f" -v "<project>/.claude:/w" --entrypoint python <mcp image> /s/merge-settings.py /f/setup-fragment.json /w/settings.local.json
```

- A missing `<settings>` is created with mode 600 and the owner of `<project>/.claude`. An existing one keeps its owner and other keys and gets mode 600.
- A missing key or entry is added (`added …`); one with the same value stays (`kept …`). A key with another value is never changed: `conflict env <key>`, with the current and wanted value for `KB_PATH`, `NEO4J_SHELL`, `NEO4J_USERNAME` and `NEO4J_DATABASE` only. Every conflict goes into the report.
- `error: … nothing changed` (`<settings>` is not valid JSON, or its `env`, `permissions` or a permission list has the wrong type): the script wrote and deleted nothing; reply that line and stop.
- The command is denied by auto mode: reply `auto mode blocks the settings merge; switch this session to manual mode (shift+tab), then run setup-operator again` and stop.

## Commands per OS

These few steps have no command that runs unchanged in bash, zsh and PowerShell. Use the column of the session's OS.

| Step | macOS, Linux (bash, zsh) | Windows (PowerShell) |
|---|---|---|
| home folder | `printenv HOME` | `[Environment]::GetFolderPath('UserProfile')` |
| create folders | `mkdir -p "<a>" "<b>"` | `New-Item -ItemType Directory -Force -Path "<a>", "<b>"` |
| remove a folder this run created | `rm -rf "<path>"` | `Remove-Item -Recurse -Force "<path>"` |
| folder permissions | `chmod 755 "<kb folder>" "<import>" "<queries>"` | none: Windows has no mode bits; Docker Desktop shares the folders with the container user, and `<settings>` stays protected by the user profile's ACL |

## 1. Check the project

1. Get `<home>`. Run `git --version` and `claude --version`; either fails: reply `setup-operator needs git and the claude CLI on PATH.` and stop.
2. Follow "Start Docker" in `../start-operator/start.md`. Outcome `docker: running` or `docker: started`: continue. Any other outcome: Docker is missing or not running. This setup then writes nothing to `<settings>` and skips steps 1.4, 1.5, 3, 4.2, 5, 6 and 7. The report says `reads work from the clone; the index needs Docker: <the outcome after "docker: ">, then run setup-operator again`, and lists, under "to add by hand", `KB_PATH` = `<KB_PATH>`, the deny rule `Read(/.claude/settings.local.json)` and the allow rules for the commands that run without Docker (the `printenv`, `git` and `Read` rules of "Allow rules").
3. `git -C "<project>" ls-files --error-unmatch ".claude/settings.local.json"` exits 0: the file is tracked, and a password in it would be committed. Reply `<settings> is tracked by git; untrack it (git rm --cached) and add it to .gitignore, then run setup-operator again.` and stop. Any other exit code (untracked, or no git repository): continue. In a git repository, `git -C "<project>" check-ignore -q ".claude/settings.local.json"` exits 1: the file is not ignored and could still be committed; the report says `add .claude/settings.local.json to .gitignore`.
4. `docker pull <mcp image>`.
5. Protect the settings: merge (section "Merge into the settings") a fragment with `permissions.deny` = `["Read(/.claude/settings.local.json)"]` and `permissions.allow` = `["Read(//<plugins folder>/**)"]` (see "Allow rules"). Its `<password state>` is the state for the steps below.
6. Read `KB_PATH` (`printenv KB_PATH`, or `[Environment]::GetEnvironmentVariable('KB_PATH')`). Set: the project already has a KB. Follow "Locate the KB" in `runtime.md`; it passes: `<kb>`, `<clone>` and `<KB_PATH>` are known, skip steps 2.1 to 2.6. It stops: reply its message plus `KB_PATH points to <value>; fix or remove it in <settings>, then run setup-operator again.` and stop; never replace a `KB_PATH` yourself.

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
7. Read `NEO4J_SHELL` (`printenv NEO4J_SHELL`, or `[Environment]::GetEnvironmentVariable('NEO4J_SHELL')`). It is set and differs from `<NEO4J_SHELL>`: the project uses another store, such as a local Neo4j. That is a store switch. Ask exactly: `This project's NEO4J_SHELL is <value>. This setup would replace it with <NEO4J_SHELL>, the Docker store neo4j-<kb>, so every query goes there. Switch?` Yes: step 4.2 replaces the key (`replace_env`). Anything else: reply `kept the current store; nothing was set up` and stop. Never keep a differing `NEO4J_SHELL` silently.

## 3. Docker and the Neo4j container

1. Network: `docker network inspect --format '{{.Internal}}' kb-<kb>`.
   - It fails (no such network): `docker network create --internal kb-<kb>`.
   - It prints `false`: the network has internet access. With a container `neo4j-<kb>` (step 3a), that is part of what step 3a.4 collects. Without one, ask exactly: `The Docker network kb-<kb> has internet access. Replace it with an internal network of the same name? It holds no data.` Yes: `docker network rm kb-<kb>`, then `docker network create --internal kb-<kb>`; the report names the change. Anything else: stop. `docker network rm` fails because another container is attached: reply its error line and stop.
2. `docker ps -a --filter 'name=^neo4j-<kb>' --format '{{.Names}}'` lists the KB's containers. Only the exact names `neo4j-<kb>` and `neo4j-<kb>.previous` count; any other name in the list belongs to another KB id and is ignored.
   - `neo4j-<kb>` and `neo4j-<kb>.previous` both: an earlier recreate kept both after a failure on a new image (step 3a.7.7). Reply `neo4j-<kb> (new image, stopped) and neo4j-<kb>.previous (old image) both exist from an earlier recreate whose step <step, if the report named it> failed. Fix that cause and run docker start neo4j-<kb>, then docker rm neo4j-<kb>.previous once it runs; the old image cannot open the upgraded data.` and stop.
   - Only `neo4j-<kb>.previous`: an earlier recreate stopped between renaming the old container and finishing. Ask `An earlier run left the old container as neo4j-<kb>.previous (stopped). Restore it as neo4j-<kb> and continue?` Yes: `docker rename neo4j-<kb>.previous neo4j-<kb>`, then step 3a. Anything else: stop.
   - `neo4j-<kb>`: step 3a. Neither: step 3b.

### 3a. Reuse the container

1. Inspect it. Never print `.Config.Env` or any env value except as step 3a.7 allows: it can hold the password.

   ```
   docker inspect --format '{{.State.Status}} {{.Config.Image}} {{.HostConfig.RestartPolicy.Name}} {{json .HostConfig.PortBindings}} {{range .Mounts}}{{.Source}}={{.Destination}} {{end}}| {{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' neo4j-<kb>
   ```

   `<old image>` is `.Config.Image`, the tag shown in the question; `<old image id>` is `docker inspect --format '{{.Image}}' neo4j-<kb>`, the image the container actually runs. `<same image>` holds when `<old image id>` equals `docker image inspect --format '{{.Id}}' <image>` (after `docker pull <image>`); `<ports>` are its published ports, from `.HostConfig.PortBindings`; `<networks>` are the networks after the `|`, and `<other networks>` those other than `kb-<kb>`; `<data>` is the source mounted at `/data`.

   The names of its env keys, never their values, and those its image sets itself, and whether authentication is off, by `NEO4J_AUTH=none` or `NEO4J_dbms_security_auth__enabled=false` in any letter case (prints `auth-none` or nothing):

   ```
   docker inspect --format '{{range .Config.Env}}{{index (split . `=`) 0}} {{end}}' neo4j-<kb>
   docker image inspect --format '{{range .Config.Env}}{{index (split . `=`) 0}} {{end}}' <old image id>
   docker inspect --format '{{range .Config.Env}}{{if or (eq (lower .) `neo4j_auth=none`) (eq (lower .) `neo4j_dbms_security_auth__enabled=false`)}}auth-none{{end}}{{end}}' neo4j-<kb>
   ```

   `<own keys>` are the container's keys that its image does not set.
2. Follow "Start the container" in `../start-operator/start.md`. Outcome `neo4j: not started` or `neo4j: Bolt does not answer`: reply it with its details and stop.
3. `docker exec neo4j-<kb> printenv NEO4J_PLUGINS NEO4J_apoc_import_file_enabled NEO4J_server_directories_import NEO4J_dbms_security_procedures_allowlist`.
4. Collect what needs a new container: `NEO4J_PLUGINS` without `apoc`; `NEO4J_apoc_import_file_enabled` not `true`; `NEO4J_server_directories_import` not `/import`; `NEO4J_dbms_security_procedures_allowlist` not equal to its line in `<scripts>/neo4j.env`; no mount of `<import>` at `/import`; any published port (`<ports>` not empty); the network `kb-<kb>` not internal (step 3.1 printed `false`); any network other than `kb-<kb>` (`<other networks>` not empty), since each one may route outside.
5. Nothing collected: fix in place what can be. Restart policy not `unless-stopped`: `docker update --restart unless-stopped neo4j-<kb>`. `docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' kb-<kb>` lacks `neo4j-<kb>`: `docker network connect kb-<kb> neo4j-<kb>`. Continue at step 3a.8.
6. Something collected and no `/data` mount: the data sits inside the container and a new container would lose it. Reply `neo4j-<kb> lacks <list> and keeps its data inside the container; recreating it would lose the data. Export what you need, remove it yourself, and run setup-operator again.` and stop.
7. Something collected: sort the `<own keys>` with the script, which reads only the names:

   ```
   docker run --rm --network none -v "<scripts>:/s:ro" --entrypoint python <mcp image> /s/sort-env-keys.py <own keys>
   ```

   Each line is `<group> <key>`:
   - `own`: set by the new container itself, from `neo4j.env` (`NEO4J_PLUGINS`, `NEO4J_apoc_import_file_enabled`, `NEO4J_server_directories_import`, `NEO4J_dbms_security_procedures_allowlist`).
   - `skip`: not carried over. The key contains, ignoring case, `PASS`, `PWD`, `SECRET`, `TOKEN`, `KEY`, `CRED`, `AUTH` or `URL`, or has `URI` as a whole word between `_`, `.` or `-`. Its value may be a credential, and carrying a value means reading it, so it is never read. `NEO4J_AUTH` and `NEO4J_dbms_security_auth__enabled` are among them; the auth note covers what they did.
   - `carry`: carried over. Read each value on its own, `docker inspect --format '{{range .Config.Env}}{{if eq (index (split . `=`) 0) `<key>`}}{{.}}{{end}}{{end}}' neo4j-<kb>`, and add the printed `<key>=<value>` line to `neo4j.env` (step 4.1).

   `<auth note>`:
   - Authentication on (step 3a.1 printed nothing): `the same password, which stays in <data>`.
   - Authentication off (`auth-none`): `authentication, now off, turned on with a newly generated password; answer "keep auth off" to keep it off instead`.

   Then ask exactly this, and accept only an explicit yes (or, with authentication off, `keep auth off`) to it:

   `neo4j-<kb> lacks <list>. Recreate it? I would stop the container neo4j-<kb>, keep it as neo4j-<kb>.previous until the new one runs, then remove it, and start the new one as setup-operator does: image <old image> → neo4j:2026.06.0<image note>; the same data folder <data>; no published ports any more (now <ports, or none>), since cypher-shell runs through docker exec; the internal network kb-<kb> with no internet access<network note>, and no other network (now <other networks, or none>); APOC limited to the plugin's procedures; the mounts <other mounts> unchanged; the env keys <carried keys> carried over; the env keys <keys not carried> not carried over, because their values may be credentials, which this setup never reads (set them again yourself if they are needed); <auth note>.`

   `<network note>`: empty when `kb-<kb>` is already internal; otherwise `, which replaces the current kb-<kb> network`. `<image note>`: empty with `<same image>`; otherwise `, which upgrades the store on first start: the old image cannot open it afterwards, and a newer old image's store does not open at all`. An empty list is written `none`.

   Authentication off, and `<password state>` is `present`: before asking, reply `<settings> already holds a NEO4J_PASSWORD, but neo4j-<kb> runs without authentication; remove that key from <settings>, then run setup-operator again.` and stop; nothing is changed.

   No, or anything else: skip steps 5, 6 and 7; the report names `<list>`. Otherwise:
   1. `docker stop -t 60 neo4j-<kb>` (time for a clean shutdown), then `docker rename neo4j-<kb> neo4j-<kb>.previous`. The dot keeps the name apart from every KB id, which has none. From here on, any failure or stop before step 3a.7.6, a merge `error:` of step 4.2 included, goes to step 3a.7.7.
   1b. `kb-<kb>` not internal: `docker network disconnect kb-<kb> neo4j-<kb>.previous` when it is attached, then `docker network rm kb-<kb>` and `docker network create --internal kb-<kb>`.
   2. `keep auth off`: add `NEO4J_AUTH=none` to `neo4j.env` (step 4.1) and leave `NEO4J_PASSWORD` out of the fragment (step 4.2).
   3. Authentication was off and the answer was yes: step 4 with the placeholder in the fragment, then step 5.1b; otherwise step 4.
   4. Create `<queries>` (Commands per OS), which also creates `<import>`; on macOS and Linux run the `chmod 755` line. The new container mounts `<import>` at `/import`, and a missing folder would be created by Docker, as another user on Linux.
   5. Step 5.2 to 5.5 with this `<data>`; each further mount is passed again as `-v "<source>:<destination>"`.
   6. All of step 5 passed: `docker rm neo4j-<kb>.previous`.
   7. A failure after the rename:
      - Not `<same image>`, and the `docker run -d` of step 5.2 exited 0: the new image may already have upgraded the store, and the old image cannot open it again. Do not roll back. `docker stop -t 60 neo4j-<kb>`, keep both containers, and report: `recreate of neo4j-<kb> failed at step <step>: <reason>. Both containers are kept: neo4j-<kb> (new image, stopped) and neo4j-<kb>.previous (old image), which cannot open the upgraded data. Fix the cause, run docker start neo4j-<kb>, then docker rm neo4j-<kb>.previous.`
      - Otherwise roll back: `docker rm -f neo4j-<kb>` (always; a `No such container` error is expected), then `docker rename neo4j-<kb>.previous neo4j-<kb>` and `docker start neo4j-<kb>`; when step 3a.7.1b disconnected it, also `docker network connect kb-<kb> neo4j-<kb>` (the network is internal now). Never recreate a network without `--internal`. When step 3a.7.1b replaced `kb-<kb>` and that was the old container's only network, the report says: `the restored neo4j-<kb> sits on the internal network kb-<kb>, so its host ports <ports> no longer answer. To get them back, recreate the network without --internal yourself: docker network disconnect kb-<kb> neo4j-<kb>, docker network rm kb-<kb>, docker network create kb-<kb>, docker network connect kb-<kb> neo4j-<kb>.` The report names the failed step and the settings state: after a successful step 5.1b, `<settings> now holds a NEO4J_PASSWORD that the restored neo4j-<kb> (authentication off) does not use; remove that key before running setup-operator again`; otherwise `<settings>` is as step 4.2 left it.
8. Authentication on and `<password state>` is `absent`: the container's password is not in this project. Never reset it, and never ask for it during this run: the report says, under "to add by hand", `NEO4J_USERNAME and NEO4J_PASSWORD of neo4j-<kb>, into the env of <settings>, after this setup finishes`.

### 3b. A new container

1. `<data>` holds any entry (Glob tool, `<data>/**`): data without a container.
   - `<password state>` is `present`: an earlier run of this setup set the password in `<data>` and `<settings>`, and its container did not start. Continue at step 3b.3 and skip step 5.1; if the load check of step 7 then fails to log in, the report says `remove <data> and the NEO4J_PASSWORD key of <settings>, then run setup-operator again`.
   - Otherwise reply `<data> holds Neo4j data but no container neo4j-<kb> exists; a new container with a new password cannot open it. Remove <data> if the data is not needed, or tell me how to continue.` and stop.
2. `<password state>` is `present` and `<data>` is empty: `<settings>` holds a password for a container and data that are gone. Reply `<settings> holds a NEO4J_PASSWORD, but neo4j-<kb> and its data no longer exist. Remove the NEO4J_PASSWORD key from <settings> yourself, then run setup-operator again.` and stop.
3. Create `<data>` and `<queries>` (Commands per OS); on macOS and Linux run the `chmod 755` line.

## 4. Write the project settings

1. Write `<kb folder>/neo4j.env` with the file tools, unless its text already equals what this step would write (read both files with the Read tool and compare): the lines of `<scripts>/neo4j.env` exactly (APOC, file import confined to `/import`, the procedure allowlist), followed by the lines a recreate adds (step 3a.7).

2. Merge (section "Merge into the settings") a fragment with:
   - `env`: `KB_PATH` = `<KB_PATH>`, `NEO4J_SHELL` = `<NEO4J_SHELL>`, `NEO4J_USERNAME` = `neo4j`, `NEO4J_DATABASE` = `neo4j`; for a new container, or a recreate that turns authentication on, also `NEO4J_PASSWORD` = `__KB_PASSWORD__`, a placeholder that step 5.1 replaces.
   - `replace_env`: `["NEO4J_SHELL"]` when the developer confirmed the store switch of step 2.7; otherwise leave it out. The script replaces only the listed keys among `KB_PATH`, `NEO4J_SHELL`, `NEO4J_USERNAME` and `NEO4J_DATABASE`, and reports `replaced env <key>: was …, now …`.
   - `permissions.allow`: the rules of "Allow rules" below, except the `<NEO4J_SHELL>` query rule.
   - `permissions.deny`: `Read(/.claude/settings.local.json)`.

   Its `<password state>` is the state from here on. `<database>`: the current value from `conflict env NEO4J_DATABASE: current <value>, …` when the merge printed that line; otherwise `neo4j`.
3. Merge a second fragment with only `permissions.allow` = the `<NEO4J_SHELL>` query rule, rendered with `<database>`. It now matches the database every query uses.

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
Bash(<NEO4J_SHELL> -d <database> --format plain -f /import/queries/*)
Bash(chmod 644 "<import>/kb-export.json.tmp")
Bash(rm "<import>/kb-export.json")
Bash(mv "<import>/kb-export.json.tmp" "<import>/kb-export.json")
Read(//<plugins folder>/**)
Read(//<kb folder>/**)
Edit(~/.kb/<kb>/import/queries/*.cypher)
Edit(~/.kb/<kb>/worktrees/*/**/*.md)
Edit(~/.kb/<kb>/worktrees/*.commit-message)
Edit(~/.kb/<kb>/worktrees/*.pull-request.json)
Edit(~/.kb/<kb>/worktrees/*.pr-title)
Edit(~/.kb/<kb>/worktrees/*.pr-description)
mcp__kb-<kb>__*
```

- `<plugins folder>`: the parent folder of the plugin root (the plugin root is two folders above this skill's directory). The skills read their shared files there (`runtime.md`, the contract, the query files), and the rule covers every installed plugin version.
- `//<plugins folder>/**` and `//<kb folder>/**` are absolute paths without their leading `/`, after `//`; on Windows in the form `//c/Users/…` with forward slashes. The KB folder is readable only; it is not an additional working directory, so no permission mode, `acceptEdits` included, edits anything under it beyond the `Edit` rules above.
- Every `Bash` rule but one is an exact command. The `Edit` rules admit only text no program runs as code: `.cypher` files in the query folder, which only `cypher-shell` reads; Markdown documents in a worktree; and the writer's message files next to the worktrees. A script, `package.json`, a `.git` file or a companion change of another type in a worktree prompts, with its content shown, before it is written. So a later approved command, such as `pr.pre_commit`, runs only code the developer has seen.
- Accepted risk, the one wildcard rule: the trailing `*` of the `<NEO4J_SHELL>` rule admits any further `cypher-shell` arguments. Together with the `Edit` rule on the query folder, a session can write and run any Cypher against this KB's own store, which holds only the rebuildable index. Nothing leaves the machine that way: the store has no network route outside Docker, so `LOAD CSV` and APOC loads from a URL fail, APOC outside the allowlist is not loaded, file loads stay in `/import`, and an inserted `-a <host>` reaches only containers on `kb-<kb>`.
- Not pre-allowed, so these prompt, unless the developer's own permission mode, rules or hooks allow them:
  - the export command, once per reindex, with its `cd` into the clone;
  - `pr.pre_commit`, with its `cd` into the worktree;
  - the writer's git work: `git -C "<clone>" remote get-url origin`, the worktree and branch, the remote branch check, staging, commit and push;
  - the pull request call: `gh --version` and `gh api …`, or `az --version` and `az repos pr create …`;
  - a companion change that is not a Markdown file.

  Each could be widened into a prompt-free file read, file write or program run: a `*` there matches any text, inserted flags included, and the export and `pre_commit` commands run code from their working directory.

## 5. Password and start

A new or recreated container only. A reused container (step 3a.5) skips to step 6.

1. New container only, with `<password state>` `placeholder`: one throwaway container generates the password, sets it as Neo4j's initial password in `<data>`, and replaces the placeholder in `<settings>`:

   ```
   docker run --rm --network none -v "<data>:/data" -v "<project>/.claude:/w" -v "<scripts>:/s:ro" --entrypoint sh <image> /s/new-password.sh
   ```

   1b. A recreate that turns authentication on, with `<password state>` `placeholder`: instead, a throwaway container of the old container's own image (`<old image id>`, kept locally while `neo4j-<kb>.previous` exists) starts Neo4j on `<data>` with authentication off, sets a newly generated password with `ALTER USER`, replaces the placeholder in `<settings>`, and stops. The old image leaves the store format as it is, so the rollback of step 3a.7 still opens it:

   ```
   docker run --rm --network kb-<kb> -e NEO4J_AUTH=none -v "<data>:/data" -v "<project>/.claude:/w" -v "<scripts>:/s:ro" --entrypoint bash <old image id> /s/reset-password.sh
   ```

   `<password state>` `present` never reaches step 5.1 or 5.1b: steps 3a.7, 3b.1 and 3b.2 have already stopped or skipped it.

   Both pass the password to `neo4j-admin` (`@/tmp/pw`, an argument file), `cypher-shell` (`-f`) and `sed` (`-f`) only through files in the container's own `/tmp`, which goes away with the container.

   Exit code 3: no placeholder in `<settings>`; the developer's own `NEO4J_PASSWORD` is there. Reply `<settings> already holds a NEO4J_PASSWORD; remove it, or answer "keep auth off", then run setup-operator again.` and stop. Any other non-zero exit code: reply `the password step failed with exit code <code>; nothing was started` and stop. `<settings>` is unchanged, since the scripts write it only as their last step. For a new container, also remove `<data>`, which this run created (Commands per OS), so the next run starts clean. For a recreate, go to step 3a.7.7, which rolls back: with authentication off, the old container opens `<data>` whether or not `ALTER USER` ran.
2. Start Neo4j:

   ```
   docker run -d --name neo4j-<kb> --restart unless-stopped --network kb-<kb> -v "<data>:/data" -v "<import>:/import" --env-file "<kb folder>/neo4j.env" <image>
   ```

3. Follow "Wait for Bolt" in `../start-operator/start.md`. Outcome `neo4j: Bolt does not answer`: reply it with its log lines and stop.
4. The container user can write the data and read the import folder: `docker exec -u neo4j neo4j-<kb> test -w /data/databases` and `docker exec -u neo4j neo4j-<kb> ls /import`. Either fails: reply `the Neo4j container user cannot use <data> or <import>; on Linux make <data> writable and <import> readable for uid 7474 (or run Docker rootless), then run setup-operator again.` and stop.
5. APOC is installed: `docker exec neo4j-<kb> ls /var/lib/neo4j/plugins` lists a file starting with `apoc`. Otherwise reply the listing and stop.

## 6. Register the MCP server

1. In `<project>`: `claude mcp get kb-<kb>`. It exists: its command and arguments must be exactly those of step 6.2; equal: keep it. Different: ask exactly `kb-<kb> is registered as <current command and arguments>; setup-operator registers <command and arguments of step 6.2>. Replace the registration?` Yes: `claude mcp remove -s local kb-<kb>`, then step 6.2. Anything else: keep it; the report names the difference and the action `run claude mcp remove -s local kb-<kb> in <project>, then run setup-operator again`.
2. It does not exist, in `<project>`:

   ```
   claude mcp add -s local kb-<kb> -- docker run -i --rm --network kb-<kb> -e NEO4J_URI=bolt://neo4j-<kb>:7687 -e NEO4J_USERNAME -e NEO4J_PASSWORD -e NEO4J_DATABASE <mcp image> mcp-neo4j-cypher --read-only --schema-sample-size 1000
   ```

   The bare `-e` flags copy the values from the Claude Code session's environment, which the `env` of `<settings>` supplies; the password never appears in the registration. `--read-only` removes the write tool, so the server offers `mcp__kb-<kb>__get_neo4j_schema` and `mcp__kb-<kb>__read_neo4j_cypher`. `--schema-sample-size 1000` is required: without it, `get_neo4j_schema` called without a sample size sends `{sample: None}` to Neo4j and fails.

## 7. Build and check the index

The new `env` and the MCP server reach only new sessions, so each check runs in a fresh session started in `<project>` with `claude -p`. The setup is done only when all three checks pass. A setup that skipped this step (Docker missing in step 1.2, a recreate declined in step 3a.7) reports `index: not ready — <that reason>`.

1. **Load.** The load runs the manifest's export. The export is not pre-allowed, and a headless session cannot ask, so this one session gets an explicit one-time grant for exactly the two commands update-operator runs (its step 6.2):
   - Fast-forward the clone first, as update-operator's steps 2.3 and 2.4 do: `git -C "<clone>" fetch --quiet origin`, then `git -C "<clone>" merge --ff-only --quiet origin/<default>`. The session then exports the commit the grant names.
   - `<commit>`: `git -C "<clone>" rev-parse HEAD`; `<export command>`: the manifest's `export.cmd` with `{ref}` replaced by `"<commit>"` and `{out}` by `"<import>/kb-export.json.tmp"`, as update-operator renders it.
   - `<export command>` contains `*`, `;`, `&`, `|`, `)`, a backtick or a line break: it cannot be granted exactly. Run the session without the `--allowedTools` part; the export is refused there, and the failure action is `run "fetch: kb <first resource name of the manifest>" once in an interactive session in <project>, then run setup-operator again`.
   - Otherwise, allowing up to 10 minutes:

     ```
     claude -p "Use the knowledge-base:update-operator skill and reply with its report block only" --allowedTools 'Bash(cd "<clone>")' 'Bash(<export command>)'
     ```

     The grant holds for that one session only, and it names the export with its commit, so it covers no other export run.
   - After the session, `git -C "<clone>" rev-parse HEAD` is `<head>`: the session fast-forwards the clone itself, so `<head>` differs from `<commit>` when `origin/<default>` moved in between.
   - Passes when the reply's `index:` line is `loaded` or `current`, its `commit:` line equals `<head>`, and its `docs:` line is a number of at least 1. Otherwise the reason is the reply's `index:` line, `the index holds no documents`, or `the index is at <reply commit>, the clone at <head>`.
2. **Full-text index and test title.** With the MCP server registered (step 6):

   ```
   claude -p "Run these two queries with the tool mcp__kb-<kb>__read_neo4j_cypher and reply with the result rows of each, under the headings fulltext and title: SHOW FULLTEXT INDEXES YIELD name, state, populationPercent WHERE name = 'kb_fulltext' RETURN state, populationPercent; MATCH (d:Doc {kb: '<kb>'}) WHERE d.title <> '' AND all(c IN split(d.title, '') WHERE toLower(c) <> toUpper(c) OR (c >= '0' AND c <= '9') OR c IN [' ', '.', ',', ':', '-']) RETURN d.title AS title ORDER BY d.path LIMIT 1" --allowedTools 'mcp__kb-<kb>__read_neo4j_cypher'
   ```

   The second query picks `<title>` for check 3: the title of the first document by path that holds only letters with an upper and a lower case, digits, spaces and `-` `.` `,` `:`. None of them is special inside double quotes in bash, zsh or PowerShell, so the title can go on the command line; the query itself holds no `$`, backslash or double quote for the same reason. Never pick the title any other way.

   Passes when the state under `fulltext` is `ONLINE`. `POPULATING`: run this check once more after check 3, and only that second state counts. No row, another state or a tool error: the reason is `kb_fulltext is <state, or "missing">`, or the error line. No MCP server: the reason is `the MCP server kb-<kb> is not registered`.
3. **Explore through MCP.** No row under `title` in check 2: the check fails with `no document title fits on a command line; run "explore: kb <a title>" in an interactive session in <project>`. Otherwise:

   ```
   claude -p "Use the knowledge-base:access-orchestrator skill: explore: kb <title>"
   ```

   Passes when the reply names the MCP server `kb-<kb>` as the source (content-provider's header `explore via MCP kb-<kb>`, or a sentence naming `kb-<kb>` as the MCP server it searched through) and lists at least one hit (`1. <path> — …`). `explore via fixed queries` or no mention of `kb-<kb>`: the session did not reach the MCP server. `No documents match.`: the search found nothing.

`index: ready` only when checks 1 to 3 pass. Otherwise `index: not ready — <check>: <reason>; <action>`, with the first failed check. The action is the one named above, or else `fix the cause and run setup-operator again`: every step reuses what is already set up, so a second run repeats only what is missing and this step. Relay each reply verbatim in the report: a permission denial or a provider message there is often the only reason shown.

## 8. Report

```
KB <kb> for <project>
clone: <clone> (<new | reused>) at <first 7 characters of HEAD>
KB_PATH: <KB_PATH>
neo4j: neo4j-<kb> (<new | reused | recreated | not set up: reason>), internal network kb-<kb>, no published ports, data <data>
mcp: kb-<kb> (<registered | kept | replaced | kept, differs: <difference>; <action> | not set up: reason>)
settings: <settings> (<added entries, or "unchanged">)
conflicts: <each conflict line of the merges, or "none">
to add by hand: <each missing key or rule, or "nothing">
index: <ready (<docs> docs at <first 7 characters of <head>>, kb_fulltext ONLINE, explore via MCP kb-<kb>) | not ready — <check>: <reason>; <action>>
load: <reply of 7.1, verbatim>
fulltext: <reply of 7.2, verbatim>
explore: <reply of 7.3, verbatim>
```

On Windows add: `permissions: not enforced on Windows (no chmod); <settings> is protected only by the user profile.`

## Common mistakes

| Mistake | Instead |
|---|---|
| Reading `<settings>` with the file tools, `cat` or Grep, or printing `docker inspect` `.Config.Env` | Change it only through the merge script; inspect only the fields of step 3a.1 |
| Putting the password or `NEO4J_AUTH=…` on a command line, or asking for a password during the run | The scripts of step 5.1 generate it in place; a password the developer adds goes under "to add by hand" |
| Recreating a container, or replacing a `KB_PATH`, `env` value or MCP registration, because it differs | Name the difference; recreate a container only on the explicit yes of step 3a.7, replace an MCP registration only on the explicit yes of step 6.1 |
| Retrying a settings merge that auto mode denied, in another form or without the merge | Stop with the auto-mode reply of "Merge into the settings" |
| Starting a new container on a data folder that already holds data | Stop and ask (step 3b.1) |
| Running the export or the load yourself | The load check of step 7 runs them in a fresh session |
| Reporting the setup as done while the index is empty, behind the clone or not searchable | `index: ready` only when all checks of step 7 pass; otherwise `not ready` with the failed check and its action |
| Checking the index or the MCP server in this session | This session has neither the new `env` nor the server; use fresh sessions |
| Writing into the clone or the KB repository | The clone is read-only; writes go through `knowledge-base:article-writer` |
