---
name: start-operator
description: Use when the project's knowledge base (KB) index stopped answering on a machine where knowledge-base:setup-operator already ran, typically after a reboot — "KB index unavailable", "Neo4j is not reachable", "start the KB", "start Neo4j", "the KB index is down", "the kb MCP server failed", "run start-operator" — or when a knowledge-base skill reported that knowledge-base:start-operator is needed. Operator: starts Docker and the KB's existing Neo4j container, waits until it answers, and tells the developer how to reconnect the KB's MCP server; never creates, recreates or reconfigures a container, network, MCP registration or setting.
---

# Start the KB stack

Brings back what `knowledge-base:setup-operator` set up, after a reboot or a stopped Docker: Docker, the container `neo4j-<kb>` and the MCP server `kb-<kb>`. It only starts what exists; anything missing or broken goes to `knowledge-base:setup-operator`.

The start and wait steps are in `start.md` in this skill's directory. The shell rules and "Denied or failed commands" in `../update-operator/runtime.md` apply: a command that is denied, or fails where this skill or `start.md` names no outcome, stops the run with the command and the reason.

## Rules

- **Start, never build.** The only changes are those of `start.md`: starting Docker Desktop, `docker start` and `docker unpause` of `neo4j-<kb>`. Never `docker run`, `docker rm`, `docker rename`, `docker network create`, `claude mcp add` or `claude mcp remove`, and never write a settings file: those belong to setup-operator, which asks before each.
- Never touch a container, network or MCP server named for another KB id.
- Never read `.claude/settings.local.json` or a container's env: they hold the Neo4j password, and starting needs no credentials.

## 1. Locate the KB

Follow "Locate the KB" in `../update-operator/runtime.md`. It stops: reply its message and stop. It passes: `<kb>` is the manifest's `kb`.

## 2. Docker

Follow "Start Docker" in `start.md`. Outcome `docker: running` or `docker: started`: go to step 3. Otherwise reply the outcome line plus `Then run knowledge-base:start-operator again.` and stop.

## 3. The Neo4j container

1. `docker ps -a --filter 'name=^neo4j-<kb>' --format '{{.Names}}'`. Only the exact names `neo4j-<kb>` and `neo4j-<kb>.previous` count. No `neo4j-<kb>`, or `neo4j-<kb>.previous` exists: reply `neo4j-<kb> <is missing | has a leftover neo4j-<kb>.previous from an earlier recreate>. Run knowledge-base:setup-operator.` and stop.
2. Follow "Start the container" in `start.md`. Any outcome other than `neo4j: <running | started>, Bolt answers`: reply the outcome with its log lines plus `Fix the cause the log shows, then run knowledge-base:start-operator again.` and stop. setup-operator would stop at the same point, since it starts the container the same way.
3. `docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' neo4j-<kb>` is not `unless-stopped`: the report's `next:` adds `neo4j-<kb> has the restart policy <policy>, not unless-stopped; run knowledge-base:setup-operator to fix it`.

## 4. The MCP server

`claude mcp get kb-<kb>` in the session's working directory, the project root. The `mcp:` line:

- It fails: `kb-<kb> is not registered; run knowledge-base:setup-operator`.
- Docker was `started` in step 2: `in /mcp, reconnect kb-<kb>, or start a new session`. The server starts with the session and runs in Docker, so a session that began while Docker was down holds a failed `kb-<kb>`; the session cannot run `/mcp` itself.
- Otherwise its `Status:` line reads `✔ Connected`: `kb-<kb> connected`. The server reaches Neo4j only per query, so a Neo4j restart needs no reconnect.
- Any other status: `kb-<kb> <status>; run knowledge-base:setup-operator`.

## 5. Report

```
KB <kb>: stack started
docker: <running | started>
neo4j: neo4j-<kb> <running | started>, Bolt answers
mcp: <the line of step 4>
next: <each line below that applies, or "nothing">
```

`next:` lines, in this order:
- Docker was `started`: `if "Start Docker Desktop when you sign in" is off in Docker Desktop's settings, turn it on so the KB comes back after a reboot`;
- the restart-policy line of step 3.3;
- a request of the developer hit the unavailable index: `ask again: <that request>`.

The index is not checked here: the next KB read runs `knowledge-base:update-operator`, which reloads it when it is behind the clone.

## Common mistakes

| Mistake | Instead |
|---|---|
| `docker run` a new `neo4j-<kb>` because the old one is missing or will not start | Stop and name setup-operator: a new container on the same data needs its checks and the developer's yes |
| Running setup-operator after a reboot when the container only stopped | This skill: setup-operator needs manual permission mode and runs headless checks |
| Running `sudo` to start the Docker engine on Linux, or starting another runtime than Docker Desktop | Reply the `docker:` outcome of `start.md`; the developer starts it |
| Sending a container that will not start to setup-operator | Reply the outcome and its log lines; setup-operator starts it the same way and stops there too |
| Reading `.claude/settings.local.json` to find the password or `NEO4J_SHELL` | Not needed: starting the container and the Bolt check use no credentials |
| Reporting the KB as back while the session's `kb-<kb>` tools are still missing | The `mcp:` line tells the developer to reconnect in `/mcp` |
