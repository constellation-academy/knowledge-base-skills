# KB start mechanics

How the `knowledge-base` skills start Docker and an existing Neo4j container `neo4j-<kb>`, and wait until it answers. `start-operator` and `setup-operator` follow these sections for every start and wait; the one exception is setup-operator's rollback of a failed recreate, which restarts the renamed old container directly. Each section ends in an outcome that the calling skill acts on.

The shell rules in `../update-operator/runtime.md` (section "Shell rules") apply, except the lines in "Commands per OS" below, whose loops need `&&`, `case` and `$(…)`, and the single-quoted Docker `--format` and `--filter` literals and the script passed to `bash -c` inside a container. These sections only start and wait: they never create, remove, rename or reconfigure a container or network, and never read a settings file or a container's env.

## Supported Docker

- macOS and Windows: Docker Desktop. The Docker engine runs in Docker Desktop's Linux VM, so starting Docker means starting Docker Desktop. On Windows, Docker Desktop is installed per user under `%LOCALAPPDATA%\Programs\DockerDesktop` or per machine under `C:\Program Files\Docker\Docker`; its docker CLI sits in `resources\bin` below that folder, so the app is found from the CLI.
- Linux: Docker Engine on the host. Starting it needs root, so the developer starts it.
- Not supported: other runtimes (Colima, OrbStack, Rancher Desktop, Docker Engine inside WSL) and Claude Code running inside WSL.

## Commands per OS

Use the column of the session's OS.

| Step | macOS | Linux | Windows (PowerShell) |
|---|---|---|---|
| where the docker CLI is | `command -v docker` | `command -v docker` | `(Get-Command docker -ErrorAction SilentlyContinue).Source` |
| inside WSL | no | `uname -r` contains `microsoft` or `WSL`, in any letter case | no |
| Docker Desktop is installed | `test -d "/Applications/Docker.app"` | — | `<desktop>`: the docker CLI's path with its ending `\resources\bin\docker.exe` replaced by `\Docker Desktop.exe`; a path with another ending has none. `Test-Path "<desktop>"` |
| start Docker Desktop | `open -a Docker` | — | `Start-Process "<desktop>"` |
| wait for Docker, up to 2 minutes; run it allowing up to 4 minutes | `bash -c 'for i in $(seq 60); do docker version --format "{{.Server.Version}}" && exit 0; sleep 2; done; exit 1'` | — | `for ($i = 0; $i -lt 60; $i++) { docker version --format '{{.Server.Version}}'; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }; docker version --format '{{.Server.Version}}'` |
| wait for Bolt, up to 3 minutes; run it allowing up to 5 minutes | `bash -c 'for i in $(seq 90); do docker exec neo4j-<kb> bash -c "(echo > /dev/tcp/127.0.0.1/7687) 2>/dev/null" && echo bolt-ok && exit 0; case "$(docker inspect --format "{{.State.Status}}" neo4j-<kb>)" in exited) exit 1;; dead) exit 1;; esac; sleep 2; done; exit 1'` | as macOS | `for ($i = 0; $i -lt 90; $i++) { docker exec neo4j-<kb> bash -c '(echo > /dev/tcp/127.0.0.1/7687) 2>/dev/null'; if ($LASTEXITCODE -eq 0) { break }; if ((docker inspect --format '{{.State.Status}}' neo4j-<kb>) -in 'exited', 'dead') { break }; Start-Sleep 2 }; docker exec neo4j-<kb> bash -c '(echo > /dev/tcp/127.0.0.1/7687) 2>/dev/null && echo bolt-ok'` |

## Start Docker

1. `docker version --format '{{.Server.Version}}'` prints a version: outcome `docker: running`.
2. Otherwise find the docker CLI. It prints nothing: outcome `docker: not installed — install Docker Desktop (macOS, Windows) or Docker Engine (Linux)`.
3. Linux inside WSL: outcome `docker: not running — Claude Code inside WSL is not supported; run it on Windows with Docker Desktop`.
4. Linux: outcome `docker: not running — <the first error line of step 1>; start the Docker engine (sudo systemctl start docker)`.
5. macOS without `/Applications/Docker.app`: outcome `docker: not running — no Docker Desktop in /Applications; start Docker`. Windows without `<desktop>`: outcome `docker: not running — no Docker Desktop next to <the docker CLI's path>; start Docker`.
6. Start Docker Desktop and wait for Docker. The wait's last output line is a version: outcome `docker: started`. Otherwise: outcome `docker: not running — Docker Desktop did not start (<the wait's last error line>); start it by hand and answer any prompt it shows`.

## Start the container

The caller has made sure that `neo4j-<kb>` exists.

1. `docker inspect --format '{{.State.Status}}' neo4j-<kb>`.
   - `running` or `restarting`: `<how>` is `running`; go to step 2.
   - `paused`: `docker unpause neo4j-<kb>`; `<how>` is `started`.
   - Any other state (`created`, `exited`, `dead`): `docker start neo4j-<kb>`; `<how>` is `started`.
   - The unpause or start fails: outcome `neo4j: not started — <its first error line>`.
2. Wait for Bolt. Outcome `neo4j: Bolt answers` becomes `neo4j: <how>, Bolt answers`; any other outcome is this section's outcome.

## Wait for Bolt

Run "wait for Bolt" (Commands per OS); a first start installs APOC, so it waits up to three minutes. The loop runs on the host and repeats `docker exec`, because Docker refuses `docker exec` while a container is `restarting`; it ends early when the container has exited.

The wait's last output line is `bolt-ok`: outcome `neo4j: Bolt answers`. Otherwise run `docker inspect --format '{{.State.Status}}' neo4j-<kb>` and `docker logs --tail 20 neo4j-<kb>`; the outcome carries those log lines:

- `exited` or `dead`: `neo4j: not started — neo4j-<kb> exited`.
- `restarting`: `neo4j: not started — neo4j-<kb> keeps restarting`.
- `running`: `neo4j: Bolt does not answer`.
