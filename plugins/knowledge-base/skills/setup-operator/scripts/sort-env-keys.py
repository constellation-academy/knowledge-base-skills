import re
import sys

SET_BY_NEW = {"NEO4J_PLUGINS", "NEO4J_apoc_import_file_enabled", "NEO4J_server_directories_import"}
SUBSTRINGS = ("PASS", "PWD", "SECRET", "TOKEN", "KEY", "CRED", "AUTH", "URL")
WORDS = ("URI",)


def group(key):
    if key in SET_BY_NEW:
        return "own"
    upper = key.upper()
    if any(part in upper for part in SUBSTRINGS):
        return "skip"
    if any(word in re.split(r"[_.\-]+", upper) for word in WORDS):
        return "skip"
    return "carry"


if __name__ == "__main__":
    for name in sys.argv[1:]:
        print(f"{group(name)} {name}")
