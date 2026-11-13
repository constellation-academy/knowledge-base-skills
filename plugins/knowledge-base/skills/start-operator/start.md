# KB start mechanics

How the `knowledge-base` skills start Docker and an existing Neo4j container `neo4j-<kb>`, and wait until it answers. `start-operator` and `setup-operator` follow these sections; neither runs its own start or wait commands. Each section ends in an outcome that the calling skill acts on.

The shell rules in `../update-operator/runtime.md` (section "Shell rules") apply, except the lines in "Commands per OS" below, whose wait loops need `&&` and `$(…)`, and the single-quoted Docker `--format` and `--filter` literals and the script passed to `bash -c` inside a container. These sections only start and wait: they never create, remove, rename or reconfigure a container or network, and never read a settings file or a container's env.

## Commands per OS

The session's OS picks the column; Linux uses only the first row and the two wait rows. Claude Code running inside WSL is Linux.

| Step | macOS, Linux | Windows (PowerShell) |
|---|---|---|
| where the docker CLI is | `command -v docker` | `(Get-Command docker -ErrorAction SilentlyContinue).Source` |
| `<desktop>`, the Docker Desktop app | `/Applications/Docker.app` | the docker CLI's path with its ending `\resources\bin\docker.exe` replaced by `\Docker Desktop.exe`; a path with another ending has no `<desktop>` |
| `<desktop>` exists | `test -d "/Applications/Docker.app"` | `Test-Path "<desktop>"` |
| start Docker Desktop | `open -a Docker` | `Start-Process "<desktop>"` |
| wait for Docker, up to 2 minutes | `bash -c 'for i in $(seq 60); do docker version --format "{{.Server.Version}}" && exit 0; sleep 2; done; exit 1'` | `for ($i = 0; $i -lt 60; $i++) { docker version --format '{{.Server.Version}}'; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }; docker version --format '{{.Server.Version}}'` |
| wait for Bolt, up to 3 minutes | `bash -c 'for i in $(seq 90); do docker exec neo4j-<kb> bash -c "(echo > /dev/tcp/127.0.0.1/7687) 2>/dev/null" && exit 0; sleep 2; done; exit 1'` | `for ($i = 0; $i -lt 90; $i++) { docker exec neo4j-<kb> bash -c '(echo > /dev/tcp/127.0.0.1/7687) 2>/dev/null'; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }; docker exec neo4j-<kb> bash -c '(echo > /dev/tcp/127.0.0.1/7687) 2>/dev/null && echo bolt-ok'` |

On macOS and Windows the Docker engine runs in Docker Desktop's Linux VM, so starting Docker means starting Docker Desktop. On Windows, Docker Desktop is installed per user under `%LOCALAPPDATA%\Programs\DockerDesktop` or per machine under `C:\Program Files\Docker\Docker`; its docker CLI sits in `resources\bin` below that folder in both, so `<desktop>` is found from the CLI. Other runtimes (Colima, OrbStack, Rancher Desktop, Docker Engine inside WSL) are not supported. On Linux the engine runs on the host and starting it needs root, so the developer starts it.

## Start Docker

1. `docker version --format '{{.Server.Version}}'` prints a version: outcome `docker: running`.
2. Otherwise find the docker CLI (Commands per OS). It prints nothing: outcome `docker: not installed — install Docker Desktop (macOS, Windows) or Docker Engine (Linux)`.
3. Linux: outcome `docker: not running — start the Docker engine (sudo systemctl start docker)`.
4. macOS or Windows: `<desktop>` (Commands per OS) is missing or does not exist: outcome `docker: not running — no Docker Desktop found next to <the docker CLI's path>; start Docker`.
5. Start Docker Desktop and wait for Docker (Commands per OS). The wait prints a version: outcome `docker: started`. It does not: run `docker version --format '{{.Server.Version}}'` once more; outcome `docker: not running — Docker Desktop did not start (<its first error line>); start it by hand and answer any prompt it shows`.

## Start the container

The caller has made sure that `neo4j-<kb>` exists.

1. `docker inspect --format '{{.State.Status}}' neo4j-<kb>`.
   - `running` or `restarting`: go to step 2.
   - `paused`: `docker unpause neo4j-<kb>`.
   - Any other state (`created`, `exited`, `dead`): `docker start neo4j-<kb>`.
   - The unpause or start fails: outcome `neo4j: not started — <its first error line>`.
2. Wait for Bolt (next section). Its outcome is this section's outcome, with `started` when step 1 started or unpaused the container, else `running`.

## Wait for Bolt

Run "wait for Bolt" (Commands per OS); a first start installs APOC, so it waits up to three minutes. The loop runs on the host and repeats `docker exec` each time, because Docker refuses `docker exec` while a container is `restarting`.

The bash command exits 0, or the PowerShell command's last line is `bolt-ok`: outcome `neo4j: <running | started>, Bolt answers`. Otherwise run `docker inspect --format '{{.State.Status}}' neo4j-<kb>`; outcome `neo4j: Bolt does not answer` (`neo4j: Bolt does not answer — neo4j-<kb> keeps restarting` when it prints `restarting`), with the output of `docker logs --tail 20 neo4j-<kb>`.
