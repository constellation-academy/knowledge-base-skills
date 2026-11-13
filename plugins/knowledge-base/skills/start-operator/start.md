# KB start mechanics

How the `knowledge-base` skills start Docker and an existing Neo4j container `neo4j-<kb>`, and wait until it answers. `start-operator` and `setup-operator` follow these sections; neither runs its own start or wait commands. Each section ends in an outcome that the calling skill acts on.

The shell rules in `../update-operator/runtime.md` (section "Shell rules") apply, except the lines in "Commands per OS" below, whose wait loops need `&&` and `$(…)`, and the single-quoted Docker `--format` and `--filter` literals and the script passed to `bash -c` inside a container. These sections only start and wait: they never create, remove, rename or reconfigure a container or network, and never read a settings file or a container's env.

## Commands per OS

The session's OS picks the column. Claude Code running inside WSL is Linux.

| Step | macOS | Windows (PowerShell) |
|---|---|---|
| Docker Desktop is installed | `test -d "/Applications/Docker.app"` | `Test-Path "C:\Program Files\Docker\Docker\Docker Desktop.exe"` |
| start Docker Desktop | `open -a Docker` | `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` |
| wait for Docker, up to 2 minutes | `bash -c 'for i in $(seq 60); do docker version --format "{{.Server.Version}}" && exit 0; sleep 2; done; exit 1'` | `for ($i = 0; $i -lt 60; $i++) { docker version --format '{{.Server.Version}}'; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }; docker version --format '{{.Server.Version}}'` |

On Linux, and on Windows without Docker Desktop (Docker Engine inside a WSL distro), starting the Docker daemon needs root, so the developer starts it.

## Start Docker

1. `docker version --format '{{.Server.Version}}'` prints a version: outcome `docker: running`.
2. It fails on Linux: outcome `docker: not running — start the Docker daemon: sudo systemctl start docker (sudo service docker start where systemd is off; Docker Desktop for Linux: systemctl --user start docker-desktop)`.
3. It fails on macOS or Windows: check that Docker Desktop is installed (Commands per OS).
   - Not installed on Windows: outcome `docker: not running — no Docker Desktop found; start Docker Engine in your WSL distro: open it with wsl, then sudo systemctl start docker (sudo service docker start where systemd is off)`.
   - Not installed on macOS: outcome `docker: not installed — install Docker Desktop`.
4. Installed: start Docker Desktop and wait for Docker (Commands per OS). The wait prints a version: outcome `docker: started`. It does not: run `docker version --format '{{.Server.Version}}'` once more; outcome `docker: not running — Docker Desktop did not start (<its first error line>); start it by hand and answer any prompt it shows`.

## Start the container

The caller has made sure that `neo4j-<kb>` exists.

1. `docker inspect --format '{{.State.Status}}' neo4j-<kb>`.
   - `running` or `restarting`: go to step 2.
   - `paused`: `docker unpause neo4j-<kb>`.
   - Any other state (`created`, `exited`, `dead`): `docker start neo4j-<kb>`.
   - The unpause or start fails: outcome `neo4j: not started — <its first error line>`.
2. Wait for Bolt (next section). Its outcome is this section's outcome, with `started` when step 1 started or unpaused the container, else `running`.

## Wait for Bolt

Up to three minutes; a first start installs APOC:

```
docker exec neo4j-<kb> bash -c 'for i in $(seq 90); do (echo > /dev/tcp/127.0.0.1/7687) 2>/dev/null && exit 0; sleep 2; done; exit 1'
```

Exit 0: outcome `neo4j: <running | started>, Bolt answers`. Otherwise: outcome `neo4j: Bolt does not answer`, with the output of `docker logs --tail 20 neo4j-<kb>`.
