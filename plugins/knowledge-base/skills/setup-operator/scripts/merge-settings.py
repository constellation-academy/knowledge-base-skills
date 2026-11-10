import json
import os
import sys

PLACEHOLDER = "__KB_PASSWORD__"
SHOWN = {"KB_PATH", "NEO4J_SHELL", "NEO4J_USERNAME", "NEO4J_DATABASE"}
LISTS = ("allow", "deny", "additionalDirectories")


def fail(message):
    print(f"error: {message}; nothing changed")
    sys.exit(2)


def main(fragment_path, settings_path):
    with open(fragment_path, encoding="utf-8") as f:
        fragment = json.load(f)
    exists = os.path.exists(settings_path)
    current = {}
    if exists:
        with open(settings_path, encoding="utf-8") as f:
            raw = f.read()
        if raw.strip():
            try:
                current = json.loads(raw)
            except ValueError:
                fail("the settings file is not valid JSON")
        if not isinstance(current, dict):
            fail("the settings file does not hold a JSON object")

    if not isinstance(current.get("env", {}), dict):
        fail("env in the settings file is not an object")
    permissions_now = current.get("permissions", {})
    if not isinstance(permissions_now, dict):
        fail("permissions in the settings file is not an object")
    for name in LISTS:
        if not isinstance(permissions_now.get(name, []), list):
            fail(f"permissions.{name} in the settings file is not a list")

    lines = []
    wanted_env = fragment.get("env", {})
    if wanted_env:
        env = current.setdefault("env", {})
        for key, value in wanted_env.items():
            if key not in env:
                env[key] = value
                lines.append(f"added env {key}")
            elif env[key] == value:
                lines.append(f"kept env {key}")
            elif key in SHOWN:
                lines.append(f"conflict env {key}: current {env[key]}, wanted {value}")
            else:
                lines.append(f"conflict env {key}")

    wanted_permissions = fragment.get("permissions", {})
    if wanted_permissions:
        permissions = current.setdefault("permissions", {})
        for name in LISTS:
            for entry in wanted_permissions.get(name, []):
                existing = permissions.setdefault(name, [])
                if entry in existing:
                    lines.append(f"kept {name} {entry}")
                else:
                    existing.append(entry)
                    lines.append(f"added {name} {entry}")

    text = json.dumps(current, indent=2, ensure_ascii=False) + "\n"
    if exists:
        with open(settings_path, "w", encoding="utf-8") as f:
            f.write(text)
    else:
        folder = os.path.dirname(settings_path)
        fd = os.open(settings_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        st = os.stat(folder)
        try:
            os.chown(settings_path, st.st_uid, st.st_gid)
        except OSError:
            pass
    try:
        os.chmod(settings_path, 0o600)
    except OSError:
        pass
    os.remove(fragment_path)

    password = current.get("env", {}).get("NEO4J_PASSWORD")
    state = "absent" if password is None else ("placeholder" if password == PLACEHOLDER else "present")
    for line in lines:
        print(line)
    print(f"password: {state}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
